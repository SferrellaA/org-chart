import type { NodeDiff, RelationshipDiff } from '../model/diff';
import type {
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
): DetailsItem {
  const result: DetailsItem = { title, kindLabel, sources: safeSources(sources) };
  if (note !== undefined) result.note = note;
  return result;
}

export function nodeDetails(node: ResolvedNode): DetailsItem {
  return details(node.name, 'Node', node.note, node.sources);
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

export function changeDetails(change: NodeDiff | RelationshipDiff | SemanticAnnotation): DetailsItem {
  if ('kind' in change && 'changes' in change) {
    if ('before' in change || 'after' in change) {
      const value = change.after ?? change.before;
      if (value && 'name' in value) {
        return details(value.name, `${capitalize(change.kind)} node`, value.note, value.sources);
      }
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
