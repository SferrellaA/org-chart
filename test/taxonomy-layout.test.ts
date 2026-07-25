import { describe, expect, it } from 'vitest';

import { layoutTaxonomyNodes, type TaxonomyLayoutNode } from '../src/renderer/taxonomy-layout';

function node(
  id: string,
  tierId: string,
  parentId?: string,
): TaxonomyLayoutNode {
  return { id, tierId, internal: false, ...(parentId ? { parentId } : {}) };
}

describe('layoutTaxonomyNodes', () => {
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
