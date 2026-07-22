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
}

export interface ControlsHandlers {
  selectView(id: string): void;
  togglePatchGroup(id: string, checked: boolean): void;
  showPatchGroup(group: PatchGroup, trigger: HTMLElement): void;
  setShowInternal(checked: boolean): void;
  setShowRelationships(checked: boolean): void;
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

function identify(element: HTMLElement, control: string, key = control): void {
  element.dataset.control = control;
  element.dataset.key = key;
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
  const root = container.getRootNode();
  const activeElement = root instanceof ShadowRoot ? root.activeElement : document.activeElement;
  const active = activeElement instanceof HTMLElement && container.contains(activeElement)
    ? {
        control: activeElement.dataset.control,
        key: activeElement.dataset.key,
        selectionStart: activeElement instanceof HTMLInputElement ? activeElement.selectionStart : null,
        selectionEnd: activeElement instanceof HTMLInputElement ? activeElement.selectionEnd : null,
      }
    : undefined;
  const previousSearch = container.querySelector<HTMLInputElement>('[data-control="search"]')?.value ?? '';
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
      identify(button, 'view', view.id);
      button.textContent = view.invalid ? `${view.label} (invalid view)` : view.label;
      button.setAttribute('aria-pressed', String(view.id === state.selectedViewId));
      if (view.invalid) {
        button.className = 'view-control__invalid';
        button.setAttribute('aria-invalid', 'true');
      }
      button.addEventListener('click', () => handlers.selectView(view.id));
      viewControl.append(button);
    }
  } else {
    const label = document.createElement('label');
    label.textContent = 'View ';
    const select = document.createElement('select');
    select.dataset.viewSelect = '';
    identify(select, 'view-select');
    if (state.views.some((view) => view.id === state.selectedViewId && view.invalid)) {
      select.setAttribute('aria-invalid', 'true');
    }
    for (const view of state.views) {
      const option = document.createElement('option');
      option.value = view.id;
      option.textContent = view.invalid ? `${view.label} (invalid)` : view.label;
      if (view.invalid) option.setAttribute('aria-invalid', 'true');
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
      identify(input, 'patch-group', group.id);
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
        identify(about, 'patch-group-about', group.id);
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
  identify(internalLabel.querySelector('input')!, 'show-internal');
  internalLabel.querySelector('input')!.addEventListener('change', (event) => {
    handlers.setShowInternal((event.currentTarget as HTMLInputElement).checked);
  });
  const relationshipLabel = checkbox(
    'Show relationships',
    state.showRelationships,
    'showRelationships',
  );
  identify(relationshipLabel.querySelector('input')!, 'show-relationships');
  relationshipLabel.querySelector('input')!.addEventListener('change', (event) => {
    handlers.setShowRelationships((event.currentTarget as HTMLInputElement).checked);
  });
  exploration.append(internalLabel, relationshipLabel);
  const fit = document.createElement('button');
  fit.type = 'button';
  fit.dataset.fit = '';
  identify(fit, 'fit');
  fit.textContent = 'Fit chart';
  fit.addEventListener('click', handlers.fit);
  exploration.append(fit);

  const searchLabel = document.createElement('label');
  searchLabel.textContent = 'Find organization ';
  const search = document.createElement('input');
  search.type = 'search';
  search.dataset.search = '';
  identify(search, 'search');
  search.value = previousSearch;
  search.setAttribute('list', 'org-search-results');
  search.setAttribute('autocomplete', 'off');
  search.setAttribute('aria-controls', 'org-chart-search-results');
  searchLabel.append(search);
  exploration.append(searchLabel);
  const datalist = document.createElement('datalist');
  datalist.id = 'org-search-results';
  exploration.append(datalist);
  const clear = document.createElement('button');
  clear.type = 'button';
  clear.dataset.searchClear = '';
  identify(clear, 'search-clear');
  clear.textContent = 'Clear search';
  exploration.append(clear);
  const results = document.createElement('ul');
  results.id = 'org-chart-search-results';
  results.className = 'search-results';
  exploration.append(results);

  const matchingEntries = (query: string): SearchEntry[] => {
    const normalized = query.trim().toLocaleLowerCase();
    if (!normalized) return [];
    return state.searchEntries.filter((entry) =>
      entry.id.toLocaleLowerCase().includes(normalized)
      || entry.label.toLocaleLowerCase().includes(normalized)
      || entry.aliases.some((alias) => alias.toLocaleLowerCase().includes(normalized))
    );
  };
  let lastCommitted: string | undefined;
  const filterSearch = (): void => {
    const matches = matchingEntries(search.value).slice(0, 50);
    datalist.replaceChildren(...matches.map((entry) => {
      const option = document.createElement('option');
      option.value = entry.label;
      option.label = entry.id;
      return option;
    }));
    results.replaceChildren(...matches.map((entry) => {
      const result = document.createElement('button');
      result.type = 'button';
      result.dataset.searchResult = entry.id;
      identify(result, 'search-result', entry.id);
      result.textContent = entry.label;
      result.addEventListener('click', () => {
        lastCommitted = `${search.value.trim().toLocaleLowerCase()}\0${entry.id}`;
        handlers.revealSearchResult(entry.id);
      });
      const item = document.createElement('li');
      item.append(result);
      return item;
    }));
    clear.hidden = search.value.trim() === '';
  };
  const commitExact = (): boolean => {
    const normalized = search.value.trim().toLocaleLowerCase();
    if (!normalized) return false;
    const exact = state.searchEntries.filter((entry) =>
      entry.id.toLocaleLowerCase() === normalized
      || entry.label.toLocaleLowerCase() === normalized
      || entry.aliases.some((alias) => alias.toLocaleLowerCase() === normalized)
    );
    if (exact.length !== 1) return false;
    const key = `${normalized}\0${exact[0]!.id}`;
    if (lastCommitted === key) return true;
    lastCommitted = key;
    handlers.revealSearchResult(exact[0]!.id);
    return true;
  };
  search.addEventListener('input', filterSearch);
  search.addEventListener('change', commitExact);
  search.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && commitExact()) event.preventDefault();
  });
  clear.addEventListener('click', () => {
    search.value = '';
    filterSearch();
    handlers.clearSearch();
  });
  filterSearch();
  fragment.append(exploration);
  container.replaceChildren(fragment);
  if (active?.control) {
    const replacement = [...container.querySelectorAll<HTMLElement>('[data-control]')]
      .find((candidate) =>
        candidate.dataset.control === active.control && candidate.dataset.key === active.key
      );
    replacement?.focus();
    if (replacement instanceof HTMLInputElement && active.selectionStart !== null) {
      replacement.setSelectionRange(active.selectionStart, active.selectionEnd);
    }
  }
}
