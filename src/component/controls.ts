import type { PatchSelection } from '../model/selection';
import type { PatchGroup, Source } from '../model/types';
import type { SearchEntry } from '../renderer/types';

export interface ControlView {
  id: string;
  label: string;
  invalid: boolean;
}

export interface ControlsState {
  views: readonly ControlView[];
  selectedViewId: string;
  selectedLabel: string;
  baselineLabel: string;
  patchGroups: readonly PatchGroup[];
  patchSelection?: PatchSelection;
  showInternal: boolean;
  showRelationships: boolean;
  searchEntries: readonly SearchEntry[];
  searchQuery: string;
}

export interface ControlsHandlers {
  selectView(id: string): void;
  togglePatchGroup(id: string, checked: boolean): void;
  showPatchGroup(group: PatchGroup, trigger: HTMLElement): void;
  setShowInternal(checked: boolean): void;
  setShowRelationships(checked: boolean): void;
  setSearchQuery(query: string): void;
  revealSearchResult(id: string): void;
  clearSearch(): void;
  fit(): void;
}

function checkbox(labelText: string, checked: boolean, dataName: string): HTMLLabelElement {
  const label = document.createElement('label');
  label.className = 'control-check';
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.checked = checked;
  input.dataset[dataName] = '';
  label.append(input, document.createTextNode(labelText));
  return label;
}

function sourceSummary(sources: readonly Source[] | undefined): string {
  return sources?.length ? ` ${sources.length} source${sources.length === 1 ? '' : 's'}.` : '';
}

function lockedRequirements(groups: readonly PatchGroup[]): ReadonlyMap<string, string> {
  const byId = new Map(groups.map((group) => [group.id, group]));
  const result = new Map<string, string>();
  for (const locked of groups.filter((group) => group.locked)) {
    const pending = [...(locked.requires ?? [])];
    const seen = new Set<string>();
    while (pending.length > 0) {
      const id = pending.pop()!;
      if (seen.has(id)) continue;
      seen.add(id);
      result.set(id, `Required by locked "${locked.id}".`);
      pending.push(...(byId.get(id)?.requires ?? []));
    }
  }
  return result;
}

