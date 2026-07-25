import type { ChartDiff, DiffKind } from '../model/diff';
import type {
  ComparisonTier,
  LeadershipPosition,
  ResolvedChart,
  TaxonomySystem,
} from '../model/types';
import type { RenderRelationship, SearchEntry } from '../renderer/types';

export interface BuildTaxonomyRenderViewOptions {
  comparison: boolean;
  showInternal: boolean;
  showRelationships: boolean;
  revealedInternalIds: ReadonlySet<string>;
}

export interface TaxonomyTierRow {
  id: string;
  kind: DiffKind;
  baseline?: ComparisonTier;
  proposed?: ComparisonTier;
}

export interface TaxonomyRenderView {
  tiers: readonly TaxonomyTierRow[];
  baseline?: TaxonomyRenderSide;
  proposed: TaxonomyRenderSide;
  movements: readonly TaxonomyMovement[];
  searchEntries: readonly SearchEntry[];
  initialExpansionIds: readonly string[];
}

export interface TaxonomyRenderNode {
  id: string;
  name: string;
  parentId?: string;
  parentName?: string;
  connectorSourceId?: string;
  tierId: string;
  internal: boolean;
  leadership?: readonly LeadershipPosition[];
  diffKind: DiffKind;
}

export interface TaxonomyRenderSide {
  systems: readonly TaxonomySystem[];
  nodes: readonly TaxonomyRenderNode[];
  relationships: readonly RenderRelationship[];
  searchEntries: readonly SearchEntry[];
}

export interface TaxonomyMovement {
  nodeId: string;
  fromTierId: string;
  toTierId: string;
}

function hierarchyOrder(chart: ResolvedChart): string[] {
  const children = new Map<string, string[]>();
  for (const [child, edge] of chart.parents) {
    const values = children.get(edge.parent) ?? [];
    values.push(child);
    children.set(edge.parent, values);
  }
  const roots = [...chart.nodes.keys()].filter((id) => {
    const parent = chart.parents.get(id)?.parent;
    return parent === undefined || !chart.nodes.has(parent);
  });
  const order: string[] = [];
  const seen = new Set<string>();
  const stack = roots.slice().reverse();
  while (stack.length > 0) {
    const id = stack.pop()!;
    if (seen.has(id)) continue;
    seen.add(id);
    order.push(id);
    const descendants = children.get(id) ?? [];
    for (let index = descendants.length - 1; index >= 0; index -= 1) {
      stack.push(descendants[index]!);
    }
  }
  for (const id of chart.nodes.keys()) if (!seen.has(id)) order.push(id);
  return order;
}

function cloneLeadership(
  leadership: readonly LeadershipPosition[] | undefined,
): LeadershipPosition[] | undefined {
  return leadership?.map((position) => ({
    ...position,
    ...(position.authorizedRank
      ? {
          authorizedRank: {
            ...position.authorizedRank,
            ...(position.authorizedRank.marker
              ? { marker: { ...position.authorizedRank.marker } }
              : {}),
          },
        }
      : {}),
    ...(position.occupant
      ? {
          occupant: {
            ...position.occupant,
            ...(position.occupant.rank
              ? {
                  rank: {
                    ...position.occupant.rank,
                    ...(position.occupant.rank.marker
                      ? { marker: { ...position.occupant.rank.marker } }
                      : {}),
                  },
                }
              : {}),
          },
        }
      : {}),
  }));
}

