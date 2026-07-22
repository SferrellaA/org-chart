// d3-org-chart 3.1.1 does not publish TypeScript declarations.
// @ts-expect-error The adapter below defines the supported API surface it consumes.
import { OrgChart } from 'd3-org-chart';
import { ConnectorOverlay } from './overlay';
import type { ActivationHandler, ActivationKind } from './overlay';
import {
  encodeHierarchyActivationId,
  type ChartRenderer,
  type RenderNode,
  type RenderView,
} from './types';
import type { DiffKind } from '../model/diff';

const SVG_NAMESPACE = 'http://www.w3.org/2000/svg';

const SYNTHETIC_ROOT = Symbol('org-delta-chart synthetic root');

interface RendererNode extends RenderNode {
  [SYNTHETIC_ROOT]?: true;
  _expanded?: boolean;
  _directSubordinates?: number;
}

interface D3HierarchyNode {
  data: RendererNode;
  parent?: D3HierarchyNode;
  children?: readonly D3HierarchyNode[] | null;
  _children?: readonly D3HierarchyNode[] | null;
}

interface NavigationItem {
  id: string;
  ownerId: string;
  parentId?: string;
  kind: 'node' | 'internal';
  label: string;
  level: number;
  expandable: boolean;
  expanded: boolean;
}

interface OrgChartApi {
  container(value: HTMLElement): this;
  data(value: readonly RendererNode[]): this;
  nodeId(value: (node: RendererNode) => string): this;
  parentNodeId(value: (node: RendererNode) => string | undefined): this;
  nodeWidth(value: (node: D3HierarchyNode) => number): this;
  nodeHeight(value: (node: D3HierarchyNode) => number): this;
  svgWidth(value: number): this;
  svgHeight(value: number): this;
  nodeContent(value: (node: D3HierarchyNode) => string): this;
  compact(value: boolean): this;
  duration(value: number): this;
  scaleExtent(value: [number, number]): this;
  minPagingVisibleNodes(value: (node: D3HierarchyNode) => number): this;
  onZoom(value: () => void): this;
  onExpandOrCollapse(value: (node: D3HierarchyNode) => void): this;
  nodeUpdate(value: (this: SVGGElement, node: D3HierarchyNode) => void): this;
  linkUpdate(value: (this: SVGPathElement, node: D3HierarchyNode) => void): this;
  render(): this;
  setExpanded(id: string, expanded: boolean): this;
  setCentered(id: string): this;
  fit(options?: { animate?: boolean }): this;
  getChartState(): {
    data: readonly RendererNode[] | null;
    lastTransform: { x: number; y: number; k: number };
    allNodes?: readonly D3HierarchyNode[];
  };
  clear(): void;
}

export interface D3OrgChartRendererOptions {
  onActivate: ActivationHandler;
}

const ACTIVATION_KINDS = new Set<ActivationKind>([
  'node',
  'internal',
  'hierarchy',
  'relationship',
  'change',
]);

function isSynthetic(node: RendererNode | undefined): boolean {
  return node?.[SYNTHETIC_ROOT] === true;
}

function rendererData(nodes: readonly RendererNode[]): RendererNode[] {
  const ids = new Set(nodes.map(({ id }) => id));
  const roots = nodes.filter((node) => node.parentId === undefined || !ids.has(node.parentId));
  if (roots.length <= 1) return [...nodes];

  let syntheticId = '__org_delta_chart_root__';
  while (ids.has(syntheticId)) syntheticId += '_';
  const rootIds = new Set(roots.map(({ id }) => id));
  const synthetic: RendererNode = {
    id: syntheticId,
    name: '',
    internalRows: [],
    hiddenInternalCount: 0,
    hiddenChangeCount: 0,
    diffKind: 'unchanged',
    ghost: false,
    _expanded: true,
    [SYNTHETIC_ROOT]: true,
  };
  return [
    synthetic,
    ...nodes.map((node) => rootIds.has(node.id) ? { ...node, parentId: syntheticId } : node),
  ];
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    switch (character) {
      case '&': return '&amp;';
      case '<': return '&lt;';
      case '>': return '&gt;';
      case '"': return '&quot;';
      default: return '&#39;';
    }
  });
}

