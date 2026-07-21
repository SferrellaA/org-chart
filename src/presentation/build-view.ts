import type { ChartDiff, DiffKind } from '../model/diff';
import type { Relationship, ResolvedChart, ResolvedNode } from '../model/types';
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

function visibleInternalIds(
  chart: ResolvedChart,
  projections: ReadonlyMap<string, Projection>,
  options: BuildRenderViewOptions,
): Set<string> {
  const visible = new Set<string>();
  if (options.showInternal) {
    for (const [id, projection] of projections) if (projection.internal) visible.add(id);
    return visible;
  }
  for (const requested of options.revealedInternalIds) {
    let current: string | undefined = requested;
    const visited = new Set<string>();
    while (current !== undefined && !visited.has(current)) {
      visited.add(current);
      const projection = projections.get(current);
      if (!projection?.internal) break;
      visible.add(current);
      current = chart.parents.get(current)?.parent;
    }
  }
  return visible;
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

export function buildRenderView(
  chart: ResolvedChart,
  diff: ChartDiff,
  options: BuildRenderViewOptions,
): RenderView {
  const { projections, order, subordinateParents } = projectHierarchy(chart);
  const visibleInternal = visibleInternalIds(chart, projections, options);
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
      hiddenInternal: projection.internal && !visibleInternal.has(id),
    });
  }
  for (const [id, node] of ghostNodes) {
    searchEntries.push({ id, label: node.name, hiddenInternal: false });
  }

  const relationships: RenderRelationship[] = [];
  if (options.showRelationships) {
    for (const relationship of relationshipValues(chart, diff)) {
      const sourceProjection = projections.get(relationship.source);
      const targetProjection = projections.get(relationship.target);
      const sourceHidden = sourceProjection?.internal && !visibleInternal.has(relationship.source);
      const targetHidden = targetProjection?.internal && !visibleInternal.has(relationship.target);
      const source = sourceHidden ? sourceProjection.outerId : relationship.source;
      const target = targetHidden ? targetProjection.outerId : relationship.target;
      if ((!projections.has(source) && !ghostNodes.has(source)) || (!projections.has(target) && !ghostNodes.has(target))) {
        continue;
      }
      const aggregated = Boolean(sourceHidden || targetHidden);
      if (aggregated && source === target && relationship.source !== relationship.target) continue;
      relationships.push({
        id: relationship.id,
        source,
        target,
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
