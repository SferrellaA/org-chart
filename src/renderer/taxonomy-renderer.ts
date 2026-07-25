import {
  select,
  zoom,
  zoomIdentity,
  type ZoomBehavior,
  type D3ZoomEvent,
  type ZoomTransform,
} from 'd3';
import type { TaxonomyRenderView } from '../presentation/build-taxonomy-view';
import { renderTaxonomyCard, type ComparisonSide } from './card';
import type { ActivationHandler, ActivationKind } from './overlay';
import { encodeHierarchyActivationId, type ChartRenderer } from './types';

const SVG_NAMESPACE = 'http://www.w3.org/2000/svg';

export function taxonomyConnectorPoint(
  rect: DOMRect,
  worldRect: DOMRect,
  edge: 'top' | 'bottom' | 'center',
  scale: number,
): { x: number; y: number } {
  const safeScale = scale > 0 ? scale : 1;
  return {
    x: (rect.left - worldRect.left + rect.width / 2) / safeScale,
    y: (edge === 'top'
      ? rect.top - worldRect.top
      : edge === 'bottom'
        ? rect.bottom - worldRect.top
        : rect.top - worldRect.top + rect.height / 2) / safeScale,
  };
}

export interface TaxonomyRendererOptions {
  onActivate: ActivationHandler;
}

export class TaxonomyRenderer implements ChartRenderer<TaxonomyRenderView> {
  private readonly mount = document.createElement('div');
  private destroyed = false;
  private currentView: TaxonomyRenderView | undefined;
  private readonly expansion = new Map<string, boolean>();
  private readonly zoomBehavior: ZoomBehavior<HTMLDivElement, unknown>;
  private readonly resizeObserver: ResizeObserver | undefined;
  private currentTransform: ZoomTransform = zoomIdentity;
  private initialFitScheduled = false;
  private hasFitted = false;
  private readonly clickHandler = (event: MouseEvent): void => {
    const target = event.target;
    if (target instanceof Element) {
      const toggle = target.closest<HTMLElement>('[data-taxonomy-toggle]');
      if (toggle && this.mount.contains(toggle)) {
        const id = toggle.dataset.taxonomyToggle;
        const side = toggle.dataset.viewSide;
        if (id) {
          this.expansion.set(id, !(this.expansion.get(id) ?? true));
          if (this.currentView) this.render(this.currentView);
          [...this.mount.querySelectorAll<HTMLElement>('[data-taxonomy-toggle]')]
            .find((candidate) =>
              candidate.dataset.taxonomyToggle === id && candidate.dataset.viewSide === side
            )
            ?.focus();
        }
        return;
      }
    }
    this.activateFromEvent(event);
  };
  private readonly keyHandler = (event: KeyboardEvent): void => {
    const target = event.target;
    if (target instanceof HTMLElement && target.matches('[role="treeitem"]')) {
      const tree = target.closest<HTMLElement>('[role="tree"]');
      const items = tree
        ? [...tree.querySelectorAll<HTMLElement>('[role="treeitem"]')]
        : [];
      const index = items.indexOf(target);
      let next: HTMLElement | undefined;
      if (event.key === 'ArrowDown') next = items[Math.min(index + 1, items.length - 1)];
      else if (event.key === 'ArrowUp') next = items[Math.max(index - 1, 0)];
      else if (event.key === 'Home') next = items[0];
      else if (event.key === 'End') next = items.at(-1);
      else if (event.key === 'ArrowRight' && target.getAttribute('aria-expanded') === 'true') {
        const childLevel = Number(target.getAttribute('aria-level')) + 1;
        next = items.slice(index + 1).find((item) => Number(item.getAttribute('aria-level')) === childLevel);
      } else if (event.key === 'ArrowLeft' && target.getAttribute('aria-expanded') !== 'true') {
        next = items.find((item) => item.dataset.activateId === target.dataset.treeParentId);
      }
      if (next) {
        event.preventDefault();
        for (const item of items) item.tabIndex = item === next ? 0 : -1;
        next.focus();
        return;
      }
      const expanded = target.getAttribute('aria-expanded');
      const shouldToggle = expanded !== null && (
        event.key === ' ' ||
        (event.key === 'ArrowLeft' && expanded === 'true') ||
        (event.key === 'ArrowRight' && expanded === 'false')
      );
      if (shouldToggle) {
        event.preventDefault();
        const id = target.dataset.activateId;
        const side = target.dataset.viewSide;
        if (id) {
          this.expansion.set(id, expanded !== 'true');
          if (this.currentView) this.render(this.currentView);
          [...this.mount.querySelectorAll<HTMLElement>('[role="treeitem"]')]
            .find((item) => item.dataset.activateId === id && item.dataset.viewSide === side)
            ?.focus();
        }
        return;
      }
    }
    if (event.key !== 'Enter' && event.key !== ' ') return;
    if (!this.activationTrigger(event)) return;
    event.preventDefault();
    this.activateFromEvent(event);
  };

