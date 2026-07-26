import { afterEach, describe, expect, it, vi } from 'vitest';

import { D3OrgChartRenderer, depthHierarchy } from '../src/renderer/d3-renderer';
import type { RenderNode, RenderView } from '../src/renderer/types';

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

function view(nodes: readonly RenderNode[] = [node()], initialExpansionIds = nodes.map(({ id }) => id)): RenderView {
  return { nodes, relationships: [], searchEntries: [], initialExpansionIds };
}

describe('D3OrgChartRenderer', () => {
  afterEach(() => {
    document.body.replaceChildren();
    vi.unstubAllGlobals();
  });

  it('normalizes outer and internal units into one hierarchy graph', () => {
    const value = view([
      node({
        internalRows: [
          { id: 'office', name: 'Office', depth: 1, diffKind: 'unchanged', hasSubordinateChildren: true },
          { id: 'team', name: 'Team', depth: 2, diffKind: 'unchanged', hasSubordinateChildren: false },
        ],
      }),
      node({ id: 'agency', name: 'Agency', parentId: 'root', connectorSourceId: 'office' }),
    ]);

    expect(depthHierarchy(value)).toEqual([
      { id: 'root', ownerId: 'root', name: 'Root', kind: 'node' },
      { id: 'office', ownerId: 'root', name: 'Office', kind: 'internal', parentId: 'root', expansionChild: false },
      { id: 'team', ownerId: 'root', name: 'Team', kind: 'internal', parentId: 'office', expansionChild: false },
      { id: 'agency', ownerId: 'agency', name: 'Agency', kind: 'node', parentId: 'office' },
    ]);
  });

  it('activates internal-only treeitems instead of treating containment as expansion', () => {
    const host = document.createElement('div');
    document.body.append(host);
    const onActivate = vi.fn();
    const renderer = new D3OrgChartRenderer(host, { onActivate });
    renderer.render(view([node({ internalRows: [
      { id: 'office', name: 'Office', depth: 1, diffKind: 'unchanged', hasSubordinateChildren: false },
      { id: 'team', name: 'Team', depth: 2, diffKind: 'unchanged', hasSubordinateChildren: false },
    ] })], ['root']));
    const office = host.querySelector<HTMLElement>(
      '[data-tree-navigation-item][data-activate-id="office"]',
    )!;

    expect(office.hasAttribute('aria-expanded')).toBe(false);
    office.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: ' ' }));

    expect(onActivate).toHaveBeenCalledWith('internal', 'office', office);
  });

  it('renders shared unit cards and hierarchy controls', () => {
    const host = document.createElement('div');
    const renderer = new D3OrgChartRenderer(host, { onActivate: vi.fn() });

    renderer.render(view([node(), node({ id: 'child', name: 'Child', parentId: 'root' })]));

    expect(host.querySelectorAll('.org-delta-unit-card')).toHaveLength(2);
    expect(host.querySelector('[data-hierarchy-toggle="root"]')).not.toBeNull();
    expect(host.querySelectorAll('[role="treeitem"]')).toHaveLength(2);
  });

  it('initially expands internal owners using canonical depth semantics', () => {
    const host = document.createElement('div');
    document.body.append(host);
    const renderer = new D3OrgChartRenderer(host, { onActivate: vi.fn() });
    renderer.render(view([
      node({ internalRows: [{
        id: 'office', name: 'Office', depth: 1, diffKind: 'unchanged',
        hasSubordinateChildren: true,
      }] }),
      node({ id: 'agency', name: 'Agency', parentId: 'root', connectorSourceId: 'office' }),
    ], ['root']));
    expect(host.querySelector('[data-node-id="agency"]')).not.toBeNull();
    expect(host.querySelector('[data-tree-navigation-item][data-activate-id="office"]')
      ?.getAttribute('aria-expanded')).toBe('true');
  });

  it('delegates card and hierarchy activation', () => {
    const host = document.createElement('div');
    const onActivate = vi.fn();
    const renderer = new D3OrgChartRenderer(host, { onActivate });
    renderer.render(view([node(), node({ id: 'child', name: 'Child', parentId: 'root' })]));

    host.querySelector<HTMLButtonElement>('[data-activate-id="child"]')!.click();
    expect(onActivate).toHaveBeenLastCalledWith(
      'node', 'child', expect.any(HTMLButtonElement),
    );
    host.querySelector<SVGPathElement>('[data-activate-kind="hierarchy"]')
      ?.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Enter' }));
    expect(onActivate.mock.calls.at(-1)?.[0]).toBe('hierarchy');
  });

  it('handles empty views and preserves unrelated host content on destroy', () => {
    const host = document.createElement('div');
    const unrelated = document.createElement('p');
    host.append(unrelated);
    const renderer = new D3OrgChartRenderer(host, { onActivate: vi.fn() });

    expect(() => {
      renderer.render(view([]));
      renderer.fit();
      renderer.reveal('missing');
    }).not.toThrow();
    expect(host.querySelector('.org-delta-empty-state')).not.toBeNull();

    renderer.destroy();
    expect(host.childNodes).toHaveLength(1);
    expect(host.firstChild).toBe(unrelated);
  });
});
