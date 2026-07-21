import Ajv2020, { type ErrorObject, type ValidateFunction } from 'ajv/dist/2020.js';

import schema from '../../public/org-delta-chart.schema.json';
import type {
  OrgDocument,
  Patch,
  Proposal,
  Relationship,
  SnapshotState,
  ValidationResult,
} from './types';

let schemaValidator: ValidateFunction | undefined;
let schemaCompilationError: string | undefined;

try {
  schemaValidator = new Ajv2020({ allErrors: true, strict: true }).compile(schema);
} catch (error) {
  schemaCompilationError = error instanceof Error ? error.message : String(error);
}

function schemaError(error: ErrorObject): string {
  const path = error.instancePath || '/';
  return `document${path}: ${error.message ?? error.keyword}`;
}

function hierarchyErrors(
  owner: string,
  state: SnapshotState,
  knownNodes: ReadonlySet<string>,
): string[] {
  const errors: string[] = [];
  const presentNodes = new Set(Object.keys(state.nodes));
  const parents = new Map<string, string>();

  for (const [index, node] of Object.keys(state.nodes).entries()) {
    if (!knownNodes.has(node)) {
      errors.push(`${owner}/nodes/${index}: unknown node "${node}"`);
    }
  }

  for (const [index, edge] of state.hierarchy.entries()) {
    const path = `${owner}/hierarchy/${index}`;
    for (const [field, node] of [
      ['child', edge.child],
      ['parent', edge.parent],
    ] as const) {
      if (!knownNodes.has(node)) {
        errors.push(`${path}/${field}: missing node "${node}"`);
      } else if (!presentNodes.has(node)) {
        errors.push(`${path}/${field}: node "${node}" is absent from the snapshot`);
      }
    }
    if (parents.has(edge.child)) {
      errors.push(`${path}/child: node "${edge.child}" has multiple parents`);
    } else {
      parents.set(edge.child, edge.parent);
    }
  }

  for (const node of presentNodes) {
    const seen = new Set<string>();
    let current: string | undefined = node;
    while (current !== undefined) {
      if (seen.has(current)) {
        errors.push(`${owner}/hierarchy: cycle involving node "${current}"`);
        break;
      }
      seen.add(current);
      current = parents.get(current);
    }
  }

  return [...new Set(errors)];
}

function graphCycle(nodes: readonly string[], edges: (node: string) => readonly string[]): string[] | undefined {
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const stack: string[] = [];

  const visit = (node: string): string[] | undefined => {
    if (visiting.has(node)) {
      const start = stack.indexOf(node);
      return [...stack.slice(start), node];
    }
    if (visited.has(node)) return undefined;
    visiting.add(node);
    stack.push(node);
    for (const target of edges(node)) {
      const cycle = visit(target);
      if (cycle) return cycle;
    }
    stack.pop();
    visiting.delete(node);
    visited.add(node);
    return undefined;
  };

  for (const node of nodes) {
    const cycle = visit(node);
    if (cycle) return cycle;
  }
  return undefined;
}

function relationshipNodeErrors(
  owner: string,
  relationship: Relationship,
  knownNodes: ReadonlySet<string>,
): string[] {
  const errors: string[] = [];
  if (!knownNodes.has(relationship.source)) {
    errors.push(`${owner}/source: unknown node "${relationship.source}"`);
  }
  if (!knownNodes.has(relationship.target)) {
    errors.push(`${owner}/target: unknown node "${relationship.target}"`);
  }
  return errors;
}

