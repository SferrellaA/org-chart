import { diffCharts, type ChartDiff } from '../model/diff';
import { resolveView } from '../model/resolve';
import { initialPatchSelection, togglePatchGroup, type PatchSelection } from '../model/selection';
import type { LayoutMode, OrgDocument, Proposal, ResolvedChart } from '../model/types';
import { validateDocument } from '../model/validate';
import { buildRenderView } from '../presentation/build-view';
import {
  buildTaxonomyRenderView,
  type TaxonomyRenderView,
} from '../presentation/build-taxonomy-view';
import {
  changeDetails,
  hierarchyDetails,
  nodeDetails,
  patchGroupDetails,
  relationshipDetails,
  type DetailsItem,
} from '../presentation/notes';
import { D3OrgChartRenderer } from '../renderer/d3-renderer';
import type { ActivationContext, ActivationHandler, ActivationKind } from '../renderer/overlay';
import { decodeHierarchyActivationId, type ChartRenderer, type RenderView } from '../renderer/types';
import { TaxonomyRenderer } from '../renderer/taxonomy-renderer';
import { closeDetailsPanel, renderDetailsPanel } from './details-panel';
import { cleanupControls, renderControls, type ControlsHandlers } from './controls';
import { hideNodeTooltip, showNodeTooltip } from './node-tooltip';
import { installStyles } from './styles';
import { createTemplate, type ComponentTemplate } from './template';

type DetailsKind = ActivationKind | 'patch-group';

interface ActiveDetails {
  kind: DetailsKind;
  id: string;
  trigger: HTMLElement | SVGElement;
  context?: ActivationContext;
}

export interface RendererCallbacks {
  onActivate: ActivationHandler;
}

export type RendererFactory = (
  container: HTMLElement,
  callbacks: RendererCallbacks,
  mode: LayoutMode,
  transitionDurationMs: number,
) => ChartRenderer<RenderView> | ChartRenderer<TaxonomyRenderView>;

