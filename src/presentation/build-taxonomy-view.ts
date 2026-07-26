import type { ChartDiff, DiffKind } from '../model/diff';
import type {
  ComparisonTier,
  LeadershipPosition,
  ResolvedChart,
  TaxonomySystem,
} from '../model/types';
import type { RenderRelationship, SearchEntry } from '../renderer/types';
import { projectHierarchy } from './hierarchy-projection';

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

function projectSide(
  chart: ResolvedChart,
  diff: ChartDiff,
  options: BuildTaxonomyRenderViewOptions,
  sharedTierOrder: readonly string[],
): { side: TaxonomyRenderSide; initialExpansionIds: readonly string[] } {
  const projection = projectHierarchy(chart, diff, {
    ...options,
    displayDiff: false,
    includeRemovedRelationships: false,
  });
  const authoredTierOrder = chart.taxonomy.comparisonTiers.map(({ id }) => id);
  const tierOrder = authoredTierOrder.length > 0 ? authoredTierOrder : sharedTierOrder;
  const tierIndex = new Map(tierOrder.map((id, index) => [id, index]));
  const placements = new Map<string, string>();
  const allNodes = new Map<string, TaxonomyRenderNode>();

  for (const entry of projection.entries) {
    const node = chart.nodes.get(entry.id)!;
    const authoredTiers = [...new Set(
      (node.resolvedTaxonomyAssignments ?? []).map(({ tierId }) => tierId),
    )];
    let tierId = authoredTiers.length === 1 ? authoredTiers[0] : undefined;
    if (tierId === undefined || !tierIndex.has(tierId)) {
      const parentTier = entry.parentId ? placements.get(entry.parentId) : undefined;
      const parentIndex = parentTier === undefined ? 0 : (tierIndex.get(parentTier) ?? 0);
      const fallbackIndex = entry.relationship === 'subordinate' ? parentIndex + 1 : parentIndex;
      tierId = tierOrder[Math.min(Math.max(fallbackIndex, 0), Math.max(tierOrder.length - 1, 0))]
        ?? '';
    }
    placements.set(entry.id, tierId);
    allNodes.set(entry.id, {
      id: entry.id,
      name: entry.name,
      ...(entry.parentId ? { parentId: entry.parentId } : {}),
      ...(entry.parentId
        ? { parentName: chart.nodes.get(entry.parentId)?.name ?? entry.parentId }
        : {}),
      tierId,
      internal: entry.internal,
      ...(entry.leadership ? { leadership: entry.leadership.map((item) => ({ ...item })) } : {}),
      diffKind: 'unchanged',
    });
  }

  const nodes = projection.visibleEntries.map((entry) => {
    const node = allNodes.get(entry.id)!;
    const connectorSourceId = entry.parentId
      ? projection.visibleAnchors.get(entry.parentId)
      : undefined;
    return {
      ...node,
      ...(connectorSourceId !== undefined && connectorSourceId !== entry.parentId
        ? { connectorSourceId }
        : {}),
    };
  });
  const visibleIds = new Set(nodes.map(({ id }) => id));
  const searchEntries = projection.searchEntries.map((entry) => ({
    ...entry,
    ownerId: projection.visibleAnchors.get(entry.id) ?? entry.ownerId,
  }));

  return {
    side: {
      systems: chart.taxonomy.systems.map((system) => ({
        ...system,
        levels: system.levels.map((level) => ({ ...level })),
      })),
      nodes,
      relationships: projection.relationships,
      searchEntries,
    },
    initialExpansionIds: projection.initialExpansionIds.filter((id) => visibleIds.has(id)),
  };
}

export function buildTaxonomyRenderView(
  _baseline: ResolvedChart,
  proposed: ResolvedChart,
  diff: ChartDiff,
  options: BuildTaxonomyRenderViewOptions,
): TaxonomyRenderView {
  const order = proposed.taxonomy.comparisonTiers.map(({ id }) => id);
  const tiers = order.map((id) => ({
    id,
    kind: 'unchanged' as const,
    proposed: proposed.taxonomy.comparisonTiers.find((tier) => tier.id === id)!,
  }));
  const { side, initialExpansionIds } = projectSide(proposed, diff, options, order);
  return {
    tiers,
    proposed: side,
    movements: [],
    searchEntries: side.searchEntries,
    initialExpansionIds,
  };
}