function patchErrors(
  owner: string,
  patch: Patch,
  knownNodes: ReadonlySet<string>,
  knownRelationships: Set<string>,
  introducedRelationships: Set<string>,
): string[] {
  const errors: string[] = [];
  const checkNode = (path: string, node: string): void => {
    if (!knownNodes.has(node)) errors.push(`${owner}/${path}: unknown node "${node}"`);
  };

  if ('node' in patch) checkNode('node', patch.node);
  if ('parent' in patch) checkNode('parent', patch.parent);
  patch.relatedNodes?.forEach((node, index) => checkNode(`relatedNodes/${index}`, node));

  if (patch.type === 'add-relationship') {
    if (
      knownRelationships.has(patch.relationship.id) ||
      introducedRelationships.has(patch.relationship.id)
    ) {
      errors.push(
        `${owner}/relationship/id: duplicate introduced relationship ID "${patch.relationship.id}"`,
      );
    }
    introducedRelationships.add(patch.relationship.id);
    knownRelationships.add(patch.relationship.id);
    errors.push(...relationshipNodeErrors(`${owner}/relationship`, patch.relationship, knownNodes));
  } else if (patch.type === 'set-relationship') {
    if (!knownRelationships.has(patch.relationship)) {
      errors.push(`${owner}/relationship: unknown relationship "${patch.relationship}"`);
    }
    if (patch.value.source && !knownNodes.has(patch.value.source)) {
      errors.push(`${owner}/value/source: unknown node "${patch.value.source}"`);
    }
    if (patch.value.target && !knownNodes.has(patch.value.target)) {
      errors.push(`${owner}/value/target: unknown node "${patch.value.target}"`);
    }
  } else if (patch.type === 'remove-relationship' && !knownRelationships.has(patch.relationship)) {
    errors.push(`${owner}/relationship: unknown relationship "${patch.relationship}"`);
  } else if (patch.type === 'remove-relationship') {
    knownRelationships.delete(patch.relationship);
  }
  return errors;
}

function proposalErrors(
  proposal: Proposal,
  knownBases: ReadonlySet<string>,
  knownNodes: ReadonlySet<string>,
  knownRelationships: ReadonlySet<string>,
): string[] {
  const owner = `proposal/${proposal.id}`;
  const errors: string[] = [];
  const proposalRelationships = new Set(knownRelationships);
  const introducedRelationships = new Set<string>();
  if (!knownBases.has(proposal.base)) {
    errors.push(`${owner}/base: unknown base "${proposal.base}"`);
  }
  if (proposal.snapshot) {
    errors.push(...hierarchyErrors(`${owner}/snapshot`, proposal.snapshot, knownNodes));
  }

  proposal.patches?.forEach((patch, index) => {
    errors.push(
      ...patchErrors(
        `${owner}/patches/${index}`,
        patch,
        knownNodes,
        proposalRelationships,
        introducedRelationships,
      ),
    );
  });

  const groups = proposal.patchGroups ?? [];
  const groupIds = new Set(groups.map((group) => group.id));
  const groupById = new Map(groups.map((group) => [group.id, group]));
  for (const [groupIndex, group] of groups.entries()) {
    const groupPath = `${owner}/patchGroups/${groupIndex}`;
    const groupRelationships = new Set(proposalRelationships);
    for (const [kind, references] of [
      ['requires', group.requires ?? []],
      ['conflictsWith', group.conflictsWith ?? []],
    ] as const) {
      references.forEach((reference, index) => {
        if (!groupIds.has(reference)) {
          errors.push(`${groupPath}/${kind}/${index}: missing group "${reference}"`);
        }
      });
    }
    for (const conflict of group.conflictsWith ?? []) {
      if ((group.requires ?? []).includes(conflict)) {
        errors.push(
          `${groupPath}: group "${group.id}" requires and conflicts with "${conflict}"`,
        );
      }
      if (groupIds.has(conflict) && !(groupById.get(conflict)?.conflictsWith ?? []).includes(group.id)) {
        errors.push(`${groupPath}/conflictsWith: conflict with "${conflict}" must be symmetric`);
      }
    }
    group.patches.forEach((patch, patchIndex) => {
      errors.push(
        ...patchErrors(
          `${groupPath}/patches/${patchIndex}`,
          patch,
          knownNodes,
          groupRelationships,
          introducedRelationships,
        ),
      );
    });
  }

  const dependencyCycle = graphCycle(
    [...groupIds],
    (id) => (groupById.get(id)?.requires ?? []).filter((required) => groupIds.has(required)),
  );
  if (dependencyCycle) {
    errors.push(`${owner}/patchGroups: dependency cycle ${dependencyCycle.join(' -> ')}`);
  }
  return errors;
}

