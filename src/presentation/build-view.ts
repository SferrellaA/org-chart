import type { ChartDiff, DiffKind } from '../model/diff';
import type { LeadershipPosition, Relationship, ResolvedChart, ResolvedNode } from '../model/types';
import type {
  InternalRow,
  RenderNode,
  RenderRelationship,
  RenderView,
  SearchEntry,
} from '../renderer/types';

export interface BuildRenderViewOptions {
  showInternal: boolean;
  showRelationships: boolean;
  revealedInternalIds: ReadonlySet<string>;
}

interface Projection {
  outerId: string;
  internal: boolean;
  internalDepth: number;
  outerDepth: number;
  parentId?: string;
  connectorSourceId?: string;
}

function kindFor(id: string, diff: ChartDiff): DiffKind {
  return diff.nodes.get(id)?.kind ?? 'unchanged';
}

function projectHierarchy(chart: ResolvedChart): {
  projections: Map<string, Projection>;
  order: string[];
  subordinateParents: Set<string>;
} {
  const children = new Map<string, string[]>();
  const subordinateParents = new Set<string>();
  for (const [child, edge] of chart.parents) {
    const siblings = children.get(edge.parent);
    if (siblings) siblings.push(child);
    else children.set(edge.parent, [child]);
    if (edge.relationship === 'subordinate') subordinateParents.add(edge.parent);
  }

  const projections = new Map<string, Projection>();
  const order: string[] = [];
  const roots = [...chart.nodes.keys()].filter((id) => {
    const parent = chart.parents.get(id)?.parent;
    return parent === undefined || !chart.nodes.has(parent);
  });
  const stack = roots.slice().reverse();

  while (stack.length > 0) {
    const id = stack.pop()!;
    if (projections.has(id)) continue;
    const edge = chart.parents.get(id);
    const parentProjection = edge ? projections.get(edge.parent) : undefined;
    let projection: Projection;
    if (!edge || !parentProjection) {
      projection = { outerId: id, internal: false, internalDepth: 0, outerDepth: 0 };
    } else if (edge.relationship === 'subordinate') {
      projection = {
        outerId: id,
        internal: false,
        internalDepth: 0,
        outerDepth: parentProjection.outerDepth + 1,
        parentId: parentProjection.outerId,
      };
      if (parentProjection.internal) projection.connectorSourceId = edge.parent;
    } else {
      projection = {
        outerId: parentProjection.outerId,
        internal: true,
        internalDepth: parentProjection.internal ? parentProjection.internalDepth + 1 : 1,
        outerDepth: parentProjection.outerDepth,
      };
    }
    projections.set(id, projection);
    order.push(id);
    const descendants = children.get(id);
    if (descendants) {
      for (let index = descendants.length - 1; index >= 0; index -= 1) {
        const child = descendants[index];
        if (child !== undefined) stack.push(child);
      }
    }
  }

  // Resolved charts are acyclic, but retaining disconnected input deterministically is safer.
  for (const id of chart.nodes.keys()) {
    if (!projections.has(id)) {
      projections.set(id, { outerId: id, internal: false, internalDepth: 0, outerDepth: 0 });
      order.push(id);
    }
  }
  return { projections, order, subordinateParents };
}

function projectVisibility(
  chart: ResolvedChart,
  projections: ReadonlyMap<string, Projection>,
  order: readonly string[],
  options: BuildRenderViewOptions,
): { visibleInternal: Set<string>; visibleAnchors: Map<string, string> } {
  const visible = new Set<string>();
  if (options.showInternal) {
    for (const [id, projection] of projections) if (projection.internal) visible.add(id);
  } else {
    for (const requested of options.revealedInternalIds) {
      if (projections.get(requested)?.internal) visible.add(requested);
    }
    for (let index = order.length - 1; index >= 0; index -= 1) {
      const id = order[index];
      if (id === undefined || !visible.has(id)) continue;
      const parent = chart.parents.get(id)?.parent;
      if (parent !== undefined && projections.get(parent)?.internal) visible.add(parent);
    }
  }

  const visibleAnchors = new Map<string, string>();
  for (const id of order) {
    const projection = projections.get(id)!;
    if (!projection.internal || visible.has(id)) {
      visibleAnchors.set(id, id);
      continue;
    }
    const parent = chart.parents.get(id)?.parent;
    visibleAnchors.set(id, (parent && visibleAnchors.get(parent)) ?? projection.outerId);
  }
  return { visibleInternal: visible, visibleAnchors };
}

function relationshipValues(chart: ResolvedChart, diff: ChartDiff): Relationship[] {
  const result = [...chart.relationships.values()];
  for (const [id, item] of diff.relationships) {
    if (!chart.relationships.has(id) && item.kind === 'removed' && item.before) {
      result.push(item.before);
    }
  }
  return result;
}

function cloneLeadership(leadership: readonly LeadershipPosition[] | undefined): LeadershipPosition[] | undefined {
  return leadership?.map((position) => ({
    ...position,
    ...(position.authorizedRank
      ? {
          authorizedRank: {
            ...position.authorizedRank,
            ...(position.authorizedRank.marker ? { marker: { ...position.authorizedRank.marker } } : {}),
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
                    ...(position.occupant.rank.marker ? { marker: { ...position.occupant.rank.marker } } : {}),
                  },
                }
              : {}),
          },
        }
      : {}),
  }));
}

