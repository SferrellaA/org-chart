import { diffCharts, type ChartDiff } from '../model/diff';
import { resolveView } from '../model/resolve';
import { initialPatchSelection, togglePatchGroup, type PatchSelection } from '../model/selection';
import type { OrgDocument, Proposal, ResolvedChart } from '../model/types';
import { validateDocument } from '../model/validate';
import { buildRenderView } from '../presentation/build-view';
import {
  changeDetails,
  hierarchyDetails,
  nodeDetails,
  patchGroupDetails,
  relationshipDetails,
  type DetailsItem,
} from '../presentation/notes';
import { D3OrgChartRenderer } from '../renderer/d3-renderer';
import type { ActivationHandler, ActivationKind } from '../renderer/overlay';
import { decodeHierarchyActivationId, type ChartRenderer, type RenderView } from '../renderer/types';
import { closeDetailsPanel, renderDetailsPanel } from './details-panel';
import { cleanupControls, renderControls, type ControlsHandlers } from './controls';
import { installStyles } from './styles';
import { createTemplate, type ComponentTemplate } from './template';

type DetailsKind = ActivationKind | 'patch-group';

interface ActiveDetails {
  kind: DetailsKind;
  id: string;
  trigger: HTMLElement | SVGElement;
}

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

function selectionsFor(
  document: OrgDocument,
  viewId: string,
  selections: ReadonlyMap<string, PatchSelection>,
): string[] {
  const proposals = new Map(document.proposals.map((proposal) => [proposal.id, proposal]));
  const chain: Proposal[] = [];
  const seen = new Set<string>();
  let proposal = proposals.get(viewId);
  while (proposal && !seen.has(proposal.id)) {
    seen.add(proposal.id);
    chain.unshift(proposal);
    proposal = proposals.get(proposal.base);
  }
  return chain.flatMap((item) =>
    selections.get(item.id)?.selected ?? initialPatchSelection(item).selected
  );
}

