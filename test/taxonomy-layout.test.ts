import { describe, expect, it } from 'vitest';

import type { TaxonomyRenderView } from '../src/presentation/build-taxonomy-view';
import {
  layoutTaxonomyNodes,
  layoutTaxonomyView,
  type TaxonomyLayoutNode,
} from '../src/renderer/taxonomy-layout';

function node(
  id: string,
  tierId: string,
  parentId?: string,
): TaxonomyLayoutNode {
  return { id, tierId, internal: false, ...(parentId ? { parentId } : {}) };
}

describe('layoutTaxonomyNodes', () => {
  it('emits shared scene nodes, connectors, and tier decorations', () => {
    const view: TaxonomyRenderView = {
      tiers: [
        { id: 'top', kind: 'unchanged', proposed: { id: 'top', label: 'Top' } },
        { id: 'lower', kind: 'unchanged', proposed: { id: 'lower', label: 'Lower' } },
      ],
      proposed: {
        systems: [{
          id: 'system', label: 'System',
          levels: [{ id: 'unit', label: 'Unit', tier: 'lower' }],
        }],
        nodes: [
          { id: 'root', name: 'Root', tierId: 'top', internal: false, diffKind: 'unchanged' },
          { id: 'child', name: 'Child', parentId: 'root', parentName: 'Root', tierId: 'lower', internal: false, diffKind: 'unchanged' },
        ],
        relationships: [],
        searchEntries: [],
      },
      movements: [],
      searchEntries: [],
      initialExpansionIds: ['root'],
    };

    const scene = layoutTaxonomyView(view, new Set(['root', 'child']));

    expect(scene.nodes.map(({ id }) => id)).toEqual(['root', 'child']);
    expect(scene.nodes.find(({ id }) => id === 'child')!.top)
      .toBeGreaterThan(scene.nodes.find(({ id }) => id === 'root')!.top);
    expect(scene.connectors).toEqual([
      expect.objectContaining({ kind: 'hierarchy', activationId: JSON.stringify(['root', 'child']) }),
    ]);
    expect(scene.decorations.map(({ key }) => key).sort()).toEqual([
      'header', 'tier:lower', 'tier:top',
    ]);
  });

  it('centers parents over ordered descendant spans across skipped tiers', () => {
    const layout = layoutTaxonomyNodes([
      node('root', 'command'),
      node('left', 'wing', 'root'),
      node('right', 'wing', 'root'),
    ]);
    const center = (id: string) => layout.positions.get(id)! + 125;

    expect(center('left')).toBeLessThan(center('right'));
    expect(center('root')).toBe((center('left') + center('right')) / 2);
  });

  it('separates multiple roots and resolves same-tier collisions deterministically', () => {
    const nodes = [
      node('first-root', 'top'),
      node('same-tier-child', 'top', 'first-root'),
      node('second-root', 'top'),
    ];
    const first = layoutTaxonomyNodes(nodes);
    const second = layoutTaxonomyNodes(nodes);
    const positions = nodes.map(({ id }) => first.positions.get(id)!);

    expect(positions[1]! - positions[0]!).toBeGreaterThanOrEqual(274);
    expect(positions[2]).toBeGreaterThan(positions[1]!);
    expect([...second.positions]).toEqual([...first.positions]);
    expect(first.width).toBeGreaterThan(750);
  });
});
