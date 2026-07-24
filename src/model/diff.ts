import type {
  LeadershipPosition,
  Relationship,
  ResolvedChart,
  ResolvedNode,
  ResolvedParent,
  SemanticAnnotation,
  Source,
} from './types';

export type DiffKind = 'added' | 'removed' | 'modified' | 'unchanged';

export type NodeChange =
  | 'name'
  | 'note'
  | 'metadata'
  | 'leadership'
  | 'parent'
  | 'relationship'
  | 'edgeMetadata';

export interface NodeDiff {
  id: string;
  kind: DiffKind;
  before?: ResolvedNode;
  after?: ResolvedNode;
  changes: readonly NodeChange[];
}

export type RelationshipChange =
  | 'type'
  | 'source'
  | 'target'
  | 'label'
  | 'note'
  | 'sources';

export interface RelationshipDiff {
  id: string;
  kind: DiffKind;
  before?: Relationship;
  after?: Relationship;
  changes: readonly RelationshipChange[];
}

export type LeadershipChange =
  | 'node'
  | 'order'
  | 'title'
  | 'authorizedRank'
  | 'occupant'
  | 'vacant'
  | 'anonymous';

export interface LeadershipDiff {
  id?: string;
  kind: DiffKind;
  beforeNodeId?: string;
  afterNodeId?: string;
  before?: LeadershipPosition;
  after?: LeadershipPosition;
  changes: readonly LeadershipChange[];
}

export interface DiffSummary {
  /** Counts node diff kinds only; relationship diffs remain in their separate map. */
  added: number;
  removed: number;
  modified: number;
  unchanged: number;
}

export interface ChartDiff {
  nodes: ReadonlyMap<string, NodeDiff>;
  relationships: ReadonlyMap<string, RelationshipDiff>;
  leadership: readonly LeadershipDiff[];
  annotations: readonly SemanticAnnotation[];
  summary: DiffSummary;
}

function cloneSources(sources: readonly Source[]): Source[];
function cloneSources(sources: undefined): undefined;
function cloneSources(sources: readonly Source[] | undefined): Source[] | undefined;
function cloneSources(sources: readonly Source[] | undefined): Source[] | undefined {
  return sources?.map((source) => ({ label: source.label, url: source.url }));
}

function cloneLeadershipPosition(position: LeadershipPosition): LeadershipPosition {
  return {
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
  };
}

function cloneLeadership(leadership: readonly LeadershipPosition[] | undefined): LeadershipPosition[] | undefined {
  return leadership?.map(cloneLeadershipPosition);
}

function cloneNode(node: ResolvedNode): ResolvedNode {
  const clone: ResolvedNode = { id: node.id, name: node.name };
  if (node.note !== undefined) clone.note = node.note;
  if (node.sources !== undefined) clone.sources = cloneSources(node.sources);
  if (node.metadata !== undefined) clone.metadata = { ...node.metadata };
  if (node.aliases !== undefined) clone.aliases = [...node.aliases];
  if (node.symbol !== undefined) clone.symbol = { ...node.symbol };
  if (node.leadership !== undefined) clone.leadership = cloneLeadership(node.leadership)!;
  return clone;
}

function cloneRelationship(relationship: Relationship): Relationship {
  const clone: Relationship = {
    id: relationship.id,
    type: relationship.type,
    source: relationship.source,
    target: relationship.target,
    label: relationship.label,
  };
  if (relationship.note !== undefined) clone.note = relationship.note;
  if (relationship.sources !== undefined) clone.sources = cloneSources(relationship.sources);
  return clone;
}

function cloneAnnotation(annotation: SemanticAnnotation): SemanticAnnotation {
  const clone: SemanticAnnotation = {
    semantic: annotation.semantic,
    nodes: [...annotation.nodes],
  };
  if (annotation.note !== undefined) clone.note = annotation.note;
  if (annotation.sources !== undefined) clone.sources = cloneSources(annotation.sources);
  return clone;
}

function valuesEqual(first: unknown, second: unknown): boolean {
  if (Object.is(first, second)) return true;
  if (typeof first !== typeof second || first === null || second === null) return false;
  if (Array.isArray(first) || Array.isArray(second)) {
    return (
      Array.isArray(first) &&
      Array.isArray(second) &&
      first.length === second.length &&
      first.every((value, index) => valuesEqual(value, second[index]))
    );
  }
  if (typeof first !== 'object') return false;
  const firstRecord = first as Record<string, unknown>;
  const secondRecord = second as Record<string, unknown>;
  const firstKeys = Object.keys(firstRecord);
  return (
    firstKeys.length === Object.keys(secondRecord).length &&
    firstKeys.every(
      (key) => Object.hasOwn(secondRecord, key) && valuesEqual(firstRecord[key], secondRecord[key]),
    )
  );
}

