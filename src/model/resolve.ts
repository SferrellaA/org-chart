import type {
  LeadershipPosition,
  NodeDefinition,
  OrgDocument,
  Patch,
  PresentationDefaults,
  Proposal,
  Relationship,
  ResolvedChart,
  ResolvedNode,
  ResolvedParent,
  SemanticAnnotation,
  SnapshotState,
  Source,
  TaxonomyPatch,
  TaxonomyState,
} from './types';
import { applyTaxonomyTransaction, cloneTaxonomy, isTaxonomyPatch, resolveTaxonomyAssignments, TaxonomyError, type TaxonomyPatchEntry } from './taxonomy';
import {
  concretePatchWrites,
  concreteValueFingerprint,
  validateSelection,
  type ConcreteWrite,
} from './selection';

export interface ResolveOptions {
  viewId: string;
  selectedGroups: readonly string[];
}

export class ResolutionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ResolutionError';
  }
}

interface MutableResolution {
  nodes: Map<string, ResolvedNode>;
  parents: Map<string, ResolvedParent>;
  relationships: Map<string, Relationship>;
  relationshipTombstones: Map<string, Relationship>;
  semanticAnnotations: SemanticAnnotation[];
  presentation: PresentationDefaults;
  taxonomy: TaxonomyState;
}

interface SelectedExecutionContext {
  effects: Map<string, string>;
}

function fail(path: string, message: string): never {
  throw new ResolutionError(path ? `${path}: ${message}` : message);
}