function resolve(
  document: OrgDocument,
  viewId: string,
  selections: ReadonlyMap<string, PatchSelection>,
): ResolvedChart {
  return resolveView(document, {
    viewId,
    selectedGroups: selectionsFor(document, viewId, selections),
  });
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
  private selectedViewId: string | undefined;
  private showInternal = true;
  private showRelationships = true;
  private readonly patchSelections = new Map<string, PatchSelection>();
  private readonly revealedInternalIds = new Set<string>();
  private renderView: RenderView | undefined;
  private activeDetails: ActiveDetails | undefined;

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
    else if (this.documentData) {
      if (name === 'initial-view') this.selectedViewId = newValue ?? undefined;
      if (name === 'show-internal') this.showInternal = booleanAttribute(this, name);
      if (name === 'show-relationships') this.showRelationships = booleanAttribute(this, name);
      this.updateChart();
    }
  }

  private load(): void {
    this.request?.abort();
    this.request = undefined;
    this.clearVisualization();
    const src = this.getAttribute('src');
    if (!src) {
      this.showFatalError('Unable to load chart: src is required.', new Error('Missing src attribute'));
      return;
    }
    let url: URL;
    try {
      url = new URL(src, document.baseURI);
    } catch (error) {
      this.showFatalError('Unable to load chart: invalid src.', error);
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
          this.showFatalError('Unable to display chart: invalid document.', validation.errors);
          return;
        }
        this.documentData = validation.value;
        this.viewErrors = validation.viewErrors;
        this.selectedViewId = this.getAttribute('initial-view') ?? undefined;
        this.showInternal = booleanAttribute(this, 'show-internal');
        this.showRelationships = booleanAttribute(this, 'show-relationships');
        this.patchSelections.clear();
        this.revealedInternalIds.clear();
        this.updateChart();
      })
      .catch((error: unknown) => {
        if (request.signal.aborted || version !== this.requestVersion) return;
        const message = error instanceof HttpError
          ? `Unable to load chart (HTTP ${error.status}).`
          : 'Unable to load chart.';
        this.showFatalError(message, error);
      });
  }

  private clearView(): void {
    this.activationVersion += 1;
    this.renderer?.destroy();
    this.renderer = undefined;
    this.template.canvas.replaceChildren();
    this.selected = undefined;
    this.diff = undefined;
    this.renderView = undefined;
    this.activeDetails = undefined;
    closeDetailsPanel(this.template.details, false);
  }

  private clearVisualization(): void {
    this.clearView();
    cleanupControls(this.template.toolbar);
    this.documentData = undefined;
    this.viewErrors = new Map();
    this.template.title.textContent = 'Organization chart';
    this.template.shell.setAttribute('aria-label', 'Organization chart');
    this.template.toolbar.replaceChildren();
    this.template.selectionStatus.replaceChildren();
  }

  private updateChart(): void {
    const documentData = this.documentData;
    if (!documentData) return;
    const allIds = new Set([
      ...documentData.snapshots.map(({ id }) => id),
      ...documentData.proposals.map(({ id }) => id),
    ]);
    const requested = this.selectedViewId ?? this.getAttribute('initial-view');
    if (requested !== null && !allIds.has(requested)) {
      this.showViewError(`Unable to display chart: view "${requested}" does not exist.`, requested);
      return;
    }
    if (requested !== null && this.viewErrors.has(requested)) {
      const errors = this.viewErrors.get(requested)!;
      this.showViewError(
        `Unable to display chart: view "${requested}" is invalid. ${errors.join(' ')}`,
        errors,
      );
      return;
    }
    const selectedId = requested ?? documentData.snapshots[0]?.id;
    if (!selectedId) {
      this.showViewError('Unable to display chart: no valid view.', this.viewErrors);
      return;
    }
    const selectedProposal = documentData.proposals.find(({ id }) => id === selectedId);
    const comparison = this.getAttribute('compare-to');
    if (comparison !== null && !allIds.has(comparison)) {
      this.showViewError(`Unable to display chart: baseline "${comparison}" does not exist.`, comparison);
      return;
    }
    if (comparison !== null && this.viewErrors.has(comparison)) {
      const errors = this.viewErrors.get(comparison)!;
      this.showViewError(
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
      const selected = resolve(documentData, selectedId, this.patchSelections);
      const baseline = resolve(documentData, baselineId, this.patchSelections);
      const diff = diffCharts(baseline, selected);
      const view = buildRenderView(selected, diff, {
        showInternal: this.showInternal,
        showRelationships: this.showRelationships,
        revealedInternalIds: this.revealedInternalIds,
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
      this.renderView = view;
      this.selectedViewId = selectedId;
      this.template.title.textContent = documentData.title;
      this.template.shell.setAttribute('aria-label', documentData.title);
      const label = documentData.snapshots.find(({ id }) => id === selectedId)?.label
        ?? documentData.proposals.find(({ id }) => id === selectedId)?.label
        ?? selectedId;
      const summary = diff.summary;
      const baselineLabel = documentData.snapshots.find(({ id }) => id === baselineId)?.label
        ?? documentData.proposals.find(({ id }) => id === baselineId)?.label
        ?? baselineId;
      this.renderCurrentControls(selectedId, label, baselineLabel, view.searchEntries);
      this.template.status.textContent = `${documentData.title}: ${label} ready, ${summary.added} added, ${summary.removed} removed, ${summary.modified} modified, ${summary.unchanged} unchanged.`;
      this.renderer.render(view);
      this.refreshActiveDetails();
      this.dispatchEvent(new CustomEvent('org-delta-chart-ready', {
        detail: { title: documentData.title, viewId: selectedId, baselineId, summary: { ...summary } },
      }));
    } catch (error) {
      this.showViewError('Unable to display chart.', error);
    }
  }

  private renderCurrentControls(
    selectedId: string,
    selectedLabel: string,
    baselineLabel: string,
    searchEntries: RenderView['searchEntries'],
  ): void {
    const documentData = this.documentData!;
    const proposal = documentData.proposals.find(({ id }) => id === selectedId);
    let patchSelection: PatchSelection | undefined;
    if (proposal) {
      patchSelection = this.patchSelections.get(proposal.id) ?? initialPatchSelection(proposal);
      this.patchSelections.set(proposal.id, patchSelection);
    }
    renderControls(this.template.toolbar, {
      views: [
        ...documentData.snapshots.map(({ id, label }) => ({
          id, label, invalid: this.viewErrors.has(id),
        })),
        ...documentData.proposals.map(({ id, label }) => ({
          id, label, invalid: this.viewErrors.has(id),
        })),
      ],
      selectedViewId: selectedId,
      selectedLabel,
      baselineLabel,
      patchGroups: proposal?.patchGroups ?? [],
      ...(patchSelection ? { patchSelection } : {}),
      showInternal: this.showInternal,
      showRelationships: this.showRelationships,
      searchEntries,
    }, this.controlHandlers);
    const status = this.template.toolbar.querySelector('[data-selection-status]');
    this.template.selectionStatus.replaceChildren(status ?? '');
  }

  private readonly controlHandlers: ControlsHandlers = {
    selectView: (id) => {
      this.selectedViewId = id;
      this.revealedInternalIds.clear();
      this.updateChart();
    },
    togglePatchGroup: (id, checked) => {
      const proposal = this.documentData?.proposals.find(({ id: proposalId }) =>
        proposalId === this.selectedViewId
      );
      if (!proposal) return;
      const current = this.patchSelections.get(proposal.id) ?? initialPatchSelection(proposal);
      this.patchSelections.set(proposal.id, togglePatchGroup(proposal, current, id, checked));
      this.updateChart();
    },
    showPatchGroup: (group, trigger) => {
      this.activeDetails = { kind: 'patch-group', id: group.id, trigger };
      this.showActiveDetails(patchGroupDetails(group), trigger);
    },
    setShowInternal: (checked) => {
      this.showInternal = checked;
      this.updateChart();
    },
    setShowRelationships: (checked) => {
      this.showRelationships = checked;
      this.updateChart();
    },
    revealSearchResult: (id) => {
      this.revealedInternalIds.add(id);
      let ancestor = this.selected?.parents.get(id)?.parent;
      while (ancestor && this.selected?.parents.get(ancestor)?.relationship === 'internal') {
        this.revealedInternalIds.add(ancestor);
        ancestor = this.selected.parents.get(ancestor)?.parent;
      }
      this.updateChart();
      const ownerId = this.renderView?.searchEntries.find((entry) => entry.id === id)?.ownerId;
      if (ownerId) this.renderer?.reveal(ownerId);
      const node = this.selected?.nodes.get(id);
      this.template.status.textContent = node ? `Revealed ${node.name}.` : `Revealed ${id}.`;
    },
    clearSearch: () => {
      this.revealedInternalIds.clear();
      this.updateChart();
    },
    fit: () => this.renderer?.fit(),
  };

  private readonly activate: ActivationHandler = (kind, id, trigger) => {
    const item = this.detailsFor(kind, id);
    if (item) {
      this.activeDetails = { kind, id, trigger };
      this.showActiveDetails(item, trigger);
    }
  };

  private showActiveDetails(
    item: DetailsItem,
    trigger: HTMLElement | SVGElement,
    focusHeading = true,
  ): void {
    renderDetailsPanel(this.template.details, item, trigger, () => {
      this.activeDetails = undefined;
    }, focusHeading);
  }

  private refreshActiveDetails(): void {
    const active = this.activeDetails;
    if (!active) return;
    let details: DetailsItem | undefined;
    if (active.kind === 'patch-group') {
      const group = this.documentData?.proposals.find(({ id }) => id === this.selectedViewId)
        ?.patchGroups?.find(({ id }) => id === active.id);
      details = group ? patchGroupDetails(group) : undefined;
    } else {
      details = this.detailsFor(active.kind, active.id);
    }
    if (!details) {
      this.activeDetails = undefined;
      closeDetailsPanel(this.template.details, false);
      return;
    }
    const currentTrigger = active.kind === 'patch-group'
      ? [...this.template.toolbar.querySelectorAll<HTMLElement>('[data-patch-group-about]')]
        .find((candidate) => candidate.dataset.patchGroupAbout === active.id)
      : [...this.template.canvas.querySelectorAll<HTMLElement | SVGElement>('[data-activate-kind]')]
        .find((candidate) =>
          candidate.getAttribute('data-activate-kind') === active.kind
          && candidate.getAttribute('data-activate-id') === active.id
        );
    active.trigger = currentTrigger ?? (active.trigger.isConnected ? active.trigger : this.template.canvas);
    this.showActiveDetails(details, active.trigger, false);
  }

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
      return child && parent && edge?.parent === parentId
        ? hierarchyDetails(child, parent, edge)
        : undefined;
    }
    if (kind === 'relationship') {
      const relationship = chart.relationships.get(id)
        ?? this.diff?.relationships.get(id)?.before;
      return relationship ? relationshipDetails(relationship) : undefined;
    }
    if (kind === 'change') {
      const change = this.diff?.nodes.get(id) ?? this.diff?.relationships.get(id);
      return change && change.kind !== 'unchanged' ? changeDetails(change) : undefined;
    }
    return undefined;
  }

  private showFatalError(message: string, detail: unknown): void {
    this.clearVisualization();
    this.reportError(message, detail);
  }

  private showViewError(message: string, detail: unknown): void {
    this.clearView();
    if (this.documentData) {
      const selectedId = this.selectedViewId ?? this.getAttribute('initial-view') ?? '';
      const selectedLabel = this.documentData.snapshots.find(({ id }) => id === selectedId)?.label
        ?? this.documentData.proposals.find(({ id }) => id === selectedId)?.label
        ?? selectedId;
      const baselineId = this.getAttribute('compare-to')
        ?? this.documentData.proposals.find(({ id }) => id === selectedId)?.base
        ?? selectedId;
      const baselineLabel = this.documentData.snapshots.find(({ id }) => id === baselineId)?.label
        ?? this.documentData.proposals.find(({ id }) => id === baselineId)?.label
        ?? baselineId;
      this.renderCurrentControls(selectedId, selectedLabel, baselineLabel, []);
    }
    this.reportError(message, detail);
  }

  private reportError(message: string, detail: unknown): void {
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
