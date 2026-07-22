import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  OrgDeltaChartElement,
  renderDetailsPanel,
  setRendererFactoryForTests,
  type RendererCallbacks,
} from '../src/index';
import { ConnectorOverlay } from '../src/renderer/overlay';
import {
  decodeHierarchyActivationId,
  encodeHierarchyActivationId,
  type ChartRenderer,
  type RenderView,
} from '../src/renderer/types';
import { cloneValidDocument } from './fixtures';

class FakeRenderer implements ChartRenderer {
  readonly views: RenderView[] = [];
  readonly revealed: string[] = [];
  fitCalls = 0;
  destroyed = false;

  constructor(readonly callbacks: RendererCallbacks) {}

  render(view: RenderView): void {
    this.views.push(view);
  }

  reveal(id: string): void { this.revealed.push(id); }
  fit(): void { this.fitCalls += 1; }

  destroy(): void {
    this.destroyed = true;
  }
}

function response(body: unknown, init: { ok?: boolean; status?: number } = {}): Response {
  return {
    ok: init.ok ?? true,
    status: init.status ?? 200,
    json: vi.fn().mockResolvedValue(body),
  } as unknown as Response;
}

function deferred<T>(): { promise: Promise<T>; resolve(value: T): void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe('OrgDeltaChartElement', () => {
  const renderers: FakeRenderer[] = [];

  beforeEach(() => {
    renderers.length = 0;
    setRendererFactoryForTests((_container, callbacks) => {
      const renderer = new FakeRenderer(callbacks);
      renderers.push(renderer);
      return renderer;
    });
  });

  afterEach(() => {
    document.body.replaceChildren();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    setRendererFactoryForTests(undefined);
  });

  it('resolves src against the containing page and announces loading before rendering', async () => {
    const fetchMock = vi.fn().mockResolvedValue(response(cloneValidDocument()));
    vi.stubGlobal('fetch', fetchMock);
    const element = new OrgDeltaChartElement();
    element.setAttribute('src', 'fixtures/chart.json');
    const readyEvents: unknown[] = [];
    element.addEventListener('org-delta-chart-ready', (event) => {
      readyEvents.push((event as CustomEvent).detail);
    });

    document.body.append(element);
    const status = element.shadowRoot!.querySelector('[role="status"]')!;
    expect(status.textContent).toBe('Loading chart...');
    expect(fetchMock).toHaveBeenCalledWith(
      new URL('fixtures/chart.json', document.baseURI).href,
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );

    await settle();
    expect(renderers).toHaveLength(1);
    expect(renderers[0]!.views).toHaveLength(1);
    expect(renderers[0]!.views[0]!.nodes.map((node) => node.id)).toContain('state');
    expect(status.textContent).toContain('US government organizations');
    expect(status.textContent).toContain('Current organization');
    expect(element.shadowRoot!.querySelector('section')!.getAttribute('aria-label'))
      .toBe('US government organizations');
    expect(readyEvents).toEqual([expect.objectContaining({
      title: 'US government organizations',
      viewId: 'current',
      baselineId: 'current',
      summary: { added: 0, removed: 0, modified: 0, unchanged: 4 },
    })]);
  });

  it.each([
    ['HTTP failure', response({}, { ok: false, status: 503 }), 'Unable to load chart (HTTP 503).'],
    ['invalid document', response({ title: 'Broken' }), 'Unable to display chart: invalid document.'],
  ])('shows a concise error for %s', async (_label, result, message) => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(result));
    const element = new OrgDeltaChartElement();
    element.setAttribute('src', '/chart.json');
    document.body.append(element);
    const errors: unknown[] = [];
    element.addEventListener('org-delta-chart-error', (event) => {
      errors.push((event as CustomEvent).detail);
    });

    await settle();
    expect(element.shadowRoot!.querySelector('[role="status"]')!.textContent).toBe(message);
    expect(errors).toEqual([{ message }]);
    expect(renderers).toHaveLength(0);
  });

  it('aborts an old request and ignores its stale response when src changes', async () => {
    const first = deferred<Response>();
    const second = deferred<Response>();
    const signals: AbortSignal[] = [];
    vi.stubGlobal('fetch', vi.fn((_url: string, init: RequestInit) => {
      signals.push(init.signal as AbortSignal);
      return signals.length === 1 ? first.promise : second.promise;
    }));
    const element = new OrgDeltaChartElement();
    element.setAttribute('src', '/old.json');
    document.body.append(element);
    element.setAttribute('src', '/new.json');

    expect(signals[0]!.aborted).toBe(true);
    const stale = cloneValidDocument();
    stale.title = 'Stale';
    first.resolve(response(stale));
    second.resolve(response(cloneValidDocument()));
    await settle();
    expect(renderers).toHaveLength(1);
    expect(element.shadowRoot!.querySelector('h1')!.textContent).toBe('US government organizations');
  });

  it('clears a successful chart immediately when a replacement source fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const failed = deferred<Response>();
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(response(cloneValidDocument()))
      .mockReturnValueOnce(failed.promise));
    const element = new OrgDeltaChartElement();
    element.setAttribute('src', '/good.json');
    document.body.append(element);
    await settle();
    const staleCallbacks = renderers[0]!.callbacks;
    const trigger = document.createElement('button');
    element.shadowRoot!.querySelector('.canvas')!.append(trigger);
    staleCallbacks.onActivate('node', 'state', trigger);
    expect(element.shadowRoot!.querySelector('aside')!.hidden).toBe(false);

    element.setAttribute('src', '/bad.json');
    expect(renderers[0]!.destroyed).toBe(true);
    expect(element.shadowRoot!.querySelector('aside')!.hidden).toBe(true);
    expect(element.shadowRoot!.querySelector('h1')!.textContent).toBe('Organization chart');
    expect(element.shadowRoot!.querySelector('section')!.getAttribute('aria-label'))
      .toBe('Organization chart');
    expect(element.shadowRoot!.querySelector('[role="status"]')!.textContent).toBe('Loading chart...');
    staleCallbacks.onActivate('node', 'state', trigger);
    expect(element.shadowRoot!.querySelector('aside')!.hidden).toBe(true);

    failed.resolve(response({}, { ok: false, status: 500 }));
    await settle();
    expect(element.shadowRoot!.querySelector('[role="status"]')!.textContent)
      .toBe('Unable to load chart (HTTP 500).');
    element.setAttribute('show-internal', 'false');
    expect(renderers).toHaveLength(1);
  });

  it('destroys on disconnect and loads cleanly when reconnected', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response(cloneValidDocument())));
    const element = new OrgDeltaChartElement();
    element.setAttribute('src', '/chart.json');
    document.body.append(element);
    await settle();

    element.remove();
    expect(renderers[0]!.destroyed).toBe(true);
    document.body.append(element);
    await settle();
    expect(renderers).toHaveLength(2);
    expect(renderers[1]!.views).toHaveLength(1);
  });

  it('renders a valid initial snapshot when an optional proposal is invalid', async () => {
    const documentData = cloneValidDocument();
    documentData.proposals[0]!.patchGroups![0]!.patches[0] = {
      type: 'set-node', node: 'missing', value: { name: 'Invalid' },
    };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response(documentData)));
    const element = new OrgDeltaChartElement();
    element.setAttribute('src', '/chart.json');
    document.body.append(element);

    await settle();
    expect(renderers[0]!.views[0]!.nodes.map((node) => node.id)).toContain('state');
    expect(element.shadowRoot!.querySelector('[role="status"]')!.textContent).toContain('ready');
  });

  it('shows the contextual validation error for an explicitly selected invalid proposal', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const documentData = cloneValidDocument();
    documentData.proposals[0]!.patchGroups![0]!.patches[0] = {
      type: 'set-node', node: 'missing', value: { name: 'Invalid' },
    };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response(documentData)));
    const element = new OrgDeltaChartElement();
    element.setAttribute('src', '/chart.json');
    element.setAttribute('initial-view', 'proposal-a');
    document.body.append(element);

    await settle();
    expect(element.shadowRoot!.querySelector('[role="status"]')!.textContent)
      .toContain('proposal/proposal-a/patchGroups/0/patches/0/node: unknown node "missing"');
    expect(renderers).toHaveLength(0);
  });

  it('recovers from an invalid initial view when the attribute is removed without refetching', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const documentData = cloneValidDocument();
    documentData.proposals[0]!.patchGroups![0]!.patches[0] = {
      type: 'set-node', node: 'missing', value: { name: 'Invalid' },
    };
    const fetchMock = vi.fn().mockResolvedValue(response(documentData));
    vi.stubGlobal('fetch', fetchMock);
    const element = new OrgDeltaChartElement();
    element.setAttribute('src', '/chart.json');
    element.setAttribute('initial-view', 'proposal-a');
    document.body.append(element);
    await settle();

    element.removeAttribute('initial-view');

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(renderers).toHaveLength(1);
    expect(renderers[0]!.views[0]!.nodes.map((node) => node.id)).toContain('state');
    expect(element.shadowRoot!.querySelector('[role="status"]')!.textContent).toContain('ready');
  });

  it('shows the contextual validation error for an explicitly selected invalid baseline', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const documentData = cloneValidDocument();
    documentData.proposals[0]!.patchGroups![0]!.patches[0] = {
      type: 'set-node', node: 'missing', value: { name: 'Invalid' },
    };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response(documentData)));
    const element = new OrgDeltaChartElement();
    element.setAttribute('src', '/chart.json');
    element.setAttribute('compare-to', 'proposal-a');
    document.body.append(element);

    await settle();
    expect(element.shadowRoot!.querySelector('[role="status"]')!.textContent)
      .toContain('proposal/proposal-a/patchGroups/0/patches/0/node: unknown node "missing"');
    expect(renderers).toHaveLength(0);
  });

  it('recovers from an invalid baseline when the attribute is fixed without refetching', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const documentData = cloneValidDocument();
    documentData.proposals[0]!.patchGroups![0]!.patches[0] = {
      type: 'set-node', node: 'missing', value: { name: 'Invalid' },
    };
    const fetchMock = vi.fn().mockResolvedValue(response(documentData));
    vi.stubGlobal('fetch', fetchMock);
    const element = new OrgDeltaChartElement();
    element.setAttribute('src', '/chart.json');
    element.setAttribute('compare-to', 'proposal-a');
    document.body.append(element);
    await settle();

    element.setAttribute('compare-to', 'current');

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(renderers).toHaveLength(1);
    expect(renderers[0]!.views[0]!.nodes.map((node) => node.id)).toContain('state');
    expect(element.shadowRoot!.querySelector('[role="status"]')!.textContent).toContain('ready');
  });

  it.each([
    ['initial-view', 'Unable to display chart: view "missing" does not exist.'],
    ['compare-to', 'Unable to display chart: baseline "missing" does not exist.'],
  ])('rejects an unknown explicit %s', async (attribute, message) => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response(cloneValidDocument())));
    const element = new OrgDeltaChartElement();
    element.setAttribute('src', '/chart.json');
    element.setAttribute(attribute, 'missing');
    document.body.append(element);

    await settle();
    expect(element.shadowRoot!.querySelector('[role="status"]')!.textContent).toBe(message);
    expect(renderers).toHaveLength(0);
  });

  it('uses initial view, baseline, default patches, and boolean display attributes', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response(cloneValidDocument())));
    const element = new OrgDeltaChartElement();
    element.setAttribute('src', '/chart.json');
    element.setAttribute('initial-view', 'proposal-a');
    element.setAttribute('compare-to', 'current');
    element.setAttribute('show-internal', 'false');
    element.setAttribute('show-relationships', '0');
    document.body.append(element);

    await settle();
    const view = renderers[0]!.views[0]!;
    expect(view.nodes.find((node) => node.id === 'state')!.internalRows).toHaveLength(0);
    expect(view.relationships).toHaveLength(0);
    expect(view.nodes.find((node) => node.id === 'usaid')!.diffKind).toBe('modified');
    expect(element.shadowRoot!.querySelector('[role="status"]')!.textContent)
      .toContain('1 modified');
  });

  it('renders view buttons through four views and a labeled select above four', async () => {
    const documentData = cloneValidDocument();
    documentData.snapshots.push(
      { ...structuredClone(documentData.snapshots[0]!), id: 'second', label: 'Second' },
      { ...structuredClone(documentData.snapshots[0]!), id: 'third', label: 'Third' },
      { ...structuredClone(documentData.snapshots[0]!), id: 'fourth', label: 'Fourth' },
    );
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response(documentData)));
    const element = new OrgDeltaChartElement();
    element.setAttribute('src', '/chart.json');
    document.body.append(element);
    await settle();

    expect(element.shadowRoot!.querySelectorAll('[data-view-id]')).toHaveLength(0);
    expect(element.shadowRoot!.querySelector<HTMLSelectElement>('[data-view-select]')!.options)
      .toHaveLength(5);

    documentData.snapshots.pop();
    element.remove();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response(documentData)));
    const fourViewElement = new OrgDeltaChartElement();
    fourViewElement.setAttribute('src', '/chart.json');
    document.body.append(fourViewElement);
    await settle();
    const buttons = fourViewElement.shadowRoot!.querySelectorAll('[data-view-id]');
    expect(buttons).toHaveLength(4);
    expect(buttons[0]!.getAttribute('aria-pressed')).toBe('true');
  });

  it('selects a proposal with its immediate base and honors compare-to override', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response(cloneValidDocument())));
    const element = new OrgDeltaChartElement();
    element.setAttribute('src', '/chart.json');
    document.body.append(element);
    await settle();

    (element.shadowRoot!.querySelector('[data-view-id="proposal-a"]') as HTMLButtonElement).click();
    expect(element.shadowRoot!.querySelector('[data-selection-status]')!.textContent)
      .toContain('Selected: Shared leadership');
    expect(element.shadowRoot!.querySelector('[data-selection-status]')!.textContent)
      .toContain('Compared with: Current organization');
    expect(renderers[0]!.views).toHaveLength(2);

    element.setAttribute('compare-to', 'proposal-a');
    expect(element.shadowRoot!.querySelector('[data-selection-status]')!.textContent)
      .toContain('Compared with: Shared leadership');
  });

  it('toggles display options, fits, and reveals hidden internal search results', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response(cloneValidDocument())));
    const element = new OrgDeltaChartElement();
    element.setAttribute('src', '/chart.json');
    element.setAttribute('show-internal', 'false');
    document.body.append(element);
    await settle();

    const relationships = element.shadowRoot!.querySelector<HTMLInputElement>('[data-show-relationships]')!;
    relationships.click();
    expect(renderers[0]!.views.at(-1)!.relationships).toHaveLength(0);
    element.shadowRoot!.querySelector<HTMLInputElement>('[data-show-internal]')!.click();
    expect(renderers[0]!.views.at(-1)!.nodes.find((node) => node.id === 'state')!.internalRows)
      .toHaveLength(2);

    element.shadowRoot!.querySelector<HTMLInputElement>('[data-show-internal]')!.click();
    const search = element.shadowRoot!.querySelector<HTMLInputElement>('[data-search]')!;
    search.value = 'State Human Resources';
    search.dispatchEvent(new Event('input', { bubbles: true }));
    expect(renderers[0]!.revealed).toContain('state-hr');
    (element.shadowRoot!.querySelector('[data-search-result="state-hr"]') as HTMLButtonElement).click();
    expect(renderers[0]!.views.at(-1)!.nodes.find((node) => node.id === 'state')!.internalRows
      .map((row) => row.id)).toEqual(['state-hq', 'state-hr']);
    expect(renderers[0]!.revealed).toContain('state-hr');

    (element.shadowRoot!.querySelector('[data-search-clear]') as HTMLButtonElement).click();
    expect(renderers[0]!.views.at(-1)!.nodes.find((node) => node.id === 'state')!.internalRows)
      .toHaveLength(0);
    (element.shadowRoot!.querySelector('[data-fit]') as HTMLButtonElement).click();
    expect(renderers[0]!.fitCalls).toBe(1);
  });

  it('applies patch dependencies and conflicts and explains locked and disabled groups', async () => {
    const documentData = cloneValidDocument();
    documentData.proposals[0]!.patchGroups = [
      { id: 'required', label: 'Required base', patches: [] },
      {
        id: 'choice', label: 'Choice', requires: ['required'], patches: [],
        conflictsWith: ['alternate'], note: '<script>Choice details</script>',
        sources: [{ label: 'Source', url: 'https://example.com/choice' }],
      },
      { id: 'alternate', label: 'Alternate', conflictsWith: ['choice'], patches: [] },
      { id: 'locked', label: 'Locked', locked: true, conflictsWith: ['unavailable'], patches: [] },
      { id: 'unavailable', label: 'Unavailable', conflictsWith: ['locked'], patches: [] },
    ];
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response(documentData)));
    const element = new OrgDeltaChartElement();
    element.setAttribute('src', '/chart.json');
    element.setAttribute('initial-view', 'proposal-a');
    document.body.append(element);
    await settle();

    const locked = element.shadowRoot!.querySelector<HTMLInputElement>('[data-patch-group="locked"]')!;
    expect(locked.checked).toBe(true);
    expect(locked.disabled).toBe(true);
    expect(element.shadowRoot!.getElementById(locked.getAttribute('aria-describedby')!)!.textContent)
      .toContain('locked on');
    const unavailable = element.shadowRoot!.querySelector<HTMLInputElement>('[data-patch-group="unavailable"]')!;
    expect(unavailable.disabled).toBe(true);
    expect(element.shadowRoot!.getElementById(unavailable.getAttribute('aria-describedby')!)!.textContent)
      .toContain('conflicts with locked group');

    element.shadowRoot!.querySelector<HTMLInputElement>('[data-patch-group="choice"]')!.click();
    expect(element.shadowRoot!.querySelector<HTMLInputElement>('[data-patch-group="required"]')!.checked)
      .toBe(true);
    element.shadowRoot!.querySelector<HTMLInputElement>('[data-patch-group="alternate"]')!.click();
    expect(element.shadowRoot!.querySelector<HTMLInputElement>('[data-patch-group="choice"]')!.checked)
      .toBe(false);

    const about = element.shadowRoot!.querySelector<HTMLButtonElement>('[data-patch-group-about="choice"]')!;
    const before = element.shadowRoot!.querySelector<HTMLInputElement>('[data-patch-group="choice"]')!.checked;
    about.click();
    expect(element.shadowRoot!.querySelector('aside h2')!.textContent).toBe('Choice');
    expect(element.shadowRoot!.querySelector('aside script')).toBeNull();
    expect(element.shadowRoot!.querySelector<HTMLInputElement>('[data-patch-group="choice"]')!.checked)
      .toBe(before);
  });

  it('preserves patch choices per proposal and does not duplicate rerender handlers', async () => {
    const documentData = cloneValidDocument();
    documentData.proposals.push({
      id: 'proposal-b', label: 'Other proposal', base: 'current',
      patchGroups: [{ id: 'other', label: 'Other changes', patches: [] }],
    });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response(documentData)));
    const element = new OrgDeltaChartElement();
    element.setAttribute('src', '/chart.json');
    document.body.append(element);
    await settle();

    element.shadowRoot!.querySelector<HTMLButtonElement>('[data-view-id="proposal-a"]')!.click();
    element.shadowRoot!.querySelector<HTMLInputElement>('[data-patch-group="shared-leadership-group"]')!
      .click();
    expect(element.shadowRoot!.querySelector<HTMLInputElement>('[data-patch-group="shared-leadership-group"]')!.checked)
      .toBe(false);
    element.shadowRoot!.querySelector<HTMLButtonElement>('[data-view-id="proposal-b"]')!.click();
    element.shadowRoot!.querySelector<HTMLButtonElement>('[data-view-id="proposal-a"]')!.click();
    expect(element.shadowRoot!.querySelector<HTMLInputElement>('[data-patch-group="shared-leadership-group"]')!.checked)
      .toBe(false);

    const before = renderers[0]!.views.length;
    element.shadowRoot!.querySelector<HTMLInputElement>('[data-show-relationships]')!.click();
    expect(renderers[0]!.views).toHaveLength(before + 1);
  });

  it('keeps invalid proposal options selectable and recovers without refetching', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const documentData = cloneValidDocument();
    documentData.proposals[0]!.patchGroups![0]!.patches[0] = {
      type: 'set-node', node: 'missing', value: { name: 'Invalid' },
    };
    const fetchMock = vi.fn().mockResolvedValue(response(documentData));
    vi.stubGlobal('fetch', fetchMock);
    const element = new OrgDeltaChartElement();
    element.setAttribute('src', '/chart.json');
    document.body.append(element);
    await settle();

    element.shadowRoot!.querySelector<HTMLButtonElement>('[data-view-id="proposal-a"]')!.click();
    expect(element.shadowRoot!.querySelector('[role="status"]')!.textContent).toContain('is invalid');
    element.shadowRoot!.querySelector<HTMLButtonElement>('[data-view-id="current"]')!.click();
    expect(element.shadowRoot!.querySelector('[role="status"]')!.textContent).toContain('ready');
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(renderers).toHaveLength(1);
  });

  it('opens internal, relationship, and change details activations', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response(cloneValidDocument())));
    const element = new OrgDeltaChartElement();
    element.setAttribute('src', '/chart.json');
    element.setAttribute('initial-view', 'proposal-a');
    document.body.append(element);
    await settle();
    const trigger = document.createElement('button');
    element.shadowRoot!.querySelector('.canvas')!.append(trigger);

    renderers[0]!.callbacks.onActivate('internal', 'state-hq', trigger);
    expect(element.shadowRoot!.querySelector('aside h2')!.textContent).toBe('State Headquarters');
    renderers[0]!.callbacks.onActivate('relationship', 'shared-leadership', trigger);
    expect(element.shadowRoot!.querySelector('aside h2')!.textContent).toBe('Shared leadership');
    renderers[0]!.callbacks.onActivate('change', 'usaid', trigger);
    expect(element.shadowRoot!.querySelector('aside h2')!.textContent).toBe('USAID');
  });

  it('opens activation details safely and restores focus when closed', async () => {
    const documentData = cloneValidDocument();
    documentData.nodes.state = {
      name: '<img src=x onerror=alert(1)>',
      note: '<script>globalThis.hacked = true</script>',
      sources: [
        { label: '<b>Source</b>', url: 'https://example.com/source' },
      ],
    };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response(documentData)));
    const element = new OrgDeltaChartElement();
    element.setAttribute('src', '/chart.json');
    document.body.append(element);
    await settle();
    const trigger = document.createElement('button');
    element.shadowRoot!.querySelector('.canvas')!.append(trigger);
    trigger.focus();

    renderers[0]!.callbacks.onActivate('node', 'state', trigger);
    const panel = element.shadowRoot!.querySelector('aside')!;
    expect(panel.hidden).toBe(false);
    expect(panel.querySelector('h2')!.textContent).toBe('<img src=x onerror=alert(1)>');
    expect(panel.querySelector('h2')).toBe(element.shadowRoot!.activeElement);
    expect(panel.querySelector('img, script')).toBeNull();
    expect(panel.querySelectorAll('a')).toHaveLength(1);

    (panel.querySelector('button') as HTMLButtonElement).click();
    expect(panel.hidden).toBe(true);
    expect(element.shadowRoot!.activeElement).toBe(trigger);
  });

  it('opens hierarchy details for stable IDs containing delimiters and quotes', async () => {
    const parentId = 'parent->/"quoted"';
    const childId = 'child->/"quoted"';
    const documentData = cloneValidDocument();
    documentData.nodes = {
      [parentId]: { name: 'Parent' },
      [childId]: { name: 'Child' },
    };
    documentData.snapshots = [{
      id: 'current',
      label: 'Current',
      nodes: { [parentId]: {}, [childId]: {} },
      hierarchy: [{ child: childId, parent: parentId, relationship: 'subordinate' }],
    }];
    documentData.proposals = [];
    documentData.relationships = [];
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response(documentData)));
    const element = new OrgDeltaChartElement();
    element.setAttribute('src', '/chart.json');
    document.body.append(element);
    await settle();
    const trigger = document.createElement('button');
    element.shadowRoot!.querySelector('.canvas')!.append(trigger);

    const activationId = encodeHierarchyActivationId(parentId, childId);
    expect(decodeHierarchyActivationId(activationId)).toEqual([parentId, childId]);
    renderers[0]!.callbacks.onActivate('hierarchy', activationId, trigger);

    expect(element.shadowRoot!.querySelector('aside h2')!.textContent).toBe('Child -> Parent');
  });

  it('opens hierarchy details from an internal overlay connector with delimiter-bearing IDs', async () => {
    const parentId = 'internal->parent';
    const childId = 'child->office';
    const documentData = cloneValidDocument();
    documentData.nodes = {
      root: { name: 'Root' },
      [parentId]: { name: 'Internal Parent' },
      [childId]: { name: 'Child' },
    };
    documentData.snapshots = [{
      id: 'current',
      label: 'Current',
      nodes: { root: {}, [parentId]: {}, [childId]: {} },
      hierarchy: [
        { child: parentId, parent: 'root', relationship: 'internal' },
        { child: childId, parent: parentId, relationship: 'subordinate' },
      ],
    }];
    documentData.proposals = [];
    documentData.relationships = [];
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response(documentData)));
    setRendererFactoryForTests((container, callbacks) => {
      let overlay: ConnectorOverlay | undefined;
      return {
        render(view): void {
          const source = document.createElement('div');
          source.dataset.internalId = parentId;
          source.getBoundingClientRect = () => new DOMRect(10, 10, 100, 40);
          const target = document.createElement('div');
          target.dataset.nodeId = childId;
          target.getBoundingClientRect = () => new DOMRect(200, 200, 100, 40);
          container.append(source, target);
          overlay = new ConnectorOverlay(container, callbacks.onActivate);
          overlay.sync(view.nodes, view.relationships);
        },
        reveal(): void {},
        fit(): void {},
        destroy(): void { overlay?.destroy(); },
      };
    });
    const element = new OrgDeltaChartElement();
    element.setAttribute('src', '/chart.json');
    document.body.append(element);
    await settle();

    const connector = element.shadowRoot!.querySelector<SVGPathElement>(
      '.org-delta-connector-hit[data-hierarchy-id]',
    )!;
    expect(connector.dataset.hierarchyId).toBe(encodeHierarchyActivationId(parentId, childId));
    connector.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(element.shadowRoot!.querySelector('aside h2')!.textContent)
      .toBe('Child -> Internal Parent');
  });

  it('defensively omits non-HTTP sources from details', () => {
    const container = document.createElement('aside');
    const trigger = document.createElement('button');
    document.body.append(trigger, container);

    renderDetailsPanel(container, {
      title: 'Safe',
      kindLabel: 'Node',
      sources: [{ label: 'Unsafe', url: 'javascript:alert(1)' }],
    }, trigger);

    expect(container.querySelector('a')).toBeNull();
  });
});
