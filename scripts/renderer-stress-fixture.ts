import type { RenderNode, RenderView } from '../src/renderer/types';

export function generateRendererStressView(count = 5_000): RenderView {
  const size = Math.max(0, Math.floor(count));
  const nodes: RenderNode[] = Array.from({ length: size }, (_value, index) => ({
    id: `stress-${index}`,
    ...(index === 0 ? {} : { parentId: `stress-${Math.floor((index - 1) / 4)}` }),
    name: `Stress node ${index}`,
    internalRows: [],
    hiddenInternalCount: 0,
    hiddenChangeCount: 0,
    diffKind: 'unchanged',
    ghost: false,
  }));
  return {
    nodes,
    relationships: [],
    searchEntries: nodes.map(({ id, name }) => ({ id, label: name, hiddenInternal: false })),
    initialExpansionIds: nodes.slice(0, Math.min(size, 341)).map(({ id }) => id),
  };
}
