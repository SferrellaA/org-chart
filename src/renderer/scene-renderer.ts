import {
  select,
  zoom,
  zoomIdentity,
  type D3ZoomEvent,
  type ZoomBehavior,
  type ZoomTransform,
} from 'd3';
import { renderExpansionIcon, type ComparisonSide } from './card';
import { HierarchyController, type HierarchyEntry } from './hierarchy-controller';
import type { ActivationHandler, ActivationKind } from './overlay';
import type { RenderScene, SceneAnchor, SceneConnector, SceneNode } from './scene-types';
import type { ChartRenderer } from './types';

const SVG_NAMESPACE = 'http://www.w3.org/2000/svg';
const ACTIVATION_KINDS = new Set<ActivationKind>([
  'node', 'internal', 'hierarchy', 'relationship', 'change',
]);

export interface SceneAdapter<View> {
  className: string;
  worldClassName?: string;
  navigationLabel?: string;
  hierarchy(view: View): readonly HierarchyEntry[];
  initialExpansionIds(view: View): readonly string[];
  layout(view: View, visibleIds: ReadonlySet<string>): RenderScene;
}

export interface SceneRendererOptions {
  onActivate: ActivationHandler;
  transitionDurationMs?: number;
}

function connectorPath(
  source: DOMRect,
  target: DOMRect,
  kind: SceneConnector['kind'],
  worldRect: DOMRect,
  scale: number,
): string {
  const safeScale = scale > 0 ? scale : 1;
  const sourceX = (source.left - worldRect.left + source.width / 2) / safeScale;
  const targetX = (target.left - worldRect.left + target.width / 2) / safeScale;
  if (kind === 'relationship') {
    const sourceY = (source.top - worldRect.top + source.height / 2) / safeScale;
    const targetY = (target.top - worldRect.top + target.height / 2) / safeScale;
    const middleX = (sourceX + targetX) / 2;
    return `M ${sourceX} ${sourceY} C ${middleX} ${sourceY}, ${middleX} ${targetY}, ${targetX} ${targetY}`;
  }
  const sourceY = (source.bottom - worldRect.top) / safeScale;
  const targetY = (target.top - worldRect.top) / safeScale;
  const middleY = (sourceY + targetY) / 2;
  return `M ${sourceX} ${sourceY} C ${sourceX} ${middleY}, ${targetX} ${middleY}, ${targetX} ${targetY}`;
}

