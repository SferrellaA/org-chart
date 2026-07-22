import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RenderNode, RenderView } from '../src/renderer/types';

const mocked = vi.hoisted(() => {
  class FakeOrgChart {
    static instances: FakeOrgChart[] = [];
    calls: Array<[string, ...unknown[]]> = [];
    content: ((value: unknown) => string) | undefined;
    zoomCallback: (() => void) | undefined;
    layoutCallback: (() => void) | undefined;
    linkCallback: ((this: SVGPathElement, value: unknown) => void) | undefined;

    constructor() {
      FakeOrgChart.instances.push(this);
    }

    private record(name: string, ...args: unknown[]): this {
      this.calls.push([name, ...args]);
      return this;
    }

    container(value: unknown): this { return this.record('container', value); }
    data(value: unknown): this { return this.record('data', value); }
    nodeId(value: unknown): this { return this.record('nodeId', value); }
    parentNodeId(value: unknown): this { return this.record('parentNodeId', value); }
    nodeWidth(value: unknown): this { return this.record('nodeWidth', value); }
    nodeHeight(value: unknown): this { return this.record('nodeHeight', value); }
    compact(value: unknown): this { return this.record('compact', value); }
    duration(value: unknown): this { return this.record('duration', value); }
    scaleExtent(value: unknown): this { return this.record('scaleExtent', value); }
    minPagingVisibleNodes(value: unknown): this { return this.record('minPagingVisibleNodes', value); }
    nodeContent(value: (node: unknown) => string): this {
      this.content = value;
      return this.record('nodeContent', value);
    }
    onZoom(value: () => void): this {
      this.zoomCallback = value;
      return this.record('onZoom', value);
    }
    onExpandOrCollapse(value: () => void): this {
      this.layoutCallback = value;
      return this.record('onExpandOrCollapse', value);
    }
    nodeUpdate(value: (this: SVGGElement, node: unknown) => void): this {
      return this.record('nodeUpdate', value);
    }
    linkUpdate(value: (this: SVGPathElement, node: unknown) => void): this {
      this.linkCallback = value;
      return this.record('linkUpdate', value);
    }
    render(): this { return this.record('render'); }
    setExpanded(...args: unknown[]): this { return this.record('setExpanded', ...args); }
    setCentered(...args: unknown[]): this { return this.record('setCentered', ...args); }
    fit(...args: unknown[]): this { return this.record('fit', ...args); }
    clear(): this { return this.record('clear'); }
  }
  return { FakeOrgChart };
});

vi.mock('d3-org-chart', () => ({ OrgChart: mocked.FakeOrgChart }));

import { D3OrgChartRenderer } from '../src/renderer/d3-renderer';

function node(overrides: Partial<RenderNode> = {}): RenderNode {
  return {
    id: 'root',
    name: 'Root',
    internalRows: [],
    hiddenInternalCount: 0,
    hiddenChangeCount: 0,
    diffKind: 'unchanged',
    ghost: false,
    ...overrides,
  };
}

function view(nodes: readonly RenderNode[] = [node()]): RenderView {
  return {
    nodes,
    relationships: [],
    searchEntries: [],
    initialExpansionIds: nodes.map(({ id }) => id),
  };
}

function rect(x: number, y: number, width: number, height: number): DOMRect {
  return {
    bottom: y + height,
    height,
    left: x,
    right: x + width,
    top: y,
    width,
    x,
    y,
    toJSON: () => ({}),
  };
}

function renderedNode(host: HTMLElement, id: string, bounds: DOMRect): HTMLElement {
  const element = document.createElement('article');
  element.dataset.nodeId = id;
  element.getBoundingClientRect = () => bounds;
  host.append(element);
  return element;
}