function projectSide(
  chart: ResolvedChart,
  diff: ChartDiff,
  options: BuildTaxonomyRenderViewOptions,
  sharedTierOrder: readonly string[],
): TaxonomyRenderSide {
  const authoredTierOrder = chart.taxonomy.comparisonTiers.map(({ id }) => id);
  const tierOrder = authoredTierOrder.length > 0 ? authoredTierOrder : sharedTierOrder;
  const tierIndex = new Map(tierOrder.map((id, index) => [id, index]));
  const placements = new Map<string, string>();
  const allNodes: TaxonomyRenderNode[] = [];
  for (const id of hierarchyOrder(chart)) {
    const node = chart.nodes.get(id)!;
    const edge = chart.parents.get(id);
    const authoredTiers = [...new Set(
      (node.resolvedTaxonomyAssignments ?? []).map(({ tierId }) => tierId),
    )];
    let tierId = authoredTiers.length === 1 ? authoredTiers[0] : undefined;
    if (tierId === undefined || !tierIndex.has(tierId)) {
      const parentTier = edge ? placements.get(edge.parent) : undefined;
      const parentIndex = parentTier === undefined ? 0 : (tierIndex.get(parentTier) ?? 0);
      const fallbackIndex = edge?.relationship === 'subordinate' ? parentIndex + 1 : parentIndex;
      tierId = tierOrder[Math.min(Math.max(fallbackIndex, 0), Math.max(tierOrder.length - 1, 0))]
        ?? '';
    }
    placements.set(id, tierId);
    allNodes.push({
      id,
      name: node.name,
      ...(edge ? { parentId: edge.parent } : {}),
      ...(edge ? { parentName: chart.nodes.get(edge.parent)?.name ?? edge.parent } : {}),
      tierId,
      internal: edge?.relationship === 'internal',
      ...(node.leadership ? { leadership: cloneLeadership(node.leadership)! } : {}),
      diffKind: diff.nodes.get(id)?.kind ?? 'unchanged',
    });
  }
  const visibleInternal = new Set<string>();
  if (options.showInternal) {
    for (const node of allNodes) if (node.internal) visibleInternal.add(node.id);
  } else {
    for (const requested of options.revealedInternalIds) {
      if (chart.parents.get(requested)?.relationship === 'internal') visibleInternal.add(requested);
    }
    for (const id of hierarchyOrder(chart).reverse()) {
      if (!visibleInternal.has(id)) continue;
      const parent = chart.parents.get(id)?.parent;
      if (parent && chart.parents.get(parent)?.relationship === 'internal') {
        visibleInternal.add(parent);
      }
    }
  }
  const visibleIds = new Set(allNodes
    .filter((node) => !node.internal || visibleInternal.has(node.id))
    .map(({ id }) => id));
  const visibleAnchor = (id: string): string => {
    const seen = new Set<string>();
    let current = id;
    while (!visibleIds.has(current) && !seen.has(current)) {
      seen.add(current);
      const parent = chart.parents.get(current)?.parent;
      if (parent === undefined) break;
      current = parent;
    }
    return current;
  };
  const nodes = allNodes
    .filter(({ id }) => visibleIds.has(id))
    .map((node) => {
      const parent = node.parentId;
      const connectorSourceId = parent === undefined ? undefined : visibleAnchor(parent);
      return {
        ...node,
        ...(connectorSourceId !== undefined && connectorSourceId !== parent
          ? { connectorSourceId }
          : {}),
      };
    });
  const relationships: RenderRelationship[] = [];
  if (options.showRelationships) {
    for (const relationship of chart.relationships.values()) {
      const source = visibleAnchor(relationship.source);
      const target = visibleAnchor(relationship.target);
      const aggregated = source !== relationship.source || target !== relationship.target;
      if (aggregated && source === target && relationship.source !== relationship.target) continue;
      relationships.push({
        id: relationship.id,
        source,
        target,
        sourceAncestors: [source],
        targetAncestors: [target],
        label: relationship.label,
        type: relationship.type,
        aggregated,
        diffKind: diff.relationships.get(relationship.id)?.kind ?? 'unchanged',
      });
    }
  }
  const searchEntries = [...chart.nodes].map(([id, node]) => ({
    id,
    label: node.name,
    aliases: node.aliases ? [...node.aliases] : [],
    hiddenInternal: !visibleIds.has(id),
    ownerId: visibleAnchor(id),
  }));
  return {
    systems: chart.taxonomy.systems.map((system) => ({
      ...system,
      levels: system.levels.map((level) => ({ ...level })),
    })),
    nodes,
    relationships,
    searchEntries,
  };
}