function relationshipLineage(
  anchor: string,
  projections: ReadonlyMap<string, Projection>,
): string[] {
  const lineage = [anchor];
  const anchorProjection = projections.get(anchor);
  if (!anchorProjection) return lineage;
  let outer = anchorProjection.outerId;
  if (outer !== anchor) lineage.push(outer);
  const visited = new Set(lineage);
  while (true) {
    const parent = projections.get(outer)?.parentId;
    if (parent === undefined || visited.has(parent)) break;
    lineage.push(parent);
    visited.add(parent);
    outer = parent;
  }
  return lineage;
}

export function buildRenderView(
  chart: ResolvedChart,
  diff: ChartDiff,
  options: BuildRenderViewOptions,
): RenderView {
  const { projections, order, subordinateParents } = projectHierarchy(chart);
  const { visibleInternal, visibleAnchors } = projectVisibility(
    chart,
    projections,
    order,
    options,
  );
  const rows = new Map<string, InternalRow[]>();
  const hiddenCounts = new Map<string, { internal: number; changed: number }>();

  for (const id of order) {
    const projection = projections.get(id)!;
    if (!projection.internal) continue;
    const node = chart.nodes.get(id)!;
    if (visibleInternal.has(id)) {
      const ownerRows = rows.get(projection.outerId) ?? [];
      ownerRows.push({
        id,
        name: node.name,
        ...(node.leadership ? { leadership: cloneLeadership(node.leadership)! } : {}),
        depth: projection.internalDepth,
        diffKind: kindFor(id, diff),
        hasSubordinateChildren: subordinateParents.has(id),
      });
      rows.set(projection.outerId, ownerRows);
    } else {
      const count = hiddenCounts.get(projection.outerId) ?? { internal: 0, changed: 0 };
      count.internal += 1;
      if (kindFor(id, diff) !== 'unchanged') count.changed += 1;
      hiddenCounts.set(projection.outerId, count);
    }
  }

  const nodes: RenderNode[] = [];
  for (const id of order) {
    const projection = projections.get(id)!;
    if (projection.internal) continue;
    const node = chart.nodes.get(id)!;
    const counts = hiddenCounts.get(id) ?? { internal: 0, changed: 0 };
    const rendered: RenderNode = {
      id,
      name: node.name,
      ...(node.leadership ? { leadership: cloneLeadership(node.leadership)! } : {}),
      internalRows: rows.get(id)?.map((row) => ({ ...row })) ?? [],
      hiddenInternalCount: counts.internal,
      hiddenChangeCount: counts.changed,
      diffKind: kindFor(id, diff),
      ghost: false,
    };
    if (projection.parentId !== undefined) rendered.parentId = projection.parentId;
    if (projection.connectorSourceId !== undefined) {
      rendered.connectorSourceId = projection.connectorSourceId;
    }
    nodes.push(rendered);
  }

  const ghostNodes = new Map<string, ResolvedNode>();
  for (const [id, item] of diff.nodes) {
    if (!chart.nodes.has(id) && item.kind === 'removed' && item.before) {
      ghostNodes.set(id, item.before);
      nodes.push({
        id,
        name: item.before.name,
        ...(item.before.leadership ? { leadership: cloneLeadership(item.before.leadership)! } : {}),
        internalRows: [],
        hiddenInternalCount: 0,
        hiddenChangeCount: 0,
        diffKind: 'removed',
        ghost: true,
      });
    }
  }

  const searchEntries: SearchEntry[] = [];
  for (const [id, node] of chart.nodes) {
    const projection = projections.get(id)!;
    searchEntries.push({
      id,
      label: node.name,
      aliases: node.aliases ? [...node.aliases] : [],
      hiddenInternal: projection.internal && !visibleInternal.has(id),
      ownerId: projection.outerId,
    });
  }
  for (const [id, node] of ghostNodes) {
    searchEntries.push({
      id,
      label: node.name,
      aliases: node.aliases ? [...node.aliases] : [],
      hiddenInternal: false,
      ownerId: id,
    });
  }

  const relationships: RenderRelationship[] = [];
  if (options.showRelationships) {
    for (const relationship of relationshipValues(chart, diff)) {
      const source = visibleAnchors.get(relationship.source) ?? relationship.source;
      const target = visibleAnchors.get(relationship.target) ?? relationship.target;
      if ((!projections.has(source) && !ghostNodes.has(source)) || (!projections.has(target) && !ghostNodes.has(target))) {
        continue;
      }
      const aggregated = source !== relationship.source || target !== relationship.target;
      if (aggregated && source === target && relationship.source !== relationship.target) continue;
      relationships.push({
        id: relationship.id,
        source,
        target,
        sourceAncestors: relationshipLineage(source, projections),
        targetAncestors: relationshipLineage(target, projections),
        label: relationship.label,
        type: relationship.type,
        aggregated,
        diffKind: diff.relationships.get(relationship.id)?.kind ?? 'unchanged',
      });
    }
  }

  const initial = new Set<string>();
  const initialDepth = chart.presentation.initialExpansionDepth ?? 2;
  for (const [id, projection] of projections) {
    if (!projection.internal && projection.outerDepth <= initialDepth) initial.add(id);
  }
  for (const focus of chart.presentation.focusNodes ?? []) {
    let current = projections.get(focus)?.outerId;
    const visited = new Set<string>();
    while (current !== undefined && !visited.has(current)) {
      visited.add(current);
      initial.add(current);
      current = projections.get(current)?.parentId;
    }
  }
  const initialExpansionIds = nodes.filter((node) => initial.has(node.id)).map((node) => node.id);

  return { nodes, relationships, searchEntries, initialExpansionIds };
}
