// d3-org-chart 3.1.1 does not publish TypeScript declarations.
// @ts-expect-error The adapter below defines the supported API surface it consumes.
import { OrgChart } from 'd3-org-chart';
import { ConnectorOverlay } from './overlay';
import type { ActivationHandler, ActivationKind } from './overlay';
import type { ChartRenderer, RenderNode, RenderView } from './types';

interface D3Node {
  data: RenderNode;
  parent?: D3Node;
}

interface OrgChartApi {
  container(value: HTMLElement): this;
  data(value: readonly RenderNode[]): this;
  nodeId(value: (node: unknown) => string): this;
  parentNodeId(value: (node: unknown) => string | undefined): this;
  nodeWidth(value: (node: unknown) => number): this;
  nodeHeight(value: (node: unknown) => number): this;
  nodeContent(value: (node: unknown) => string): this;
  compact(value: boolean): this;
  duration(value: number): this;
  scaleExtent(value: [number, number]): this;
  minPagingVisibleNodes(value: (node: unknown) => number): this;
  onZoom(value: () => void): this;
  onExpandOrCollapse(value: () => void): this;
  linkUpdate(value: (this: SVGPathElement, node: unknown) => void): this;
  render(): this;
  setExpanded(id: string, expanded: boolean): this;
  setCentered(id: string): this;
  fit(options?: { animate?: boolean }): this;
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function nodeData(value: unknown): RenderNode | undefined {
  if (!isRecord(value)) return undefined;
  const data = isRecord(value.data) ? value.data : value;
  return typeof data.id === 'string' && typeof data.name === 'string'
    ? (data as unknown as RenderNode)
    : undefined;
}

function d3Node(value: unknown): D3Node | undefined {
  const data = nodeData(value);
  if (!data || !isRecord(value)) return undefined;
  const parentValue = value.parent;
  const parent = parentValue === undefined ? undefined : d3Node(parentValue);
  return parent ? { data, parent } : { data };
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

function activationAttributes(kind: ActivationKind, id: string): string {
  return `data-activate-kind="${kind}" data-activate-id="${escapeHtml(id)}"`;
}

function renderNodeContent(value: unknown): string {
  const node = nodeData(value);
  if (!node) return '';
  const nodeId = escapeHtml(node.id);
  const classes = [
    'org-delta-node',
    `org-delta-node--${node.diffKind}`,
    ...(node.ghost ? ['org-delta-node--ghost'] : []),
  ].join(' ');
  const rows = node.internalRows.map((row) => {
    const rowId = escapeHtml(row.id);
    const change = row.diffKind === 'unchanged'
      ? ''
      : `<button type="button" class="org-delta-change org-delta-change--${row.diffKind}" ${activationAttributes('change', row.id)} aria-label="View changes for ${escapeHtml(row.name)}">${escapeHtml(row.diffKind)}</button>`;
    return `<div class="org-delta-internal org-delta-internal--${row.diffKind}" data-internal-id="${rowId}" data-depth="${row.depth}"><button type="button" class="org-delta-internal-name" ${activationAttributes('internal', row.id)}>${escapeHtml(row.name)}</button>${row.hasSubordinateChildren ? '<span class="org-delta-subordinate-marker" aria-label="Has subordinate children"></span>' : ''}${change}</div>`;
  }).join('');
  const hiddenInternal = node.hiddenInternalCount > 0
    ? `<span class="org-delta-hidden-count" data-hidden-internal-count="${node.hiddenInternalCount}">${node.hiddenInternalCount} hidden</span>`
    : '';
  const hiddenChanges = node.hiddenChangeCount > 0
    ? `<span class="org-delta-hidden-changes" data-hidden-change-count="${node.hiddenChangeCount}">${node.hiddenChangeCount} changed</span>`
    : '';
  const change = node.diffKind === 'unchanged' && node.hiddenChangeCount === 0
    ? ''
    : `<button type="button" class="org-delta-change org-delta-change--${node.diffKind}" ${activationAttributes('change', node.id)}>View changes</button>`;
  return `<article class="${classes}" data-node-id="${nodeId}" data-diff-kind="${node.diffKind}"><button type="button" class="org-delta-node-name" ${activationAttributes('node', node.id)}>${escapeHtml(node.name)}</button>${change}${hiddenInternal}${hiddenChanges}<div class="org-delta-internal-rows">${rows}</div></article>`;
}

function prefersReducedMotion(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export class D3OrgChartRenderer implements ChartRenderer {
  private static readonly LAYOUT_DURATION = 300;
  private readonly chart: OrgChartApi;
  private readonly overlay: ConnectorOverlay;
  private readonly reducedMotion: boolean;
  private readonly resizeObserver: ResizeObserver | undefined;
  private currentView: RenderView | undefined;
  private frame: number | undefined;
  private layoutTimer: ReturnType<typeof setTimeout> | undefined;
  private destroyed = false;
  private readonly clickHandler = (event: MouseEvent): void => this.activateFromEvent(event);
  private readonly keyHandler = (event: KeyboardEvent): void => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    const target = event.target;
    if (!(target instanceof SVGElement)) return;
    event.preventDefault();
    this.activateFromEvent(event);
  };

  constructor(
    private readonly host: HTMLElement,
    private readonly options: D3OrgChartRendererOptions,
  ) {
    this.reducedMotion = prefersReducedMotion();
    this.overlay = new ConnectorOverlay(host, options.onActivate);
    this.chart = new OrgChart() as OrgChartApi;
    this.chart
      .container(host)
      .nodeId((value) => nodeData(value)?.id ?? '')
      .parentNodeId((value) => nodeData(value)?.parentId)
      .nodeWidth(() => 280)
      .nodeHeight((value) => 88 + (nodeData(value)?.internalRows.length ?? 0) * 36)
      .nodeContent(renderNodeContent)
      .compact(false)
      .duration(this.reducedMotion ? 0 : D3OrgChartRenderer.LAYOUT_DURATION)
      .scaleExtent([0.15, 4])
      .minPagingVisibleNodes(() => 200)
      .onZoom(() => this.scheduleOverlay())
      .onExpandOrCollapse(() => this.scheduleAfterLayout())
      .linkUpdate(function (value: unknown): void {
        const current = d3Node(value);
        if (!current) return;
        if (current.data.connectorSourceId !== undefined) {
          this.style.display = 'none';
          this.removeAttribute('data-activate-kind');
          this.removeAttribute('data-activate-id');
          return;
        }
        const parentId = current.parent?.data.id;
        if (!parentId) return;
        this.style.display = '';
        this.setAttribute('stroke', 'currentColor');
        this.setAttribute('stroke-width', '2');
        this.dataset.activateKind = 'hierarchy';
        this.dataset.activateId = `${parentId}->${current.data.id}`;
        this.setAttribute('role', 'button');
        this.setAttribute('tabindex', '0');
      });

    host.addEventListener('click', this.clickHandler);
    host.addEventListener('keydown', this.keyHandler);
    if (typeof ResizeObserver === 'function') {
      this.resizeObserver = new ResizeObserver(() => this.scheduleOverlay());
      this.resizeObserver.observe(host);
    }
  }

  render(view: RenderView): void {
    if (this.destroyed) return;
    this.currentView = view;
    const initial = new Set(view.initialExpansionIds);
    const data = view.nodes.map((node) => ({ ...node, _expanded: initial.has(node.id) }));
    this.chart.data(data).render();
    if (view.initialExpansionIds.length > 0) {
      for (const id of view.initialExpansionIds) this.chart.setExpanded(id, true);
      this.chart.render();
    }
    this.scheduleAfterLayout();
  }

  reveal(nodeId: string): void {
    if (this.destroyed) return;
    this.chart.setCentered(nodeId).render();
    this.scheduleAfterLayout();
  }

  fit(): void {
    if (this.destroyed) return;
    this.chart.fit({ animate: !this.reducedMotion });
    this.scheduleAfterLayout();
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    if (this.frame !== undefined) cancelAnimationFrame(this.frame);
    this.frame = undefined;
    if (this.layoutTimer !== undefined) clearTimeout(this.layoutTimer);
    this.layoutTimer = undefined;
    this.resizeObserver?.disconnect();
    this.host.removeEventListener('click', this.clickHandler);
    this.host.removeEventListener('keydown', this.keyHandler);
    this.overlay.destroy();
    this.chart.clear();
    this.currentView = undefined;
  }

  private scheduleOverlay(): void {
    if (this.destroyed || this.frame !== undefined) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = undefined;
      if (this.destroyed || !this.currentView) return;
      this.overlay.sync(this.currentView.nodes, this.currentView.relationships);
    });
  }

  private scheduleAfterLayout(): void {
    this.scheduleOverlay();
    if (this.layoutTimer !== undefined) clearTimeout(this.layoutTimer);
    this.layoutTimer = undefined;
    if (this.reducedMotion) return;
    this.layoutTimer = setTimeout(() => {
      this.layoutTimer = undefined;
      this.scheduleOverlay();
    }, D3OrgChartRenderer.LAYOUT_DURATION);
  }

  private activateFromEvent(event: Event): void {
    const eventTarget = event.target;
    if (!(eventTarget instanceof Element)) return;
    const trigger = eventTarget.closest<HTMLElement | SVGElement>(
      '[data-activate-kind][data-activate-id]',
    );
    if (!trigger || !this.host.contains(trigger)) return;
    const kind = trigger.getAttribute('data-activate-kind');
    const id = trigger.getAttribute('data-activate-id');
    if (!kind || !ACTIVATION_KINDS.has(kind as ActivationKind) || id === null) return;
    this.options.onActivate(kind as ActivationKind, id, trigger);
  }
}