type ActiveRenderer =
  | { mode: 'depth'; transitionDurationMs: number; instance: ChartRenderer<RenderView> }
  | { mode: 'taxonomy'; transitionDurationMs: number; instance: ChartRenderer<TaxonomyRenderView> };

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
    'layout-mode',
    'transition-duration',
  ];

  private readonly template: ComponentTemplate;
  private request: AbortController | undefined;
  private requestVersion = 0;
  private renderer: ActiveRenderer | undefined;
  private documentData: OrgDocument | undefined;
  private viewErrors: ReadonlyMap<string, readonly string[]> = new Map();
  private selected: ResolvedChart | undefined;
  private baseline: ResolvedChart | undefined;
  private diff: ChartDiff | undefined;
  private activationVersion = 0;
  private selectedViewId: string | undefined;
  private showInternal = true;
  private showRelationships = true;
  private readonly patchSelections = new Map<string, PatchSelection>();
  private readonly revealedInternalIds = new Set<string>();
  private renderView: RenderView | TaxonomyRenderView | undefined;
  private activeDetails: ActiveDetails | undefined;
  private tooltipTrigger: HTMLElement | undefined;

  constructor() {
    super();
    const root = this.attachShadow({ mode: 'open' });
    installStyles(root);
    this.template = createTemplate(root);
    this.template.canvas.addEventListener('pointerover', this.handleTooltipEnter);
    this.template.canvas.addEventListener('pointerout', this.handleTooltipLeave);
    this.template.canvas.addEventListener('focusin', this.handleTooltipEnter);
    this.template.canvas.addEventListener('focusout', this.handleTooltipLeave);
    this.template.controlsToggle.addEventListener('click', () => this.openControls());
    this.template.controlsBackdrop.addEventListener('click', () => this.closeControls());
    this.template.controlsSidebar.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') this.closeControls();
    });
  }

  connectedCallback(): void {
    this.load();
  }

  disconnectedCallback(): void {
    this.closeControls(false);
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
    this.hideTooltip();
    this.activationVersion += 1;
    this.renderer?.instance.destroy();
    this.renderer = undefined;
    this.template.canvas.replaceChildren();
    this.selected = undefined;
    this.baseline = undefined;
    this.diff = undefined;
    this.renderView = undefined;
    this.activeDetails = undefined;
    closeDetailsPanel(this.template.details, false);
  }

  private readonly handleTooltipEnter = (event: Event): void => {
    const trigger = this.tooltipActivation(event.target);
    if (!trigger || trigger === this.tooltipTrigger) return;
    this.hideTooltip();
    const id = trigger.dataset.activateId;
    if (!id) return;
    const preferred = trigger.dataset.viewSide === 'baseline' ? this.baseline : this.selected;
    const chart = preferred?.nodes.has(id)
      ? preferred
      : this.selected?.nodes.has(id)
        ? this.selected
        : this.baseline;
    const node = chart?.nodes.get(id);
    if (!chart || !node) return;
    const assignment = chart.parents.get(id);
    const parent = assignment ? chart.nodes.get(assignment.parent) : undefined;
    this.tooltipTrigger = trigger;
    showNodeTooltip(this.template.tooltip, trigger, {
      node,
      ...(parent ? { parent } : {}),
      ...(assignment ? { assignment } : {}),
    });
  };

  private readonly handleTooltipLeave = (event: Event): void => {
    const trigger = this.tooltipActivation(event.target);
    if (!trigger || trigger !== this.tooltipTrigger) return;
    const relatedTarget = 'relatedTarget' in event ? event.relatedTarget : null;
    if (relatedTarget instanceof Node && trigger.contains(relatedTarget)) return;
    this.hideTooltip();
  };

  private tooltipActivation(target: EventTarget | null): HTMLElement | undefined {
    if (!(target instanceof Element)) return undefined;
    const trigger = target.closest<HTMLElement>(
      '[data-activate-kind="node"], [data-activate-kind="internal"]',
    );
    return trigger && this.template.canvas.contains(trigger) ? trigger : undefined;
  }

  private hideTooltip(): void {
    hideNodeTooltip(this.template.tooltip, this.tooltipTrigger);
    this.tooltipTrigger = undefined;
  }

  private openControls(): void {
    this.template.controlsSidebar.dataset.open = 'true';
    this.template.controlsToggle.setAttribute('aria-expanded', 'true');
    this.template.controlsBackdrop.hidden = false;
    this.template.controlsSidebar.focus();
  }

  private closeControls(restoreFocus = true): void {
    delete this.template.controlsSidebar.dataset.open;
    this.template.controlsToggle.setAttribute('aria-expanded', 'false');
    this.template.controlsBackdrop.hidden = true;
    if (restoreFocus && this.template.controlsToggle.isConnected) {
      this.template.controlsToggle.focus();
    }
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
      const configuredMode = this.configuredLayoutMode(selected.presentation.layoutMode);
      const taxonomyFallback = configuredMode === 'taxonomy' &&
        selected.taxonomy.comparisonTiers.length === 0;
      const layoutMode: LayoutMode = taxonomyFallback ? 'depth' : configuredMode;
      const transitionDurationMs = this.configuredTransitionDuration(
        selected.presentation.transitionDurationMs,
      );
      const viewOptions = {
        showInternal: this.showInternal,
        showRelationships: this.showRelationships,
        revealedInternalIds: this.revealedInternalIds,
      };
      const view = layoutMode === 'taxonomy'
        ? buildTaxonomyRenderView(baseline, selected, diff, {
            ...viewOptions,
            comparison: baselineId !== selectedId,
          })
        : buildRenderView(selected, diff, viewOptions);
      if (
        !this.renderer ||
        this.renderer.mode !== layoutMode ||
        this.renderer.transitionDurationMs !== transitionDurationMs
      ) {
        this.renderer?.instance.destroy();
        const activationVersion = this.activationVersion;
        const callbacks: RendererCallbacks = {
          onActivate: (kind, id, trigger, context) => {
            if (activationVersion === this.activationVersion) {
              this.activate(kind, id, trigger, context);
            }
          },
        };
        const created = rendererFactory
          ? rendererFactory(this.template.canvas, callbacks, layoutMode, transitionDurationMs)
          : layoutMode === 'taxonomy'
            ? new TaxonomyRenderer(this.template.canvas, { ...callbacks, transitionDurationMs })
            : new D3OrgChartRenderer(this.template.canvas, { ...callbacks, transitionDurationMs });
        this.renderer = layoutMode === 'taxonomy'
          ? {
              mode: 'taxonomy',
              transitionDurationMs,
              instance: created as ChartRenderer<TaxonomyRenderView>,
            }
          : {
              mode: 'depth',
              transitionDurationMs,
              instance: created as ChartRenderer<RenderView>,
            };
      }
      this.selected = selected;
      this.baseline = baseline;
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
      const fallbackStatus = taxonomyFallback
        ? 'Taxonomy layout unavailable; showing depth layout. '
        : '';
      this.template.status.textContent = `${fallbackStatus}${documentData.title}: ${label} ready, ${summary.added} added, ${summary.removed} removed, ${summary.modified} modified, ${summary.unchanged} unchanged.`;
      if (this.renderer.mode === 'taxonomy') {
        this.renderer.instance.render(view as TaxonomyRenderView);
      } else if (this.renderer.mode === 'depth') {
        this.renderer.instance.render(view as RenderView);
      }
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
      if (this.renderer?.mode === 'taxonomy') this.renderer.instance.reveal(id);
      else if (ownerId) this.renderer?.instance.reveal(ownerId);
      const node = this.selected?.nodes.get(id);
      this.template.status.textContent = node ? `Revealed ${node.name}.` : `Revealed ${id}.`;
    },
    clearSearch: () => {
      this.revealedInternalIds.clear();
      this.updateChart();
    },
    fit: () => this.renderer?.instance.fit(),
  };

  private readonly activate: ActivationHandler = (kind, id, trigger, context) => {
    const item = this.detailsFor(kind, id, context);
    if (item) {
      this.activeDetails = { kind, id, trigger, ...(context ? { context } : {}) };
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
      details = this.detailsFor(active.kind, active.id, active.context);
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
          && (!active.context?.side || candidate.getAttribute('data-view-side') === active.context.side)
        );
    active.trigger = currentTrigger ?? (active.trigger.isConnected ? active.trigger : this.template.canvas);
    this.showActiveDetails(details, active.trigger, false);
  }

  private detailsFor(
    kind: ActivationKind,
    id: string,
    context?: ActivationContext,
  ): DetailsItem | undefined {
    const chart = context?.side === 'baseline' ? this.baseline : this.selected;
    if (!chart) return undefined;
    if (kind === 'node' || kind === 'internal') {
      const node = chart.nodes.get(id) ?? this.baseline?.nodes.get(id);
      const change = this.diff?.nodes.get(id);
      return node ? nodeDetails(node, change) : undefined;
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

  private configuredLayoutMode(documentDefault: LayoutMode | undefined): LayoutMode {
    const attribute = this.getAttribute('layout-mode');
    return attribute === 'depth' || attribute === 'taxonomy'
      ? attribute
      : documentDefault ?? 'depth';
  }

  private configuredTransitionDuration(documentDefault: number | undefined): number {
    const attribute = this.getAttribute('transition-duration');
    if (attribute !== null && /^\d+$/.test(attribute)) {
      const duration = Number(attribute);
      if (duration <= 5000) return duration;
    }
    return documentDefault ?? 700;
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
