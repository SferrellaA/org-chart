export interface TaxonomyLayoutNode {
  id: string;
  parentId?: string;
  connectorSourceId?: string;
  tierId: string;
  internal: boolean;
}

export interface TaxonomyLayout {
  positions: ReadonlyMap<string, number>;
  width: number;
}

const OUTER_WIDTH = 250;
const INTERNAL_WIDTH = 220;
const GAP = 24;

function nodeWidth(node: TaxonomyLayoutNode): number {
  return node.internal ? INTERNAL_WIDTH : OUTER_WIDTH;
}

export function layoutTaxonomyNodes(nodes: readonly TaxonomyLayoutNode[]): TaxonomyLayout {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const children = new Map<string, TaxonomyLayoutNode[]>();
  const parentOf = new Map<string, string>();
  for (const node of nodes) {
    const parent = node.connectorSourceId ?? node.parentId;
    if (!parent || !byId.has(parent)) continue;
    parentOf.set(node.id, parent);
    const values = children.get(parent) ?? [];
    values.push(node);
    children.set(parent, values);
  }
  const roots = nodes.filter(({ id }) => !parentOf.has(id));
  const centers = new Map<string, number>();
  let nextLeafCenter = OUTER_WIDTH / 2;
  const placed = new Set<string>();

  const placeTree = (root: TaxonomyLayoutNode): void => {
    const stack: Array<{ node: TaxonomyLayoutNode; visited: boolean }> = [
      { node: root, visited: false },
    ];
    while (stack.length) {
      const entry = stack.pop()!;
      if (entry.visited) {
        const descendants = children.get(entry.node.id) ?? [];
        if (descendants.length === 0) {
          centers.set(entry.node.id, nextLeafCenter);
          nextLeafCenter += nodeWidth(entry.node) + GAP;
        } else {
          const first = centers.get(descendants[0]!.id)!;
          const last = centers.get(descendants.at(-1)!.id)!;
          centers.set(entry.node.id, (first + last) / 2);
        }
        placed.add(entry.node.id);
        continue;
      }
      stack.push({ node: entry.node, visited: true });
      const descendants = children.get(entry.node.id) ?? [];
      for (let index = descendants.length - 1; index >= 0; index -= 1) {
        stack.push({ node: descendants[index]!, visited: false });
      }
    }
  };

  for (const root of roots) placeTree(root);
  for (const node of nodes) if (!placed.has(node.id)) placeTree(node);

  const descendantsOf = (id: string): string[] => {
    const result: string[] = [];
    const stack = [...(children.get(id) ?? [])];
    while (stack.length) {
      const child = stack.pop()!;
      result.push(child.id);
      stack.push(...(children.get(child.id) ?? []));
    }
    return result;
  };
  const tiers = new Map<string, TaxonomyLayoutNode[]>();
  for (const node of nodes) {
    const values = tiers.get(node.tierId) ?? [];
    values.push(node);
    tiers.set(node.tierId, values);
  }
  for (const values of tiers.values()) {
    values.sort((left, right) => centers.get(left.id)! - centers.get(right.id)!);
    let previousRight = -Infinity;
    for (const node of values) {
      const width = nodeWidth(node);
      const left = centers.get(node.id)! - width / 2;
      const shift = Math.max(0, previousRight + GAP - left);
      if (shift) {
        centers.set(node.id, centers.get(node.id)! + shift);
        for (const descendant of descendantsOf(node.id)) {
          centers.set(descendant, centers.get(descendant)! + shift);
        }
      }
      previousRight = centers.get(node.id)! + width / 2;
    }
  }

  const positions = new Map<string, number>();
  let width = OUTER_WIDTH;
  for (const node of nodes) {
    const left = centers.get(node.id)! - nodeWidth(node) / 2;
    positions.set(node.id, left);
    width = Math.max(width, left + nodeWidth(node));
  }
  return { positions, width };
}