function safeDiffKind(value: unknown): DiffKind {
  return value === 'added' || value === 'removed' || value === 'modified' || value === 'unchanged'
    ? value
    : 'unchanged';
}

function safeCount(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : 0;
}

function safeDepth(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? Math.floor(value)
    : 0;
}

function activationAttributes(kind: ActivationKind, id: string): string {
  return `data-activate-kind="${kind}" data-activate-id="${escapeHtml(id)}"`;
}

function renderNodeContent({ data: node }: D3HierarchyNode): string {
  if (isSynthetic(node)) return '';
  const nodeId = escapeHtml(node.id);
  const nodeDiffKind = safeDiffKind(node.diffKind);
  const classes = [
    'org-delta-node',
    `org-delta-node--${nodeDiffKind}`,
    ...(node.ghost ? ['org-delta-node--ghost'] : []),
  ].join(' ');
  const rows = node.internalRows.map((row) => {
    const rowId = escapeHtml(row.id);
    const rowDiffKind = safeDiffKind(row.diffKind);
    const change = rowDiffKind === 'unchanged'
      ? ''
      : `<button type="button" class="org-delta-change org-delta-change--${rowDiffKind}" ${activationAttributes('change', row.id)} aria-label="View changes for ${escapeHtml(row.name)}">${rowDiffKind}</button>`;
    const internalLabel = `${row.name}, internal unit, depth ${safeDepth(row.depth)}${row.hasSubordinateChildren ? ', contains subordinate organizations' : ''}`;
    return `<div class="org-delta-internal org-delta-internal--${rowDiffKind}" data-internal-id="${rowId}" data-depth="${safeDepth(row.depth)}"><button type="button" class="org-delta-internal-name" ${activationAttributes('internal', row.id)} aria-label="${escapeHtml(internalLabel)}">${escapeHtml(row.name)}</button>${row.hasSubordinateChildren ? '<span class="org-delta-subordinate-marker" aria-label="Has subordinate children"></span>' : ''}${change}</div>`;
  }).join('');
  const internalCount = safeCount(node.hiddenInternalCount);
  const changeCount = safeCount(node.hiddenChangeCount);
  const hiddenInternal = internalCount > 0
    ? `<span class="org-delta-hidden-count" data-hidden-internal-count="${internalCount}">${internalCount} hidden</span>`
    : '';
  const hiddenChanges = changeCount > 0
    ? `<span class="org-delta-hidden-changes" data-hidden-change-count="${changeCount}">${changeCount} changed</span>`
    : '';
  const change = nodeDiffKind === 'unchanged' && changeCount === 0
    ? ''
    : `<button type="button" class="org-delta-change org-delta-change--${nodeDiffKind}" ${activationAttributes('change', node.id)}>View changes</button>`;
  return `<article class="${classes}" data-node-id="${nodeId}" data-diff-kind="${nodeDiffKind}"><button type="button" class="org-delta-node-name" ${activationAttributes('node', node.id)}>${escapeHtml(node.name)}</button>${change}${hiddenInternal}${hiddenChanges}<div class="org-delta-internal-rows">${rows}</div></article>`;
}

