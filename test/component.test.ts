import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  OrgDeltaChartElement,
  renderDetailsPanel,
  setRendererFactoryForTests,
  type RendererCallbacks,
} from '../src/index';
import type { ChartRenderer, RenderView } from '../src/renderer/types';
import { cloneValidDocument } from './fixtures';

class FakeRenderer implements ChartRenderer {
  readonly views: RenderView[] = [];
  destroyed = false;

  constructor(readonly callbacks: RendererCallbacks) {}

  render(view: RenderView): void {
    this.views.push(view);
  }

  reveal(): void {}
  fit(): void {}

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
