import type { ChartDiff, DiffKind } from '../model/diff';
import type {
  LeadershipPosition,
  Relationship,
  ResolvedChart,
} from '../model/types';
import type { RenderRelationship, SearchEntry } from '../renderer/types';

export interface ProjectedHierarchyEntry {
  id: string;
  name: string;
  aliases: readonly string[];
  parentId?: string;
  relationship?: 'internal' | 'subordinate';
  internal: boolean;
  internalDepth: number;
  outerId: string;
  outerDepth: number;
  outerParentId?: string;
  leadership?: readonly LeadershipPosition[];
  diffKind: DiffKind;
}

export interface HierarchyProjectionOptions {
  showInternal: boolean;
  showRelationships: boolean;
  revealedInternalIds: ReadonlySet<string>;
  displayDiff?: boolean;
  includeRemovedRelationships?: boolean;
}

export interface HierarchyProjection {
  entries: readonly ProjectedHierarchyEntry[];
  visibleEntries: readonly ProjectedHierarchyEntry[];
  visibleAnchors: ReadonlyMap<string, string>;
  relationships: readonly RenderRelationship[];
  searchEntries: readonly SearchEntry[];
  initialExpansionIds: readonly string[];
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

function relationshipValues(
  chart: ResolvedChart,
  diff: ChartDiff,
  includeRemoved: boolean,
): Relationship[] {
  const result = [...chart.relationships.values()];
  if (!includeRemoved) return result;
  for (const [id, item] of diff.relationships) {
    if (!chart.relationships.has(id) && item.kind === 'removed' && item.before) {
      result.push(item.before);
    }
  }
  return result;
}

function relationshipLineage(
  anchor: string,
  entries: ReadonlyMap<string, ProjectedHierarchyEntry>,
): string[] {
  const lineage = [anchor];
  const entry = entries.get(anchor);
  if (!entry) return lineage;
  let outer = entry.outerId;
  if (outer !== anchor) lineage.push(outer);
  const seen = new Set(lineage);
  while (true) {
    const parent = entries.get(outer)?.outerParentId;
    if (parent === undefined || seen.has(parent)) break;
    lineage.push(parent);
    seen.add(parent);
    outer = parent;
  }
  return lineage;
}

export function projectHierarchy(
  chart: ResolvedChart,
  diff: ChartDiff,
  options: HierarchyProjectionOptions,
): HierarchyProjection {
  const children = new Map<string, string[]>();
  for (const [child, edge] of chart.parents) {
    const siblings = children.get(edge.parent) ?? [];
    siblings.push(child);
    children.set(edge.parent, siblings);
  }

  const order: string[] = [];
  const entriesById = new Map<string, ProjectedHierarchyEntry>();
  const roots = [...chart.nodes.keys()].filter((id) => {
    const parent = chart.parents.get(id)?.parent;
    return parent === undefined || !chart.nodes.has(parent);
  });
  const stack = roots.slice().reverse();
  while (stack.length > 0) {
    const id = stack.pop()!;
    if (entriesById.has(id)) continue;
    const node = chart.nodes.get(id);
    if (!node) continue;
    const edge = chart.parents.get(id);
    const parent = edge ? entriesById.get(edge.parent) : undefined;
    const internal = edge?.relationship === 'internal' && parent !== undefined;
    const entry: ProjectedHierarchyEntry = {
      id,
      name: node.name,
      aliases: node.aliases ? [...node.aliases] : [],
      ...(edge ? { parentId: edge.parent, relationship: edge.relationship } : {}),
      internal,
      internalDepth: internal ? (parent.internal ? parent.internalDepth + 1 : 1) : 0,
      outerId: internal ? parent.outerId : id,
      outerDepth: parent
        ? parent.outerDepth + (edge?.relationship === 'subordinate' ? 1 : 0)
        : 0,
      ...(parent && !internal ? { outerParentId: parent.outerId } : {}),
      ...(node.leadership ? { leadership: cloneLeadership(node.leadership)! } : {}),
      diffKind: options.displayDiff === false
        ? 'unchanged'
        : (diff.nodes.get(id)?.kind ?? 'unchanged'),
    };
    entriesById.set(id, entry);
    order.push(id);
    const descendants = children.get(id) ?? [];
    for (let index = descendants.length - 1; index >= 0; index -= 1) {
      stack.push(descendants[index]!);
    }
  }
  for (const [id, node] of chart.nodes) {
    if (entriesById.has(id)) continue;
    const entry: ProjectedHierarchyEntry = {
      id,
      name: node.name,
      aliases: node.aliases ? [...node.aliases] : [],
      internal: false,
      internalDepth: 0,
      outerId: id,
      outerDepth: 0,
      ...(node.leadership ? { leadership: cloneLeadership(node.leadership)! } : {}),
      diffKind: options.displayDiff === false
        ? 'unchanged'
        : (diff.nodes.get(id)?.kind ?? 'unchanged'),
    };
    entriesById.set(id, entry);
    order.push(id);
  }
  const entries = order.map((id) => entriesById.get(id)!);

  const visibleInternal = new Set<string>();
  if (options.showInternal) {
    for (const entry of entries) if (entry.internal) visibleInternal.add(entry.id);
  } else {
    for (const id of options.revealedInternalIds) {
      if (entriesById.get(id)?.internal) visibleInternal.add(id);
    }
    for (let index = order.length - 1; index >= 0; index -= 1) {
      const id = order[index]!;
      if (!visibleInternal.has(id)) continue;
      const parentId = entriesById.get(id)?.parentId;
      if (parentId && entriesById.get(parentId)?.internal) visibleInternal.add(parentId);
    }
  }

  const visibleAnchors = new Map<string, string>();
  for (const entry of entries) {
    if (!entry.internal || visibleInternal.has(entry.id)) {
      visibleAnchors.set(entry.id, entry.id);
    } else {
      visibleAnchors.set(
        entry.id,
        (entry.parentId && visibleAnchors.get(entry.parentId)) ?? entry.outerId,
      );
    }
  }
  const visibleEntries = entries.filter((entry) =>
    !entry.internal || visibleInternal.has(entry.id)
  );
  const searchEntries: SearchEntry[] = entries.map((entry) => ({
    id: entry.id,
    label: entry.name,
    aliases: [...entry.aliases],
    hiddenInternal: entry.internal && !visibleInternal.has(entry.id),
    ownerId: entry.outerId,
  }));

  const relationships: RenderRelationship[] = [];
  if (options.showRelationships) {
    for (const relationship of relationshipValues(
      chart,
      diff,
      options.includeRemovedRelationships ?? options.displayDiff !== false,
    )) {
      const source = visibleAnchors.get(relationship.source) ?? relationship.source;
      const target = visibleAnchors.get(relationship.target) ?? relationship.target;
      if (!entriesById.has(source) || !entriesById.has(target)) continue;
      const aggregated = source !== relationship.source || target !== relationship.target;
      if (aggregated && source === target && relationship.source !== relationship.target) continue;
      relationships.push({
        id: relationship.id,
        source,
        target,
        sourceAncestors: relationshipLineage(source, entriesById),
        targetAncestors: relationshipLineage(target, entriesById),
        label: relationship.label,
        type: relationship.type,
        aggregated,
        diffKind: options.displayDiff === false
          ? 'unchanged'
          : (diff.relationships.get(relationship.id)?.kind ?? 'unchanged'),
      });
    }
  }

  const initial = new Set<string>();
  const initialDepth = chart.presentation.initialExpansionDepth ?? 2;
  for (const entry of entries) {
    if (entry.outerDepth <= initialDepth) initial.add(entry.id);
  }
  for (const focusId of chart.presentation.focusNodes ?? []) {
    let current: string | undefined = focusId;
    const seen = new Set<string>();
    while (current !== undefined && !seen.has(current)) {
      seen.add(current);
      if (entriesById.has(current)) initial.add(current);
      current = entriesById.get(current)?.parentId;
    }
  }

  return {
    entries,
    visibleEntries,
    visibleAnchors,
    relationships,
    searchEntries,
    initialExpansionIds: [...initial],
  };
}
