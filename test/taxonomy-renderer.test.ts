import { afterEach, describe, expect, it, vi } from 'vitest';

import { diffCharts } from '../src/model/diff';
import { resolveView } from '../src/model/resolve';
import { buildTaxonomyRenderView } from '../src/presentation/build-taxonomy-view';
import { TaxonomyRenderer } from '../src/renderer/taxonomy-renderer';
import { taxonomyDocument } from './fixtures';
import { componentStyles } from '../src/component/styles';

function comparisonView(comparison = true) {
  const document = taxonomyDocument();
  const baseline = resolveView(document, { viewId: 'current', selectedGroups: [] });
  const proposed = resolveView(document, {
    viewId: comparison ? 'remove-air-divisions' : 'current',
    selectedGroups: [],
  });
  return buildTaxonomyRenderView(baseline, proposed, diffCharts(baseline, proposed), {
    comparison,
    showInternal: true,
    showRelationships: true,
    revealedInternalIds: new Set(),
  });
}

describe('TaxonomyRenderer', () => {
  afterEach(() => {
    document.body.replaceChildren();
    vi.unstubAllGlobals();
    delete (Element.prototype as unknown as { animate?: unknown }).animate;
  });

  it('renders one selected chart in taxonomy rows with column headings', () => {
    const host = document.createElement('div');
    document.body.append(host);
    const renderer = new TaxonomyRenderer(host, { onActivate: vi.fn() });

    renderer.render(comparisonView());

    expect(host.querySelectorAll('[data-taxonomy-tier]')).toHaveLength(3);
    expect(host.querySelectorAll('[data-view-side="baseline"][data-node-id]')).toHaveLength(0);
    expect(host.querySelectorAll('[data-view-side="proposed"][data-node-id]')).toHaveLength(6);
    expect(host.querySelectorAll('[data-taxonomy-system-heading="army-echelon"]'))
      .toHaveLength(1);
    expect(host.querySelector('[data-taxonomy-system-heading="army-echelon"]')?.textContent)
      .toBe('Army echelon');
    expect([...host.querySelectorAll('[data-taxonomy-system="army-echelon"]')]
      .every((cell) => !cell.textContent?.includes('Army echelon'))).toBe(true);
    expect(host.querySelector('[data-taxonomy-level="air-division"]')).toBeNull();
    expect(host.querySelector('[data-node-id="air-division-a"]')).toBeNull();
    expect(host.querySelector('[data-view-side="proposed"] [data-node-id="naf-a"]')?.textContent)
      .toContain('Deputy Commander');
    expect(host.querySelectorAll('[data-taxonomy-hierarchy][data-view-side="baseline"]'))
      .toHaveLength(0);
    expect(host.querySelectorAll('[data-taxonomy-hierarchy][data-view-side="proposed"]'))
      .toHaveLength(3);
    expect(host.querySelector('[data-taxonomy-movement="naf-a"]')).toBeNull();
    const hierarchyConnector = [...host.querySelectorAll<SVGPathElement>(
      '[data-taxonomy-hierarchy][data-view-side="proposed"]',
    )].find((path) => path.dataset.activateId?.includes('wing-a'));
    expect(hierarchyConnector?.getAttribute('aria-label')).toBe(
      'Example Numbered Air Force A subordinate relationship to Example Wing A',
    );
  });

  it('animates retained and entering cards with configured motion after initial render', () => {
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false })));
    const animate = vi.fn(() => ({ cancel: vi.fn() }) as unknown as Animation);
    Object.defineProperty(Element.prototype, 'animate', { configurable: true, value: animate });
    const host = document.createElement('div');
    document.body.append(host);
    const renderer = new TaxonomyRenderer(host, {
      onActivate: vi.fn(),
      transitionDurationMs: 900,
    });
    renderer.render(comparisonView());
    expect(animate).not.toHaveBeenCalled();
    const oldWorld = host.querySelector('.org-delta-taxonomy-world');
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      const old = this.closest('.org-delta-taxonomy-world') === oldWorld;
      const left = this.dataset.nodeId === 'naf-a' ? (old ? 20 : 120) : 0;
      return new DOMRect(left, 20, 100, 50);
    });

    renderer.render(comparisonView(false));

    expect(animate).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ transform: expect.stringContaining('translate') })]),
      expect.objectContaining({ duration: 900 }),
    );
    expect(animate).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          opacity: 0,
          transform: expect.stringContaining('translate'),
        }),
      ]),
      expect.objectContaining({ duration: 900 }),
    );
  });

  it('describes authored and displayed parents for aggregated hierarchy connectors', () => {
    const source = comparisonView(false);
    const view = {
      ...source,
      proposed: {
        ...source.proposed,
        nodes: source.proposed.nodes.map((node) => node.id === 'wing-a'
          ? {
              ...node,
              parentId: 'hidden-office',
              parentName: 'Hidden Office',
              connectorSourceId: 'naf-a',
            }
          : node),
      },
    };
    const host = document.createElement('div');
    document.body.append(host);
    const renderer = new TaxonomyRenderer(host, { onActivate: vi.fn() });

    renderer.render(view);

    const connector = [...host.querySelectorAll<SVGPathElement>('[data-taxonomy-hierarchy]')]
      .find((path) => path.dataset.activateId?.includes('wing-a'));
    expect(connector?.getAttribute('aria-label')).toBe(
      'Hidden Office subordinate relationship to Example Wing A, shown from Example Numbered Air Force A',
    );
  });

  it('uses a single full-width proposed chart when no comparison is active', () => {
    const host = document.createElement('div');
    document.body.append(host);
    const renderer = new TaxonomyRenderer(host, { onActivate: vi.fn() });

    renderer.render(comparisonView(false));

    expect(host.querySelector('[data-taxonomy-comparison]')?.getAttribute('data-taxonomy-comparison'))
      .toBe('false');
    expect(host.querySelectorAll('[data-view-side="baseline"]')).toHaveLength(0);
    expect(host.querySelectorAll('[data-view-side="proposed"][data-node-id]')).toHaveLength(8);
  });

  it('places children in ordered slots and centers their parent over the span', () => {
    const host = document.createElement('div');
    document.body.append(host);
    const renderer = new TaxonomyRenderer(host, { onActivate: vi.fn() });
    renderer.render({
      tiers: [
        { id: 'top', kind: 'unchanged', proposed: { id: 'top', label: 'Top' } },
        { id: 'lower', kind: 'unchanged', proposed: { id: 'lower', label: 'Lower' } },
      ],
      proposed: {
        systems: [],
        nodes: [
          { id: 'root', name: 'Root', tierId: 'top', internal: false, diffKind: 'unchanged' },
          { id: 'left', name: 'Left', parentId: 'root', parentName: 'Root', tierId: 'lower', internal: false, diffKind: 'unchanged' },
          { id: 'right', name: 'Right', parentId: 'root', parentName: 'Root', tierId: 'lower', internal: false, diffKind: 'unchanged' },
        ],
        relationships: [],
        searchEntries: [],
      },
      movements: [],
      searchEntries: [],
      initialExpansionIds: ['root'],
    });

    const left = host.querySelector<HTMLElement>('[data-scene-id="left"]')!;
    const right = host.querySelector<HTMLElement>('[data-scene-id="right"]')!;
    const root = host.querySelector<HTMLElement>('[data-scene-id="root"]')!;
    const leftX = Number.parseFloat(left.style.left);
    const rightX = Number.parseFloat(right.style.left);
    const rootX = Number.parseFloat(root.style.left);
    expect(rightX).toBeGreaterThan(leftX);
    expect(rootX + 125).toBe((leftX + 125 + rightX + 125) / 2);
    expect(host.querySelector('[data-taxonomy-toggle="root"]')?.innerHTML)
      .toContain('org-delta-expansion-chevron--expanded');
  });

  it('activates the selected card with proposed context', () => {
    const host = document.createElement('div');
    document.body.append(host);
    const onActivate = vi.fn();
    const renderer = new TaxonomyRenderer(host, { onActivate });
    renderer.render(comparisonView());

    const proposed = host.querySelector<HTMLElement>(
      '[data-view-side="proposed"][data-node-id="naf-a"] [data-activate-kind="node"]',
    )!;
    proposed.click();

    expect(onActivate).toHaveBeenCalledOnce();
    expect(onActivate).toHaveBeenCalledWith(
      'node',
      'naf-a',
      proposed,
      { side: 'proposed' },
    );
  });

  it('reveals a selected node and exposes one semantic tree', () => {
    const host = document.createElement('div');
    document.body.append(host);
    const renderer = new TaxonomyRenderer(host, { onActivate: vi.fn() });
    renderer.render(comparisonView());
    const toggle = host.querySelector<HTMLButtonElement>(
      '[data-view-side="proposed"] [data-taxonomy-toggle="naf-a"]',
    )!;
    toggle.focus();
    toggle.click();
    expect(host.querySelectorAll('[data-node-id="wing-a"]')).toHaveLength(0);

    renderer.reveal('wing-a');

    expect(host.querySelectorAll('[data-node-id="wing-a"].org-delta-taxonomy-card--revealed'))
      .toHaveLength(1);
    expect(host.querySelectorAll('[role="tree"][aria-label="Baseline organization tree"]'))
      .toHaveLength(0);
    expect(host.querySelectorAll('[role="tree"][aria-label="Proposed organization tree"]'))
      .toHaveLength(1);
    expect(host.querySelectorAll('[role="treeitem"][data-activate-id="wing-a"]'))
      .toHaveLength(1);
  });

  it('preserves focus after selected-chart expansion', () => {
    const host = document.createElement('div');
    document.body.append(host);
    const renderer = new TaxonomyRenderer(host, { onActivate: vi.fn() });
    renderer.render(comparisonView());

    const toggle = host.querySelector<HTMLButtonElement>(
      '[data-view-side="proposed"] [data-taxonomy-toggle="naf-a"]',
    )!;
    toggle.focus();
    toggle.click();

    expect(host.querySelectorAll('[data-node-id="wing-a"]')).toHaveLength(0);
    expect(host.querySelectorAll('[data-taxonomy-toggle="naf-a"][aria-expanded="false"]'))
      .toHaveLength(1);
    expect((document.activeElement as HTMLElement).dataset.taxonomyToggle).toBe('naf-a');
    expect((document.activeElement as HTMLElement).dataset.viewSide).toBe('proposed');
  });

  it('omits expansion when the selected node has no children', () => {
    const source = comparisonView();
    const view = {
      ...source,
      proposed: {
        ...source.proposed,
        nodes: source.proposed.nodes.map((node) => {
          if (node.id !== 'wing-a') return node;
          const { parentId: _parentId, ...detached } = node;
          return detached;
        }),
      },
    };
    const host = document.createElement('div');
    document.body.append(host);
    const renderer = new TaxonomyRenderer(host, { onActivate: vi.fn() });

    renderer.render(view);

    expect(host.querySelectorAll('[data-view-side="baseline"]')).toHaveLength(0);
    expect(host.querySelectorAll(
      '[data-view-side="proposed"] [data-taxonomy-toggle="naf-a"]',
    )).toHaveLength(0);
    expect(host.querySelector(
      '[aria-label="Proposed organization tree"] [data-activate-id="naf-a"]',
    )?.hasAttribute('aria-expanded')).toBe(false);
  });

  it('fits the shared comparison world with one transform', () => {
    const host = document.createElement('div');
    document.body.append(host);
    const renderer = new TaxonomyRenderer(host, { onActivate: vi.fn() });
    renderer.render(comparisonView());
    const mount = host.querySelector<HTMLElement>('.org-delta-taxonomy-renderer')!;
    const world = host.querySelector<HTMLElement>('.org-delta-taxonomy-world')!;
    mount.getBoundingClientRect = () => new DOMRect(0, 0, 800, 600);
    let transformed = false;
    world.getBoundingClientRect = () => transformed
      ? new DOMRect(20, 15, 760, 570)
      : new DOMRect(0, 0, 1600, 1200);

    renderer.fit();

    expect(world.style.transform).toContain('scale(');
    expect(Number(world.style.transform.match(/scale\(([^)]+)/)?.[1])).toBeLessThan(1);
    const fitted = world.style.transform;
    transformed = true;
    renderer.fit();
    expect(world.style.transform).toBe(fitted);
    const transform = world.style.transform;
    host.querySelector<HTMLButtonElement>('[data-taxonomy-toggle="naf-a"]')!.click();
    expect(host.querySelector<HTMLElement>('.org-delta-taxonomy-world')!.style.transform)
      .toBe(transform);
  });

  it('fits the initial mobile-sized view after layout', async () => {
    const bounds = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect')
      .mockImplementation(function (this: HTMLElement) {
        if (this.classList.contains('org-delta-taxonomy-renderer')) return new DOMRect(0, 0, 400, 600);
        if (this.classList.contains('org-delta-taxonomy-world')) return new DOMRect(0, 0, 1600, 1000);
        return new DOMRect();
      });
    const host = document.createElement('div');
    document.body.append(host);
    const renderer = new TaxonomyRenderer(host, { onActivate: vi.fn() });

    renderer.render(comparisonView());
    await Promise.resolve();

    expect(host.querySelector<HTMLElement>('.org-delta-taxonomy-world')!.style.transform)
      .toContain('scale(');
    bounds.mockRestore();
  });

  it('refits after a zero-sized mount becomes visible and disconnects observation', async () => {
    let resize: ResizeObserverCallback | undefined;
    const disconnect = vi.fn();
    vi.stubGlobal('ResizeObserver', class {
      constructor(callback: ResizeObserverCallback) { resize = callback; }
      observe(): void {}
      disconnect(): void { disconnect(); }
    });
    let visible = false;
    const bounds = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect')
      .mockImplementation(function (this: HTMLElement) {
        if (this.classList.contains('org-delta-taxonomy-renderer')) {
          return visible ? new DOMRect(0, 0, 800, 600) : new DOMRect();
        }
        if (this.classList.contains('org-delta-taxonomy-world')) {
          return visible ? new DOMRect(0, 0, 1600, 1200) : new DOMRect();
        }
        return new DOMRect();
      });
    const host = document.createElement('div');
    document.body.append(host);
    const renderer = new TaxonomyRenderer(host, { onActivate: vi.fn() });
    renderer.render(comparisonView());
    await Promise.resolve();

    visible = true;
    resize?.([], {} as ResizeObserver);

    expect(host.querySelector<HTMLElement>('.org-delta-taxonomy-world')!.style.transform)
      .toContain('scale(');
    renderer.destroy();
    expect(disconnect).toHaveBeenCalledOnce();
    bounds.mockRestore();
  });

  it('keeps the tier grid intact at mobile widths', () => {
    expect(componentStyles).toContain('.org-delta-taxonomy-tier { display: grid;');
    expect(componentStyles).toContain("[data-taxonomy-comparison='false'] .org-delta-taxonomy-tier");
    expect(componentStyles).toContain('grid-template-columns: subgrid');
    expect(componentStyles).toContain('touch-action: none');
    expect(componentStyles).not.toContain('org-delta-taxonomy-tier { display: block');
  });

  it('supports roving arrow navigation in the selected semantic tree', () => {
    const host = document.createElement('div');
    document.body.append(host);
    const renderer = new TaxonomyRenderer(host, { onActivate: vi.fn() });
    renderer.render(comparisonView());
    const items = host.querySelectorAll<HTMLElement>(
      '[aria-label="Proposed organization tree"] [role="treeitem"]',
    );
    items[0]!.focus();

    items[0]!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));

    expect(document.activeElement).toBe(items[1]);
    expect(items[0]!.tabIndex).toBe(-1);
    expect(items[1]!.tabIndex).toBe(0);

    items[0]!.focus();
    items[0]!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    expect((document.activeElement as HTMLElement).getAttribute('aria-level')).toBe('2');

    const leaf = [...items].find((item) => item.dataset.activateId === 'wing-a')!;
    leaf.focus();
    leaf.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
    expect((document.activeElement as HTMLElement).dataset.activateId).toBe('naf-a');
  });

  it('supports keyboard expansion in the selected semantic tree', () => {
    const host = document.createElement('div');
    document.body.append(host);
    const renderer = new TaxonomyRenderer(host, { onActivate: vi.fn() });
    renderer.render(comparisonView());
    const item = host.querySelector<HTMLElement>(
      '[aria-label="Proposed organization tree"] [data-activate-id="naf-a"]',
    )!;

    item.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));

    expect(host.querySelectorAll('[data-node-id="wing-a"]')).toHaveLength(0);
    expect(host.querySelectorAll('[role="treeitem"][data-activate-id="naf-a"][aria-expanded="false"]'))
      .toHaveLength(1);
  });
});