  constructor(
    private readonly host: HTMLElement,
    private readonly options: TaxonomyRendererOptions,
  ) {
    this.mount.className = 'org-delta-taxonomy-renderer';
    this.mount.addEventListener('click', this.clickHandler);
    this.mount.addEventListener('keydown', this.keyHandler);
    this.host.append(this.mount);
    this.zoomBehavior = zoom<HTMLDivElement, unknown>()
      .scaleExtent([0.15, 4])
      .on('zoom', (event: D3ZoomEvent<HTMLDivElement, unknown>) => {
        this.currentTransform = event.transform;
        const world = this.mount.querySelector<HTMLElement>('.org-delta-taxonomy-world');
        if (world) this.applyTransform(world, event.transform);
      });
    select(this.mount).call(this.zoomBehavior);
    if (typeof ResizeObserver === 'function') {
      this.resizeObserver = new ResizeObserver(() => this.fit());
      this.resizeObserver.observe(this.host);
    }
  }

  render(view: TaxonomyRenderView): void {
    if (this.destroyed) return;
    this.currentView = view;
    for (const side of [view.baseline, view.proposed]) {
      for (const node of side?.nodes ?? []) {
        if (!this.expansion.has(node.id)) {
          this.expansion.set(node.id, view.initialExpansionIds.includes(node.id));
        }
      }
    }
    const comparison = view.baseline !== undefined;
    const world = document.createElement('div');
    world.className = 'org-delta-taxonomy-world';
    world.dataset.taxonomyComparison = String(comparison);
    this.applyTransform(world, this.currentTransform);

    const header = document.createElement('div');
    header.className = 'org-delta-taxonomy-header';
    if (comparison) header.append(this.heading('Baseline', 'baseline'));
    header.append(this.heading(comparison ? 'Proposed' : 'Organization chart', 'proposed'));
    world.append(header);

    for (const tier of view.tiers) {
      const row = document.createElement('section');
      row.className = `org-delta-taxonomy-tier org-delta-taxonomy-tier--${tier.kind}`;
      row.dataset.taxonomyTier = tier.id;

      const label = document.createElement('h3');
      label.className = 'org-delta-taxonomy-tier-label';
      label.textContent = tier.proposed?.label ?? tier.baseline?.label ?? tier.id;

      if (view.baseline) {
        row.append(
          this.taxonomyCells(view.baseline.systems, tier.id, 'baseline'),
          this.nodeLane(
            this.visibleNodes(view.baseline.nodes).filter((node) => node.tierId === tier.id),
            'baseline',
            view.baseline.nodes,
          ),
        );
      }
      const gutter = document.createElement('div');
      gutter.className = 'org-delta-taxonomy-gutter';
      gutter.append(label);
      for (const movement of view.movements.filter(({ toTierId }) => toTierId === tier.id)) {
        const marker = document.createElement('span');
        marker.className = 'org-delta-taxonomy-movement';
        marker.dataset.movementNode = movement.nodeId;
        marker.dataset.fromTier = movement.fromTierId;
        marker.dataset.toTier = movement.toTierId;
        gutter.append(marker);
      }
      row.append(
        gutter,
        this.nodeLane(
          this.visibleNodes(view.proposed.nodes).filter((node) => node.tierId === tier.id),
          'proposed',
          view.proposed.nodes,
        ),
        this.taxonomyCells(view.proposed.systems, tier.id, 'proposed'),
      );
      world.append(row);
    }
    this.mount.replaceChildren(world);
    this.syncConnectors(view, world);
    if (view.baseline) this.mount.append(this.navigationTree(view.baseline.nodes, 'baseline'));
    this.mount.append(this.navigationTree(view.proposed.nodes, 'proposed'));
    if (!this.hasFitted && !this.initialFitScheduled) {
      this.initialFitScheduled = true;
      queueMicrotask(() => {
        this.initialFitScheduled = false;
        if (!this.destroyed && !this.hasFitted) this.fit();
      });
    }
  }