export class D3OrgChartRenderer implements ChartRenderer {
  private static readonly LAYOUT_DURATION = 300;
  private readonly mount = document.createElement('div');
  private readonly emptyState = document.createElement('div');
  private readonly chart: OrgChartApi;
  private readonly overlay: ConnectorOverlay;
  private readonly minimap = document.createElementNS(SVG_NAMESPACE, 'svg');
  private readonly relationshipDescriptions = document.createElement('div');
  private readonly navigationTree = document.createElement('div');
  private reducedMotion: boolean;
  private readonly motionQuery: MediaQueryList | undefined;
  private readonly resizeObserver: ResizeObserver | undefined;
  private currentView: RenderView | undefined;
  private readonly expansion = new Map<string, boolean>();
  private overlayFrame: number | undefined;
  private minimapFrame: number | undefined;
  private transitionFrames = 0;
  private minimapProjection: {
    minX: number;
    minY: number;
    scale: number;
    offsetX: number;
    offsetY: number;
  } | undefined;
  private chartHasData = false;
  private layoutTimer: ReturnType<typeof setTimeout> | undefined;
  private destroyed = false;
  private readonly motionHandler = (event: MediaQueryListEvent): void => {
    this.reducedMotion = event.matches;
    if (event.matches) this.transitionFrames = 0;
    this.chart.duration(this.layoutDuration());
  };
  private readonly clickHandler = (event: MouseEvent): void => {
    const navigationItem = this.navigationItemFromEvent(event);
    if (navigationItem) {
      event.stopPropagation();
      this.activateNavigationItem(navigationItem);
      return;
    }
    if (!this.activationTrigger(event)) return;
    event.stopPropagation();
    this.activateFromEvent(event);
  };
  private readonly keyHandler = (event: KeyboardEvent): void => {
    const navigationItem = this.navigationItemFromEvent(event);
    if (navigationItem && this.handleNavigationKey(event, navigationItem)) return;
    if (event.key !== 'Enter' && event.key !== ' ') return;
    const trigger = this.activationTrigger(event);
    if (!trigger) return;
    event.stopPropagation();
    if (trigger instanceof HTMLElement) return;
    event.preventDefault();
    this.activateFromEvent(event);
  };