function nodeChanges(
  before: ResolvedNode,
  after: ResolvedNode,
  beforeParent: ResolvedParent | undefined,
  afterParent: ResolvedParent | undefined,
): NodeChange[] {
  const changes: NodeChange[] = [];
  if (before.name !== after.name) changes.push('name');
  if (before.note !== after.note) changes.push('note');
  if (!valuesEqual(before.metadata, after.metadata)) changes.push('metadata');
  if (!valuesEqual(before.leadership, after.leadership)) changes.push('leadership');
  if (beforeParent?.parent !== afterParent?.parent) changes.push('parent');
  if (beforeParent?.relationship !== afterParent?.relationship) changes.push('relationship');
  if (
    beforeParent?.note !== afterParent?.note ||
    !valuesEqual(beforeParent?.sources, afterParent?.sources)
  ) {
    changes.push('edgeMetadata');
  }
  return changes;
}

function relationshipChanges(before: Relationship, after: Relationship): RelationshipChange[] {
  const changes: RelationshipChange[] = [];
  if (before.type !== after.type) changes.push('type');
  if (before.source !== after.source) changes.push('source');
  if (before.target !== after.target) changes.push('target');
  if (before.label !== after.label) changes.push('label');
  if (before.note !== after.note) changes.push('note');
  if (!valuesEqual(before.sources, after.sources)) changes.push('sources');
  return changes;
}

function diffNodes(before: ResolvedChart, after: ResolvedChart): Map<string, NodeDiff> {
  const result = new Map<string, NodeDiff>();
  for (const [id, beforeNode] of before.nodes) {
    const afterNode = after.nodes.get(id);
    if (!afterNode) {
      result.set(id, { id, kind: 'removed', before: cloneNode(beforeNode), changes: [] });
      continue;
    }
    const changes = nodeChanges(beforeNode, afterNode, before.parents.get(id), after.parents.get(id));
    result.set(id, {
      id,
      kind: changes.length === 0 ? 'unchanged' : 'modified',
      before: cloneNode(beforeNode),
      after: cloneNode(afterNode),
      changes,
    });
  }
  for (const [id, afterNode] of after.nodes) {
    if (!before.nodes.has(id)) {
      result.set(id, { id, kind: 'added', after: cloneNode(afterNode), changes: [] });
    }
  }
  return result;
}

function diffRelationships(before: ResolvedChart, after: ResolvedChart): Map<string, RelationshipDiff> {
  const result = new Map<string, RelationshipDiff>();
  for (const [id, beforeRelationship] of before.relationships) {
    const afterRelationship = after.relationships.get(id);
    if (!afterRelationship) {
      result.set(id, {
        id,
        kind: 'removed',
        before: cloneRelationship(beforeRelationship),
        changes: [],
      });
      continue;
    }
    const changes = relationshipChanges(beforeRelationship, afterRelationship);
    result.set(id, {
      id,
      kind: changes.length === 0 ? 'unchanged' : 'modified',
      before: cloneRelationship(beforeRelationship),
      after: cloneRelationship(afterRelationship),
      changes,
    });
  }
  for (const [id, afterRelationship] of after.relationships) {
    if (!before.relationships.has(id)) {
      result.set(id, {
        id,
        kind: 'added',
        after: cloneRelationship(afterRelationship),
        changes: [],
      });
    }
  }
  return result;
}

interface IndexedLeadership {
  nodeId: string;
  index: number;
  position: LeadershipPosition;
}

function indexedLeadership(chart: ResolvedChart): {
  identified: Map<string, IndexedLeadership>;
  anonymousByNode: Map<string, LeadershipPosition[]>;
} {
  const identified = new Map<string, IndexedLeadership>();
  const anonymousByNode = new Map<string, LeadershipPosition[]>();
  for (const [nodeId, node] of chart.nodes) {
    node.leadership?.forEach((position, index) => {
      if (position.id) {
        identified.set(position.id, { nodeId, index, position });
      } else {
        const anonymous = anonymousByNode.get(nodeId) ?? [];
        anonymous.push(position);
        anonymousByNode.set(nodeId, anonymous);
      }
    });
  }
  return { identified, anonymousByNode };
}

