import { diffCharts, type ChartDiff } from '../model/diff';
import { resolveView } from '../model/resolve';
import { initialPatchSelection } from '../model/selection';
import type { OrgDocument, Proposal, ResolvedChart } from '../model/types';
import { validateDocument } from '../model/validate';
import { buildRenderView } from '../presentation/build-view';
import {
  changeDetails,
  hierarchyDetails,
  nodeDetails,
  relationshipDetails,
  type DetailsItem,
} from '../presentation/notes';
import { D3OrgChartRenderer } from '../renderer/d3-renderer';
import type { ActivationHandler, ActivationKind } from '../renderer/overlay';
import { decodeHierarchyActivationId, type ChartRenderer } from '../renderer/types';
import { closeDetailsPanel, renderDetailsPanel } from './details-panel';
import { installStyles } from './styles';
import { createTemplate, type ComponentTemplate } from './template';

export interface RendererCallbacks {
  onActivate: ActivationHandler;
}

export type RendererFactory = (
  container: HTMLElement,
  callbacks: RendererCallbacks,
) => ChartRenderer;

let rendererFactory: RendererFactory | undefined;

export function setRendererFactoryForTests(factory: RendererFactory | undefined): void {
  rendererFactory = factory;
}

function booleanAttribute(element: Element, name: string): boolean {
  const value = element.getAttribute(name);
  return value === null || !['false', '0', 'no'].includes(value.trim().toLowerCase());
}

function selectionsFor(document: OrgDocument, viewId: string): string[] {
  const proposals = new Map(document.proposals.map((proposal) => [proposal.id, proposal]));
  const chain: Proposal[] = [];
  const seen = new Set<string>();
  let proposal = proposals.get(viewId);
  while (proposal && !seen.has(proposal.id)) {
    seen.add(proposal.id);
    chain.unshift(proposal);
    proposal = proposals.get(proposal.base);
  }
  return chain.flatMap((item) => initialPatchSelection(item).selected);
}

function resolve(document: OrgDocument, viewId: string): ResolvedChart {
  return resolveView(document, { viewId, selectedGroups: selectionsFor(document, viewId) });
}

export class OrgDeltaChartElement extends HTMLElement {
  static readonly observedAttributes = [
    'src',
    'initial-view',
    'compare-to',
    'show-internal',
    'show-relationships',
  ];

  private readonly template: ComponentTemplate;
  private request: AbortController | undefined;
  private requestVersion = 0;
  private renderer: ChartRenderer | undefined;
  private documentData: OrgDocument | undefined;
  private viewErrors: ReadonlyMap<string, readonly string[]> = new Map();
  private selected: ResolvedChart | undefined;
  private diff: ChartDiff | undefined;
  private activationVersion = 0;

  constructor() {
    super();
    const root = this.attachShadow({ mode: 'open' });
    installStyles(root);
    this.template = createTemplate(root);
  }

  connectedCallback(): void {
    this.load();
  }

  disconnectedCallback(): void {
    this.request?.abort();
    this.request = undefined;
    this.requestVersion += 1;
    this.clearVisualization();
  }

  attributeChangedCallback(name: string, oldValue: string | null, newValue: string | null): void {
    if (!this.isConnected || oldValue === newValue) return;
    if (name === 'src') this.load();
    else if (this.documentData) this.renderDocument();
  }

  private load(): void {
    this.request?.abort();
    this.request = undefined;
    this.clearVisualization();
    const src = this.getAttribute('src');
    if (!src) {
      this.showError('Unable to load chart: src is required.', new Error('Missing src attribute'));
      return;
    }
    let url: URL;
    try {
      url = new URL(src, document.baseURI);
    } catch (error) {
      this.showError('Unable to load chart: invalid src.', error);
      return;
    }
    const request = new AbortController();
    const version = ++this.requestVersion;
    this.request = request;
    this.template.status.textContent = 'Loading chart...';
    void fetch(url.href, { signal: request.signal })
      .then(async (result) => {
        if (!result.ok) throw new HttpError(result.status);
        return result.json() as Promise<unknown>;
      })
      .then((input) => {
        if (!this.isConnected || request.signal.aborted || version !== this.requestVersion) return;
        const validation = validateDocument(input);
        if (!validation.ok) {
          this.showError('Unable to display chart: invalid document.', validation.errors);
          return;
        }
        this.documentData = validation.value;
        this.viewErrors = validation.viewErrors;
        this.renderDocument();
      })
      .catch((error: unknown) => {
        if (request.signal.aborted || version !== this.requestVersion) return;
        const message = error instanceof HttpError
          ? `Unable to load chart (HTTP ${error.status}).`
          : 'Unable to load chart.';
        this.showError(message, error);
      });
  }

  private clearVisualization(): void {
    this.activationVersion += 1;
    this.renderer?.destroy();
    this.renderer = undefined;
    this.template.canvas.replaceChildren();
    this.selected = undefined;
    this.diff = undefined;
    this.documentData = undefined;
    this.viewErrors = new Map();
    closeDetailsPanel(this.template.details);
    this.template.title.textContent = 'Organization chart';
    this.template.shell.setAttribute('aria-label', 'Organization chart');
  }

