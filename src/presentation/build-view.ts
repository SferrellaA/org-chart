import type { ChartDiff } from '../model/diff';
import type { ResolvedChart } from '../model/types';
import type { InternalRow, RenderNode, RenderView } from '../renderer/types';
import { projectHierarchy } from './hierarchy-projection';

export interface BuildRenderViewOptions {
  showInternal: boolean;
  showRelationships: boolean;
  revealedInternalIds: ReadonlySet<string>;
}

export function buildRenderView(
  chart: ResolvedChart,
  diff: ChartDiff,
  options: BuildRenderViewOptions,
): RenderView {
  const projection = projectHierarchy(chart, diff, options);
  const entriesById = new Map(projection.entries.map((entry) => [entry.id, entry]));
  const visibleIds = new Set(projection.visibleEntries.map(({ id }) => id));
  const subordinateParents = new Set(
    projection.entries
      .filter(({ relationship }) => relationship === 'subordinate')
      .map(({ parentId }) => parentId)
      .filter((id): id is string => id !== undefined),
  );
  const rows = new Map<string, InternalRow[]>();
  const hiddenCounts = new Map<string, { internal: number; changed: number }>();

  for (const entry of projection.entries) {
    if (!entry.internal) continue;
    if (visibleIds.has(entry.id)) {
      const ownerRows = rows.get(entry.outerId) ?? [];
      ownerRows.push({
        id: entry.id,
        name: entry.name,
        ...(entry.leadership ? { leadership: entry.leadership.map((item) => ({ ...item })) } : {}),
        depth: entry.internalDepth,
        diffKind: entry.diffKind,
        hasSubordinateChildren: subordinateParents.has(entry.id),
      });
      rows.set(entry.outerId, ownerRows);
    } else {
      const count = hiddenCounts.get(entry.outerId) ?? { internal: 0, changed: 0 };
      count.internal += 1;
      if (entry.diffKind !== 'unchanged') count.changed += 1;
      hiddenCounts.set(entry.outerId, count);
    }
  }

  const nodes: RenderNode[] = projection.entries
    .filter(({ internal }) => !internal)
    .map((entry) => {
      const counts = hiddenCounts.get(entry.id) ?? { internal: 0, changed: 0 };
      return {
        id: entry.id,
        name: entry.name,
        ...(entry.leadership ? { leadership: entry.leadership.map((item) => ({ ...item })) } : {}),
        ...(entry.outerParentId ? { parentId: entry.outerParentId } : {}),
        ...(entry.parentId && entriesById.get(entry.parentId)?.internal
          ? { connectorSourceId: entry.parentId }
          : {}),
        internalRows: rows.get(entry.id)?.map((row) => ({ ...row })) ?? [],
        hiddenInternalCount: counts.internal,
        hiddenChangeCount: counts.changed,
        diffKind: entry.diffKind,
        ghost: false,
      };
    });
  const outerIds = new Set(nodes.map(({ id }) => id));

  return {
    nodes,
    relationships: projection.relationships,
    searchEntries: projection.searchEntries,
    initialExpansionIds: projection.initialExpansionIds.filter((id) => outerIds.has(id)),
  };
}