export function validateDocument(input: unknown): ValidationResult {
  if (!schemaValidator) {
    return { ok: false, errors: [`schema: failed to compile: ${schemaCompilationError}`] };
  }
  if (!schemaValidator(input)) {
    return { ok: false, errors: (schemaValidator.errors ?? []).map(schemaError) };
  }

  const document = input as OrgDocument;
  const fatalErrors: string[] = [];
  const knownNodes = new Set(Object.keys(document.nodes));
  const idOwners = new Map<string, string>();
  const registerId = (id: string, owner: string): void => {
    const previous = idOwners.get(id);
    if (previous) fatalErrors.push(`${owner}: duplicate global ID "${id}" (already used by ${previous})`);
    else idOwners.set(id, owner);
  };

  Object.keys(document.nodes).forEach((id) => registerId(id, `nodes/${id}`));
  document.snapshots.forEach((snapshot, index) => registerId(snapshot.id, `snapshots/${index}/id`));
  document.proposals.forEach((proposal, index) => registerId(proposal.id, `proposals/${index}/id`));
  document.relationships?.forEach((relationship, index) =>
    registerId(relationship.id, `relationships/${index}/id`),
  );
  document.zones?.forEach((zone, index) => registerId(zone.id, `zones/${index}/id`));
  document.proposals.forEach((proposal, proposalIndex) =>
    proposal.patchGroups?.forEach((group, groupIndex) =>
      registerId(group.id, `proposals/${proposalIndex}/patchGroups/${groupIndex}/id`),
    ),
  );

  for (const snapshot of document.snapshots) {
    fatalErrors.push(...hierarchyErrors(`snapshot/${snapshot.id}`, snapshot, knownNodes));
  }
  document.relationships?.forEach((relationship, index) => {
    fatalErrors.push(...relationshipNodeErrors(`relationships/${index}`, relationship, knownNodes));
  });
  document.zones?.forEach((zone, zoneIndex) => {
    zone.nodes.forEach((node, nodeIndex) => {
      if (!knownNodes.has(node)) {
        fatalErrors.push(`zones/${zoneIndex}/nodes/${nodeIndex}: unknown node "${node}"`);
      }
    });
  });
  document.presentation?.focusNodes?.forEach((node, index) => {
    if (!knownNodes.has(node)) {
      fatalErrors.push(`presentation/focusNodes/${index}: unknown node "${node}"`);
    }
  });
  if (fatalErrors.length > 0) return { ok: false, errors: fatalErrors };

  const snapshots = new Set(document.snapshots.map((snapshot) => snapshot.id));
  const proposalById = new Map(document.proposals.map((proposal) => [proposal.id, proposal]));
  const knownBases = new Set([...snapshots, ...proposalById.keys()]);
  const knownRelationships = new Set((document.relationships ?? []).map((item) => item.id));
  const mutableViewErrors = new Map<string, string[]>();

  for (const proposal of document.proposals) {
    const errors = proposalErrors(proposal, knownBases, knownNodes, knownRelationships);
    if (errors.length > 0) mutableViewErrors.set(proposal.id, errors);
  }

  const processedBases = new Set<string>();
  const baseCycles: string[][] = [];
  for (const start of proposalById.keys()) {
    if (processedBases.has(start)) continue;
    const path: string[] = [];
    const pathIndexes = new Map<string, number>();
    let current: string | undefined = start;
    while (current && proposalById.has(current) && !processedBases.has(current)) {
      const cycleStart = pathIndexes.get(current);
      if (cycleStart !== undefined) {
        baseCycles.push([...path.slice(cycleStart), current]);
        break;
      }
      pathIndexes.set(current, path.length);
      path.push(current);
      current = proposalById.get(current)?.base;
    }
    path.forEach((id) => processedBases.add(id));
  }
  for (const baseCycle of baseCycles) {
    const cycleDescription = baseCycle.join(' -> ');
    for (const id of new Set(baseCycle)) {
      const errors = mutableViewErrors.get(id) ?? [];
      errors.push(`proposal/${id}/base: base cycle ${cycleDescription}`);
      mutableViewErrors.set(id, errors);
    }
  }

  let changed = true;
  while (changed) {
    changed = false;
    for (const proposal of document.proposals) {
      if (mutableViewErrors.has(proposal.id)) continue;
      if (mutableViewErrors.has(proposal.base)) {
        mutableViewErrors.set(proposal.id, [
          `proposal/${proposal.id}/base: base proposal "${proposal.base}" is invalid`,
        ]);
        changed = true;
      }
    }
  }

  return { ok: true, value: document, viewErrors: mutableViewErrors };
}

export const validateOrgDocument = validateDocument;