  constructor(
    private readonly host: HTMLElement,
    private readonly options: D3OrgChartRendererOptions,
  ) {
    this.mount.className = 'org-delta-renderer-root';
    this.mount.style.position = 'relative';
    this.mount.style.width = '100%';
    this.mount.style.height = '100%';
    this.emptyState.className = 'org-delta-empty-state';
    this.emptyState.hidden = true;
    this.relationshipDescriptions.className =
      'org-delta-relationship-descriptions org-delta-visually-hidden';
    this.relationshipDescriptions.setAttribute('aria-label', 'Relationship descriptions');
    this.navigationTree.className = 'org-delta-tree-navigation';
    this.navigationTree.setAttribute('role', 'tree');
    this.navigationTree.setAttribute('aria-label', 'Organization tree navigation');
    this.mount.append(this.emptyState, this.relationshipDescriptions, this.navigationTree);
    host.append(this.mount);
    this.motionQuery = typeof matchMedia === 'function'
      ? matchMedia('(prefers-reduced-motion: reduce)')
      : undefined;
    this.reducedMotion = this.motionQuery?.matches ?? false;
    this.overlay = new ConnectorOverlay(this.mount, options.onActivate);
    this.minimap.classList.add('org-delta-minimap');
    this.minimap.setAttribute('aria-hidden', 'true');
    this.minimap.setAttribute('viewBox', '0 0 160 100');
    this.minimap.style.position = 'absolute';
    this.minimap.style.right = '0';
    this.minimap.style.bottom = '0';
    this.minimap.style.width = '160px';
    this.minimap.style.height = '100px';
    this.minimap.style.pointerEvents = 'none';
    this.minimap.style.display = 'none';
    this.mount.append(this.minimap);
    this.chart = new OrgChart() as OrgChartApi;
    this.chart
      .container(this.mount)
      .nodeId((node) => node.id)
      .parentNodeId((node) => node.parentId)
      .nodeWidth(({ data }) => isSynthetic(data) ? 1 : 280)
      .nodeHeight(({ data }) => isSynthetic(data)
        ? 1
        : 88 + data.internalRows.length * 36)
      .nodeContent(renderNodeContent)
      .compact(false)
      .duration(this.reducedMotion ? 0 : D3OrgChartRenderer.LAYOUT_DURATION)
      .scaleExtent([0.15, 4])
      .minPagingVisibleNodes(() => 200)
      .onZoom(() => {
        this.scheduleOverlay();
        this.updateMinimapViewport();
      })
      .onExpandOrCollapse((node) => {
        this.captureExpansion([node]);
        if (!isSynthetic(node.data)) {
          this.expansion.set(node.data.id, Boolean(node.data._expanded ?? node.children));
        }
        this.scheduleAfterLayout();
        queueMicrotask(() => this.syncNavigationTree(node.data.id));
      })
      .nodeUpdate(function (node: D3HierarchyNode): void {
        if (isSynthetic(node.data)) {
          this.style.display = 'none';
          this.setAttribute('aria-hidden', 'true');
          return;
        }
        const visualNode = this.querySelector<HTMLElement>('[data-node-id]');
        if (visualNode) {
          delete visualNode.dataset.treeNode;
          visualNode.removeAttribute('role');
          visualNode.removeAttribute('aria-level');
          visualNode.removeAttribute('aria-expanded');
          visualNode.removeAttribute('aria-label');
          visualNode.removeAttribute('tabindex');
        }
        const hasChildren = Boolean(node.children || node._children || node.data._directSubordinates);
        const control = this.querySelector<SVGGElement>('.node-button-g');
        if (!control) return;
        if (!hasChildren) {
          control.removeAttribute('role');
          control.removeAttribute('tabindex');
          control.removeAttribute('aria-label');
          control.querySelector('title')?.remove();
          return;
        }
        const label = `${node.children ? 'Collapse' : 'Expand'} children of ${node.data.name}`;
        control.setAttribute('role', 'button');
        control.setAttribute('tabindex', '0');
        control.setAttribute('aria-label', label);
        let title = control.querySelector<SVGTitleElement>('title');
        if (!title) {
          title = document.createElementNS(SVG_NAMESPACE, 'title');
          control.prepend(title);
        }
        title.textContent = label;
      })
      .linkUpdate(function (current: D3HierarchyNode): void {
        if (isSynthetic(current.data) || isSynthetic(current.parent?.data)) {
          this.style.display = 'none';
          this.removeAttribute('data-activate-kind');
          this.removeAttribute('data-activate-id');
          this.removeAttribute('tabindex');
          this.removeAttribute('role');
          this.removeAttribute('aria-label');
          this.querySelector('title')?.remove();
          return;
        }
        if (
          current.data.connectorSourceId !== undefined &&
          current.data.parentId !== undefined &&
          current.parent?.data.id === current.data.parentId &&
          !isSynthetic(current.parent.data)
        ) {
          this.style.display = 'none';
          this.removeAttribute('data-activate-kind');
          this.removeAttribute('data-activate-id');
          this.removeAttribute('tabindex');
          this.removeAttribute('role');
          this.removeAttribute('aria-label');
          this.querySelector('title')?.remove();
          return;
        }
        const parentId = current.parent?.data.id;
        if (!parentId) return;
        this.style.display = '';
        this.setAttribute('stroke', 'currentColor');
        this.setAttribute('stroke-width', '2');
        this.dataset.activateKind = 'hierarchy';
        this.dataset.activateId = encodeHierarchyActivationId(parentId, current.data.id);
        this.setAttribute('role', 'button');
        this.setAttribute('tabindex', '0');
        const label =
          `${current.parent!.data.name} subordinate relationship to ${current.data.name}`;
        this.setAttribute('aria-label', label);
        let title = this.querySelector<SVGTitleElement>('title');
        if (!title) {
          title = document.createElementNS(SVG_NAMESPACE, 'title');
          this.prepend(title);
        }
        title.textContent = label;
      });

    this.motionQuery?.addEventListener?.('change', this.motionHandler);

    this.mount.addEventListener('click', this.clickHandler, true);
    this.mount.addEventListener('keydown', this.keyHandler, true);
    if (typeof ResizeObserver === 'function') {
      this.resizeObserver = new ResizeObserver(() => {
        this.configureSize();
        this.scheduleOverlay();
        this.scheduleMinimap();
      });
      this.resizeObserver.observe(host);
    }
  }

