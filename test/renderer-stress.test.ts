import { describe, expect, it } from 'vitest';
import { generateRendererStressView } from '../scripts/renderer-stress-fixture';

describe('renderer stress fixture', () => {
  it('generates a connected 5k-node browser benchmark view', () => {
    const view = generateRendererStressView();

    expect(view.nodes).toHaveLength(5_000);
    expect(view.nodes[0]?.parentId).toBeUndefined();
    expect(view.nodes.slice(1).every(({ parentId }) => parentId !== undefined)).toBe(true);
    expect(view.initialExpansionIds.length).toBeGreaterThan(0);
  });
});