export class SceneRenderer<View> implements ChartRenderer<View> {
  private readonly mount = document.createElement('div');
  private readonly world = document.createElement('div');
  private readonly decorations = document.createElement('div');
  private readonly connectorLayer = document.createElementNS(SVG_NAMESPACE, 'svg');
  private readonly nodeLayer = document.createElement('div');
  private readonly navigationTree = document.createElement('div');
  private readonly relationshipDescriptions = document.createElement('div');
  private readonly minimap = document.createElementNS(SVG_NAMESPACE, 'svg');
  private readonly emptyState = document.createElement('div');
  private readonly controller = new HierarchyController();
  private readonly zoomBehavior: ZoomBehavior<HTMLDivElement, unknown>;
  private readonly transitionDurationMs: number;
  private readonly motionQuery: MediaQueryList | undefined;
  private readonly resizeObserver: ResizeObserver | undefined;
  private currentTransform: ZoomTransform = zoomIdentity;
  private currentView: View | undefined;
  private currentScene: RenderScene | undefined;
  private rendered = false;
  private reducedMotion: boolean;
  private destroyed = false;
  private initialFitScheduled = false;
  private hasInitialFit = false;
  private animationFrame: number | undefined;
  private readonly motionHandler = (event: MediaQueryListEvent): void => {
    this.reducedMotion = event.matches;
  };
  private readonly clickHandler = (event: MouseEvent): void => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const toggle = target.closest<HTMLElement>('[data-hierarchy-toggle]');
    if (toggle && this.mount.contains(toggle)) {
      const id = toggle.dataset.hierarchyToggle;
      if (id && this.controller.toggle(id)) {
        this.draw(id);
        this.findToggle(id, toggle.dataset.viewSide as ComparisonSide | undefined)?.focus();
      }
      return;
    }
    const item = target.closest<HTMLElement>('[data-tree-navigation-item]');
    if (item && this.navigationTree.contains(item)) {
      this.activateNavigationItem(item);
      return;
    }
    this.activateFromEvent(event);
  };
  private readonly keyHandler = (event: KeyboardEvent): void => {
    const target = event.target;
    if (target instanceof HTMLElement && target.matches('[data-tree-navigation-item]')) {
      if (this.handleNavigationKey(event, target)) return;
    }
    if (event.key !== 'Enter' && event.key !== ' ') return;
    const trigger = this.activationTrigger(event);
    if (!trigger || trigger instanceof HTMLButtonElement) return;
    event.preventDefault();
    this.activateFromEvent(event);
  };

  constructor(
    private readonly host: HTMLElement,
    private readonly adapter: SceneAdapter<View>,
    private readonly options: SceneRendererOptions,
  ) {
    this.transitionDurationMs = options.transitionDurationMs ?? 700;
    this.motionQuery = typeof matchMedia === 'function'
      ? matchMedia('(prefers-reduced-motion: reduce)')
      : undefined;
    this.reducedMotion = this.motionQuery?.matches ?? false;
    this.motionQuery?.addEventListener?.('change', this.motionHandler);

    this.mount.className = `org-delta-scene-renderer ${adapter.className}`;
    this.world.className = `org-delta-scene-world${adapter.worldClassName ? ` ${adapter.worldClassName}` : ''}`;
    this.world.setAttribute('role', 'group');
    this.world.setAttribute('aria-label', 'Interactive organization diagram');
    this.decorations.className = 'org-delta-scene-decorations';
    this.connectorLayer.classList.add('org-delta-scene-connectors');
    this.nodeLayer.className = 'org-delta-scene-nodes';
    this.navigationTree.className = 'org-delta-tree-navigation';
    this.navigationTree.setAttribute('role', 'tree');
    this.navigationTree.setAttribute(
      'aria-label',
      adapter.navigationLabel ?? 'Organization tree navigation',
    );
    this.relationshipDescriptions.className =
      'org-delta-relationship-descriptions org-delta-visually-hidden';
    this.relationshipDescriptions.setAttribute('aria-label', 'Relationship descriptions');
    this.minimap.classList.add('org-delta-minimap');
    this.minimap.setAttribute('aria-hidden', 'true');
    this.minimap.setAttribute('viewBox', '0 0 160 100');
    this.emptyState.className = 'org-delta-empty-state';
    this.emptyState.hidden = true;
    this.world.append(this.decorations, this.connectorLayer, this.nodeLayer);
    this.mount.append(
      this.world,
      this.emptyState,
      this.relationshipDescriptions,
      this.navigationTree,
      this.minimap,
    );
    this.host.append(this.mount);

    this.zoomBehavior = zoom<HTMLDivElement, unknown>()
      .scaleExtent([0.15, 4])
      .on('zoom', (event: D3ZoomEvent<HTMLDivElement, unknown>) => {
        this.currentTransform = event.transform;
        this.applyTransform();
        this.updateMinimapViewport();
      });
    select(this.mount).call(this.zoomBehavior);
    this.mount.addEventListener('click', this.clickHandler);
    this.mount.addEventListener('keydown', this.keyHandler);
    if (typeof ResizeObserver === 'function') {
      this.resizeObserver = new ResizeObserver(() => this.fit());
      this.resizeObserver.observe(this.host);
    }
  }

  render(view: View): void {
    if (this.destroyed) return;
    this.currentView = view;
    this.controller.reconcile(
      this.adapter.hierarchy(view),
      this.adapter.initialExpansionIds(view),
    );
    this.draw();
    if (!this.hasInitialFit && !this.initialFitScheduled) {
      this.initialFitScheduled = true;
      queueMicrotask(() => {
        this.initialFitScheduled = false;
        if (!this.destroyed && this.rendered) {
          this.hasInitialFit = true;
          this.fit();
        }
      });
    }
  }

  reveal(nodeId: string): void {
    if (this.destroyed || !this.currentView || !this.controller.has(nodeId)) return;
    if (this.controller.reveal(nodeId)) this.draw();
    for (const item of this.nodeElements()) {
      item.classList.toggle('org-delta-scene-node--revealed', item.dataset.sceneId === nodeId);
      item.querySelector('.org-delta-taxonomy-card')?.classList.toggle(
        'org-delta-taxonomy-card--revealed',
        item.dataset.sceneId === nodeId,
      );
    }
    const node = this.currentScene?.nodes.find(({ id }) => id === nodeId);
    if (!node) return;
    const viewport = this.mount.getBoundingClientRect();
    const x = viewport.width / 2 - (node.left + node.width / 2) * this.currentTransform.k;
    const y = viewport.height / 2 - (node.top + node.height / 2) * this.currentTransform.k;
    select(this.mount).call(
      this.zoomBehavior.transform,
      zoomIdentity.translate(x, y).scale(this.currentTransform.k),
    );
  }

  fit(): void {
    if (this.destroyed || !this.currentScene || this.currentScene.nodes.length === 0) return;
    const viewport = this.mount.getBoundingClientRect();
    if (viewport.width <= 0 || viewport.height <= 0) return;
    const scale = Math.min(
      viewport.width / Math.max(1, this.currentScene.width),
      viewport.height / Math.max(1, this.currentScene.height),
    ) * 0.95;
    const x = (viewport.width - this.currentScene.width * scale) / 2;
    const y = (viewport.height - this.currentScene.height * scale) / 2;
    select(this.mount).call(
      this.zoomBehavior.transform,
      zoomIdentity.translate(x, y).scale(scale),
    );
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    if (this.animationFrame !== undefined) cancelAnimationFrame(this.animationFrame);
    this.resizeObserver?.disconnect();
    this.motionQuery?.removeEventListener?.('change', this.motionHandler);
    select(this.mount).on('.zoom', null);
    this.mount.removeEventListener('click', this.clickHandler);
    this.mount.removeEventListener('keydown', this.keyHandler);
    this.mount.remove();
    this.currentView = undefined;
    this.currentScene = undefined;
  }

  private draw(preferredFocusId?: string): void {
    if (!this.currentView) return;
    const previous = new Map(this.nodeElements().map((element) => [
      element.dataset.sceneKey!,
      {
        element,
        left: Number.parseFloat(element.style.left) || 0,
        top: Number.parseFloat(element.style.top) || 0,
      },
    ]));
    const scene = this.adapter.layout(this.currentView, this.controller.visibleIds());
    const duration = this.effectiveDuration(scene.nodes.length + scene.connectors.length);
    this.currentScene = scene;
    this.emptyState.hidden = scene.nodes.length > 0;
    this.world.style.width = `${scene.width}px`;
    this.world.style.height = `${scene.height}px`;
    for (const name of this.world.getAttributeNames()) {
      if (name.startsWith('data-')) this.world.removeAttribute(name);
    }
    for (const [name, value] of Object.entries(scene.worldAttributes ?? {})) {
      this.world.setAttribute(name, value);
    }
    this.reconcileDecorations(scene);
    this.reconcileNodes(scene, previous, duration);
    this.syncConnectors(scene);
    this.relationshipDescriptions.replaceChildren(...scene.connectors
      .filter(({ kind }) => kind === 'relationship')
      .map((connector) => {
        const description = document.createElement('p');
        description.textContent = `${connector.label}. ${connector.source.id} to ${connector.target.id}.`;
        return description;
      }));
    this.syncNavigationTree(preferredFocusId);
    this.syncMinimap(scene);
    this.rendered = true;
    this.scheduleConnectorFrames(duration);
  }

  private reconcileDecorations(scene: RenderScene): void {
    this.decorations.replaceChildren(...scene.decorations.map((value) => {
      const item = document.createElement('div');
      item.className = value.className;
      item.dataset.sceneDecoration = value.key;
      item.style.left = `${value.left}px`;
      item.style.top = `${value.top}px`;
      item.style.width = `${value.width}px`;
      item.style.height = `${value.height}px`;
      item.innerHTML = value.markup ?? '';
      return item;
    }));
  }

  private reconcileNodes(
    scene: RenderScene,
    previous: ReadonlyMap<string, { element: HTMLElement; left: number; top: number }>,
    duration: number,
  ): void {
    const retained = new Set(scene.nodes.map(({ key }) => key));
    const nextById = new Map(scene.nodes.map((node) => [node.id, node]));
    const previousById = new Map(
      [...previous.values()].map((value) => [value.element.dataset.sceneId!, value]),
    );
    for (const [key, value] of previous) {
      if (retained.has(key)) continue;
      if (duration > 0 && typeof value.element.animate === 'function') {
        let parentId = value.element.dataset.sceneParentId;
        const seen = new Set<string>();
        while (parentId && !nextById.has(parentId) && !seen.has(parentId)) {
          seen.add(parentId);
          parentId = previousById.get(parentId)?.element.dataset.sceneParentId;
        }
        const parent = parentId ? nextById.get(parentId) : undefined;
        const x = parent ? parent.left - value.left : 0;
        const y = parent ? parent.top - value.top : 0;
        const animation = value.element.animate(
          [{ opacity: 1, transform: 'translate(0, 0)' }, { opacity: 0, transform: `translate(${x}px, ${y}px)` }],
          { duration, easing: 'ease-in-out' },
        );
        animation.addEventListener?.('finish', () => value.element.remove(), { once: true });
      } else value.element.remove();
    }
    for (const node of scene.nodes) {
      const old = previous.get(node.key);
      const item = old?.element ?? document.createElement('div');
      item.className = 'org-delta-scene-node';
      item.dataset.sceneNode = '';
      item.dataset.sceneKey = node.key;
      item.dataset.sceneId = node.id;
      item.dataset.sceneKind = node.kind;
      if (node.parentId) item.dataset.sceneParentId = node.parentId;
      else delete item.dataset.sceneParentId;
      if (node.side) item.dataset.viewSide = node.side;
      else delete item.dataset.viewSide;
      item.style.left = `${node.left}px`;
      item.style.top = `${node.top}px`;
      item.style.width = `${node.width}px`;
      item.style.minHeight = `${node.height}px`;
      item.innerHTML = node.markup;
      if (this.controller.isExpandable(node.id)) item.append(this.expansionControl(node));
      if (!item.isConnected) this.nodeLayer.append(item);
      if (duration > 0 && typeof item.animate === 'function') {
        const parent = node.parentId ? previousById.get(node.parentId) : undefined;
        const x = old
          ? old.left - node.left
          : parent
            ? parent.left - node.left
            : 0;
        const y = old
          ? old.top - node.top
          : parent
            ? parent.top - node.top
            : 0;
        item.animate(
          old
            ? [{ transform: `translate(${x}px, ${y}px)` }, { transform: 'translate(0, 0)' }]
            : [{ opacity: 0, transform: `translate(${x}px, ${y}px)` }, { opacity: 1, transform: 'translate(0, 0)' }],
          { duration, easing: 'ease-in-out' },
        );
      }
    }
  }

  private expansionControl(node: SceneNode): HTMLButtonElement {
    const expanded = this.controller.isExpanded(node.id);
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'org-delta-hierarchy-toggle';
    button.dataset.hierarchyToggle = node.id;
    if (node.side) button.dataset.taxonomyToggle = node.id;
    if (node.side) button.dataset.viewSide = node.side;
    button.setAttribute('aria-expanded', String(expanded));
    button.setAttribute('aria-label', `${expanded ? 'Collapse' : 'Expand'} children of ${node.name}`);
    button.innerHTML = renderExpansionIcon(expanded);
    return button;
  }

  private syncConnectors(scene: RenderScene): void {
    const existing = new Map(
      [...this.connectorLayer.querySelectorAll<SVGPathElement>('[data-scene-connector-key]')]
        .map((path) => [path.dataset.sceneConnectorKey!, path]),
    );
    const retained = new Set<string>();
    this.connectorLayer.setAttribute('width', String(scene.width));
    this.connectorLayer.setAttribute('height', String(scene.height));
    const worldRect = this.world.getBoundingClientRect();
    for (const connector of scene.connectors) {
      const source = this.anchorElement(connector.source);
      const target = this.anchorElement(connector.target);
      if (!source || !target) continue;
      const pathData = connectorPath(
        source.getBoundingClientRect(),
        target.getBoundingClientRect(),
        connector.kind,
        worldRect,
        this.currentTransform.k,
      );
      for (const hit of [false, true]) {
        const key = `${connector.key}:${hit ? 'hit' : 'visible'}`;
        const path = existing.get(key) ?? document.createElementNS(SVG_NAMESPACE, 'path');
        path.dataset.sceneConnectorKey = key;
        path.setAttribute('d', pathData);
        path.setAttribute('fill', 'none');
        path.setAttribute('stroke', hit ? 'transparent' : 'currentColor');
        path.setAttribute('stroke-width', hit ? '12' : '2');
        path.classList.add('org-delta-connector', `org-delta-connector--${connector.kind}`);
        if (connector.aggregated) path.classList.add('org-delta-connector--aggregated');
        else path.classList.remove('org-delta-connector--aggregated');
        if (hit) {
          path.removeAttribute('aria-hidden');
          path.dataset.activateKind = connector.kind;
          path.dataset.activateId = connector.activationId;
          if (connector.kind === 'relationship') {
            path.dataset.relationshipId = connector.activationId;
            delete path.dataset.hierarchyId;
          } else {
            path.dataset.hierarchyId = connector.activationId;
            delete path.dataset.relationshipId;
          }
          if (connector.side) path.dataset.viewSide = connector.side;
          else delete path.dataset.viewSide;
          path.setAttribute('role', connector.kind === 'relationship' ? 'link' : 'button');
          path.setAttribute('tabindex', '0');
          path.setAttribute('aria-label', connector.label);
          path.style.pointerEvents = 'stroke';
          if (connector.side) {
            if (connector.kind === 'hierarchy') {
              path.dataset.taxonomyHierarchy = connector.activationId;
              delete path.dataset.taxonomyRelationship;
            } else {
              path.dataset.taxonomyRelationship = connector.activationId;
              delete path.dataset.taxonomyHierarchy;
            }
          } else {
            delete path.dataset.taxonomyHierarchy;
            delete path.dataset.taxonomyRelationship;
          }
        } else {
          for (const attribute of [
            'data-activate-kind',
            'data-activate-id',
            'data-view-side',
            'data-relationship-id',
            'data-hierarchy-id',
            'data-taxonomy-hierarchy',
            'data-taxonomy-relationship',
            'role',
            'tabindex',
            'aria-label',
          ]) path.removeAttribute(attribute);
          path.setAttribute('aria-hidden', 'true');
          path.style.pointerEvents = 'none';
        }
        if (!path.isConnected) this.connectorLayer.append(path);
        retained.add(key);
      }
    }
    for (const [key, path] of existing) if (!retained.has(key)) path.remove();
  }

  private anchorElement(anchor: SceneAnchor): HTMLElement | undefined {
    const candidates = anchor.kind === 'internal'
      ? this.world.querySelectorAll<HTMLElement>('[data-internal-id], [data-scene-kind="internal"]')
      : this.world.querySelectorAll<HTMLElement>('[data-node-id], [data-scene-node]');
    return [...candidates].find((element) => {
      const id = anchor.kind === 'internal'
        ? element.dataset.internalId ?? element.dataset.sceneId
        : element.dataset.nodeId ?? element.dataset.sceneId;
      return id === anchor.id && (!anchor.side || element.dataset.viewSide === anchor.side);
    });
  }

  private syncNavigationTree(preferredId?: string): void {
    const entries = this.controller.navigationItems();
    const focused = this.navigationTree.querySelector<HTMLElement>(':focus')?.dataset.activateId;
    const selected = [focused, preferredId].find((id) => id && entries.some((entry) => entry.id === id))
      ?? entries[0]?.id;
    const byParent = new Map<string | undefined, typeof entries>();
    for (const entry of entries) {
      const siblings = byParent.get(entry.parentId) ?? [];
      siblings.push(entry);
      byParent.set(entry.parentId, siblings);
    }
    const renderItem = (entry: (typeof entries)[number]): HTMLElement => {
      const item = document.createElement('div');
      item.dataset.treeNavigationItem = '';
      item.dataset.activateKind = entry.kind;
      item.dataset.activateId = entry.id;
      item.dataset.ownerId = entry.ownerId;
      if (entry.parentId) item.dataset.treeParentId = entry.parentId;
      item.setAttribute('role', 'treeitem');
      item.setAttribute('aria-level', String(entry.level));
      item.setAttribute('aria-label', `${entry.name}, ${entry.kind === 'internal' ? 'internal unit' : entry.parentId ? 'subordinate organization' : 'organization'}, level ${entry.level}`);
      if (entry.expandable) item.setAttribute('aria-expanded', String(entry.expanded));
      item.tabIndex = entry.id === selected ? 0 : -1;
      const children = byParent.get(entry.id) ?? [];
      if (children.length > 0) {
        const group = document.createElement('div');
        group.setAttribute('role', 'group');
        group.append(...children.map(renderItem));
        item.append(group);
      }
      return item;
    };
    this.navigationTree.replaceChildren(...(byParent.get(undefined) ?? []).map(renderItem));
  }

  private navigationItems(): HTMLElement[] {
    return [...this.navigationTree.querySelectorAll<HTMLElement>('[data-tree-navigation-item]')];
  }

  private handleNavigationKey(event: KeyboardEvent, current: HTMLElement): boolean {
    const items = this.navigationItems();
    const index = items.indexOf(current);
    if (index < 0) return false;
    let target: HTMLElement | undefined;
    if (event.key === 'ArrowDown') target = items[Math.min(index + 1, items.length - 1)];
    else if (event.key === 'ArrowUp') target = items[Math.max(index - 1, 0)];
    else if (event.key === 'Home') target = items[0];
    else if (event.key === 'End') target = items.at(-1);
    else if (event.key === 'ArrowRight') {
      if (current.getAttribute('aria-expanded') === 'false') this.toggleNavigationItem(current);
      else target = items.find((item) => item.dataset.treeParentId === current.dataset.activateId);
    } else if (event.key === 'ArrowLeft') {
      if (current.getAttribute('aria-expanded') === 'true') this.toggleNavigationItem(current);
      else target = items.find((item) => item.dataset.activateId === current.dataset.treeParentId);
    } else if (event.key === 'Enter') this.activateNavigationItem(current);
    else if (event.key === ' ') {
      if (current.hasAttribute('aria-expanded')) this.toggleNavigationItem(current);
      else this.activateNavigationItem(current);
    } else return false;
    event.preventDefault();
    event.stopPropagation();
    if (target) {
      for (const item of items) item.tabIndex = item === target ? 0 : -1;
      target.focus();
    }
    return true;
  }

  private toggleNavigationItem(item: HTMLElement): void {
    const id = item.dataset.activateId;
    if (!id || !this.controller.toggle(id)) return;
    this.draw(id);
    this.navigationItems().find((candidate) => candidate.dataset.activateId === id)?.focus();
  }

  private activateNavigationItem(item: HTMLElement): void {
    const id = item.dataset.activateId;
    const kind = item.dataset.activateKind;
    const ownerId = item.dataset.ownerId;
    if (!id || !ownerId || (kind !== 'node' && kind !== 'internal')) return;
    this.reveal(ownerId);
    this.options.onActivate(kind, id, item);
  }

  private syncMinimap(scene: RenderScene): void {
    this.minimap.replaceChildren();
    if (scene.nodes.length === 0) {
      this.minimap.style.display = 'none';
      return;
    }
    this.minimap.style.display = '';
    const scale = Math.min(148 / Math.max(1, scene.width), 88 / Math.max(1, scene.height));
    const offsetX = (160 - scene.width * scale) / 2;
    const offsetY = (100 - scene.height * scale) / 2;
    const nodesById = new Map(scene.nodes.map((node) => [node.id, node]));
    for (const node of scene.nodes) {
      if (!node.parentId) continue;
      const parent = nodesById.get(node.parentId);
      if (!parent) continue;
      const line = document.createElementNS(SVG_NAMESPACE, 'line');
      line.dataset.minimapLink = `${parent.id}->${node.id}`;
      line.setAttribute('x1', String(offsetX + (parent.left + parent.width / 2) * scale));
      line.setAttribute('y1', String(offsetY + (parent.top + parent.height / 2) * scale));
      line.setAttribute('x2', String(offsetX + (node.left + node.width / 2) * scale));
      line.setAttribute('y2', String(offsetY + (node.top + node.height / 2) * scale));
      line.setAttribute('stroke', 'currentColor');
      this.minimap.append(line);
    }
    for (const node of scene.nodes) {
      const circle = document.createElementNS(SVG_NAMESPACE, 'circle');
      circle.dataset.minimapNodeId = node.id;
      circle.setAttribute('cx', String(offsetX + (node.left + node.width / 2) * scale));
      circle.setAttribute('cy', String(offsetY + (node.top + node.height / 2) * scale));
      circle.setAttribute('r', '2');
      circle.setAttribute('fill', 'currentColor');
      this.minimap.append(circle);
    }
    this.updateMinimapViewport();
  }

  private updateMinimapViewport(): void {
    const scene = this.currentScene;
    if (!scene || scene.nodes.length === 0) return;
    const scale = Math.min(148 / Math.max(1, scene.width), 88 / Math.max(1, scene.height));
    const offsetX = (160 - scene.width * scale) / 2;
    const offsetY = (100 - scene.height * scale) / 2;
    let viewport = this.minimap.querySelector<SVGRectElement>('.org-delta-minimap-viewport');
    if (!viewport) {
      viewport = document.createElementNS(SVG_NAMESPACE, 'rect');
      viewport.classList.add('org-delta-minimap-viewport');
      viewport.setAttribute('fill', 'none');
      viewport.setAttribute('stroke', 'currentColor');
      this.minimap.append(viewport);
    }
    const bounds = this.mount.getBoundingClientRect();
    viewport.setAttribute('x', String(offsetX + (-this.currentTransform.x / this.currentTransform.k) * scale));
    viewport.setAttribute('y', String(offsetY + (-this.currentTransform.y / this.currentTransform.k) * scale));
    viewport.setAttribute('width', String(bounds.width / this.currentTransform.k * scale));
    viewport.setAttribute('height', String(bounds.height / this.currentTransform.k * scale));
  }

  private scheduleConnectorFrames(duration: number): void {
    if (duration <= 0 || typeof requestAnimationFrame !== 'function') return;
    if (this.animationFrame !== undefined) cancelAnimationFrame(this.animationFrame);
    const started = performance.now();
    const update = (time: number): void => {
      this.animationFrame = undefined;
      if (this.destroyed || !this.currentScene) return;
      this.syncConnectors(this.currentScene);
      if (time - started < duration) this.animationFrame = requestAnimationFrame(update);
    };
    this.animationFrame = requestAnimationFrame(update);
  }

  private effectiveDuration(itemCount: number): number {
    return !this.rendered || this.reducedMotion || itemCount >= 300
      ? 0
      : this.transitionDurationMs;
  }

  private applyTransform(): void {
    this.world.style.transform = `translate(${this.currentTransform.x}px, ${this.currentTransform.y}px) scale(${this.currentTransform.k})`;
  }

  private nodeElements(): HTMLElement[] {
    return [...this.nodeLayer.querySelectorAll<HTMLElement>('[data-scene-node]')];
  }

  private findToggle(id: string, side?: ComparisonSide): HTMLButtonElement | undefined {
    return [...this.mount.querySelectorAll<HTMLButtonElement>('[data-hierarchy-toggle]')]
      .find((button) => button.dataset.hierarchyToggle === id &&
        (!side || button.dataset.viewSide === side));
  }

  private activationTrigger(event: Event): HTMLElement | SVGElement | undefined {
    const target = event.target;
    if (!(target instanceof Element)) return undefined;
    const trigger = target.closest<HTMLElement | SVGElement>(
      '[data-activate-kind][data-activate-id]',
    );
    return trigger && this.mount.contains(trigger) ? trigger : undefined;
  }

  private activateFromEvent(event: Event): void {
    const trigger = this.activationTrigger(event);
    if (!trigger) return;
    const kind = trigger.getAttribute('data-activate-kind') as ActivationKind | null;
    const id = trigger.getAttribute('data-activate-id');
    if (!kind || !ACTIVATION_KINDS.has(kind) || id === null) return;
    const side = trigger.getAttribute('data-view-side');
    if (side === 'baseline' || side === 'proposed') {
      this.options.onActivate(kind, id, trigger, { side });
    } else this.options.onActivate(kind, id, trigger);
  }
}