  render(view: RenderView): void {
    if (this.destroyed) return;
    this.currentView = view;
    this.emptyState.hidden = view.nodes.length > 0;
    if (view.nodes.length === 0) {
      this.chart.clear();
      this.relationshipDescriptions.replaceChildren();
      this.navigationTree.replaceChildren();
      this.chartHasData = false;
      this.expansion.clear();
      this.transitionFrames = 0;
      this.scheduleOverlay();
      this.scheduleMinimap();
      return;
    }
    this.configureSize();
    const duration = this.layoutDuration();
    this.chart.duration(duration);
    if (this.chartHasData) {
      this.captureExpansion(this.chart.getChartState().allNodes ?? []);
    }
    const initial = new Set(view.initialExpansionIds);
    const retained = new Set(view.nodes.map(({ id }) => id));
    for (const id of this.expansion.keys()) if (!retained.has(id)) this.expansion.delete(id);
    const data = rendererData(
      view.nodes.map((node) => {
        const expanded = this.expansion.get(node.id) ?? initial.has(node.id);
        this.expansion.set(node.id, expanded);
        return { ...node, _expanded: expanded };
      }),
    );
    this.chart.data(data).render();
    this.chartHasData = true;
    this.syncRelationshipDescriptions(view);
    this.syncDiagramSemantics();
    this.syncNavigationTree();
    this.scheduleAfterLayout();
  }

  reveal(nodeId: string): void {
    if (this.destroyed || !this.currentView?.nodes.some(({ id }) => id === nodeId)) return;
    this.chart.setCentered(nodeId).render();
    this.scheduleAfterLayout();
  }

  fit(): void {
    if (this.destroyed || !this.currentView || this.currentView.nodes.length === 0) return;
    this.configureSize();
    this.chart.fit({ animate: !this.reducedMotion });
    this.scheduleAfterLayout();
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    if (this.overlayFrame !== undefined) cancelAnimationFrame(this.overlayFrame);
    if (this.minimapFrame !== undefined) cancelAnimationFrame(this.minimapFrame);
    this.overlayFrame = undefined;
    this.minimapFrame = undefined;
    if (this.layoutTimer !== undefined) clearTimeout(this.layoutTimer);
    this.layoutTimer = undefined;
    this.resizeObserver?.disconnect();
    this.motionQuery?.removeEventListener?.('change', this.motionHandler);
    this.mount.removeEventListener('click', this.clickHandler, true);
    this.mount.removeEventListener('keydown', this.keyHandler, true);
    this.chart.clear();
    this.overlay.destroy();
    this.minimap.remove();
    this.relationshipDescriptions.remove();
    this.navigationTree.remove();
    this.mount.remove();
    this.currentView = undefined;
  }

  private scheduleOverlay(): void {
    if (this.destroyed || this.overlayFrame !== undefined) return;
    this.overlayFrame = requestAnimationFrame(() => {
      this.overlayFrame = undefined;
      if (this.destroyed || !this.currentView) return;
      this.overlay.sync(this.currentView.nodes, this.currentView.relationships);
      this.updateMinimapViewport();
      if (this.transitionFrames > 0) {
        this.transitionFrames -= 1;
        this.scheduleOverlay();
      }
    });
  }

  private syncRelationshipDescriptions(view: RenderView): void {
    this.relationshipDescriptions.replaceChildren(...view.relationships.map((relationship) => {
      const description = document.createElement('p');
      description.textContent = `${relationship.label}. ${relationship.source} to ${relationship.target}. ${relationship.diffKind}.`;
      return description;
    }));
  }

  private syncDiagramSemantics(): void {
    const svg = this.mount.querySelector<SVGSVGElement>('svg.svg-chart-container');
    if (!svg) return;
    svg.setAttribute('role', 'group');
    svg.setAttribute('aria-label', 'Interactive organization diagram');
  }

