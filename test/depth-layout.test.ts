import { describe, expect, it } from 'vitest';

import { layoutDepthView } from '../src/renderer/depth-layout';
import type { RenderNode, RenderView } from '../src/renderer/types';

function node(id: string, parentId?: string, internalRows: RenderNode['internalRows'] = []): RenderNode {
  return {
    id,
    ...(parentId ? { parentId } : {}),
    name: id,
    internalRows,
    hiddenInternalCount: 0,
    hiddenChangeCount: 0,
    diffKind: 'unchanged',
    ghost: false,
  };
}

function view(nodes: readonly RenderNode[]): RenderView {
  return { nodes, relationships: [], searchEntries: [], initialExpansionIds: [] };
}

describe('layoutDepthView', () => {
  it('centers parents over ordered descendants without overlap', () => {
    const scene = layoutDepthView(view([
      node('root'), node('left', 'root'), node('right', 'root'),
    ]), new Set(['root', 'left', 'right']));
    const byId = new Map(scene.nodes.map((item) => [item.id, item]));

    expect(byId.get('left')!.left + 125).toBeLessThan(byId.get('right')!.left + 125);
    expect(byId.get('root')!.left + 125).toBe(
      (byId.get('left')!.left + 125 + byId.get('right')!.left + 125) / 2,
    );
    expect(byId.get('left')!.top).toBeGreaterThan(byId.get('root')!.top);
  });

  it('uses row maximums for uneven cards and keeps multiple roots separate', () => {
    const scene = layoutDepthView(view([
      node('tall', undefined, [{
        id: 'office', name: 'Office', depth: 1, diffKind: 'unchanged',
        hasSubordinateChildren: false,
      }]),
      node('short'),
      node('child', 'short'),
    ]), new Set(['tall', 'short', 'child']));
    const byId = new Map(scene.nodes.map((item) => [item.id, item]));

    expect(byId.get('child')!.top).toBeGreaterThanOrEqual(
      byId.get('tall')!.top + byId.get('tall')!.height + 72,
    );
    expect(byId.get('short')!.left).not.toBe(byId.get('tall')!.left);
    expect(scene.nodes.every(({ left, top }) => Number.isFinite(left) && Number.isFinite(top)))
      .toBe(true);
  });

  it('uses the visible outer parent for motion when a connector starts internally', () => {
    const child = node('child', 'root');
    child.connectorSourceId = 'office';
    const scene = layoutDepthView(view([
      node('root', undefined, [{
        id: 'office', name: 'Office', depth: 1, diffKind: 'unchanged',
        hasSubordinateChildren: true,
      }]),
      child,
    ]), new Set(['root', 'office', 'child']));

    expect(scene.nodes.find(({ id }) => id === 'child')?.parentId).toBe('root');
    expect(scene.connectors[0]?.source).toEqual({ id: 'office', kind: 'internal' });
  });
});
