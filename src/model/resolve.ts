import type {
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
} from './types';

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
  semanticAnnotations: SemanticAnnotation[];
  presentation: PresentationDefaults;
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

function cloneNode(id: string, node: NodeDefinition | ResolvedNode): ResolvedNode {
  const cloned: ResolvedNode = { ...node, id };
  if (node.aliases) cloned.aliases = [...node.aliases];
  if (node.symbol) cloned.symbol = { ...node.symbol };
  if (node.metadata) cloned.metadata = { ...node.metadata };
  if (node.sources) cloned.sources = cloneSources(node.sources);
  return cloned;
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

function applyPatch(
  document: OrgDocument,
  state: MutableResolution,
  patch: Patch,
  path: string,
): void {
  if (!isObject(patch)) fail(path, 'patch must be an object');
  let annotationRelationship: Relationship | undefined;
  switch (patch.type) {
    case 'add-node': {
      if (state.nodes.has(patch.node)) fail(path, `node "${patch.node}" already exists`);
      const definition = document.nodes[patch.node];
      if (!definition) fail(path, `node "${patch.node}" does not have a definition`);
      state.nodes.set(patch.node, cloneNode(patch.node, { ...definition, ...patch.value }));
      break;
    }
    case 'remove-node': {
      requireNode(state, patch.node, path);
      state.nodes.delete(patch.node);
      state.parents.delete(patch.node);
      for (const [child, edge] of state.parents) {
        if (edge.parent === patch.node) state.parents.delete(child);
      }
      for (const [id, relationship] of state.relationships) {
        if (relationship.source === patch.node || relationship.target === patch.node) {
          state.relationships.delete(id);
        }
      }
      break;
    }
    case 'set-node': {
      const node = requireNode(state, patch.node, path);
      state.nodes.set(patch.node, cloneNode(patch.node, { ...node, ...patch.value }));
      break;
    }
    case 'set-parent': {
      requireNode(state, patch.node, path);
      requireNode(state, patch.parent, path);
      validateParentChange(state, patch.node, patch.parent, path);
      state.parents.set(patch.node, {
        parent: patch.parent,
        relationship: patch.relationship,
        note: patch.note,
        sources: cloneSources(patch.sources),
      } as ResolvedParent);
      break;
    }
    case 'remove-parent':
      requireNode(state, patch.node, path);
      state.parents.delete(patch.node);
      break;
    case 'add-relationship':
      if (!isObject(patch.relationship)) fail(path, 'relationship must be an object');
      if (state.relationships.has(patch.relationship.id)) {
        fail(path, `relationship "${patch.relationship.id}" already exists`);
      }
      requireNode(state, patch.relationship.source, path);
      requireNode(state, patch.relationship.target, path);
      annotationRelationship = cloneRelationship(patch.relationship);
      state.relationships.set(patch.relationship.id, annotationRelationship);
      break;
    case 'remove-relationship':
      annotationRelationship = requireRelationship(state, patch.relationship, path);
      state.relationships.delete(patch.relationship);
      break;
    case 'set-relationship': {
      const relationship = requireRelationship(state, patch.relationship, path);
      if (!isObject(patch.value)) fail(path, 'relationship value must be an object');
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
      const exhaustive: never = patch;
      const runtimeType = (exhaustive as { type?: unknown }).type;
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
): void {
  if (!Array.isArray(patches)) fail(path, 'patches must be an array');
  let finalPath = path;
  patches.forEach((patch, index) => {
    const patchPath = `${path}/${index}`;
    finalPath = patchPath;
    applyPatch(document, state, patch as Patch, patchPath);
  });
  validateHierarchy(state.nodes, state.parents, finalPath);
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
): void {
  const proposalPath = escapePathSegment(proposal.id);
  if (proposal.snapshot) {
    const replacement = resolveSnapshot(document, proposal.snapshot, `${proposalPath}/snapshot`);
    state.nodes = replacement.nodes;
    state.parents = replacement.parents;
  }
  applyPatchList(
    document,
    state,
    proposal.patches === undefined ? [] : proposal.patches,
    `${proposalPath}/patches`,
  );
  for (const [groupIndex, group] of (proposal.patchGroups ?? []).entries()) {
    const groupPath = `${proposalPath}/patchGroups/${groupIndex}/patches`;
    if (!Array.isArray(group.patches)) fail(groupPath, 'patches must be an array');
    if (!group.locked && !selected.has(group.id)) continue;
    applyPatchList(document, state, group.patches, groupPath);
  }
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
    semanticAnnotations: [],
    presentation: {
      ...(document.presentation ?? {}),
      ...(document.presentation?.focusNodes
        ? { focusNodes: [...document.presentation.focusNodes] }
        : {}),
    },
  };
  for (const item of chain) applyProposal(document, state, item, selected);

  return {
    nodes: state.nodes,
    parents: state.parents,
    relationships: state.relationships,
    semanticAnnotations: state.semanticAnnotations,
    presentation: state.presentation,
  };
}