  private renderDocument(): void {
    const documentData = this.documentData;
    if (!documentData) return;
    const allIds = new Set([
      ...documentData.snapshots.map(({ id }) => id),
      ...documentData.proposals.map(({ id }) => id),
    ]);
    const requested = this.getAttribute('initial-view');
    if (requested !== null && !allIds.has(requested)) {
      this.showError(`Unable to display chart: view "${requested}" does not exist.`, requested);
      return;
    }
    if (requested !== null && this.viewErrors.has(requested)) {
      const errors = this.viewErrors.get(requested)!;
      this.showError(
        `Unable to display chart: view "${requested}" is invalid. ${errors.join(' ')}`,
        errors,
      );
      return;
    }
    const selectedId = requested ?? documentData.snapshots[0]?.id;
    if (!selectedId) {
      this.showError('Unable to display chart: no valid view.', this.viewErrors);
      return;
    }
    const selectedProposal = documentData.proposals.find(({ id }) => id === selectedId);
    const comparison = this.getAttribute('compare-to');
    if (comparison !== null && !allIds.has(comparison)) {
      this.showError(`Unable to display chart: baseline "${comparison}" does not exist.`, comparison);
      return;
    }
    if (comparison !== null && this.viewErrors.has(comparison)) {
      const errors = this.viewErrors.get(comparison)!;
      this.showError(
        `Unable to display chart: baseline "${comparison}" is invalid. ${errors.join(' ')}`,
        errors,
      );
      return;
    }
    const baselineId = comparison !== null
      ? comparison
      : selectedProposal && allIds.has(selectedProposal.base)
        ? selectedProposal.base
        : selectedId;
    try {
      const selected = resolve(documentData, selectedId);
      const baseline = resolve(documentData, baselineId);
      const diff = diffCharts(baseline, selected);
      const view = buildRenderView(selected, diff, {
        showInternal: booleanAttribute(this, 'show-internal'),
        showRelationships: booleanAttribute(this, 'show-relationships'),
        revealedInternalIds: new Set(),
      });
      if (!this.renderer) {
        const activationVersion = this.activationVersion;
        const callbacks: RendererCallbacks = {
          onActivate: (kind, id, trigger) => {
            if (activationVersion === this.activationVersion) this.activate(kind, id, trigger);
          },
        };
        this.renderer = rendererFactory
          ? rendererFactory(this.template.canvas, callbacks)
          : new D3OrgChartRenderer(this.template.canvas, callbacks);
      }
      this.selected = selected;
      this.diff = diff;
      this.template.title.textContent = documentData.title;
      this.template.shell.setAttribute('aria-label', documentData.title);
      const label = documentData.snapshots.find(({ id }) => id === selectedId)?.label
        ?? documentData.proposals.find(({ id }) => id === selectedId)?.label
        ?? selectedId;
      const summary = diff.summary;
      this.template.status.textContent = `${documentData.title}: ${label} ready, ${summary.added} added, ${summary.removed} removed, ${summary.modified} modified.`;
      this.renderer.render(view);
      this.dispatchEvent(new CustomEvent('org-delta-chart-ready', {
        detail: { title: documentData.title, viewId: selectedId, baselineId, summary: { ...summary } },
      }));
    } catch (error) {
      this.showError('Unable to display chart.', error);
    }
  }

  private readonly activate: ActivationHandler = (kind, id, trigger) => {
    const item = this.detailsFor(kind, id);
    if (item) renderDetailsPanel(this.template.details, item, trigger);
  };

  private detailsFor(kind: ActivationKind, id: string): DetailsItem | undefined {
    const chart = this.selected;
    if (!chart) return undefined;
    if (kind === 'node' || kind === 'internal') {
      const node = chart.nodes.get(id);
      return node ? nodeDetails(node) : undefined;
    }
    if (kind === 'hierarchy') {
      const hierarchyIds = decodeHierarchyActivationId(id);
      if (!hierarchyIds) return undefined;
      const [parentId, childId] = hierarchyIds;
      const child = chart.nodes.get(childId);
      const parent = chart.nodes.get(parentId);
      const edge = chart.parents.get(childId);
      return child && parent && edge ? hierarchyDetails(child, parent, edge) : undefined;
    }
    if (kind === 'relationship') {
      const relationship = chart.relationships.get(id)
        ?? this.diff?.relationships.get(id)?.before;
      return relationship ? relationshipDetails(relationship) : undefined;
    }
    if (kind === 'change') {
      const change = this.diff?.nodes.get(id) ?? this.diff?.relationships.get(id);
      return change ? changeDetails(change) : undefined;
    }
    return undefined;
  }

  private showError(message: string, detail: unknown): void {
    this.clearVisualization();
    this.template.status.textContent = message;
    console.error(`[org-delta-chart] ${message}`, detail);
    this.dispatchEvent(new CustomEvent('org-delta-chart-error', { detail: { message } }));
  }
}

class HttpError extends Error {
  constructor(readonly status: number) {
    super(`HTTP ${status}`);
  }
}