function escapePathSegment(value: string): string {
  return value.replaceAll('~', '~0').replaceAll('/', '~1');
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function cloneSources(sources: readonly Source[]): Source[];
function cloneSources(sources: undefined): undefined;
function cloneSources(sources: readonly Source[] | undefined): Source[] | undefined;
function cloneSources(sources: readonly Source[] | undefined): Source[] | undefined {
  return sources?.map((source) => ({ ...source }));
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

function cloneNode(id: string, node: NodeDefinition | ResolvedNode): ResolvedNode {
  const cloned: ResolvedNode = { ...node, id };
  if (node.aliases) cloned.aliases = [...node.aliases];
  if (node.symbol) cloned.symbol = { ...node.symbol };
  if (node.metadata) cloned.metadata = { ...node.metadata };
  if (node.leadership) cloned.leadership = cloneLeadership(node.leadership)!;
  if (node.taxonomyAssignments) cloned.taxonomyAssignments = { ...node.taxonomyAssignments };
  if ('resolvedTaxonomyAssignments' in node && node.resolvedTaxonomyAssignments) {
    cloned.resolvedTaxonomyAssignments = node.resolvedTaxonomyAssignments.map((assignment) => ({ ...assignment }));
  }
  if (node.sources) cloned.sources = cloneSources(node.sources);
  return cloned;
}

function validateLeadershipIds(nodes: ReadonlyMap<string, ResolvedNode>, path: string): void {
  const owners = new Map<string, string>();
  for (const [nodeId, node] of nodes) {
    for (const position of node.leadership ?? []) {
      if (!position.id) continue;
      const previous = owners.get(position.id);
      if (previous) {
        fail(path, `duplicate billet ID "${position.id}" on nodes "${previous}" and "${nodeId}"`);
      }
      owners.set(position.id, nodeId);
    }
  }
}

function cloneRelationship(relationship: Relationship): Relationship {
  const cloned: Relationship = { ...relationship };
  if (relationship.sources) cloned.sources = cloneSources(relationship.sources);
  return cloned;
}

function resolveSnapshot(
  document: OrgDocument,
  snapshot: SnapshotState,
  path: string,
): Pick<MutableResolution, 'nodes' | 'parents'> {
  const nodes = new Map<string, ResolvedNode>();
  for (const [id, state] of Object.entries(snapshot.nodes)) {
    const definition = document.nodes[id];
    if (!definition) fail(path, `node "${id}" does not have a definition`);
    nodes.set(id, cloneNode(id, { ...definition, ...state }));
  }

  const parents = new Map<string, ResolvedParent>();
  for (const edge of snapshot.hierarchy) {
    if (!nodes.has(edge.child)) fail(path, `node "${edge.child}" does not exist`);
    if (!nodes.has(edge.parent)) fail(path, `parent "${edge.parent}" does not exist`);
    if (parents.has(edge.child)) fail(path, `node "${edge.child}" has multiple parents`);
    parents.set(edge.child, {
      parent: edge.parent,
      relationship: edge.relationship,
      note: edge.note,
      sources: cloneSources(edge.sources),
    } as ResolvedParent);
  }
  validateHierarchy(nodes, parents, path);
  validateLeadershipIds(nodes, path);
  resolveTaxonomyAssignments(cloneTaxonomy(snapshot.taxonomy), nodes, path);
  return { nodes, parents };
}

function validateHierarchy(
  nodes: ReadonlyMap<string, ResolvedNode>,
  parents: ReadonlyMap<string, ResolvedParent>,
  path: string,
): void {
  for (const [child, edge] of parents) {
    if (!nodes.has(child)) fail(path, `node "${child}" does not exist`);
    if (!nodes.has(edge.parent)) fail(path, `parent "${edge.parent}" does not exist`);
  }

  const complete = new Set<string>();
  for (const start of nodes.keys()) {
    if (complete.has(start)) continue;
    const pathNodes: string[] = [];
    const inPath = new Set<string>();
    let current: string | undefined = start;
    while (current !== undefined && !complete.has(current)) {
      if (inPath.has(current)) fail(path, 'hierarchy contains a cycle');
      inPath.add(current);
      pathNodes.push(current);
      current = parents.get(current)?.parent;
    }
    for (const node of pathNodes) complete.add(node);
  }
}

function annotationNodes(
  patch: Patch,
  relationship: Relationship | undefined,
): readonly string[] {
  const candidates: string[] = [];
  if ('node' in patch) candidates.push(patch.node);
  if (relationship) candidates.push(relationship.source, relationship.target);
  candidates.push(...(patch.relatedNodes ?? []));
  return [...new Set(candidates)];
}

function addAnnotation(
  annotations: SemanticAnnotation[],
  patch: Patch,
  relationship: Relationship | undefined,
): void {
  if (!patch.semantic) return;
  annotations.push({
    semantic: patch.semantic,
    nodes: annotationNodes(patch, relationship),
    note: patch.note,
    sources: cloneSources(patch.sources),
  } as SemanticAnnotation);
}

function requireNode(state: MutableResolution, id: string, path: string): ResolvedNode {
  const node = state.nodes.get(id);
  if (!node) fail(path, `node "${id}" does not exist`);
  return node;
}

function requireRelationship(
  state: MutableResolution,
  id: string,
  path: string,
): Relationship {
  const relationship = state.relationships.get(id);
  if (!relationship) fail(path, `relationship "${id}" does not exist`);
  return relationship;
}

function validateParentChange(
  state: MutableResolution,
  node: string,
  parent: string,
  path: string,
): void {
  const seen = new Set<string>();
  let ancestor: string | undefined = parent;
  while (ancestor !== undefined) {
    if (ancestor === node || seen.has(ancestor)) fail(path, 'hierarchy contains a cycle');
    seen.add(ancestor);
    ancestor = state.parents.get(ancestor)?.parent;
  }
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
  const secondKeys = Object.keys(secondRecord);
  return (
    firstKeys.length === secondKeys.length &&
    firstKeys.every(
      (key) => Object.hasOwn(secondRecord, key) && valuesEqual(firstRecord[key], secondRecord[key]),
    )
  );
}

function hasEqualFields(current: object, written: object): boolean {
  return Object.entries(written).every(([key, value]) =>
    valuesEqual((current as Record<string, unknown>)[key], value),
  );
}

function selectedPatchEffects(
  document: OrgDocument,
  state: MutableResolution,
  patch: Patch,
): ConcreteWrite[] {
  const effects = new Map(concretePatchWrites(patch).map((write) => [write.target, write]));
  const addEffect = (target: string, value: unknown): void => {
    effects.set(target, { target, value, fingerprint: concreteValueFingerprint(value) });
  };
  if (patch.type === 'add-node') {
    for (const [key, value] of Object.entries({
      ...document.nodes[patch.node],
      ...patch.value,
    })) {
      addEffect(`${patch.node}.${key}`, value);
    }
    addEffect(`${patch.node}.parent`, null);
  }
  if (patch.type === 'remove-node') {
    addEffect(`${patch.node}.parent`, null);
    for (const [child, edge] of state.parents) {
      if (edge.parent === patch.node) addEffect(`${child}.parent`, null);
    }
    for (const relationship of state.relationships.values()) {
      if (relationship.source === patch.node || relationship.target === patch.node) {
        addEffect(`${relationship.id}.existence`, false);
      }
    }
  }
  return [...effects.values()];
}

function patchMatchesCurrentState(state: MutableResolution, patch: Patch): boolean {
  switch (patch.type) {
    case 'add-node': {
      const node = state.nodes.get(patch.node);
      return node !== undefined && hasEqualFields(node, patch.value ?? {});
    }
    case 'remove-node':
      return !state.nodes.has(patch.node);
    case 'set-node': {
      const node = state.nodes.get(patch.node);
      return node !== undefined && hasEqualFields(node, patch.value);
    }
    case 'set-parent':
      return valuesEqual(state.parents.get(patch.node), {
        parent: patch.parent,
        relationship: patch.relationship,
        note: patch.note,
        sources: cloneSources(patch.sources),
      });
    case 'remove-parent':
      return !state.nodes.has(patch.node) || !state.parents.has(patch.node);
    case 'add-relationship':
      return valuesEqual(state.relationships.get(patch.relationship.id), patch.relationship);
    case 'remove-relationship':
      return !state.relationships.has(patch.relationship);
    case 'set-relationship': {
      const relationship = state.relationships.get(patch.relationship);
      return relationship !== undefined && hasEqualFields(relationship, patch.value);
    }
    default:
      return false;
  }
}

function applyPatch(
  document: OrgDocument,
  state: MutableResolution,
  patch: Patch,
  path: string,
  allowNoOp = false,
  selected = false,
): void {
  if (!isObject(patch)) fail(path, 'patch must be an object');
  let annotationRelationship: Relationship | undefined;
  switch (patch.type) {
    case 'add-node': {
      const existing = state.nodes.get(patch.node);
      if (existing) {
        if (!allowNoOp) fail(path, `node "${patch.node}" already exists`);
        break;
      }
      const definition = document.nodes[patch.node];
      if (!definition) fail(path, `node "${patch.node}" does not have a definition`);
      state.nodes.set(patch.node, cloneNode(patch.node, { ...definition, ...patch.value }));
      break;
    }
    case 'remove-node': {
      if (!state.nodes.has(patch.node)) {
        if (allowNoOp) break;
        fail(path, `node "${patch.node}" does not exist`);
      }
      state.nodes.delete(patch.node);
      state.parents.delete(patch.node);
      for (const [child, edge] of state.parents) {
        if (edge.parent === patch.node) state.parents.delete(child);
      }
      for (const [id, relationship] of state.relationships) {
        if (relationship.source === patch.node || relationship.target === patch.node) {
          if (selected) state.relationshipTombstones.set(id, cloneRelationship(relationship));
          state.relationships.delete(id);
        }
      }
      break;
    }
    case 'set-node': {
      const node = requireNode(state, patch.node, path);
      if (allowNoOp) break;
      state.nodes.set(patch.node, cloneNode(patch.node, { ...node, ...patch.value }));
      break;
    }
    case 'set-parent': {
      const parent = {
        parent: patch.parent,
        relationship: patch.relationship,
        note: patch.note,
        sources: cloneSources(patch.sources),
      } as ResolvedParent;
      if (allowNoOp) break;
      requireNode(state, patch.node, path);
      requireNode(state, patch.parent, path);
      validateParentChange(state, patch.node, patch.parent, path);
      state.parents.set(patch.node, parent);
      break;
    }
    case 'remove-parent':
      if (allowNoOp) break;
      requireNode(state, patch.node, path);
      if (selected && !state.parents.has(patch.node)) {
        fail(path, `node "${patch.node}" does not have a parent`);
      }
      state.parents.delete(patch.node);
      break;
    case 'add-relationship':
      if (!isObject(patch.relationship)) fail(path, 'relationship must be an object');
      annotationRelationship = state.relationships.get(patch.relationship.id);
      if (annotationRelationship) {
        if (allowNoOp) break;
        fail(path, `relationship "${patch.relationship.id}" already exists`);
      }
      requireNode(state, patch.relationship.source, path);
      requireNode(state, patch.relationship.target, path);
      annotationRelationship = cloneRelationship(patch.relationship);
      state.relationships.set(patch.relationship.id, annotationRelationship);
      break;
    case 'remove-relationship':
      annotationRelationship = state.relationships.get(patch.relationship);
      if (!annotationRelationship) {
        if (allowNoOp) {
          annotationRelationship = state.relationshipTombstones.get(patch.relationship);
          break;
        }
        fail(path, `relationship "${patch.relationship}" does not exist`);
      }
      if (selected) {
        state.relationshipTombstones.set(
          patch.relationship,
          cloneRelationship(annotationRelationship),
        );
      }
      state.relationships.delete(patch.relationship);
      break;
    case 'set-relationship': {
      const relationship = requireRelationship(state, patch.relationship, path);
      if (!isObject(patch.value)) fail(path, 'relationship value must be an object');
      if (allowNoOp) {
        annotationRelationship = relationship;
        break;
      }
      if (patch.value.source) requireNode(state, patch.value.source, path);
      if (patch.value.target) requireNode(state, patch.value.target, path);
      annotationRelationship = cloneRelationship({
        ...relationship,
        ...patch.value,
        id: relationship.id,
      });
      state.relationships.set(patch.relationship, annotationRelationship);
      break;
    }
    default: {
      const runtimeType = (patch as { type?: unknown }).type;
      fail(path, `unsupported patch type "${String(runtimeType)}"`);
    }
  }
  addAnnotation(state.semanticAnnotations, patch, annotationRelationship);
}

function applyPatchList(
  document: OrgDocument,
  state: MutableResolution,
  patches: unknown,
  path: string,
  context?: SelectedExecutionContext,
): void {
  if (!Array.isArray(patches)) fail(path, 'patches must be an array');
  let finalPath = path;
  patches.forEach((patch, index) => {
    const patchPath = `${path}/${index}`;
    finalPath = patchPath;
    let effects: ConcreteWrite[] = [];
    if (context && isObject(patch)) {
      try {
        effects = selectedPatchEffects(document, state, patch as unknown as Patch);
      } catch {
        // applyPatch retains contextual runtime errors for malformed patch values.
      }
    }
    if (isObject(patch) && isTaxonomyPatch(patch as unknown as Patch)) return;
    applyPatch(document, state, patch as Patch, patchPath);
    for (const effect of effects) context!.effects.delete(effect.target);
  });
  validateHierarchy(state.nodes, state.parents, finalPath);
  validateLeadershipIds(state.nodes, finalPath);
}

function applySelectedPatchGroup(
  document: OrgDocument,
  state: MutableResolution,
  patches: readonly Patch[],
  path: string,
  context: SelectedExecutionContext,
): void {
  let finalPath = path;
  patches.forEach((patch, index) => {
    const patchPath = `${path}/${index}`;
    finalPath = patchPath;
    if (isTaxonomyPatch(patch)) return;
    let effects: ConcreteWrite[] = [];
    if (isObject(patch)) {
      try {
        effects = selectedPatchEffects(document, state, patch);
      } catch {
        // applyPatch retains contextual runtime errors for malformed patch values.
      }
    }
    const hasProvenance =
      effects.length > 0 &&
      effects.every((effect) => context.effects.get(effect.target) === effect.fingerprint);
    const allowNoOp = hasProvenance && patchMatchesCurrentState(state, patch);
    applyPatch(document, state, patch, patchPath, allowNoOp, true);
    for (const effect of effects) context.effects.set(effect.target, effect.fingerprint);
  });
  validateHierarchy(state.nodes, state.parents, finalPath);
  validateLeadershipIds(state.nodes, finalPath);
}

function globalRelationships(document: OrgDocument): Map<string, Relationship> {
  return new Map(
    (document.relationships ?? []).map((relationship) => [
      relationship.id,
      cloneRelationship(relationship),
    ]),
  );
}

function proposalChain(document: OrgDocument, proposal: Proposal): { root: SnapshotState; chain: Proposal[] } {
  const snapshots = new Map(document.snapshots.map((snapshot) => [snapshot.id, snapshot]));
  const proposals = new Map(document.proposals.map((item) => [item.id, item]));
  const reversed: Proposal[] = [];
  const seen = new Set<string>();
  let current: Proposal | undefined = proposal;

  while (current) {
    const currentPath = escapePathSegment(current.id);
    if (seen.has(current.id)) fail(`${currentPath}/base`, 'proposal base chain contains a cycle');
    seen.add(current.id);
    reversed.push(current);
    const snapshot = snapshots.get(current.base);
    if (snapshot) return { root: snapshot, chain: reversed.reverse() };
    const base = proposals.get(current.base);
    if (!base) fail(`${currentPath}/base`, `view "${current.base}" does not exist`);
    current = base;
  }
  throw new ResolutionError('unreachable proposal chain');
}

function applyProposal(
  document: OrgDocument,
  state: MutableResolution,
  proposal: Proposal,
  selected: ReadonlySet<string>,
  context: SelectedExecutionContext,
): void {
  const proposalPath = escapePathSegment(proposal.id);
  if (proposal.snapshot) {
    const replacement = resolveSnapshot(document, proposal.snapshot, `${proposalPath}/snapshot`);
    state.nodes = replacement.nodes;
    state.parents = replacement.parents;
    state.taxonomy = cloneTaxonomy(proposal.snapshot.taxonomy);
    context.effects.clear();
  }
  applyPatchList(
    document,
    state,
    proposal.patches === undefined ? [] : proposal.patches,
    `${proposalPath}/patches`,
    context,
  );
  for (const [groupIndex, group] of (proposal.patchGroups ?? []).entries()) {
    const groupPath = `${proposalPath}/patchGroups/${groupIndex}/patches`;
    if (!Array.isArray(group.patches)) fail(groupPath, 'patches must be an array');
    if (!selected.has(group.id)) continue;
    applySelectedPatchGroup(document, state, group.patches, groupPath, context);
  }
  const taxonomyEntries: TaxonomyPatchEntry[] = [];
  const nodeAssignmentWrites = new Map<string, { assignments: Readonly<Record<string, string>>; path: string }>();
  const collect = (patches: readonly Patch[], path: string): void => {
    patches.forEach((patch, index) => {
      const patchPath = `${path}/${index}`;
      if (isTaxonomyPatch(patch)) taxonomyEntries.push({ patch: patch as TaxonomyPatch, path: patchPath });
      if ((patch.type === 'set-node' || patch.type === 'add-node') && patch.value?.taxonomyAssignments) {
        const previous = nodeAssignmentWrites.get(patch.node);
        if (
          previous &&
          concreteValueFingerprint(previous.assignments) !== concreteValueFingerprint(patch.value.taxonomyAssignments)
        ) {
          throw new TaxonomyError(
            patchPath,
            `conflicting taxonomy assignment record writes for ${patch.node} (first written at ${previous.path})`,
          );
        }
        nodeAssignmentWrites.set(patch.node, { assignments: patch.value.taxonomyAssignments, path: patchPath });
      }
    });
  };
  collect(proposal.patches ?? [], `${proposalPath}/patches`);
  for (const [groupIndex, group] of (proposal.patchGroups ?? []).entries()) {
    if (selected.has(group.id)) collect(group.patches, `${proposalPath}/patchGroups/${groupIndex}/patches`);
  }
  for (const entry of taxonomyEntries) {
    const patch = entry.patch;
    if (patch.type === 'set-taxonomy-assignment' || patch.type === 'remove-taxonomy-assignment') {
      const wholeRecord = nodeAssignmentWrites.get(patch.node);
      if (wholeRecord) {
        const granularValue = patch.type === 'set-taxonomy-assignment' ? patch.level : undefined;
        if (wholeRecord.assignments[patch.taxonomy] !== granularValue) {
          throw new TaxonomyError(
            entry.path,
            `conflicting taxonomy assignment writes for ${patch.node}/${patch.taxonomy} (whole record written at ${wholeRecord.path})`,
          );
        }
      }
    }
    addAnnotation(state.semanticAnnotations, patch, undefined);
  }
  state.taxonomy = applyTaxonomyTransaction(state.taxonomy, state.nodes, taxonomyEntries, proposalPath);
  state.parents = new Map(
    [...state.nodes.keys()].flatMap((nodeId) => {
      const parent = state.parents.get(nodeId);
      return parent ? [[nodeId, parent] as const] : [];
    }),
  );
}

export function resolveView(document: OrgDocument, options: ResolveOptions): ResolvedChart {
  const snapshot = document.snapshots.find((item) => item.id === options.viewId);
  const proposal = document.proposals.find((item) => item.id === options.viewId);
  if (!snapshot && !proposal) fail('', `view "${options.viewId}" does not exist`);

  const selected = new Set(options.selectedGroups);
  let root: SnapshotState;
  let chain: Proposal[] = [];
  if (snapshot) {
    root = snapshot;
  } else {
    const resolvedChain = proposalChain(document, proposal!);
    root = resolvedChain.root;
    chain = resolvedChain.chain;
  }
  const availableGroups = new Set(
    chain.flatMap((item) => (item.patchGroups ?? []).map((group) => group.id)),
  );
  for (const id of selected) {
    if (!availableGroups.has(id)) {
      fail(`${escapePathSegment(options.viewId)}/patchGroups`, `group "${id}" does not exist`);
    }
  }
  for (const item of chain) {
    const groupIds = new Set((item.patchGroups ?? []).map((group) => group.id));
    const itemSelection = options.selectedGroups.filter((id) => groupIds.has(id));
    const selectionError = validateSelection(item, itemSelection);
    if (selectionError) {
      const message = selectionError[0]!.toLowerCase() + selectionError.slice(1);
      fail(`${escapePathSegment(item.id)}/patchGroups`, message);
    }
  }

  const initial = resolveSnapshot(
    document,
    root,
    snapshot
      ? escapePathSegment(snapshot.id)
      : `${escapePathSegment(chain[0]!.id)}/base`,
  );
  const state: MutableResolution = {
    ...initial,
    relationships: globalRelationships(document),
    relationshipTombstones: new Map(),
    semanticAnnotations: [],
    taxonomy: cloneTaxonomy(root.taxonomy),
    presentation: {
      ...(document.presentation ?? {}),
      ...(document.presentation?.focusNodes
        ? { focusNodes: [...document.presentation.focusNodes] }
        : {}),
    },
  };
  const selectedContext: SelectedExecutionContext = { effects: new Map() };
  for (const item of chain) applyProposal(document, state, item, selected, selectedContext);
  resolveTaxonomyAssignments(state.taxonomy, state.nodes, escapePathSegment(options.viewId));

  return {
    nodes: state.nodes,
    parents: state.parents,
    relationships: state.relationships,
    semanticAnnotations: state.semanticAnnotations,
    taxonomy: state.taxonomy,
    presentation: state.presentation,
  };
}