describe('D3OrgChartRenderer', () => {
  let animationFrames: FrameRequestCallback[];
  let resizeCallback: ResizeObserverCallback | undefined;
  let disconnect: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mocked.FakeOrgChart.instances = [];
    animationFrames = [];
    vi.stubGlobal('requestAnimationFrame', vi.fn((callback: FrameRequestCallback) => {
      animationFrames.push(callback);
      return animationFrames.length;
    }));
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    disconnect = vi.fn();
    vi.stubGlobal('ResizeObserver', class {
      constructor(callback: ResizeObserverCallback) { resizeCallback = callback; }
      observe = vi.fn();
      disconnect = disconnect;
    });
    vi.spyOn(window, 'matchMedia').mockReturnValue({ matches: false } as MediaQueryList);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('configures supported APIs and expands initial nodes', () => {
    const host = document.createElement('div');
    const renderer = new D3OrgChartRenderer(host, { onActivate: vi.fn() });

    renderer.render(view([node(), node({ id: 'child', parentId: 'root' })]));

    const chart = mocked.FakeOrgChart.instances[0]!;
    expect(chart.calls.some(([name, value]) => name === 'container' && value === host)).toBe(true);
    expect(chart.calls.filter(([name]) => name === 'setExpanded').map((call) => call.slice(1))).toEqual([
      ['root', true],
      ['child', true],
    ]);
    expect(chart.calls.filter(([name]) => name === 'render')).toHaveLength(2);
    expect(chart.calls.some(([name]) => name === 'minPagingVisibleNodes')).toBe(true);
    expect(chart.calls.some(([name]) => name.toLowerCase().includes('minimap'))).toBe(false);
  });

  it('draws an aria-hidden noninteractive minimap from rendered real nodes and links', () => {
    const host = document.createElement('div');
    host.getBoundingClientRect = () => rect(0, 0, 500, 500);
    renderedNode(host, 'root', rect(50, 50, 100, 50));
    renderedNode(host, 'child', rect(300, 300, 100, 50));
    const renderer = new D3OrgChartRenderer(host, { onActivate: vi.fn() });

    renderer.render(view([node(), node({ id: 'child', parentId: 'root' })]));
    animationFrames[0]?.(0);

    const minimap = host.querySelector<SVGSVGElement>('.org-delta-minimap')!;
    expect(minimap).not.toBeNull();
    expect(minimap.getAttribute('aria-hidden')).toBe('true');
    expect(minimap.style.pointerEvents).toBe('none');
    expect(minimap.querySelectorAll('[data-minimap-node-id]')).toHaveLength(2);
    expect(minimap.querySelectorAll('[data-minimap-link]')).toHaveLength(1);
    renderer.destroy();
    expect(host.querySelector('.org-delta-minimap')).toBeNull();
  });

  it('updates minimap geometry after resize and hides it when nodes disappear', () => {
    const host = document.createElement('div');
    host.getBoundingClientRect = () => rect(0, 0, 500, 500);
    renderedNode(host, 'root', rect(0, 0, 50, 50));
    let middleBounds = rect(100, 100, 50, 50);
    const middle = renderedNode(host, 'middle', middleBounds);
    middle.getBoundingClientRect = () => middleBounds;
    renderedNode(host, 'far', rect(400, 400, 50, 50));
    const renderer = new D3OrgChartRenderer(host, { onActivate: vi.fn() });
    const nodes = [
      node(),
      node({ id: 'middle', parentId: 'root' }),
      node({ id: 'far', parentId: 'root' }),
    ];
    renderer.render(view(nodes));
    animationFrames[0]?.(0);
    const minimap = host.querySelector<SVGSVGElement>('.org-delta-minimap')!;
    const before = minimap.querySelector('[data-minimap-node-id="middle"]')?.getAttribute('cx');

    middleBounds = rect(250, 100, 50, 50);
    resizeCallback?.([], {} as ResizeObserver);
    animationFrames[1]?.(1);
    const after = minimap.querySelector('[data-minimap-node-id="middle"]')?.getAttribute('cx');
    expect(after).not.toBe(before);

    renderer.render(view([]));
    animationFrames[2]?.(2);
    expect(minimap.style.display).toBe('none');
    expect(minimap.childNodes).toHaveLength(0);
    renderer.destroy();
  });

  it('provides raw-data id accessors as required by d3-org-chart', () => {
    const host = document.createElement('div');
    new D3OrgChartRenderer(host, { onActivate: vi.fn() });
    const chart = mocked.FakeOrgChart.instances[0]!;
    const idAccessor = chart.calls.find(([name]) => name === 'nodeId')?.[1] as
      | ((value: unknown) => string)
      | undefined;
    const parentAccessor = chart.calls.find(([name]) => name === 'parentNodeId')?.[1] as
      | ((value: unknown) => string | undefined)
      | undefined;

    expect(idAccessor?.(node({ id: 'child', parentId: 'root' }))).toBe('child');
    expect(parentAccessor?.(node({ id: 'child', parentId: 'root' }))).toBe('root');
  });

  it('escapes untrusted content and emits semantic activation buttons', () => {
    const host = document.createElement('div');
    const renderer = new D3OrgChartRenderer(host, { onActivate: vi.fn() });
    const malicious = node({
      id: `x" onclick="alert(1)`,
      name: '<script>alert(1)</script><img src=x onerror=alert(1)>',
      diffKind: 'modified',
      ghost: true,
      hiddenInternalCount: 2,
      hiddenChangeCount: 1,
      internalRows: [{
        id: `i' onmouseover='bad`,
        name: '<b>Internal</b>',
        depth: 1,
        diffKind: 'added',
        hasSubordinateChildren: true,
      }],
    });
    renderer.render(view([malicious]));
    const chart = mocked.FakeOrgChart.instances[0]!;

    const html = chart.content?.({ data: malicious }) ?? '';
    const container = document.createElement('div');
    container.innerHTML = html;
    expect(container.querySelector('script')).toBeNull();
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('[onclick],[onmouseover],[onerror]')).toBeNull();
    expect(container.querySelector('button[data-activate-kind="node"]')).not.toBeNull();
    expect(container.querySelector('button[data-activate-kind="internal"]')).not.toBeNull();
    expect(container.querySelector('button[data-activate-kind="change"]')).not.toBeNull();
    expect(container.querySelector('.org-delta-node--ghost')).not.toBeNull();
    expect(container.textContent).toContain('<script>alert(1)</script>');
  });

  it('delegates activation once across repeated renders', () => {
    const host = document.createElement('div');
    const onActivate = vi.fn();
    const renderer = new D3OrgChartRenderer(host, { onActivate });
    renderer.render(view());
    renderer.render(view());
    const button = document.createElement('button');
    button.dataset.activateKind = 'node';
    button.dataset.activateId = 'root';
    host.append(button);

    button.click();

    expect(onActivate).toHaveBeenCalledTimes(1);
    expect(onActivate).toHaveBeenCalledWith('node', 'root', button);
  });

  it('captures HTML activation before D3 node click and keyboard handlers', () => {
    const host = document.createElement('div');
    const onActivate = vi.fn();
    new D3OrgChartRenderer(host, { onActivate });
    const d3Click = vi.fn();
    const d3Keydown = vi.fn();
    const group = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    group.addEventListener('click', d3Click);
    group.addEventListener('keydown', d3Keydown);
    const foreignObject = document.createElementNS('http://www.w3.org/2000/svg', 'foreignObject');
    const button = document.createElement('button');
    button.dataset.activateKind = 'internal';
    button.dataset.activateId = 'inside';
    foreignObject.append(button);
    group.append(foreignObject);
    host.append(group);

    button.click();
    expect(onActivate).toHaveBeenCalledTimes(1);
    expect(d3Click).not.toHaveBeenCalled();
    onActivate.mockClear();

    for (const key of ['Enter', ' ']) {
      button.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key }));
      button.click();
      expect(onActivate).toHaveBeenCalledTimes(1);
      expect(d3Keydown).not.toHaveBeenCalled();
      expect(d3Click).not.toHaveBeenCalled();
      onActivate.mockClear();
    }
  });

  it('makes normal hierarchy links activatable and hides replaced links', () => {
    const host = document.createElement('div');
    const renderer = new D3OrgChartRenderer(host, { onActivate: vi.fn() });
    renderer.render(view([node(), node({ id: 'child', parentId: 'root' })]));
    const callback = mocked.FakeOrgChart.instances[0]!.linkCallback!;
    const normal = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    callback.call(normal, { data: node({ id: 'child' }), parent: { data: node() } });
    const internal = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    callback.call(internal, {
      data: node({ id: 'child', parentId: 'root', connectorSourceId: 'inside' }),
      parent: { data: node() },
    });
    const missingFallback = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    callback.call(missingFallback, {
      data: node({ id: 'orphan', connectorSourceId: 'inside' }),
      parent: { data: node() },
    });
    const mismatchedFallback = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    callback.call(mismatchedFallback, {
      data: node({ id: 'mismatch', parentId: 'missing', connectorSourceId: 'inside' }),
      parent: { data: node() },
    });

    expect(normal.dataset.activateKind).toBe('hierarchy');
    expect(normal.dataset.activateId).toBe('root->child');
    expect(normal.getAttribute('tabindex')).toBe('0');
    expect(normal.getAttribute('stroke')).toBe('currentColor');
    expect(normal.getAttribute('stroke-width')).toBe('2');
    expect(internal.style.display).toBe('none');
    expect(missingFallback.style.display).toBe('');
    expect(mismatchedFallback.style.display).toBe('');
  });

  it('uses actual centering and fit APIs and disables motion when requested', () => {
    vi.mocked(window.matchMedia).mockReturnValue({ matches: true } as MediaQueryList);
    const host = document.createElement('div');
    const renderer = new D3OrgChartRenderer(host, { onActivate: vi.fn() });
    renderer.render(view());
    renderer.reveal('root');
    renderer.fit();
    const chart = mocked.FakeOrgChart.instances[0]!;

    expect(chart.calls).toContainEqual(['duration', 0]);
    expect(chart.calls).toContainEqual(['setCentered', 'root']);
    expect(chart.calls.some(([name]) => name === 'render')).toBe(true);
    expect(chart.calls).toContainEqual(['fit', { animate: false }]);
  });

  it('deduplicates overlay frames and cleans chart, observers, frames, and listeners', () => {
    const host = document.createElement('div');
    const onActivate = vi.fn();
    const renderer = new D3OrgChartRenderer(host, { onActivate });
    renderer.render(view());
    const chart = mocked.FakeOrgChart.instances[0]!;
    chart.zoomCallback?.();
    chart.layoutCallback?.();
    resizeCallback?.([], {} as ResizeObserver);
    expect(animationFrames).toHaveLength(1);

    renderer.destroy();
    const button = document.createElement('button');
    button.dataset.activateKind = 'node';
    button.dataset.activateId = 'root';
    host.append(button);
    button.click();

    expect(disconnect).toHaveBeenCalledOnce();
    expect(cancelAnimationFrame).toHaveBeenCalled();
    expect(chart.calls).toContainEqual(['clear']);
    expect(host.querySelector('.org-delta-connectors')).toBeNull();
    expect(onActivate).not.toHaveBeenCalled();
  });

  it('resynchronizes the overlay after the layout transition completes', () => {
    vi.useFakeTimers();
    vi.stubGlobal('requestAnimationFrame', vi.fn((callback: FrameRequestCallback) => {
      animationFrames.push(callback);
      return animationFrames.length;
    }));
    const host = document.createElement('div');
    const renderer = new D3OrgChartRenderer(host, { onActivate: vi.fn() });
    renderer.render(view());
    expect(animationFrames).toHaveLength(1);
    animationFrames[0]?.(0);

    vi.advanceTimersByTime(300);

    expect(animationFrames).toHaveLength(2);
    renderer.destroy();
  });
});