export function renderControls(
  container: HTMLElement,
  state: ControlsState,
  handlers: ControlsHandlers,
): void {
  const fragment = document.createDocumentFragment();
  const requiredByLocked = lockedRequirements(state.patchGroups);
  const viewControl = document.createElement('div');
  viewControl.className = 'view-control';
  if (state.views.length <= 4) {
    viewControl.setAttribute('role', 'group');
    viewControl.setAttribute('aria-label', 'View');
    for (const view of state.views) {
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.viewId = view.id;
      button.textContent = view.label;
      button.setAttribute('aria-pressed', String(view.id === state.selectedViewId));
      if (view.invalid) button.className = 'view-control__invalid';
      button.addEventListener('click', () => handlers.selectView(view.id));
      viewControl.append(button);
    }
  } else {
    const label = document.createElement('label');
    label.textContent = 'View ';
    const select = document.createElement('select');
    select.dataset.viewSelect = '';
    for (const view of state.views) {
      const option = document.createElement('option');
      option.value = view.id;
      option.textContent = view.invalid ? `${view.label} (invalid)` : view.label;
      option.selected = view.id === state.selectedViewId;
      select.append(option);
    }
    select.addEventListener('change', () => handlers.selectView(select.value));
    label.append(select);
    viewControl.append(label);
  }
  fragment.append(viewControl);

  const selectionStatus = document.createElement('p');
  selectionStatus.className = 'selection-status';
  selectionStatus.dataset.selectionStatus = '';
  selectionStatus.textContent = `Selected: ${state.selectedLabel}. Compared with: ${state.baselineLabel}.`;
  fragment.append(selectionStatus);

  if (state.patchSelection && state.patchGroups.length > 0) {
    const fieldset = document.createElement('fieldset');
    const legend = document.createElement('legend');
    legend.textContent = 'Proposal changes';
    fieldset.append(legend);
    for (const group of state.patchGroups) {
      const row = document.createElement('div');
      row.className = 'patch-group';
      const label = document.createElement('label');
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.dataset.patchGroup = group.id;
      input.checked = state.patchSelection.selected.includes(group.id);
      const reason = group.locked
        ? `Required change; ${group.label} is locked on.`
        : requiredByLocked.get(group.id) ?? state.patchSelection.disabled.get(group.id);
      if (reason) {
        const reasonId = `patch-reason-${group.id.replace(/[^a-zA-Z0-9_-]/g, '-')}`;
        input.disabled = true;
        input.setAttribute('aria-describedby', reasonId);
        const explanation = document.createElement('span');
        explanation.id = reasonId;
        explanation.className = 'patch-group__reason';
        explanation.textContent = reason;
        row.append(explanation);
      }
      if (!reason) {
        input.addEventListener('change', () => handlers.togglePatchGroup(group.id, input.checked));
      }
      label.append(input, document.createTextNode(group.label));
      row.prepend(label);
      if (group.note || group.sources?.length) {
        const about = document.createElement('button');
        about.type = 'button';
        about.dataset.patchGroupAbout = group.id;
        about.textContent = `About ${group.label}`;
        about.title = `${group.note ?? ''}${sourceSummary(group.sources)}`.trim();
        about.addEventListener('click', () => handlers.showPatchGroup(group, about));
        row.append(about);
      }
      fieldset.append(row);
    }
    fragment.append(fieldset);
  }

  const exploration = document.createElement('div');
  exploration.className = 'exploration-controls';
  const internalLabel = checkbox('Show internal units', state.showInternal, 'showInternal');
  internalLabel.querySelector('input')!.addEventListener('change', (event) => {
    handlers.setShowInternal((event.currentTarget as HTMLInputElement).checked);
  });
  const relationshipLabel = checkbox(
    'Show relationships',
    state.showRelationships,
    'showRelationships',
  );
  relationshipLabel.querySelector('input')!.addEventListener('change', (event) => {
    handlers.setShowRelationships((event.currentTarget as HTMLInputElement).checked);
  });
  exploration.append(internalLabel, relationshipLabel);
  const fit = document.createElement('button');
  fit.type = 'button';
  fit.dataset.fit = '';
  fit.textContent = 'Fit chart';
  fit.addEventListener('click', handlers.fit);
  exploration.append(fit);

  const searchLabel = document.createElement('label');
  searchLabel.textContent = 'Find organization ';
  const search = document.createElement('input');
  search.type = 'search';
  search.dataset.search = '';
  search.value = state.searchQuery;
  search.setAttribute('list', 'org-search-results');
  search.setAttribute('autocomplete', 'off');
  search.setAttribute('aria-controls', 'org-chart-search-results');
  search.addEventListener('input', () => handlers.setSearchQuery(search.value));
  searchLabel.append(search);
  exploration.append(searchLabel);
  const datalist = document.createElement('datalist');
  datalist.id = 'org-search-results';
  for (const entry of state.searchEntries) {
    const option = document.createElement('option');
    option.value = entry.label;
    option.label = entry.id;
    datalist.append(option);
  }
  exploration.append(datalist);
  if (state.searchQuery) {
    const clear = document.createElement('button');
    clear.type = 'button';
    clear.dataset.searchClear = '';
    clear.textContent = 'Clear search';
    clear.addEventListener('click', handlers.clearSearch);
    exploration.append(clear);
    const results = document.createElement('ul');
    results.id = 'org-chart-search-results';
    results.className = 'search-results';
    const query = state.searchQuery.trim().toLocaleLowerCase();
    for (const entry of state.searchEntries.filter((item) =>
      item.label.toLocaleLowerCase().includes(query) || item.id.toLocaleLowerCase().includes(query)
    )) {
      const result = document.createElement('button');
      result.type = 'button';
      result.dataset.searchResult = entry.id;
      result.textContent = entry.label;
      result.addEventListener('click', () => handlers.revealSearchResult(entry.id));
      const item = document.createElement('li');
      item.append(result);
      results.append(item);
    }
    exploration.append(results);
  }
  fragment.append(exploration);
  container.replaceChildren(fragment);
}