  reveal(nodeId: string): void {
    if (this.destroyed || !this.currentView) return;
    let expanded = false;
    for (const side of [this.currentView.baseline, this.currentView.proposed]) {
      const nodes = side?.nodes ?? [];
      const byId = new Map(nodes.map((node) => [node.id, node]));
      let current = byId.get(nodeId);
      const seen = new Set<string>();
      while (current && !seen.has(current.id)) {
        seen.add(current.id);
        const parentId = current.connectorSourceId ?? current.parentId;
        if (!parentId) break;
        if (!(this.expansion.get(parentId) ?? true)) {
          this.expansion.set(parentId, true);
          expanded = true;
        }
        current = byId.get(parentId);
      }
    }
    if (expanded) this.render(this.currentView);
    const revealed: HTMLElement[] = [];
    for (const card of this.mount.querySelectorAll<HTMLElement>('[data-node-id]')) {
      const matches = card.dataset.nodeId === nodeId;
      card.classList.toggle('org-delta-taxonomy-card--revealed', matches);
      if (matches) revealed.push(card);
    }
    if (revealed.length > 0) {
      const viewport = this.mount.getBoundingClientRect();
      const bounds = revealed.map((card) => card.getBoundingClientRect());
      const left = Math.min(...bounds.map((rect) => rect.left));
      const right = Math.max(...bounds.map((rect) => rect.right));
      const top = Math.min(...bounds.map((rect) => rect.top));
      const bottom = Math.max(...bounds.map((rect) => rect.bottom));
      if (viewport.width > 0 && viewport.height > 0 && right > left && bottom > top) {
        const dx = viewport.left + viewport.width / 2 - (left + right) / 2;
        const dy = viewport.top + viewport.height / 2 - (top + bottom) / 2;
        this.hasFitted = true;
        select(this.mount).call(
          this.zoomBehavior.transform,
          zoomIdentity
            .translate(this.currentTransform.x + dx, this.currentTransform.y + dy)
            .scale(this.currentTransform.k),
        );
      }
    }
  }

  fit(): void {
    if (this.destroyed) return;
    const world = this.mount.querySelector<HTMLElement>('.org-delta-taxonomy-world');
    if (!world) return;
    const viewport = this.mount.getBoundingClientRect();
    const content = world.getBoundingClientRect();
    if (viewport.width <= 0 || viewport.height <= 0 || content.width <= 0 || content.height <= 0) {
      return;
    }
    const contentWidth = content.width / this.currentTransform.k;
    const contentHeight = content.height / this.currentTransform.k;
    const scale = Math.min(viewport.width / contentWidth, viewport.height / contentHeight) * 0.95;
    const x = (viewport.width - contentWidth * scale) / 2;
    const y = (viewport.height - contentHeight * scale) / 2;
    this.hasFitted = true;
    select(this.mount).call(
      this.zoomBehavior.transform,
      zoomIdentity.translate(x, y).scale(scale),
    );
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.currentView = undefined;
    this.expansion.clear();
    this.resizeObserver?.disconnect();
    select(this.mount).on('.zoom', null);
    this.mount.removeEventListener('click', this.clickHandler);
    this.mount.removeEventListener('keydown', this.keyHandler);
    this.mount.remove();
  }

  private heading(text: string, side: ComparisonSide): HTMLElement {
    const heading = document.createElement('h2');
    heading.className = 'org-delta-taxonomy-side-heading';
    heading.dataset.viewSide = side;
    heading.textContent = text;
    return heading;
  }

  private applyTransform(world: HTMLElement, transform: ZoomTransform): void {
    world.style.transform = `translate(${transform.x}px, ${transform.y}px) scale(${transform.k})`;
  }

  private taxonomyCells(
    systems: TaxonomyRenderView['proposed']['systems'],
    tierId: string,
    side: ComparisonSide,
  ): HTMLElement {
    const cells = document.createElement('div');
    cells.className = 'org-delta-taxonomy-systems';
    cells.dataset.viewSide = side;
    for (const system of systems) {
      const cell = document.createElement('div');
      cell.className = 'org-delta-taxonomy-system';
      cell.dataset.taxonomySystem = system.id;
      const label = document.createElement('strong');
      label.textContent = system.label;
      cell.append(label);
      for (const level of system.levels.filter(({ tier }) => tier === tierId)) {
        const levelLabel = document.createElement('span');
        levelLabel.dataset.taxonomyLevel = level.id;
        levelLabel.textContent = level.label;
        cell.append(levelLabel);
      }
      cells.append(cell);
    }
    return cells;
  }

