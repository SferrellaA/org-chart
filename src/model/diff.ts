import type {
  ComparisonTier,
  LeadershipPosition,
  Relationship,
  ResolvedChart,
  ResolvedNode,
  ResolvedParent,
  SemanticAnnotation,
  Source,
  TaxonomyLevel,
  TaxonomySystem,
} from './types';

export type DiffKind = 'added' | 'removed' | 'modified' | 'unchanged';

export type NodeChange =
  | 'name'
  | 'note'
  | 'metadata'
  | 'leadership'
  | 'taxonomy'
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
  taxonomy: TaxonomyDiff;
  annotations: readonly SemanticAnnotation[];
  summary: DiffSummary;
}

export type TaxonomyDefinitionChange = 'label' | 'note' | 'sources' | 'tier';

export interface ComparisonTierDiff {
  id: string;
  kind: DiffKind;
  before?: ComparisonTier;
  after?: ComparisonTier;
  changes: readonly TaxonomyDefinitionChange[];
}

export interface TaxonomySystemDiff {
  id: string;
  kind: DiffKind;
  before?: Omit<TaxonomySystem, 'levels'>;
  after?: Omit<TaxonomySystem, 'levels'>;
  changes: readonly TaxonomyDefinitionChange[];
}

export interface TaxonomyLevelDiff {
  systemId: string;
  levelId: string;
  kind: DiffKind;
  before?: TaxonomyLevel;
  after?: TaxonomyLevel;
  changes: readonly TaxonomyDefinitionChange[];
}

export type TaxonomyAssignmentChange = 'level' | 'tier';

export interface TaxonomyAssignmentDiff {
  nodeId: string;
  systemId: string;
  kind: DiffKind;
  beforeLevelId?: string;
  afterLevelId?: string;
  beforeTierId?: string;
  afterTierId?: string;
  changes: readonly TaxonomyAssignmentChange[];
}