function leadershipChanges(before: IndexedLeadership, after: IndexedLeadership): LeadershipChange[] {
  const changes: LeadershipChange[] = [];
  if (before.nodeId !== after.nodeId) changes.push('node');
  if (before.index !== after.index && before.nodeId === after.nodeId) changes.push('order');
  if (before.position.title !== after.position.title) changes.push('title');
  if (!valuesEqual(before.position.authorizedRank, after.position.authorizedRank)) changes.push('authorizedRank');
  if (!valuesEqual(before.position.occupant, after.position.occupant)) changes.push('occupant');
  if (before.position.vacant !== after.position.vacant) changes.push('vacant');
  return changes;
}

function diffLeadership(before: ResolvedChart, after: ResolvedChart): LeadershipDiff[] {
  const beforeIndex = indexedLeadership(before);
  const afterIndex = indexedLeadership(after);
  const result: LeadershipDiff[] = [];
  for (const [id, beforePosition] of beforeIndex.identified) {
    const afterPosition = afterIndex.identified.get(id);
    if (!afterPosition) {
      result.push({
        id,
        kind: 'removed',
        beforeNodeId: beforePosition.nodeId,
        before: cloneLeadershipPosition(beforePosition.position),
        changes: [],
      });
      continue;
    }
    const changes = leadershipChanges(beforePosition, afterPosition);
    if (changes.length === 0) continue;
    result.push({
      id,
      kind: 'modified',
      beforeNodeId: beforePosition.nodeId,
      afterNodeId: afterPosition.nodeId,
      before: cloneLeadershipPosition(beforePosition.position),
      after: cloneLeadershipPosition(afterPosition.position),
      changes,
    });
  }
  for (const [id, afterPosition] of afterIndex.identified) {
    if (beforeIndex.identified.has(id)) continue;
    result.push({
      id,
      kind: 'added',
      afterNodeId: afterPosition.nodeId,
      after: cloneLeadershipPosition(afterPosition.position),
      changes: [],
    });
  }
  for (const [nodeId, beforeAnonymous] of beforeIndex.anonymousByNode) {
    const afterAnonymous = afterIndex.anonymousByNode.get(nodeId) ?? [];
    if (valuesEqual(beforeAnonymous, afterAnonymous)) continue;
    const diff: LeadershipDiff = {
      kind: 'modified',
      beforeNodeId: nodeId,
      changes: ['anonymous'],
    };
    if (after.nodes.has(nodeId)) diff.afterNodeId = nodeId;
    if (beforeAnonymous[0]) diff.before = cloneLeadershipPosition(beforeAnonymous[0]);
    if (afterAnonymous[0]) diff.after = cloneLeadershipPosition(afterAnonymous[0]);
    result.push(diff);
  }
  for (const [nodeId, afterAnonymous] of afterIndex.anonymousByNode) {
    if (beforeIndex.anonymousByNode.has(nodeId)) continue;
    const diff: LeadershipDiff = {
      kind: 'modified',
      afterNodeId: nodeId,
      changes: ['anonymous'],
    };
    if (before.nodes.has(nodeId)) diff.beforeNodeId = nodeId;
    if (afterAnonymous[0]) diff.after = cloneLeadershipPosition(afterAnonymous[0]);
    result.push(diff);
  }
  return result;
}

export function diffCharts(before: ResolvedChart, after: ResolvedChart): ChartDiff {
  const nodes = diffNodes(before, after);
  const leadership = diffLeadership(before, after);
  for (const item of leadership) {
    for (const nodeId of [item.beforeNodeId, item.afterNodeId]) {
      const node = nodeId ? nodes.get(nodeId) : undefined;
      if (!node || node.kind === 'added' || node.kind === 'removed' || node.changes.includes('leadership')) continue;
      node.changes = [...node.changes, 'leadership'];
      node.kind = 'modified';
    }
  }
  const summary: DiffSummary = { added: 0, removed: 0, modified: 0, unchanged: 0 };
  for (const item of nodes.values()) summary[item.kind] += 1;
  return {
    nodes,
    relationships: diffRelationships(before, after),
    leadership,
    annotations: after.semanticAnnotations.map(cloneAnnotation),
    summary,
  };
}
