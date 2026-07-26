import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { D3OrgChartRenderer } from '../src/renderer/d3-renderer';
import {
  encodeHierarchyActivationId,
  type RenderNode,
  type RenderView,
} from '../src/renderer/types';
import { generateRendererStressView } from '../scripts/renderer-stress-fixture';

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

describe('D3OrgChartRenderer with the shared scene renderer', () => {
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
    for (const dimension of ['width', 'height']) {
      Object.defineProperty(SVGSVGElement.prototype, dimension, {
        configurable: true,
        get: () => ({ baseVal: { value: dimension === 'width' ? 800 : 600 } }),
      });
    }
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    document.body.replaceChildren();
  });

  it('renders multiple roots without exposing a synthetic root', async () => {
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
    expect(element.querySelectorAll('[data-scene-node]')).toHaveLength(3);
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

  it('removes the owned chart while preserving unrelated host content on destroy', () => {
    const element = host();
    const unrelated = document.createElement('p');
    unrelated.textContent = 'preserve';
    element.append(unrelated);
    const renderer = new D3OrgChartRenderer(element, { onActivate: vi.fn() });
    renderer.render(view([node('root')]));
    expect(element.querySelector('.org-delta-scene-renderer')).not.toBeNull();

    renderer.destroy();
    window.dispatchEvent(new Event('resize'));

    expect(element.childNodes).toHaveLength(1);
    expect(element.firstChild).toBe(unrelated);
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

  it('handles an empty view without creating a D3 chart', () => {
    const element = host();
    const renderer = new D3OrgChartRenderer(element, { onActivate: vi.fn() });

    expect(() => {
      renderer.render(view([]));
      renderer.fit();
      renderer.reveal('missing');
    }).not.toThrow();
    expect(element.querySelector('svg.svg-chart-container')).toBeNull();
    expect(element.querySelector('.org-delta-empty-state')).not.toBeNull();
    renderer.destroy();
  });

  it('preserves a user collapse across retained-data render updates', async () => {
    const element = host();
    const renderer = new D3OrgChartRenderer(element, { onActivate: vi.fn() });
    renderer.render(view([
      node('root'),
      node('child', 'root'),
      node('grandchild', 'child'),
    ]));
    const control = element.querySelector<HTMLButtonElement>('[data-hierarchy-toggle="child"]');
    expect(control?.tagName).toBe('BUTTON');
    expect(control?.getAttribute('aria-label')).toContain('child');
    control?.click();

    renderer.render(view([
      { ...node('root'), name: 'Updated root' },
      { ...node('child', 'root'), name: 'Updated child' },
      { ...node('grandchild', 'child'), name: 'Updated grandchild' },
    ]));
    await new Promise((resolve) => setTimeout(resolve, 30));

    expect(element.querySelector('[data-node-id="grandchild"]')).toBeNull();
    renderer.destroy();
  });

  it('preserves expanded A and collapsed B after nested toggles and rerender', async () => {
    const element = host();
    const renderer = new D3OrgChartRenderer(element, { onActivate: vi.fn() });
    const nested = [
      node('root'),
      node('A', 'root'),
      node('B', 'A'),
      node('C', 'B'),
    ];
    renderer.render({ ...view(nested), initialExpansionIds: ['root'] });

    element.querySelector<HTMLButtonElement>('[data-hierarchy-toggle="A"]')?.click();
    const bControl = element.querySelector<HTMLButtonElement>('[data-hierarchy-toggle="B"]');
    expect(bControl).not.toBeNull();
    bControl?.click();
    expect(element.querySelector('[data-node-id="C"]')).not.toBeNull();
    element.querySelector<HTMLButtonElement>('[data-hierarchy-toggle="B"]')?.click();

    renderer.render({
      ...view(nested.map((item) => ({ ...item, name: `${item.name} updated` }))),
      initialExpansionIds: ['root'],
    });
    await new Promise((resolve) => setTimeout(resolve, 30));

    expect(element.querySelector('[data-node-id="A"]')).not.toBeNull();
    expect(element.querySelector('[data-node-id="B"]')).not.toBeNull();
    expect(element.querySelector('[data-node-id="C"]')).toBeNull();
    renderer.destroy();
  });

  it('activates an accessibly named hierarchy path by keyboard', () => {
    const element = host();
    const onActivate = vi.fn();
    const renderer = new D3OrgChartRenderer(element, { onActivate });
    renderer.render(view([node('root'), node('child', 'root')]));
    const link = element.querySelector<SVGPathElement>('[data-activate-kind="hierarchy"]')!;

    expect(link.getAttribute('role')).toBe('button');
    expect(link.getAttribute('tabindex')).toBe('0');
    expect(link.getAttribute('aria-label')).toBe('root subordinate relationship to child');
    link.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Enter' }));

    expect(onActivate).toHaveBeenCalledOnce();
    expect(onActivate.mock.calls[0]?.[0]).toBe('hierarchy');
    expect(onActivate.mock.calls[0]?.[1]).toBe(encodeHierarchyActivationId('root', 'child'));
    expect(onActivate.mock.calls[0]?.[2] === link).toBe(true);
    renderer.destroy();
  });

  it('renders hundreds of actual D3 nodes with animation disabled', () => {
    const element = host();
    const renderer = new D3OrgChartRenderer(element, { onActivate: vi.fn() });
    const started = performance.now();

    renderer.render(generateRendererStressView(300));
    const elapsed = performance.now() - started;

    expect(element.querySelectorAll('[data-node-id]')).toHaveLength(300);
    expect(elapsed).toBeLessThan(5_000);
    renderer.destroy();
  });
});
