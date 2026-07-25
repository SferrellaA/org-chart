import type { DiffKind, LeadershipDiff, NodeChange, NodeDiff, RelationshipDiff } from '../model/diff';
import type {
  LeadershipPosition,
  PatchGroup,
  Relationship,
  ResolvedNode,
  ResolvedParent,
  SemanticAnnotation,
  Source,
} from '../model/types';

export interface DetailsItem {
  title: string;
  kindLabel: string;
  note?: string;
  leadership?: readonly string[];
  change?: { kind: DiffKind; fields: readonly NodeChange[] };
  sources: readonly Source[];
}

function safeSources(sources: readonly Source[] | undefined): Source[] {
  const result: Source[] = [];
  for (const source of sources ?? []) {
    try {
      const url = new URL(source.url);
      if (url.protocol === 'http:' || url.protocol === 'https:') {
        result.push({ label: source.label, url: source.url });
      }
    } catch {
      // Invalid URLs are display data, not exceptional control flow.
    }
  }
  return result;
}

function details(
  title: string,
  kindLabel: string,
  note: string | undefined,
  sources: readonly Source[] | undefined,
  leadership?: readonly string[],
): DetailsItem {
  const result: DetailsItem = { title, kindLabel, sources: safeSources(sources) };
  if (note !== undefined) result.note = note;
  if (leadership !== undefined && leadership.length > 0) result.leadership = [...leadership];
  return result;
}

function rankLabel(rank: LeadershipPosition['authorizedRank'] | undefined): string | undefined {
  if (!rank) return undefined;
  if (rank.label) return rank.label;
  const marker = rank.marker;
  if (!marker) return undefined;
  if (marker.type === 'text') return marker.text;
  if (marker.type === 'emoji') return marker.label;
  if (marker.type === 'image') return marker.alt;
  return marker.id;
}

function leadershipLine(position: LeadershipPosition): string {
  const primary = [rankLabel(position.authorizedRank), position.title].filter(Boolean).join(' ');
  const occupant = position.occupant
    ? [
        position.occupant.acting ? 'Acting' : undefined,
        rankLabel(position.occupant.rank),
        position.occupant.name,
      ].filter(Boolean).join(' ')
    : undefined;
  return [primary || undefined, occupant, position.vacant ? 'Vacant' : undefined]
    .filter(Boolean)
    .join('; ');
}

function leadershipLines(leadership: readonly LeadershipPosition[] | undefined): string[] {
  return (leadership ?? []).map(leadershipLine);
}

function leadershipBeforeAfter(
  before: readonly LeadershipPosition[] | undefined,
  after: readonly LeadershipPosition[] | undefined,
): string[] {
  const lines: string[] = [];
  for (const position of before ?? []) lines.push(`Before: ${leadershipLine(position)}`);
  for (const position of after ?? []) lines.push(`After: ${leadershipLine(position)}`);
  return lines;
}

function isLeadershipDiff(
  change: NodeDiff | RelationshipDiff | LeadershipDiff | SemanticAnnotation,
): change is LeadershipDiff {
  return 'changes' in change && ('beforeNodeId' in change || 'afterNodeId' in change);
}

function isNodeDiff(change: NodeDiff | RelationshipDiff): change is NodeDiff {
  return Boolean((change.before && 'name' in change.before) || (change.after && 'name' in change.after));
}

export function nodeDetails(node: ResolvedNode, change?: NodeDiff): DetailsItem {
  const result = details(node.name, 'Node', node.note, node.sources, leadershipLines(node.leadership));
  if (change && change.kind !== 'unchanged') {
    result.change = { kind: change.kind, fields: [...change.changes] };
  }
  return result;
}

export function hierarchyDetails(
  child: ResolvedNode,
  parent: ResolvedNode,
  edge: ResolvedParent,
): DetailsItem {
  const label = edge.relationship === 'internal' ? 'Internal hierarchy' : 'Subordinate hierarchy';
  return details(`${child.name} -> ${parent.name}`, label, edge.note, edge.sources);
}

export function relationshipDetails(relationship: Relationship): DetailsItem {
  return details(relationship.label, relationship.type, relationship.note, relationship.sources);
}

export function changeDetails(change: NodeDiff | RelationshipDiff | LeadershipDiff | SemanticAnnotation): DetailsItem {
  if (isLeadershipDiff(change)) {
    const lines = [
      change.before ? `Before: ${leadershipLine(change.before)}` : undefined,
      change.after ? `After: ${leadershipLine(change.after)}` : undefined,
    ].filter((line): line is string => line !== undefined);
    return details(change.id ?? 'Anonymous leadership', `${capitalize(change.kind)} leadership`, undefined, undefined, lines);
  }
  if ('kind' in change && 'changes' in change) {
    if (isNodeDiff(change)) {
      const value = change.after ?? change.before;
      if (value) {
        const leadership = change.changes.includes('leadership')
          ? leadershipBeforeAfter(change.before?.leadership, change.after?.leadership)
          : undefined;
        return details(value.name, `${capitalize(change.kind)} node`, value.note, value.sources, leadership);
      }
    } else if ('before' in change || 'after' in change) {
      const value = change.after ?? change.before;
      if (value) {
        return details(value.label, `${capitalize(change.kind)} relationship`, value.note, value.sources);
      }
    }
    return details(change.id, capitalize(change.kind), undefined, undefined);
  }
  return details(change.semantic, 'Semantic change', change.note, change.sources);
}

export function patchGroupDetails(group: PatchGroup): DetailsItem {
  return details(group.label, 'Patch group', group.note, group.sources);
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