  private nodeLane(
    nodes: TaxonomyRenderView['proposed']['nodes'],
    side: ComparisonSide,
    allNodes: TaxonomyRenderView['proposed']['nodes'],
  ): HTMLElement {
    const lane = document.createElement('div');
    lane.className = 'org-delta-taxonomy-node-lane';
    lane.dataset.viewSide = side;
    for (const node of nodes) {
      const template = document.createElement('template');
      template.innerHTML = renderTaxonomyCard(node, side);
      const card = template.content.firstElementChild;
      if (card) {
        const expandable = this.expandableIds(allNodes).has(node.id);
        if (expandable) {
          const toggle = document.createElement('button');
          const expanded = this.expansion.get(node.id) ?? true;
          toggle.type = 'button';
          toggle.className = 'org-delta-taxonomy-toggle';
          toggle.dataset.taxonomyToggle = node.id;
          toggle.dataset.viewSide = side;
          toggle.setAttribute('aria-expanded', String(expanded));
          toggle.setAttribute('aria-label', `${expanded ? 'Collapse' : 'Expand'} children of ${node.name}`);
          toggle.textContent = expanded ? '−' : '+';
          card.append(toggle);
        }
        lane.append(card);
      }
    }
    return lane;
  }

  private expandableIds(nodes: TaxonomyRenderView['proposed']['nodes']): Set<string> {
    const result = new Set<string>();
    for (const node of nodes) {
      const parent = node.connectorSourceId ?? node.parentId;
      if (parent) result.add(parent);
    }
    return result;
  }

  private visibleNodes(
    nodes: TaxonomyRenderView['proposed']['nodes'],
  ): TaxonomyRenderView['proposed']['nodes'] {
    const byId = new Map(nodes.map((node) => [node.id, node]));
    return nodes.filter((node) => {
      const seen = new Set<string>();
      let parentId = node.parentId;
      while (parentId && !seen.has(parentId)) {
        seen.add(parentId);
        const parent = byId.get(parentId);
        const visibleParentId = parent ? parentId : node.connectorSourceId;
        if (visibleParentId && !(this.expansion.get(visibleParentId) ?? true)) return false;
        if (!parent) {
          parentId = undefined;
        } else {
          parentId = parent.parentId;
        }
      }
      return true;
    });
  }

  private navigationTree(
    nodes: TaxonomyRenderView['proposed']['nodes'],
    side: ComparisonSide,
  ): HTMLElement {
    const tree = document.createElement('div');
    tree.className = 'org-delta-tree-navigation';
    tree.setAttribute('role', 'tree');
    tree.setAttribute('aria-label', `${side === 'baseline' ? 'Baseline' : 'Proposed'} organization tree`);
    const visible = this.visibleNodes(nodes);
    const byId = new Map(nodes.map((node) => [node.id, node]));
    visible.forEach((node, index) => {
      let level = 1;
      let parent = node.parentId;
      const seen = new Set<string>();
      while (parent && !seen.has(parent)) {
        seen.add(parent);
        level += 1;
        parent = byId.get(parent)?.parentId;
      }
      const item = document.createElement('div');
      item.setAttribute('role', 'treeitem');
      item.setAttribute('aria-level', String(level));
      item.setAttribute('aria-label', node.name);
      item.tabIndex = index === 0 ? 0 : -1;
      item.dataset.activateKind = node.internal ? 'internal' : 'node';
      item.dataset.activateId = node.id;
      item.dataset.viewSide = side;
      const parentId = node.parentId && byId.has(node.parentId)
        ? node.parentId
        : node.connectorSourceId;
      if (parentId) item.dataset.treeParentId = parentId;
      if (this.expandableIds(nodes).has(node.id)) {
        item.setAttribute('aria-expanded', String(this.expansion.get(node.id) ?? true));
      }
      tree.append(item);
    });
    return tree;
  }

  private activationTrigger(event: Event): HTMLElement | undefined {
    const target = event.target;
    if (!(target instanceof Element)) return undefined;
    const trigger = target.closest<HTMLElement>('[data-activate-kind][data-activate-id]');
    return trigger && this.mount.contains(trigger) ? trigger : undefined;
  }

