import { afterEach, describe, expect, it, vi } from 'vitest';

import { diffCharts } from '../src/model/diff';
import { resolveView } from '../src/model/resolve';
import { buildTaxonomyRenderView } from '../src/presentation/build-taxonomy-view';
import {
  taxonomyConnectorPoint,
  TaxonomyRenderer,
} from '../src/renderer/taxonomy-renderer';
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
  });

  it('converts transformed card geometry back to world connector coordinates', () => {
    expect(taxonomyConnectorPoint(
      new DOMRect(120, 70, 40, 20),
      new DOMRect(100, 50, 400, 300),
      'center',
      2,
    )).toEqual({ x: 20, y: 15 });
  });

  it('renders complete baseline and proposed cards in shared tier rows with taxonomy columns', () => {
    const host = document.createElement('div');
    document.body.append(host);
    const renderer = new TaxonomyRenderer(host, { onActivate: vi.fn() });

    renderer.render(comparisonView());

    expect(host.querySelectorAll('[data-taxonomy-tier]')).toHaveLength(3);
    expect(host.querySelectorAll('[data-view-side="baseline"][data-node-id]')).toHaveLength(8);
    expect(host.querySelectorAll('[data-view-side="proposed"][data-node-id]')).toHaveLength(6);
    expect(host.querySelector('[data-taxonomy-system="army-echelon"]')?.textContent)
      .toContain('Army echelon');
    expect(host.querySelector('[data-taxonomy-level="air-division"]')?.textContent)
      .toContain('Air Division');
    expect(host.querySelector('[data-node-id="air-division-a"]')?.textContent)
      .toContain('Commander');
    expect(host.querySelector('[data-view-side="proposed"] [data-node-id="naf-a"]')?.textContent)
      .toContain('Deputy Commander');
    expect(host.querySelectorAll('[data-taxonomy-hierarchy][data-view-side="baseline"]'))
      .toHaveLength(5);
    expect(host.querySelectorAll('[data-taxonomy-hierarchy][data-view-side="proposed"]'))
      .toHaveLength(3);
    expect(host.querySelector('[data-taxonomy-movement="naf-a"]')).not.toBeNull();
    const hierarchyConnector = [...host.querySelectorAll<SVGPathElement>(
      '[data-taxonomy-hierarchy][data-view-side="baseline"]',
    )].find((path) => path.dataset.activateId?.includes('air-division-a'));
    expect(hierarchyConnector?.getAttribute('aria-label')).toBe(
      'Example Numbered Air Force A subordinate relationship to Example Air Division A',
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

  it('activates duplicate cards with their baseline or proposed context', () => {
    const host = document.createElement('div');
    document.body.append(host);
    const onActivate = vi.fn();
    const renderer = new TaxonomyRenderer(host, { onActivate });
    renderer.render(comparisonView());

    host.querySelector<HTMLElement>(
      '[data-view-side="baseline"][data-node-id="naf-a"] [data-activate-kind="node"]',
    )!.click();
    const proposed = host.querySelector<HTMLElement>(
      '[data-view-side="proposed"][data-node-id="naf-a"] [data-activate-kind="node"]',
    )!;
    proposed.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

    expect(onActivate).toHaveBeenNthCalledWith(
      1,
      'node',
      'naf-a',
      expect.any(HTMLElement),
      { side: 'baseline' },
    );
    expect(onActivate).toHaveBeenNthCalledWith(
      2,
      'node',
      'naf-a',
      proposed,
      { side: 'proposed' },
    );
  });

  it('reveals both counterparts and exposes separately labeled semantic trees', () => {
    const host = document.createElement('div');
    document.body.append(host);
    const renderer = new TaxonomyRenderer(host, { onActivate: vi.fn() });
    renderer.render(comparisonView());
    const toggle = host.querySelector<HTMLButtonElement>(
      '[data-view-side="baseline"] [data-taxonomy-toggle="naf-a"]',
    )!;
    toggle.focus();
    toggle.click();
    expect(host.querySelectorAll('[data-node-id="wing-a"]')).toHaveLength(0);

    renderer.reveal('wing-a');

    expect(host.querySelectorAll('[data-node-id="wing-a"].org-delta-taxonomy-card--revealed'))
      .toHaveLength(2);
    expect(host.querySelectorAll('[role="tree"][aria-label="Baseline organization tree"]'))
      .toHaveLength(1);
    expect(host.querySelectorAll('[role="tree"][aria-label="Proposed organization tree"]'))
      .toHaveLength(1);
    expect(host.querySelectorAll('[role="treeitem"][data-activate-id="wing-a"]'))
      .toHaveLength(2);
  });

  it('synchronizes expansion across both comparison halves', () => {
    const host = document.createElement('div');
    document.body.append(host);
    const renderer = new TaxonomyRenderer(host, { onActivate: vi.fn() });
    renderer.render(comparisonView());

    const toggle = host.querySelector<HTMLButtonElement>(
      '[data-view-side="baseline"] [data-taxonomy-toggle="naf-a"]',
    )!;
    toggle.focus();
    toggle.click();

    expect(host.querySelectorAll('[data-node-id="wing-a"]')).toHaveLength(0);
    expect(host.querySelectorAll('[data-taxonomy-toggle="naf-a"][aria-expanded="false"]'))
      .toHaveLength(2);
    expect((document.activeElement as HTMLElement).dataset.taxonomyToggle).toBe('naf-a');
    expect((document.activeElement as HTMLElement).dataset.viewSide).toBe('baseline');
  });

  it('exposes expansion only on sides that contain children', () => {
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

    expect(host.querySelectorAll(
      '[data-view-side="baseline"] [data-taxonomy-toggle="naf-a"]',
    )).toHaveLength(1);
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

    expect(world.style.transform).toContain('scale(0.475)');
    transformed = true;
    renderer.fit();
    expect(world.style.transform).toContain('scale(0.475)');
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
      .toContain('scale(0.2375)');
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
      .toContain('scale(0.475)');
    renderer.destroy();
    expect(disconnect).toHaveBeenCalledOnce();
    bounds.mockRestore();
  });

  it('keeps the paired tier grid intact at mobile widths', () => {
    expect(componentStyles).toContain('.org-delta-taxonomy-tier { display: grid;');
    expect(componentStyles).toContain("[data-taxonomy-comparison='true'] .org-delta-taxonomy-tier");
    expect(componentStyles).toContain('grid-template-columns: subgrid');
    expect(componentStyles).toContain('touch-action: none');
    expect(componentStyles).not.toContain('org-delta-taxonomy-tier { display: block');
  });

  it('supports roving arrow navigation in each semantic tree', () => {
    const host = document.createElement('div');
    document.body.append(host);
    const renderer = new TaxonomyRenderer(host, { onActivate: vi.fn() });
    renderer.render(comparisonView());
    const items = host.querySelectorAll<HTMLElement>(
      '[aria-label="Baseline organization tree"] [role="treeitem"]',
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
    expect((document.activeElement as HTMLElement).dataset.activateId).toBe('air-division-a');
  });

  it('synchronizes keyboard expansion from either semantic tree', () => {
    const host = document.createElement('div');
    document.body.append(host);
    const renderer = new TaxonomyRenderer(host, { onActivate: vi.fn() });
    renderer.render(comparisonView());
    const item = host.querySelector<HTMLElement>(
      '[aria-label="Baseline organization tree"] [data-activate-id="naf-a"]',
    )!;

    item.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));

    expect(host.querySelectorAll('[data-node-id="wing-a"]')).toHaveLength(0);
    expect(host.querySelectorAll('[role="treeitem"][data-activate-id="naf-a"][aria-expanded="false"]'))
      .toHaveLength(2);
  });
});