  private syncNavigationTree(preferredId?: string): void {
    const view = this.currentView;
    if (!view) return;
    const root = this.mount.getRootNode();
    const focused = root instanceof ShadowRoot ? root.activeElement : document.activeElement;
    const focusedId = focused instanceof HTMLElement && this.navigationTree.contains(focused)
      ? focused.dataset.activateId
      : undefined;
    const rovingId = this.navigationItems().find((item) => item.tabIndex === 0)
      ?.dataset.activateId;
    const entries = this.buildNavigationItems(view);
    const selectedId = focusedId ?? rovingId ?? preferredId ?? entries[0]?.id;
    const items = entries.map((entry) => {
      const item = document.createElement('div');
      item.setAttribute('role', 'treeitem');
      item.setAttribute('aria-label', entry.label);
      item.setAttribute('aria-level', String(entry.level));
      item.dataset.treeNavigationItem = '';
      item.dataset.activateKind = entry.kind;
      item.dataset.activateId = entry.id;
      item.dataset.ownerId = entry.ownerId;
      if (entry.parentId !== undefined) item.dataset.treeParentId = entry.parentId;
      if (entry.expandable) item.setAttribute('aria-expanded', String(entry.expanded));
      item.tabIndex = entry.id === selectedId ? 0 : -1;
      return item;
    });
    this.navigationTree.replaceChildren(...items);
    if (focusedId) items.find((item) => item.dataset.activateId === selectedId)?.focus();
  }

  private buildNavigationItems(view: RenderView): NavigationItem[] {
    const all: NavigationItem[] = [];
    const byId = new Map<string, NavigationItem>();
    const expandableIds = new Set(
      view.nodes.flatMap((node) => node.parentId === undefined ? [] : [node.parentId]),
    );
    for (const node of view.nodes) {
      const parentId = node.connectorSourceId && byId.has(node.connectorSourceId)
        ? node.connectorSourceId
        : node.parentId;
      const parent = parentId ? byId.get(parentId) : undefined;
      const level = (parent?.level ?? 0) + 1;
      const expandable = expandableIds.has(node.id);
      const outer: NavigationItem = {
        id: node.id,
        ownerId: node.id,
        ...(parentId ? { parentId } : {}),
        kind: 'node',
        label: parentId
          ? `${node.name}, subordinate organization, level ${level}`
          : `${node.name}, organization, level ${level}`,
        level,
        expandable,
        expanded: expandable && (this.expansion.get(node.id) ?? false),
      };
      all.push(outer);
      byId.set(outer.id, outer);
      const internalAtDepth = new Map<number, NavigationItem>();
      for (const row of node.internalRows) {
        const internalParent = internalAtDepth.get(row.depth - 1);
        const internalParentId = internalParent?.id ?? node.id;
        const internal: NavigationItem = {
          id: row.id,
          ownerId: node.id,
          parentId: internalParentId,
          kind: 'internal',
          label: `${row.name}, internal unit, level ${level + row.depth}`,
          level: level + row.depth,
          expandable: false,
          expanded: false,
        };
        all.push(internal);
        byId.set(internal.id, internal);
        internalAtDepth.set(row.depth, internal);
        for (const depth of [...internalAtDepth.keys()]) {
          if (depth > row.depth) internalAtDepth.delete(depth);
        }
      }
    }
    return all.filter((item) => {
      let parentId = item.parentId;
      while (parentId) {
        const parent = byId.get(parentId);
        if (!parent) break;
        if (parent.expandable && !parent.expanded) return false;
        parentId = parent.parentId;
      }
      return true;
    });
  }

  private navigationItems(): HTMLElement[] {
    return [...this.navigationTree.querySelectorAll<HTMLElement>('[data-tree-navigation-item]')];
  }

  private navigationItemFromEvent(event: Event): HTMLElement | undefined {
    const target = event.target;
    if (!(target instanceof Element)) return undefined;
    const item = target.closest<HTMLElement>('[data-tree-navigation-item]');
    return item && this.navigationTree.contains(item) ? item : undefined;
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
      else target = items.find((item) =>
        item.dataset.treeParentId === current.dataset.activateId
      );
    } else if (event.key === 'ArrowLeft') {
      if (current.getAttribute('aria-expanded') === 'true') this.toggleNavigationItem(current);
      else {
        target = items.find((item) => item.dataset.activateId === current.dataset.treeParentId);
      }
    } else if (event.key === 'Enter') this.activateNavigationItem(current);
    else if (event.key === ' ') {
      if (current.hasAttribute('aria-expanded')) this.toggleNavigationItem(current);
      else this.activateNavigationItem(current);
    }
    else return false;