export function buildTaxonomyRenderView(
  baseline: ResolvedChart,
  proposed: ResolvedChart,
  diff: ChartDiff,
  options: BuildTaxonomyRenderViewOptions,
): TaxonomyRenderView {
  const baselineById = new Map(baseline.taxonomy.comparisonTiers.map((tier) => [tier.id, tier]));
  const proposedById = new Map(proposed.taxonomy.comparisonTiers.map((tier) => [tier.id, tier]));
  const baselineOrder = baseline.taxonomy.comparisonTiers.map(({ id }) => id);
  const order = proposed.taxonomy.comparisonTiers.map(({ id }) => id);

  for (let baselineIndex = 0; baselineIndex < baselineOrder.length; baselineIndex += 1) {
    const id = baselineOrder[baselineIndex]!;
    if (proposedById.has(id)) continue;
    const preceding = baselineOrder.slice(0, baselineIndex).reverse()
      .find((candidate) => order.includes(candidate));
    if (preceding !== undefined) {
      order.splice(order.indexOf(preceding) + 1, 0, id);
      continue;
    }
    const following = baselineOrder.slice(baselineIndex + 1)
      .find((candidate) => order.includes(candidate));
    order.splice(following === undefined ? order.length : order.indexOf(following), 0, id);
  }

  const tiers = order.map((id) => ({
      id,
      kind: diff.taxonomy.comparisonTiers.get(id)?.kind ?? 'unchanged',
      ...(baselineById.has(id) ? { baseline: baselineById.get(id)! } : {}),
      ...(proposedById.has(id) ? { proposed: proposedById.get(id)! } : {}),
    }));
  const baselineSide = projectSide(baseline, diff, options, order);
  const proposedSide = projectSide(proposed, diff, options, order);
  const baselineNodes = new Map(baselineSide.nodes.map((node) => [node.id, node]));
  const movements = options.comparison
    ? proposedSide.nodes.flatMap((node) => {
        const before = baselineNodes.get(node.id);
        return before && before.tierId !== node.tierId
          ? [{ nodeId: node.id, fromTierId: before.tierId, toTierId: node.tierId }]
          : [];
      })
    : [];
  const initial = new Set<string>();
  const initialDepth = proposed.presentation.initialExpansionDepth ?? 2;
  const addInitialDepth = (chart: ResolvedChart, side: TaxonomyRenderSide): void => {
    const depth = new Map<string, number>();
    for (const id of hierarchyOrder(chart)) {
      const edge = chart.parents.get(id);
      const parentDepth = edge ? (depth.get(edge.parent) ?? 0) : 0;
      depth.set(id, edge?.relationship === 'subordinate' ? parentDepth + 1 : parentDepth);
    }
    for (const node of side.nodes) {
      if ((depth.get(node.id) ?? 0) <= initialDepth) initial.add(node.id);
    }
  };
  if (options.comparison) addInitialDepth(baseline, baselineSide);
  addInitialDepth(proposed, proposedSide);
  const proposedNodes = new Map(proposedSide.nodes.map((node) => [node.id, node]));
  for (const focusId of proposed.presentation.focusNodes ?? []) {
    let current = proposedSide.searchEntries.find(({ id }) => id === focusId)?.ownerId;
    const seen = new Set<string>();
    while (current && !seen.has(current)) {
      seen.add(current);
      initial.add(current);
      const node = proposedNodes.get(current);
      current = node?.connectorSourceId ?? node?.parentId;
    }
  }
  const proposedSearchIds = new Set(proposedSide.searchEntries.map(({ id }) => id));
  const searchEntries = options.comparison
    ? [
        ...proposedSide.searchEntries,
        ...baselineSide.searchEntries.filter(({ id }) => !proposedSearchIds.has(id)),
      ]
    : proposedSide.searchEntries;
  return {
    tiers,
    ...(options.comparison ? { baseline: baselineSide } : {}),
    proposed: proposedSide,
    movements,
    searchEntries,
    initialExpansionIds: [...initial],
  };
}
