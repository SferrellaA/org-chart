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

const HEADER_HEIGHT = 64;
const TIER_MIN_HEIGHT = 150;
const TIER_GAP = 18;
const TIER_LABEL_WIDTH = 120;
const SYSTEM_WIDTH = 148;

function taxonomyHeadings(view: TaxonomyRenderView): string {
  const systems = view.proposed.systems.map((system) =>
    `<strong data-taxonomy-system-heading="${escapeHtml(system.id)}">${escapeHtml(system.label)}</strong>`
  ).join('');
  return `<h2 class="org-delta-taxonomy-side-heading" data-view-side="proposed">Organization chart</h2><div class="org-delta-taxonomy-system-headings" data-view-side="proposed">${systems}</div>`;
}

function tierMarkup(view: TaxonomyRenderView, tierId: string): string {
  const tier = view.tiers.find(({ id }) => id === tierId)!;
  const systems = view.proposed.systems.map((system) => {
    const levels = system.levels
      .filter(({ tier: levelTier }) => levelTier === tierId)
      .map((level) => `<span data-taxonomy-level="${escapeHtml(level.id)}">${escapeHtml(level.label)}</span>`)
      .join('');
    return `<div class="org-delta-taxonomy-system" data-taxonomy-system="${escapeHtml(system.id)}">${levels}</div>`;
  }).join('');
  return `<section class="org-delta-taxonomy-tier org-delta-taxonomy-tier--${tier.kind}" data-taxonomy-tier="${escapeHtml(tier.id)}"><h3 class="org-delta-taxonomy-tier-label">${escapeHtml(tier.proposed?.label ?? tier.baseline?.label ?? tier.id)}</h3><div class="org-delta-taxonomy-systems" data-view-side="proposed">${systems}</div></section>`;
}

export function layoutTaxonomyView(
  view: TaxonomyRenderView,
  visibleIds: ReadonlySet<string>,
): RenderScene {
  const nodes = view.proposed.nodes.filter(({ id }) => visibleIds.has(id));
  const hierarchy = layoutTaxonomyNodes(nodes);
  const laneLeft = TIER_LABEL_WIDTH + TIER_GAP;
  const systemsWidth = view.proposed.systems.length * SYSTEM_WIDTH +
    Math.max(0, view.proposed.systems.length - 1) * 8;
  const width = Math.max(780, laneLeft + hierarchy.width + TIER_GAP + systemsWidth + 18);
  const nodesById = new Map(view.proposed.nodes.map((node) => [node.id, node]));
  const heightByTier = new Map<string, number>();
  for (const tier of view.tiers) {
    const cardHeight = nodes
      .filter(({ tierId }) => tierId === tier.id)
      .reduce((maximum, node) => Math.max(
        maximum,
        (node.internal ? 56 : 72) + (node.leadership?.length ?? 0) * 44,
      ), 0);
    heightByTier.set(tier.id, Math.max(TIER_MIN_HEIGHT, cardHeight + 48));
  }
  const topByTier = new Map<string, number>();
  let nextTop = HEADER_HEIGHT;
  for (const tier of view.tiers) {
    topByTier.set(tier.id, nextTop);
    nextTop += heightByTier.get(tier.id) ?? TIER_MIN_HEIGHT;
  }

  const sceneNodes: SceneNode[] = nodes.map((node) => ({
    key: `proposed:${node.id}`,
    id: node.id,
    ownerId: node.id,
    ...(node.connectorSourceId ?? node.parentId
      ? { parentId: node.connectorSourceId ?? node.parentId }
      : {}),
    name: node.name,
    kind: node.internal ? 'internal' : 'node',
    left: laneLeft + (hierarchy.positions.get(node.id) ?? 0),
    top: (topByTier.get(node.tierId) ?? HEADER_HEIGHT) + 24,
    width: node.internal ? INTERNAL_WIDTH : OUTER_WIDTH,
    height: (node.internal ? 56 : 72) + (node.leadership?.length ?? 0) * 44,
    markup: renderTaxonomyCard(node, 'proposed'),
    side: 'proposed',
  }));
  const connectors: SceneConnector[] = [];
  for (const node of nodes) {
    const sourceId = node.connectorSourceId ?? node.parentId;
    if (!sourceId || !visibleIds.has(sourceId)) continue;
    const source = nodesById.get(sourceId);
    const authoredParent = node.parentId ? nodesById.get(node.parentId) : source;
    const aggregation = sourceId !== node.parentId ? `, shown from ${source?.name ?? sourceId}` : '';
    connectors.push({
      key: `proposed:hierarchy:${sourceId}:${node.id}`,
      kind: 'hierarchy',
      source: { id: sourceId, kind: source?.internal ? 'internal' : 'node', side: 'proposed' },
      target: { id: node.id, kind: node.internal ? 'internal' : 'node', side: 'proposed' },
      activationId: encodeHierarchyActivationId(node.parentId ?? sourceId, node.id),
      label: `${authoredParent?.name ?? node.parentName ?? sourceId} ${node.internal ? 'internal' : 'subordinate'} relationship to ${node.name}${aggregation}`,
      side: 'proposed',
    });
  }
  for (const relationship of view.proposed.relationships) {
    const source = nodesById.get(relationship.source);
    const target = nodesById.get(relationship.target);
    if (!source || !target || !visibleIds.has(source.id) || !visibleIds.has(target.id)) continue;
    connectors.push({
      key: `proposed:relationship:${relationship.id}`,
      kind: 'relationship',
      source: { id: source.id, kind: source.internal ? 'internal' : 'node', side: 'proposed' },
      target: { id: target.id, kind: target.internal ? 'internal' : 'node', side: 'proposed' },
      activationId: relationship.id,
      label: relationship.label,
      aggregated: relationship.aggregated,
      side: 'proposed',
    });
  }
  const decorations: SceneDecoration[] = [{
    key: 'header',
    className: 'org-delta-taxonomy-header',
    left: 0,
    top: 0,
    width,
    height: HEADER_HEIGHT,
    markup: taxonomyHeadings(view),
  }];
  for (const tier of view.tiers) {
    decorations.push({
      key: `tier:${tier.id}`,
      className: 'org-delta-taxonomy-tier-decoration',
      left: 0,
      top: topByTier.get(tier.id) ?? HEADER_HEIGHT,
      width,
      height: heightByTier.get(tier.id) ?? TIER_MIN_HEIGHT,
      markup: tierMarkup(view, tier.id),
    });
  }
  return {
    width,
    height: nextTop,
    nodes: sceneNodes,
    connectors,
    decorations,
    worldAttributes: {
      'data-taxonomy-comparison': String(view.baseline !== undefined),
    },
  };
}
import type { TaxonomyRenderView } from '../presentation/build-taxonomy-view';
import { escapeHtml, renderTaxonomyCard } from './card';
import type { RenderScene, SceneConnector, SceneDecoration, SceneNode } from './scene-types';
import { encodeHierarchyActivationId } from './types';