  private activateFromEvent(event: Event): void {
    const trigger = this.activationTrigger(event);
    if (!trigger) return;
    const kind = trigger.dataset.activateKind as ActivationKind | undefined;
    const id = trigger.dataset.activateId;
    const side = trigger.dataset.viewSide;
    if (
      !kind ||
      !id ||
      !['node', 'internal', 'hierarchy', 'relationship', 'change'].includes(kind) ||
      (side !== 'baseline' && side !== 'proposed')
    ) return;
    this.options.onActivate(kind, id, trigger, { side });
  }

  private syncConnectors(view: TaxonomyRenderView, world: HTMLElement): void {
    const overlay = document.createElementNS(SVG_NAMESPACE, 'svg');
    overlay.classList.add('org-delta-taxonomy-connectors');
    const worldRect = world.getBoundingClientRect();
    const card = (side: ComparisonSide, id: string): HTMLElement | undefined =>
      [...world.querySelectorAll<HTMLElement>(`[data-view-side="${side}"][data-node-id]`)]
        .find((element) => element.dataset.nodeId === id);
    const point = (element: HTMLElement, edge: 'top' | 'bottom' | 'center') =>
      taxonomyConnectorPoint(
        element.getBoundingClientRect(),
        worldRect,
        edge,
        this.currentTransform.k,
      );
    const sideConnectors = (side: ComparisonSide, value: TaxonomyRenderView['proposed']) => {
      const nodesById = new Map(value.nodes.map((node) => [node.id, node]));
      for (const node of value.nodes) {
        const sourceId = node.connectorSourceId ?? node.parentId;
        if (!sourceId) continue;
        const source = card(side, sourceId);
        const target = card(side, node.id);
        if (!source || !target) continue;
        const from = point(source, 'bottom');
        const to = point(target, 'top');
        const path = document.createElementNS(SVG_NAMESPACE, 'path');
        path.dataset.taxonomyHierarchy = encodeHierarchyActivationId(node.parentId ?? sourceId, node.id);
        path.dataset.viewSide = side;
        path.dataset.activateKind = 'hierarchy';
        path.dataset.activateId = encodeHierarchyActivationId(node.parentId ?? sourceId, node.id);
        path.setAttribute('d', `M ${from.x} ${from.y} C ${from.x} ${(from.y + to.y) / 2}, ${to.x} ${(from.y + to.y) / 2}, ${to.x} ${to.y}`);
        path.setAttribute('role', 'button');
        path.setAttribute('tabindex', '0');
        const sourceName = nodesById.get(sourceId)?.name ?? sourceId;
        const authoredParentName = node.parentName
          ?? (node.parentId ? nodesById.get(node.parentId)?.name ?? node.parentId : sourceName);
        const aggregation = sourceId !== node.parentId ? `, shown from ${sourceName}` : '';
        path.setAttribute(
          'aria-label',
          `${authoredParentName} ${node.internal ? 'internal' : 'subordinate'} relationship to ${node.name}${aggregation}`,
        );
        overlay.append(path);
      }
      for (const relationship of value.relationships) {
        const source = card(side, relationship.source);
        const target = card(side, relationship.target);
        if (!source || !target) continue;
        const from = point(source, 'center');
        const to = point(target, 'center');
        const path = document.createElementNS(SVG_NAMESPACE, 'path');
        path.dataset.taxonomyRelationship = relationship.id;
        path.dataset.viewSide = side;
        path.dataset.activateKind = 'relationship';
        path.dataset.activateId = relationship.id;
        path.setAttribute('d', `M ${from.x} ${from.y} C ${(from.x + to.x) / 2} ${from.y}, ${(from.x + to.x) / 2} ${to.y}, ${to.x} ${to.y}`);
        path.setAttribute('role', 'button');
        path.setAttribute('tabindex', '0');
        path.setAttribute('aria-label', relationship.label);
        overlay.append(path);
      }
    };
    if (view.baseline) sideConnectors('baseline', view.baseline);
    sideConnectors('proposed', view.proposed);
    if (view.baseline) {
      for (const movement of view.movements) {
        const source = card('baseline', movement.nodeId);
        const target = card('proposed', movement.nodeId);
        if (!source || !target) continue;
        const from = point(source, 'center');
        const to = point(target, 'center');
        const path = document.createElementNS(SVG_NAMESPACE, 'path');
        path.dataset.taxonomyMovement = movement.nodeId;
        path.setAttribute('d', `M ${from.x} ${from.y} C ${(from.x + to.x) / 2} ${from.y}, ${(from.x + to.x) / 2} ${to.y}, ${to.x} ${to.y}`);
        path.setAttribute('aria-hidden', 'true');
        overlay.append(path);
      }
    }
    world.prepend(overlay);
  }
}