export interface TaxonomyDiff {
  comparisonTiers: ReadonlyMap<string, ComparisonTierDiff>;
  systems: ReadonlyMap<string, TaxonomySystemDiff>;
  levels: ReadonlyMap<string, TaxonomyLevelDiff>;
  assignments: ReadonlyMap<string, TaxonomyAssignmentDiff>;
  tierOrder?: { before: readonly string[]; after: readonly string[] };
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
  if (node.taxonomyAssignments !== undefined) clone.taxonomyAssignments = { ...node.taxonomyAssignments };
  if (node.resolvedTaxonomyAssignments !== undefined) {
    clone.resolvedTaxonomyAssignments = node.resolvedTaxonomyAssignments.map((assignment) => ({ ...assignment }));
  }
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
  if (!valuesEqual(before.resolvedTaxonomyAssignments, after.resolvedTaxonomyAssignments)) changes.push('taxonomy');
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

function definitionChanges(before: object, after: object, includeTier = false): TaxonomyDefinitionChange[] {
  const changes: TaxonomyDefinitionChange[] = [];
  const first = before as { label?: string; note?: string; sources?: readonly Source[]; tier?: string };
  const second = after as { label?: string; note?: string; sources?: readonly Source[]; tier?: string };
  if (first.label !== second.label) changes.push('label');
  if (first.note !== second.note) changes.push('note');
  if (!valuesEqual(first.sources, second.sources)) changes.push('sources');
  if (includeTier && first.tier !== second.tier) changes.push('tier');
  return changes;
}

function cloneDefinition<T extends { sources?: readonly Source[] }>(value: T): T {
  return {
    ...value,
    ...(value.sources ? { sources: cloneSources(value.sources) } : {}),
  };
}

function diffTaxonomy(before: ResolvedChart, after: ResolvedChart): TaxonomyDiff {
  const comparisonTiers = new Map<string, ComparisonTierDiff>();
  const beforeTiers = new Map(before.taxonomy.comparisonTiers.map((tier) => [tier.id, tier]));
  const afterTiers = new Map(after.taxonomy.comparisonTiers.map((tier) => [tier.id, tier]));
  for (const [id, item] of beforeTiers) {
    const next = afterTiers.get(id);
    if (!next) comparisonTiers.set(id, { id, kind: 'removed', before: cloneDefinition(item), changes: [] });
    else {
      const changes = definitionChanges(item, next);
      if (changes.length > 0) comparisonTiers.set(id, { id, kind: 'modified', before: cloneDefinition(item), after: cloneDefinition(next), changes });
    }
  }
  for (const [id, item] of afterTiers) {
    if (!beforeTiers.has(id)) comparisonTiers.set(id, { id, kind: 'added', after: cloneDefinition(item), changes: [] });
  }

  const systems = new Map<string, TaxonomySystemDiff>();
  const levels = new Map<string, TaxonomyLevelDiff>();
  const beforeSystems = new Map(before.taxonomy.systems.map((system) => [system.id, system]));
  const afterSystems = new Map(after.taxonomy.systems.map((system) => [system.id, system]));
  const metadata = (system: TaxonomySystem): Omit<TaxonomySystem, 'levels'> => {
    const { levels: _levels, ...rest } = system;
    return cloneDefinition(rest);
  };
  for (const [id, item] of beforeSystems) {
    const next = afterSystems.get(id);
    if (!next) systems.set(id, { id, kind: 'removed', before: metadata(item), changes: [] });
    else {
      const changes = definitionChanges(item, next);
      if (changes.length > 0) systems.set(id, { id, kind: 'modified', before: metadata(item), after: metadata(next), changes });
    }
  }
  for (const [id, item] of afterSystems) {
    if (!beforeSystems.has(id)) systems.set(id, { id, kind: 'added', after: metadata(item), changes: [] });
  }
  const indexLevels = (chart: ResolvedChart): Map<string, { systemId: string; level: TaxonomyLevel }> => {
    const result = new Map<string, { systemId: string; level: TaxonomyLevel }>();
    for (const system of chart.taxonomy.systems) {
      for (const level of system.levels) result.set(`${system.id}\0${level.id}`, { systemId: system.id, level });
    }
    return result;
  };
  const beforeLevels = indexLevels(before);
  const afterLevels = indexLevels(after);
  for (const [key, item] of beforeLevels) {
    const next = afterLevels.get(key);
    if (!next) levels.set(key, { systemId: item.systemId, levelId: item.level.id, kind: 'removed', before: cloneDefinition(item.level), changes: [] });
    else {
      const changes = definitionChanges(item.level, next.level, true);
      if (changes.length > 0) levels.set(key, { systemId: item.systemId, levelId: item.level.id, kind: 'modified', before: cloneDefinition(item.level), after: cloneDefinition(next.level), changes });
    }
  }
  for (const [key, item] of afterLevels) {
    if (!beforeLevels.has(key)) levels.set(key, { systemId: item.systemId, levelId: item.level.id, kind: 'added', after: cloneDefinition(item.level), changes: [] });
  }

  const assignments = new Map<string, TaxonomyAssignmentDiff>();
  const indexAssignments = (chart: ResolvedChart): Map<string, { nodeId: string; systemId: string; levelId: string; tierId: string }> => {
    const result = new Map<string, { nodeId: string; systemId: string; levelId: string; tierId: string }>();
    for (const [nodeId, node] of chart.nodes) {
      for (const assignment of node.resolvedTaxonomyAssignments ?? []) result.set(`${nodeId}\0${assignment.systemId}`, { nodeId, ...assignment });
    }
    return result;
  };
  const beforeAssignments = indexAssignments(before);
  const afterAssignments = indexAssignments(after);
  for (const [key, item] of beforeAssignments) {
    const next = afterAssignments.get(key);
    if (!next) assignments.set(key, { nodeId: item.nodeId, systemId: item.systemId, kind: 'removed', beforeLevelId: item.levelId, beforeTierId: item.tierId, changes: [] });
    else {
      const changes: TaxonomyAssignmentChange[] = [];
      if (item.levelId !== next.levelId) changes.push('level');
      if (item.tierId !== next.tierId) changes.push('tier');
      if (changes.length > 0) assignments.set(key, {
        nodeId: item.nodeId, systemId: item.systemId, kind: 'modified',
        beforeLevelId: item.levelId, afterLevelId: next.levelId,
        beforeTierId: item.tierId, afterTierId: next.tierId, changes,
      });
    }
  }
  for (const [key, item] of afterAssignments) {
    if (!beforeAssignments.has(key)) assignments.set(key, { nodeId: item.nodeId, systemId: item.systemId, kind: 'added', afterLevelId: item.levelId, afterTierId: item.tierId, changes: [] });
  }
  const beforeOrder = before.taxonomy.comparisonTiers.map((tier) => tier.id);
  const afterOrder = after.taxonomy.comparisonTiers.map((tier) => tier.id);
  return {
    comparisonTiers,
    systems,
    levels,
    assignments,
    ...(!valuesEqual(beforeOrder, afterOrder) ? { tierOrder: { before: beforeOrder, after: afterOrder } } : {}),
  };
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
    taxonomy: diffTaxonomy(before, after),
    annotations: after.semanticAnnotations.map(cloneAnnotation),
    summary,
  };
}
