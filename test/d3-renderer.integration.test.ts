import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { D3OrgChartRenderer } from '../src/renderer/d3-renderer';
import type { RenderNode, RenderView } from '../src/renderer/types';

function node(id: string, parentId?: string): RenderNode {
  return {
    id,
    ...(parentId === undefined ? {} : { parentId }),
    name: id,
    internalRows: [],
    hiddenInternalCount: 0,
    hiddenChangeCount: 0,
    diffKind: 'unchanged',
    ghost: false,
  };
}

function view(nodes: readonly RenderNode[]): RenderView {
  return {
    nodes,
    relationships: [],
    searchEntries: [],
    initialExpansionIds: nodes.map(({ id }) => id),
  };
}

function host(): HTMLElement {
  const element = document.createElement('div');
  element.getBoundingClientRect = () => ({
    bottom: 600,
    height: 600,
    left: 0,
    right: 800,
    top: 0,
    width: 800,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  });
  document.body.append(element);
  return element;
}

describe('D3OrgChartRenderer with installed d3-org-chart', () => {
  beforeEach(() => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      measureText: () => ({ width: 10 }),
    } as unknown as CanvasRenderingContext2D);
    vi.stubGlobal('ResizeObserver', class {
      observe(): void {}
      disconnect(): void {}
    });
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: true })));
    Object.defineProperty(SVGElement.prototype, 'transform', {
      configurable: true,
      get: () => ({ baseVal: { consolidate: () => null } }),
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    document.body.replaceChildren();
  });

  it('renders multiple roots through an invisible minimal collision-safe synthetic root', async () => {
    const element = host();
    const renderer = new D3OrgChartRenderer(element, { onActivate: vi.fn() });

    expect(() => renderer.render(view([
      node('__org_delta_chart_root__'),
      node('first'),
      node('second'),
    ]))).not.toThrow();

    expect(element.querySelector('[data-node-id="__org_delta_chart_root__"]')).not.toBeNull();
    expect(element.querySelector('[data-node-id="first"]')).not.toBeNull();
    expect(element.querySelector('[data-node-id="second"]')).not.toBeNull();
    expect(element.querySelectorAll('[data-node-id]')).toHaveLength(3);
    const hiddenNodes = [...element.querySelectorAll<SVGGElement>('g.node')]
      .filter((item) => item.style.display === 'none');
    expect(hiddenNodes).toHaveLength(1);
    expect(hiddenNodes[0]?.querySelector('foreignObject')?.getAttribute('width')).toBe('1');
    expect(
      [...element.querySelectorAll<SVGPathElement>('path.link')]
        .filter((item) => item.style.display === 'none'),
    ).toHaveLength(3);
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    const minimap = element.querySelector<SVGSVGElement>('.org-delta-minimap')!;
    expect([...minimap.querySelectorAll<SVGElement>('[data-minimap-node-id]')]
      .map(({ dataset }) => dataset.minimapNodeId).sort()).toEqual([
      '__org_delta_chart_root__',
      'first',
      'second',
    ]);
    renderer.destroy();
  });

  it('removes the complete D3 chart and leaves the host empty on destroy', () => {
    const element = host();
    const renderer = new D3OrgChartRenderer(element, { onActivate: vi.fn() });
    renderer.render(view([node('root')]));
    expect(element.querySelector('svg.svg-chart-container')).not.toBeNull();

    renderer.destroy();
    window.dispatchEvent(new Event('resize'));

    expect(element.childNodes).toHaveLength(0);
  });

  it('activates native node buttons by keyboard without reaching D3 expansion handlers', () => {
    const element = host();
    const onActivate = vi.fn();
    const renderer = new D3OrgChartRenderer(element, { onActivate });
    renderer.render(view([node('root'), node('child', 'root')]));
    const button = element.querySelector<HTMLButtonElement>(
      '[data-node-id="root"] [data-activate-kind="node"]',
    )!;

    for (const key of ['Enter', ' ']) {
      button.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key }));
      button.click();
      expect(onActivate).toHaveBeenCalledTimes(1);
      expect(onActivate).toHaveBeenLastCalledWith('node', 'root', button);
      expect(element.querySelector('[data-node-id="child"]')).not.toBeNull();
      onActivate.mockClear();
    }
    renderer.destroy();
  });
});
