import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RenderNode, RenderView } from '../src/renderer/types';

const mocked = vi.hoisted(() => {
  class FakeOrgChart {
    static instances: FakeOrgChart[] = [];
    calls: Array<[string, ...unknown[]]> = [];
    currentData: Array<RenderNode & { _expanded?: boolean }> = [];
    currentTransform = { x: 0, y: 0, k: 1 };
    content: ((value: unknown) => string) | undefined;
    zoomCallback: (() => void) | undefined;
    layoutCallback: ((node?: unknown) => void) | undefined;
    linkCallback: ((this: SVGPathElement, value: unknown) => void) | undefined;
    nodeCallback: ((this: SVGGElement, value: unknown) => void) | undefined;

    constructor() {
      FakeOrgChart.instances.push(this);
    }

    private record(name: string, ...args: unknown[]): this {
      this.calls.push([name, ...args]);
      return this;
    }

    container(value: unknown): this { return this.record('container', value); }
    data(value: Array<RenderNode & { _expanded?: boolean }>): this {
      this.currentData = value;
      return this.record('data', value);
    }
    getChartState(): {
      data: Array<RenderNode & { _expanded?: boolean }>;
      lastTransform: { x: number; y: number; k: number };
    } {
      return { data: this.currentData, lastTransform: this.currentTransform };
    }
    nodeId(value: unknown): this { return this.record('nodeId', value); }
    parentNodeId(value: unknown): this { return this.record('parentNodeId', value); }
    nodeWidth(value: unknown): this { return this.record('nodeWidth', value); }
    nodeHeight(value: unknown): this { return this.record('nodeHeight', value); }
    svgWidth(value: unknown): this { return this.record('svgWidth', value); }
    svgHeight(value: unknown): this { return this.record('svgHeight', value); }
    buttonContent(value: unknown): this { return this.record('buttonContent', value); }
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
    onExpandOrCollapse(value: (node?: unknown) => void): this {
      this.layoutCallback = value;
      return this.record('onExpandOrCollapse', value);
    }
    nodeUpdate(value: (this: SVGGElement, node: unknown) => void): this {
      this.nodeCallback = value;
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
    expect(chart.calls.some(([name, value]) =>
      name === 'container' && value === host.querySelector('.org-delta-renderer-root'))).toBe(true);
    const submitted = chart.currentData;
    expect(submitted.filter(({ _expanded }) => _expanded).map(({ id }) => id)).toEqual([
      'root',
      'child',
    ]);
    expect(chart.calls.filter(([name]) => name === 'render')).toHaveLength(1);
    expect(chart.calls.some(([name]) => name === 'minPagingVisibleNodes')).toBe(true);
    expect(chart.calls.some(([name]) => name.toLowerCase().includes('minimap'))).toBe(false);
  });

  it('owns an isolated mount and preserves unrelated host children on destroy', () => {
    const host = document.createElement('div');
    const unrelated = document.createElement('p');
    unrelated.textContent = 'keep';
    host.append(unrelated);
    const renderer = new D3OrgChartRenderer(host, { onActivate: vi.fn() });
    const mount = host.querySelector<HTMLElement>('.org-delta-renderer-root');

    expect(mount).not.toBeNull();
    expect(mocked.FakeOrgChart.instances[0]!.calls).toContainEqual(['container', mount]);
    renderer.destroy();
    expect(host.childNodes).toHaveLength(1);
    expect(host.firstChild).toBe(unrelated);
  });

  it('renders empty state without invoking D3 and makes fit and reveal safe no-ops', () => {
    const host = document.createElement('div');
    const renderer = new D3OrgChartRenderer(host, { onActivate: vi.fn() });
    const chart = mocked.FakeOrgChart.instances[0]!;

    expect(() => {
      renderer.render(view([]));
      renderer.fit();
      renderer.reveal('missing');
    }).not.toThrow();

    expect(chart.calls.some(([name]) => name === 'data' || name === 'render')).toBe(false);
    expect(chart.calls.some(([name]) => name === 'fit' || name === 'setCentered')).toBe(false);
    expect(host.querySelector('.org-delta-empty-state')).not.toBeNull();
    expect(host.querySelector<SVGSVGElement>('.org-delta-minimap')?.style.display).toBe('none');
  });

  it('configures chart dimensions from host bounds before render and fit', () => {
    const host = document.createElement('div');
    host.getBoundingClientRect = () => rect(0, 0, 640, 480);
    const renderer = new D3OrgChartRenderer(host, { onActivate: vi.fn() });
    renderer.render(view());
    renderer.fit();
    const calls = mocked.FakeOrgChart.instances[0]!.calls;

    expect(calls.filter(([name]) => name === 'svgWidth').at(-1)).toEqual(['svgWidth', 640]);
    expect(calls.filter(([name]) => name === 'svgHeight').at(-1)).toEqual(['svgHeight', 480]);
  });

  it('preserves retained expansion state and renders only once per update', () => {
    const host = document.createElement('div');
    const renderer = new D3OrgChartRenderer(host, { onActivate: vi.fn() });
    const chart = mocked.FakeOrgChart.instances[0]!;
    const nodes = [
      node(),
      node({ id: 'child', parentId: 'root' }),
      node({ id: 'grandchild', parentId: 'child' }),
    ];
    renderer.render(view(nodes));
    const collapsed = chart.currentData.find(({ id }) => id === 'child')!;
    const grandchild = chart.currentData.find(({ id }) => id === 'grandchild')!;
    grandchild._expanded = false;
    chart.layoutCallback?.({ data: collapsed, _children: [{ data: grandchild }] });

    renderer.render(view([
      node({ name: 'Updated root' }),
      node({ id: 'child', parentId: 'root', name: 'Updated child' }),
      node({ id: 'grandchild', parentId: 'child', name: 'Updated grandchild' }),
      node({ id: 'new', parentId: 'root' }),
    ]));

    const submitted = chart.calls.filter(([name]) => name === 'data').at(-1)?.[1] as
      Array<RenderNode & { _expanded?: boolean }>;
    expect(submitted.find(({ id }) => id === 'child')?._expanded).toBe(true);
    expect(submitted.find(({ id }) => id === 'grandchild')?._expanded).toBe(false);
    expect(submitted.find(({ id }) => id === 'new')?._expanded).toBe(true);
    expect(chart.calls.filter(([name]) => name === 'render')).toHaveLength(2);
  });

  it('treats nodes reappearing after an empty dataset as new', () => {
    const host = document.createElement('div');
    const renderer = new D3OrgChartRenderer(host, { onActivate: vi.fn() });
    renderer.render(view([node()]));
    renderer.render(view([]));
    renderer.render({ ...view([node()]), initialExpansionIds: [] });

    expect(mocked.FakeOrgChart.instances[0]!.currentData[0]?._expanded).toBe(false);
  });

  it('draws an aria-hidden noninteractive minimap from rendered real nodes and links', () => {
    vi.mocked(window.matchMedia).mockReturnValue({ matches: true } as MediaQueryList);
    const host = document.createElement('div');
    host.getBoundingClientRect = () => rect(0, 0, 500, 500);
    const renderer = new D3OrgChartRenderer(host, { onActivate: vi.fn() });
    const mount = host.querySelector<HTMLElement>('.org-delta-renderer-root')!;
    renderedNode(mount, 'root', rect(50, 50, 100, 50));
    renderedNode(mount, 'child', rect(300, 300, 100, 50));

    renderer.render(view([node(), node({ id: 'child', parentId: 'root' })]));
    animationFrames[0]?.(0);
    animationFrames[1]?.(0);

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
    vi.mocked(window.matchMedia).mockReturnValue({ matches: true } as MediaQueryList);
    const host = document.createElement('div');
    host.getBoundingClientRect = () => rect(0, 0, 500, 500);
    let middleBounds = rect(100, 100, 50, 50);
    const renderer = new D3OrgChartRenderer(host, { onActivate: vi.fn() });
    const mount = host.querySelector<HTMLElement>('.org-delta-renderer-root')!;
    renderedNode(mount, 'root', rect(0, 0, 50, 50));
    const middle = renderedNode(mount, 'middle', middleBounds);
    middle.getBoundingClientRect = () => middleBounds;
    renderedNode(mount, 'far', rect(400, 400, 50, 50));
    const nodes = [
      node(),
      node({ id: 'middle', parentId: 'root' }),
      node({ id: 'far', parentId: 'root' }),
    ];
    renderer.render(view(nodes));
    animationFrames[0]?.(0);
    animationFrames[1]?.(0);
    const minimap = host.querySelector<SVGSVGElement>('.org-delta-minimap')!;
    const before = minimap.querySelector('[data-minimap-node-id="middle"]')?.getAttribute('cx');

    middleBounds = rect(250, 100, 50, 50);
    resizeCallback?.([], {} as ResizeObserver);
    animationFrames[2]?.(1);
    animationFrames[3]?.(1);
    const after = minimap.querySelector('[data-minimap-node-id="middle"]')?.getAttribute('cx');
    expect(after).not.toBe(before);

    renderer.render(view([]));
    animationFrames[4]?.(2);
    animationFrames[5]?.(2);
    expect(minimap.style.display).toBe('none');
    expect(minimap.childNodes).toHaveLength(0);
    renderer.destroy();
  });

  it('updates only the minimap viewport during zoom while retaining node-map elements', () => {
    vi.mocked(window.matchMedia).mockReturnValue({ matches: true } as MediaQueryList);
    const host = document.createElement('div');
    host.getBoundingClientRect = () => rect(0, 0, 400, 300);
    const renderer = new D3OrgChartRenderer(host, { onActivate: vi.fn() });
    const mount = host.querySelector<HTMLElement>('.org-delta-renderer-root')!;
    mount.getBoundingClientRect = () => rect(0, 0, 400, 300);
    renderedNode(mount, 'root', rect(50, 50, 50, 50));
    renderedNode(mount, 'child', rect(300, 200, 50, 50));
    renderer.render(view([node(), node({ id: 'child', parentId: 'root' })]));
    animationFrames[0]?.(0);
    animationFrames[1]?.(0);
    const chart = mocked.FakeOrgChart.instances[0]!;
    const minimap = mount.querySelector<SVGSVGElement>('.org-delta-minimap')!;
    const dot = minimap.querySelector('[data-minimap-node-id="root"]');
    const viewport = minimap.querySelector<SVGRectElement>('.org-delta-minimap-viewport')!;
    const before = viewport.getAttribute('x');

    chart.currentTransform = { x: -100, y: -50, k: 2 };
    chart.zoomCallback?.();

    expect(viewport.getAttribute('x')).not.toBe(before);
    expect(minimap.querySelector('[data-minimap-node-id="root"]') === dot).toBe(true);
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
    expect(container.querySelector('[data-internal-id]')?.hasAttribute('aria-label')).toBe(false);
    expect(container.querySelector('button[data-activate-kind="internal"]')?.getAttribute('aria-label'))
      .toBe('<b>Internal</b>, internal unit, depth 1, contains subordinate organizations');
    expect(container.querySelector('button[data-activate-kind="change"]')).not.toBeNull();
    expect(container.querySelector('.org-delta-node--ghost')).not.toBeNull();
    expect(container.textContent).toContain('<script>alert(1)</script>');
  });

  it('renders a separate flat semantic tree without assigning tree roles to visual nodes', () => {
    const host = document.createElement('div');
    const renderer = new D3OrgChartRenderer(host, { onActivate: vi.fn() });
    const root = node({
      internalRows: [{
        id: 'inside', name: 'Inside', depth: 1, diffKind: 'unchanged',
        hasSubordinateChildren: false,
      }],
    });
    renderer.render(view([root, node({ id: 'child', name: 'Child', parentId: 'root' })]));

    const tree = host.querySelector<HTMLElement>('[role="tree"]')!;
    const items = [...tree.children] as HTMLElement[];
    expect(tree.getAttribute('aria-label')).toBe('Organization tree navigation');
    expect(items).toHaveLength(3);
    expect(items.every((item) => item.getAttribute('role') === 'treeitem')).toBe(true);
    expect(items.every((item) => item.childElementCount === 0)).toBe(true);
    expect(items.map((item) => [item.dataset.activateId, item.getAttribute('aria-level')]))
      .toEqual([['root', '1'], ['inside', '2'], ['child', '2']]);
    expect(items.map((item) => item.getAttribute('aria-label'))).toEqual([
      'Root, organization, level 1',
      'Inside, internal unit, level 2',
      'Child, subordinate organization, level 2',
    ]);
    expect(items[0]!.getAttribute('aria-expanded')).toBe('true');

    const visual = document.createElement('div');
    visual.innerHTML = mocked.FakeOrgChart.instances[0]!.content?.({ data: root }) ?? '';
    expect(visual.querySelector('[role="treeitem"]')).toBeNull();
    expect(visual.querySelector('[data-tree-navigation-item]')).toBeNull();
  });

  it('clamps tree focus and maps activation and expansion keys to the chart', () => {
    const host = document.createElement('div');
    document.body.append(host);
    const onActivate = vi.fn();
    const renderer = new D3OrgChartRenderer(host, { onActivate });
    renderer.render(view([
      node({ internalRows: [{
        id: 'inside', name: 'Inside', depth: 1, diffKind: 'unchanged',
        hasSubordinateChildren: false,
      }] }),
      node({ id: 'child', name: 'Child', parentId: 'root' }),
    ]));
    const item = (id: string): HTMLElement =>
      host.querySelector<HTMLElement>(`[data-tree-navigation-item][data-activate-id="${id}"]`)!;
    const chart = mocked.FakeOrgChart.instances[0]!;

    item('root').focus();
    item('root').dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'ArrowUp' }));
    expect(document.activeElement).toBe(item('root'));
    item('root').dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'End' }));
    expect(document.activeElement).toBe(item('child'));
    item('child').dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'ArrowDown' }));
    expect(document.activeElement).toBe(item('child'));

    item('root').dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Enter' }));
    expect(chart.calls).toContainEqual(['setCentered', 'root']);
    expect(onActivate).toHaveBeenLastCalledWith('node', 'root', item('root'));

    item('inside').dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: ' ' }));
    expect(chart.calls).toContainEqual(['setCentered', 'root']);
    expect(onActivate).toHaveBeenLastCalledWith('internal', 'inside', item('inside'));

    item('child').click();
    expect(chart.calls).toContainEqual(['setCentered', 'child']);
    expect(onActivate).toHaveBeenLastCalledWith('node', 'child', item('child'));

    item('root').dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: ' ' }));
    expect(chart.calls).toContainEqual(['setExpanded', 'root', false]);
    expect(item('root').getAttribute('aria-expanded')).toBe('false');
    expect(item('inside')).toBeNull();
    expect(item('child')).toBeNull();

    item('root').dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'ArrowRight' }));
    expect(chart.calls).toContainEqual(['setExpanded', 'root', true]);
    item('root').dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'ArrowRight' }));
    expect(document.activeElement).toBe(item('inside'));
    item('inside').dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'ArrowLeft' }));
    expect(document.activeElement).toBe(item('root'));
  });

  it('keeps collapsed descendant branches out of navigation after re-expanding a parent', () => {
    const host = document.createElement('div');
    const renderer = new D3OrgChartRenderer(host, { onActivate: vi.fn() });
    renderer.render(view([
      node(),
      node({ id: 'child', name: 'Child', parentId: 'root' }),
      node({ id: 'grandchild', name: 'Grandchild', parentId: 'child' }),
    ]));
    const item = (id: string): HTMLElement | null =>
      host.querySelector(`[data-tree-navigation-item][data-activate-id="${id}"]`);

    item('root')!.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: ' ' }));
    item('root')!.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'ArrowRight' }));

    expect(item('child')?.getAttribute('aria-expanded')).toBe('false');
    expect(item('grandchild')).toBeNull();
  });

  it('coerces unsafe runtime diff, depth, and count values before HTML interpolation', () => {
    const host = document.createElement('div');
    const renderer = new D3OrgChartRenderer(host, { onActivate: vi.fn() });
    const unsafe = node({
      diffKind: 'bad" onclick="alert(1)' as RenderNode['diffKind'],
      hiddenInternalCount: Number.NaN,
      hiddenChangeCount: Number.POSITIVE_INFINITY,
      internalRows: [{
        id: 'inside',
        name: 'Inside',
        depth: Number.POSITIVE_INFINITY,
        diffKind: '<img>' as RenderNode['diffKind'],
        hasSubordinateChildren: false,
      }],
    });
    renderer.render(view([unsafe]));
    const html = mocked.FakeOrgChart.instances[0]!.content?.({ data: unsafe }) ?? '';
    const container = document.createElement('div');
    container.innerHTML = html;

    expect(container.querySelector('[onclick],img')).toBeNull();
    expect(container.querySelector('[data-diff-kind]')?.getAttribute('data-diff-kind')).toBe('unchanged');
    expect(container.querySelector('[data-depth]')?.getAttribute('data-depth')).toBe('0');
    expect(container.querySelector('[data-hidden-internal-count]')).toBeNull();
    expect(container.querySelector('[data-hidden-change-count]')).toBeNull();
  });

  it('labels generated expand controls and hierarchy paths and cleans hidden link focusability', () => {
    const host = document.createElement('div');
    const renderer = new D3OrgChartRenderer(host, { onActivate: vi.fn() });
    renderer.render(view([node(), node({ id: 'child', parentId: 'root' })]));
    const chart = mocked.FakeOrgChart.instances[0]!;
    const group = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    const control = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    control.classList.add('node-button-g');
    group.append(control);
    chart.nodeCallback?.call(group, { data: node({ name: 'Root name' }), children: [{}] });
    expect(control.getAttribute('role')).toBe('button');
    expect(control.getAttribute('tabindex')).toBe('0');
    expect(control.getAttribute('aria-label')).toContain('Root name');

    const link = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    chart.linkCallback?.call(link, {
      data: node({ id: 'child', name: 'Child name' }),
      parent: { data: node({ name: 'Root name' }) },
    });
    expect(link.getAttribute('aria-label')).toBe(
      'Root name subordinate relationship to Child name',
    );
    expect(link.querySelector('title')?.textContent).toBe(
      'Root name subordinate relationship to Child name',
    );

    chart.linkCallback?.call(link, {
      data: node({ id: 'child', parentId: 'root', connectorSourceId: 'inside' }),
      parent: { data: node() },
    });
    expect(link.hasAttribute('tabindex')).toBe(false);
    expect(link.hasAttribute('role')).toBe(false);
    expect(link.hasAttribute('aria-label')).toBe(false);
    expect(link.querySelector('title')).toBeNull();
  });

  it('reacts to reduced-motion preference changes and removes the subscription', () => {
    let listener: ((event: MediaQueryListEvent) => void) | undefined;
    const remove = vi.fn();
    vi.mocked(window.matchMedia).mockReturnValue({
      matches: false,
      addEventListener: (_name: string, value: EventListenerOrEventListenerObject) => {
        listener = value as (event: MediaQueryListEvent) => void;
      },
      removeEventListener: remove,
    } as unknown as MediaQueryList);
    const renderer = new D3OrgChartRenderer(document.createElement('div'), { onActivate: vi.fn() });
    const chart = mocked.FakeOrgChart.instances[0]!;

    listener?.({ matches: true } as MediaQueryListEvent);
    expect(chart.calls.filter(([name]) => name === 'duration').at(-1)).toEqual(['duration', 0]);
    renderer.destroy();
    expect(remove).toHaveBeenCalledWith('change', expect.any(Function));
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
    host.querySelector('.org-delta-renderer-root')!.append(button);

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
    host.querySelector('.org-delta-renderer-root')!.append(group);

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
    expect(normal.dataset.activateId).toBe(JSON.stringify(['root', 'child']));
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
    chart.layoutCallback?.({ data: chart.currentData[0] });
    resizeCallback?.([], {} as ResizeObserver);
    expect(animationFrames).toHaveLength(2);

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
    expect(animationFrames).toHaveLength(2);
    animationFrames[0]?.(0);

    vi.advanceTimersByTime(300);

    expect(animationFrames.length).toBeGreaterThan(2);
    renderer.destroy();
  });

  it('runs a bounded overlay RAF loop for animated small charts', () => {
    const host = document.createElement('div');
    const renderer = new D3OrgChartRenderer(host, { onActivate: vi.fn() });
    renderer.render(view([node(), node({ id: 'child', parentId: 'root' })]));

    animationFrames[0]?.(0);
    expect(animationFrames.length).toBeGreaterThan(1);
    for (let index = 1; index < 30 && animationFrames[index]; index += 1) {
      animationFrames[index]?.(index * 16);
    }
    expect(animationFrames.length).toBeLessThanOrEqual(21);
    renderer.destroy();
  });

  it('disables animation and coalesces overlay work for hundreds of visible nodes', () => {
    const host = document.createElement('div');
    const renderer = new D3OrgChartRenderer(host, { onActivate: vi.fn() });
    const nodes = Array.from({ length: 500 }, (_value, index) => node({
      id: `node-${index}`,
      ...(index === 0 ? {} : { parentId: `node-${index - 1}` }),
    }));
    renderer.render(view(nodes));
    const chart = mocked.FakeOrgChart.instances[0]!;
    chart.zoomCallback?.();
    chart.zoomCallback?.();
    expect(animationFrames).toHaveLength(2);
    animationFrames[0]?.(0);

    expect(chart.calls.filter(([name]) => name === 'duration').at(-1)).toEqual(['duration', 0]);
    expect(animationFrames).toHaveLength(2);
    renderer.destroy();
  });
});