    event.preventDefault();
    event.stopPropagation();
    if (target) {
      for (const item of items) item.tabIndex = item === target ? 0 : -1;
      target.focus();
    }
    return true;
  }

  private activateNavigationItem(item: HTMLElement): void {
    const id = item.dataset.activateId;
    const kind = item.dataset.activateKind;
    const ownerId = item.dataset.ownerId;
    if (!id || !ownerId || (kind !== 'node' && kind !== 'internal')) return;
    this.reveal(ownerId);
    this.options.onActivate(kind, id, item);
  }

  private toggleNavigationItem(item: HTMLElement): void {
    const id = item.dataset.activateId;
    if (!id || !item.hasAttribute('aria-expanded')) return;
    const expanded = item.getAttribute('aria-expanded') !== 'true';
    this.expansion.set(id, expanded);
    if (!expanded && this.currentView) {
      const collapsedIds = new Set([id]);
      for (const node of this.currentView.nodes) {
        if (node.parentId && collapsedIds.has(node.parentId)) {
          collapsedIds.add(node.id);
          this.expansion.set(node.id, false);
        }
      }
    }
    this.chart.setExpanded(id, expanded).render();
    this.syncNavigationTree(id);
    this.scheduleAfterLayout();
  }

  private scheduleMinimap(): void {
    if (this.destroyed || this.minimapFrame !== undefined) return;
    this.minimapFrame = requestAnimationFrame(() => {
      this.minimapFrame = undefined;
      if (this.destroyed || !this.currentView) return;
      this.syncMinimap(this.currentView);
    });
  }

  private syncMinimap(view: RenderView): void {
    const ids = new Set(view.nodes.map(({ id }) => id));
    const transform = this.chart.getChartState().lastTransform ?? { x: 0, y: 0, k: 1 };
    const mountRect = this.mount.getBoundingClientRect();
    const rendered = [...this.mount.querySelectorAll<HTMLElement>('[data-node-id]')]
      .filter((element) => ids.has(element.dataset.nodeId ?? ''))
      .map((element) => ({
        id: element.dataset.nodeId!,
        rect: element.getBoundingClientRect(),
      }));
    this.minimap.replaceChildren();
    if (rendered.length === 0) {
      this.minimap.style.display = 'none';
      return;
    }
    this.minimap.style.display = '';
    if (this.minimap.parentElement !== this.mount) this.mount.append(this.minimap);

    const world = rendered.map(({ id, rect }) => ({
      id,
      left: (rect.left - mountRect.left - transform.x) / transform.k,
      top: (rect.top - mountRect.top - transform.y) / transform.k,
      width: rect.width / transform.k,
      height: rect.height / transform.k,
    }));
    const minX = Math.min(...world.map(({ left }) => left));
    const minY = Math.min(...world.map(({ top }) => top));
    const maxX = Math.max(...world.map(({ left, width }) => left + width));
    const maxY = Math.max(...world.map(({ top, height }) => top + height));
    const scale = Math.min(148 / Math.max(1, maxX - minX), 88 / Math.max(1, maxY - minY));
    const offsetX = (160 - (maxX - minX) * scale) / 2;
    const offsetY = (100 - (maxY - minY) * scale) / 2;
    this.minimapProjection = { minX, minY, scale, offsetX, offsetY };
    const points = new Map(world.map(({ id, left, top, width, height }) => [id, {
      x: offsetX + (left + width / 2 - minX) * scale,
      y: offsetY + (top + height / 2 - minY) * scale,
    }]));

    for (const node of view.nodes) {
      if (node.parentId === undefined) continue;
      const source = points.get(node.parentId);
      const target = points.get(node.id);
      if (!source || !target) continue;
      const line = document.createElementNS(SVG_NAMESPACE, 'line');
      line.dataset.minimapLink = `${node.parentId}->${node.id}`;
      line.setAttribute('x1', String(source.x));
      line.setAttribute('y1', String(source.y));
      line.setAttribute('x2', String(target.x));
      line.setAttribute('y2', String(target.y));
      line.setAttribute('stroke', 'currentColor');
      this.minimap.append(line);
    }
    for (const [id, point] of points) {
      const circle = document.createElementNS(SVG_NAMESPACE, 'circle');
      circle.dataset.minimapNodeId = id;
      circle.setAttribute('cx', String(point.x));
      circle.setAttribute('cy', String(point.y));
      circle.setAttribute('r', '2');
      circle.setAttribute('fill', 'currentColor');
      this.minimap.append(circle);
    }
    this.updateMinimapViewport();
  }

  private updateMinimapViewport(): void {
    if (!this.minimapProjection || this.minimap.parentElement !== this.mount) return;
    const { minX, minY, scale, offsetX, offsetY } = this.minimapProjection;
    const { x, y, k } = this.chart.getChartState().lastTransform ?? { x: 0, y: 0, k: 1 };
    const rect = this.host.getBoundingClientRect();
    const width = rect.width > 0 ? rect.width : this.host.clientWidth || 800;
    const height = rect.height > 0 ? rect.height : this.host.clientHeight || 600;
    let viewport = this.minimap.querySelector<SVGRectElement>('.org-delta-minimap-viewport');
    if (!viewport) {
      viewport = document.createElementNS(SVG_NAMESPACE, 'rect');
      viewport.classList.add('org-delta-minimap-viewport');
      viewport.setAttribute('fill', 'none');
      viewport.setAttribute('stroke', 'currentColor');
      this.minimap.append(viewport);
    }
    viewport.setAttribute('x', String(offsetX + (-x / k - minX) * scale));
    viewport.setAttribute('y', String(offsetY + (-y / k - minY) * scale));
    viewport.setAttribute('width', String(width / k * scale));
    viewport.setAttribute('height', String(height / k * scale));
  }

  private scheduleAfterLayout(): void {
    const duration = this.layoutDuration();
    this.transitionFrames = duration === 0 ? 0 : Math.ceil(duration / 16);
    this.scheduleOverlay();
    this.scheduleMinimap();
    if (this.layoutTimer !== undefined) clearTimeout(this.layoutTimer);
    this.layoutTimer = undefined;
    if (duration === 0) return;
    this.layoutTimer = setTimeout(() => {
      this.layoutTimer = undefined;
      this.scheduleOverlay();
      this.scheduleMinimap();
    }, D3OrgChartRenderer.LAYOUT_DURATION);
  }

  private configureSize(): void {
    const rect = this.host.getBoundingClientRect();
    const width = rect.width > 0 ? rect.width : this.host.clientWidth || 800;
    const height = rect.height > 0 ? rect.height : this.host.clientHeight || 600;
    this.chart.svgWidth(width).svgHeight(height);
    const svg = this.mount.querySelector<SVGSVGElement>('svg.svg-chart-container');
    svg?.setAttribute('width', String(width));
    svg?.setAttribute('height', String(height));
  }

  private layoutDuration(): number {
    return this.reducedMotion ||
      !this.currentView ||
      this.currentView.nodes.length + this.currentView.relationships.length >= 300
      ? 0
      : D3OrgChartRenderer.LAYOUT_DURATION;
  }

  private captureExpansion(nodes: readonly D3HierarchyNode[]): void {
    for (const node of nodes) {
      for (const child of node.children ?? []) {
        if (!isSynthetic(child.data)) this.expansion.set(child.data.id, true);
      }
      for (const child of node._children ?? []) {
        if (!isSynthetic(child.data)) this.expansion.set(child.data.id, false);
      }
    }
  }

  private activateFromEvent(event: Event): void {
    const trigger = this.activationTrigger(event);
    if (!trigger) return;
    const kind = trigger.getAttribute('data-activate-kind');
    const id = trigger.getAttribute('data-activate-id');
    if (!kind || !ACTIVATION_KINDS.has(kind as ActivationKind) || id === null) return;
    this.options.onActivate(kind as ActivationKind, id, trigger);
  }

  private activationTrigger(event: Event): HTMLElement | SVGElement | undefined {
    const eventTarget = event.target;
    if (!(eventTarget instanceof Element)) return undefined;
    const trigger = eventTarget.closest<HTMLElement | SVGElement>(
      '[data-activate-kind][data-activate-id]',
    );
    return trigger && this.mount.contains(trigger) ? trigger : undefined;
  }
}
