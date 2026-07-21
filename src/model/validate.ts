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

function escapeJsonPointer(value: string): string {
  return value.replaceAll('~', '~0').replaceAll('/', '~1');
}

function hierarchyErrors(
  owner: string,
  state: SnapshotState,
  knownNodes: ReadonlySet<string>,
): string[] {
  const errors: string[] = [];
  const presentNodes = new Set(Object.keys(state.nodes));
  const parents = new Map<string, string>();

  for (const node of Object.keys(state.nodes).sort()) {
    if (!knownNodes.has(node)) {
      errors.push(`${owner}/nodes/${escapeJsonPointer(node)}: unknown node "${node}"`);
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
  globalIdOwners: ReadonlyMap<string, string>,
): { errors: string[]; relationships: Set<string> } {
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
  const declaredRelationships = new Map<string, string>();
  const recordRelationshipDeclarations = (patches: readonly Patch[], path: string): void => {
    patches.forEach((patch, patchIndex) => {
      if (patch.type !== 'add-relationship') return;
      const id = patch.relationship.id;
      const declarationPath = `${path}/${patchIndex}`;
      const previous = declaredRelationships.get(id);
      const globalOwner = globalIdOwners.get(id);
      if (
        (globalOwner && globalOwner !== declarationPath) ||
        knownRelationships.has(id) ||
        previous
      ) {
        errors.push(
          `${path}/${patchIndex}/relationship/id: duplicate introduced relationship ID "${id}"` +
            (globalOwner && globalOwner !== declarationPath
              ? ` (already used by ${globalOwner})`
              : previous
                ? ` (already introduced by ${previous})`
                : ''),
        );
      } else {
        declaredRelationships.set(id, declarationPath);
      }
    });
  };
  recordRelationshipDeclarations(proposal.patches ?? [], `${owner}/patches`);
  groups.forEach((group, groupIndex) => {
    recordRelationshipDeclarations(group.patches, `${owner}/patchGroups/${groupIndex}/patches`);
  });
  const dependentGroups = new Map<string, number[]>();
  const remainingRequirements = groups.map(() => 0);
  for (const [groupIndex, group] of groups.entries()) {
    const groupPath = `${owner}/patchGroups/${groupIndex}`;
    for (const [kind, references] of [
      ['requires', group.requires ?? []],
      ['conflictsWith', group.conflictsWith ?? []],
    ] as const) {
      references.forEach((reference, index) => {
        if (!groupIds.has(reference)) {
          errors.push(`${groupPath}/${kind}/${index}: missing group "${reference}"`);
        } else if (kind === 'requires') {
          remainingRequirements[groupIndex]! += 1;
          const dependents = dependentGroups.get(reference) ?? [];
          dependents.push(groupIndex);
          dependentGroups.set(reference, dependents);
        }
      });
    }
    for (const conflict of group.conflictsWith ?? []) {
      if (group.locked && groupById.get(conflict)?.locked) {
        errors.push(
          `${groupPath}/conflictsWith: locked groups "${group.id}" and "${conflict}" conflict; selection is impossible`,
        );
      }
      if ((group.requires ?? []).includes(conflict)) {
        errors.push(
          `${groupPath}: group "${group.id}" requires and conflicts with "${conflict}"`,
        );
      }
      if (groupIds.has(conflict) && !(groupById.get(conflict)?.conflictsWith ?? []).includes(group.id)) {
        errors.push(`${groupPath}/conflictsWith: conflict with "${conflict}" must be symmetric`);
      }
    }
  }

  const readyGroups: number[] = [];
  remainingRequirements.forEach((count, index) => {
    if (count === 0) readyGroups.push(index);
  });
  const groupOrder: number[] = [];
  for (let cursor = 0; cursor < readyGroups.length; cursor += 1) {
    const groupIndex = readyGroups[cursor]!;
    groupOrder.push(groupIndex);
    for (const dependent of dependentGroups.get(groups[groupIndex]!.id) ?? []) {
      remainingRequirements[dependent]! -= 1;
      if (remainingRequirements[dependent] === 0) readyGroups.push(dependent);
    }
  }
  if (groupOrder.length !== groups.length) {
    const cycleGroups = groups
      .filter((_group, index) => remainingRequirements[index]! > 0)
      .map((group) => group.id);
    errors.push(`${owner}/patchGroups: dependency cycle involving ${cycleGroups.join(', ')}`);
  }

  const dependencyClosure = (initialIds: readonly string[]): Set<string> => {
    const selected = new Set<string>();
    const pending = [...initialIds];
    while (pending.length > 0) {
      const id = pending.pop()!;
      if (selected.has(id) || !groupIds.has(id)) continue;
      selected.add(id);
      const required = groupById.get(id)?.requires ?? [];
      for (let index = required.length - 1; index >= 0; index -= 1) {
        pending.push(required[index]!);
      }
    }
    return selected;
  };
  const applyGroups = (
    selected: ReadonlySet<string>,
    relationships: Set<string>,
    introduced: Set<string>,
  ): void => {
    for (const groupIndex of groupOrder) {
      const group = groups[groupIndex]!;
      if (!selected.has(group.id)) continue;
      group.patches.forEach((patch, patchIndex) => {
        errors.push(
          ...patchErrors(
            `${owner}/patchGroups/${groupIndex}/patches/${patchIndex}`,
            patch,
            knownNodes,
            relationships,
            introduced,
          ),
        );
      });
    }
  };

  const guaranteedGroups = dependencyClosure(
    groups.filter((group) => group.locked).map((group) => group.id),
  );
  applyGroups(guaranteedGroups, proposalRelationships, introducedRelationships);

  for (const group of groups) {
    if (guaranteedGroups.has(group.id) || group.patches.length === 0) continue;
    const selected = dependencyClosure([group.id]);
    guaranteedGroups.forEach((id) => selected.delete(id));
    const groupRelationships = new Set(proposalRelationships);
    applyGroups(selected, groupRelationships, new Set<string>());
  }
  return { errors: [...new Set(errors)], relationships: proposalRelationships };
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

  const recordIntroducedOwners = (patches: readonly Patch[], path: string): void => {
    patches.forEach((patch, patchIndex) => {
      if (patch.type === 'add-relationship' && !idOwners.has(patch.relationship.id)) {
        idOwners.set(patch.relationship.id, `${path}/${patchIndex}`);
      }
    });
  };
  document.proposals.forEach((proposal) => {
    recordIntroducedOwners(proposal.patches ?? [], `proposal/${proposal.id}/patches`);
    proposal.patchGroups?.forEach((group, groupIndex) => {
      recordIntroducedOwners(
        group.patches,
        `proposal/${proposal.id}/patchGroups/${groupIndex}/patches`,
      );
    });
  });

  const snapshots = new Set(document.snapshots.map((snapshot) => snapshot.id));
  const proposalById = new Map(document.proposals.map((proposal) => [proposal.id, proposal]));
  const knownBases = new Set([...snapshots, ...proposalById.keys()]);
  const knownRelationships = new Set((document.relationships ?? []).map((item) => item.id));
  const mutableViewErrors = new Map<string, string[]>();

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
  const cycleProposalIds = new Set<string>();
  for (const baseCycle of baseCycles) {
    const cycleDescription = baseCycle.join(' -> ');
    for (const id of new Set(baseCycle)) {
      cycleProposalIds.add(id);
      mutableViewErrors.set(id, [`proposal/${id}/base: base cycle ${cycleDescription}`]);
    }
  }

  const dependentProposals = new Map<string, Proposal[]>();
  const remainingBases = new Map<string, number>();
  const readyProposals: Proposal[] = [];
  for (const proposal of document.proposals) {
    if (proposalById.has(proposal.base)) {
      remainingBases.set(proposal.id, 1);
      const dependents = dependentProposals.get(proposal.base) ?? [];
      dependents.push(proposal);
      dependentProposals.set(proposal.base, dependents);
    } else {
      remainingBases.set(proposal.id, 0);
      readyProposals.push(proposal);
    }
  }

  const relationshipStates = new Map<string, ReadonlySet<string>>();
  for (let cursor = 0; cursor < readyProposals.length; cursor += 1) {
    const proposal = readyProposals[cursor]!;
    const baseProposal = proposalById.get(proposal.base);
    let baseRelationships: ReadonlySet<string> | undefined = knownRelationships;
    if (baseProposal) {
      baseRelationships = relationshipStates.get(baseProposal.id);
      if (!baseRelationships) {
        mutableViewErrors.set(proposal.id, [
          `proposal/${proposal.id}/base: base proposal "${proposal.base}" is invalid`,
        ]);
      }
    }

    if (baseRelationships) {
      const result = proposalErrors(
        proposal,
        knownBases,
        knownNodes,
        baseRelationships,
        idOwners,
      );
      if (result.errors.length > 0) {
        mutableViewErrors.set(proposal.id, result.errors);
      } else {
        relationshipStates.set(proposal.id, result.relationships);
      }
    }

    for (const dependent of dependentProposals.get(proposal.id) ?? []) {
      const remaining = remainingBases.get(dependent.id)! - 1;
      remainingBases.set(dependent.id, remaining);
      if (remaining === 0) readyProposals.push(dependent);
    }
  }

  const invalidQueue = [...cycleProposalIds];
  const propagatedInvalidIds = new Set(invalidQueue);
  for (let cursor = 0; cursor < invalidQueue.length; cursor += 1) {
    const invalidId = invalidQueue[cursor]!;
    for (const dependent of dependentProposals.get(invalidId) ?? []) {
      if (propagatedInvalidIds.has(dependent.id)) continue;
      propagatedInvalidIds.add(dependent.id);
      mutableViewErrors.set(dependent.id, [
        `proposal/${dependent.id}/base: base proposal "${dependent.base}" is invalid`,
      ]);
      invalidQueue.push(dependent.id);
    }
  }

  return { ok: true, value: document, viewErrors: mutableViewErrors };
}

export const validateOrgDocument = validateDocument;
