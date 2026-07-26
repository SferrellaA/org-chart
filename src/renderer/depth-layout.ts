import { renderDepthNodeContent } from './card';
import type { RenderScene, SceneConnector, SceneNode } from './scene-types';
import { encodeHierarchyActivationId, type RenderNode, type RenderView } from './types';

const NODE_WIDTH = 250;
const HORIZONTAL_GAP = 24;
const VERTICAL_GAP = 72;

function nodeHeight(node: RenderNode): number {
  return 72 +
    (node.leadership?.length ?? 0) * 44 +
    node.internalRows.length * 56 +
    node.internalRows.reduce(
      (sum, row) => sum + (row.leadership?.length ?? 0) * 36,
      0,
    );
}

export function layoutDepthView(
  view: RenderView,
  visibleIds: ReadonlySet<string>,
): RenderScene {
  const nodes = view.nodes.filter(({ id }) => visibleIds.has(id));
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const children = new Map<string, RenderNode[]>();
  const parentOf = new Map<string, string>();
  for (const node of nodes) {
    if (!node.parentId || !byId.has(node.parentId)) continue;
    parentOf.set(node.id, node.parentId);
    const siblings = children.get(node.parentId) ?? [];
    siblings.push(node);
    children.set(node.parentId, siblings);
  }
  const roots = nodes.filter(({ id }) => !parentOf.has(id));
  const centers = new Map<string, number>();
  let nextLeafCenter = NODE_WIDTH / 2;
  const placed = new Set<string>();
  const placeTree = (root: RenderNode): void => {
    const stack: Array<{ node: RenderNode; visited: boolean }> = [{ node: root, visited: false }];
    while (stack.length > 0) {
      const current = stack.pop()!;
      if (current.visited) {
        const descendants = children.get(current.node.id) ?? [];
        if (descendants.length === 0) {
          centers.set(current.node.id, nextLeafCenter);
          nextLeafCenter += NODE_WIDTH + HORIZONTAL_GAP;
        } else {
          centers.set(
            current.node.id,
            (centers.get(descendants[0]!.id)! + centers.get(descendants.at(-1)!.id)!) / 2,
          );
        }
        placed.add(current.node.id);
        continue;
      }
      stack.push({ ...current, visited: true });
      const descendants = children.get(current.node.id) ?? [];
      for (let index = descendants.length - 1; index >= 0; index -= 1) {
        stack.push({ node: descendants[index]!, visited: false });
      }
    }
  };
  for (const root of roots) placeTree(root);
  for (const node of nodes) if (!placed.has(node.id)) placeTree(node);

  const depths = new Map<string, number>();
  for (const node of nodes) {
    let depth = 0;
    let parentId = parentOf.get(node.id);
    const seen = new Set<string>();
    while (parentId !== undefined && !seen.has(parentId)) {
      seen.add(parentId);
      depth += 1;
      parentId = parentOf.get(parentId);
    }
    depths.set(node.id, depth);
  }
  const maxHeightByDepth = new Map<number, number>();
  for (const node of nodes) {
    const depth = depths.get(node.id) ?? 0;
    maxHeightByDepth.set(depth, Math.max(maxHeightByDepth.get(depth) ?? 0, nodeHeight(node)));
  }
  const topByDepth = new Map<number, number>([[0, 0]]);
  const maxDepth = Math.max(0, ...depths.values());
  for (let depth = 1; depth <= maxDepth; depth += 1) {
    topByDepth.set(
      depth,
      (topByDepth.get(depth - 1) ?? 0) + (maxHeightByDepth.get(depth - 1) ?? 0) + VERTICAL_GAP,
    );
  }

  const sceneNodes: SceneNode[] = nodes.map((node) => ({
    key: node.id,
    id: node.id,
    ownerId: node.id,
    ...(node.parentId ? { parentId: node.parentId } : {}),
    name: node.name,
    kind: 'node',
    left: (centers.get(node.id) ?? NODE_WIDTH / 2) - NODE_WIDTH / 2,
    top: topByDepth.get(depths.get(node.id) ?? 0) ?? 0,
    width: NODE_WIDTH,
    height: nodeHeight(node),
    markup: renderDepthNodeContent(node),
  }));
  const connectors: SceneConnector[] = [];
  for (const node of nodes) {
    const sourceId = node.connectorSourceId ?? node.parentId;
    if (!sourceId) continue;
    const sourceNode = byId.get(node.parentId ?? sourceId);
    connectors.push({
      key: `hierarchy:${sourceId}:${node.id}`,
      kind: 'hierarchy',
      source: {
        id: sourceId,
        kind: node.connectorSourceId ? 'internal' : 'node',
      },
      target: { id: node.id, kind: 'node' },
      activationId: encodeHierarchyActivationId(node.parentId ?? sourceId, node.id),
      label: `${sourceNode?.name ?? sourceId} subordinate relationship to ${node.name}`,
    });
  }
  for (const relationship of view.relationships) {
    connectors.push({
      key: `relationship:${relationship.id}`,
      kind: 'relationship',
      source: { id: relationship.source, kind: 'node' },
      target: { id: relationship.target, kind: 'node' },
      activationId: relationship.id,
      label: relationship.label,
      aggregated: relationship.aggregated,
    });
  }
  const width = Math.max(NODE_WIDTH, ...sceneNodes.map((node) => node.left + node.width));
  const height = Math.max(72, ...sceneNodes.map((node) => node.top + node.height));
  return { width, height, nodes: sceneNodes, connectors, decorations: [] };
}
