import Ajv2020, { type ErrorObject, type ValidateFunction } from 'ajv/dist/2020.js';

import schema from '../../public/org-delta-chart.schema.json';
import { bundledMarkerIds } from '../markers/catalog';
import { resolveView } from './resolve';
import { TaxonomyError } from './taxonomy';
import type {
  LeadershipPosition,
  OrgDocument,
  Patch,
  Proposal,
  RankMarker,
  Relationship,
  SnapshotState,
  ValidationResult,
} from './types';

interface IdOwner {
  token: object;
  path: string;
}

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

function markerErrors(path: string, marker: RankMarker | undefined): string[] {
  if (!marker || marker.type !== 'bundled') return [];
  return bundledMarkerIds.has(marker.id)
    ? []
    : [`${path}/id: unknown bundled marker "${marker.id}"`];
}

function leadershipErrors(owner: string, leadership: readonly LeadershipPosition[] | undefined): string[] {
  const errors: string[] = [];
  leadership?.forEach((position, index) => {
    const path = `${owner}/leadership/${index}`;
    if (!position.title && !position.authorizedRank && !position.occupant && position.vacant !== true) {
      errors.push(`${path}: leadership billet must include title, rank, occupant, or vacancy`);
    }
    errors.push(...markerErrors(`${path}/authorizedRank/marker`, position.authorizedRank?.marker));
    errors.push(...markerErrors(`${path}/occupant/rank/marker`, position.occupant?.rank?.marker));
  });
  return errors;
}

function resolvedLeadershipErrors(document: OrgDocument, viewId: string, owner: string): string[] {
  try {
    const chart = resolveView(document, { viewId, selectedGroups: [] });
    const owners = new Map<string, string>();
    for (const [nodeId, node] of chart.nodes) {
      for (const position of node.leadership ?? []) {
        if (!position.id) continue;
        const previous = owners.get(position.id);
        if (previous) {
          return [
            `${owner}/resolved/leadership: duplicate billet ID "${position.id}" on nodes "${previous}" and "${nodeId}"`,
          ];
        }
        owners.set(position.id, nodeId);
      }
    }
  } catch (error) {
    if (error instanceof Error && error.message.includes('duplicate billet ID')) {
      return [`${owner}/resolved/leadership: ${error.message.replace(/^.*: /, '')}`];
    }
    // Existing validation paths cover malformed views; duplicate billet checks are additive.
  }
  return [];
}

function resolvedTaxonomyErrors(document: OrgDocument, viewId: string, owner: string): string[] {
  try {
    resolveView(document, { viewId, selectedGroups: [] });
  } catch (error) {
    if (error instanceof TaxonomyError) return [`${owner}/resolved/taxonomy: ${error.message}`];
  }
  return [];
}

function selectableTaxonomyErrors(document: OrgDocument, proposal: Proposal): string[] {
  const groups = proposal.patchGroups ?? [];
  const byId = new Map(groups.map((group) => [group.id, group]));
  const closure = (initial: readonly string[]): string[] => {
    const selected = new Set<string>();
    const pending = [...initial];
    while (pending.length > 0) {
      const id = pending.pop()!;
      if (selected.has(id)) continue;
      selected.add(id);
      pending.push(...(byId.get(id)?.requires ?? []));
    }
    return groups.filter((group) => selected.has(group.id)).map((group) => group.id);
  };
  const locked = groups.filter((group) => group.locked).map((group) => group.id);
  for (const group of groups) {
    if (!group.patches.some((patch) => patch.type.includes('taxonomy') || patch.type.includes('comparison-tier'))) continue;
    try {
      resolveView(document, { viewId: proposal.id, selectedGroups: closure([...locked, group.id]) });
    } catch (error) {
      if (error instanceof TaxonomyError) {
        return [`proposal/${escapeJsonPointer(proposal.id)}/resolved/taxonomy: ${error.message}`];
      }
    }
  }
  return [];
}

function hasLeadershipData(document: OrgDocument): boolean {
  if (Object.values(document.nodes).some((node) => node.leadership !== undefined)) return true;
  if (document.snapshots.some((snapshot) =>
    Object.values(snapshot.nodes).some((node) => node.leadership !== undefined)
  )) return true;
  return document.proposals.some((proposal) => {
    if (proposal.snapshot && Object.values(proposal.snapshot.nodes).some((node) => node.leadership !== undefined)) {
      return true;
    }
    if (proposal.patches?.some((patch) =>
      (patch.type === 'set-node' || patch.type === 'add-node') && patch.value?.leadership !== undefined
    )) return true;
    return proposal.patchGroups?.some((group) => group.patches.some((patch) =>
      (patch.type === 'set-node' || patch.type === 'add-node') && patch.value?.leadership !== undefined
    )) ?? false;
  });
}

function hasTaxonomyData(document: OrgDocument): boolean {
  if (Object.values(document.nodes).some((node) => node.taxonomyAssignments !== undefined)) return true;
  if (document.snapshots.some((snapshot) =>
    snapshot.taxonomy !== undefined || Object.values(snapshot.nodes).some((node) => node.taxonomyAssignments !== undefined)
  )) return true;
  return document.proposals.some((proposal) => {
    if (proposal.snapshot?.taxonomy !== undefined) return true;
    const patches = [
      ...(proposal.patches ?? []),
      ...(proposal.patchGroups ?? []).flatMap((group) => group.patches),
    ];
    return patches.some((patch) =>
      patch.type.includes('taxonomy') ||
      patch.type.includes('comparison-tier') ||
      ((patch.type === 'set-node' || patch.type === 'add-node') && patch.value?.taxonomyAssignments !== undefined)
    );
  });
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
  globalIdOwners: ReadonlyMap<string, IdOwner>,
): { errors: string[]; relationships: Set<string> } {
  const owner = `proposal/${escapeJsonPointer(proposal.id)}`;
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
  const declaredRelationships = new Map<string, IdOwner>();
  const recordRelationshipDeclarations = (patches: readonly Patch[], path: string): void => {
    patches.forEach((patch, patchIndex) => {
      if (patch.type !== 'add-relationship') return;
      const id = patch.relationship.id;
      const declarationPath = `${path}/${patchIndex}`;
      const previous = declaredRelationships.get(id);
      const globalOwner = globalIdOwners.get(id);
      if (
        (globalOwner && globalOwner.token !== patch) ||
        knownRelationships.has(id) ||
        previous
      ) {
        errors.push(
          `${path}/${patchIndex}/relationship/id: duplicate introduced relationship ID "${id}"` +
            (globalOwner && globalOwner.token !== patch
              ? ` (already used by ${globalOwner.path})`
              : previous
                ? ` (already introduced by ${previous.path})`
                : ''),
        );
      } else {
        declaredRelationships.set(id, { token: patch, path: declarationPath });
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
    for (const [groupIndex, group] of groups.entries()) {
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
  const unconditionalRelationships = new Set(proposalRelationships);
  for (const [groupIndex, group] of groups.entries()) {
    if (!guaranteedGroups.has(group.id)) continue;
    for (const conflict of group.conflictsWith ?? []) {
      if (guaranteedGroups.has(conflict)) {
        errors.push(
          `${owner}/patchGroups/${groupIndex}/conflictsWith: groups "${group.id}" and "${conflict}" are selected by a locked group closure and conflict; selection is impossible`,
        );
      }
    }
  }
  applyGroups(guaranteedGroups, proposalRelationships, introducedRelationships);

  for (const group of groups) {
    if (guaranteedGroups.has(group.id) || group.patches.length === 0) continue;
    const selected = dependencyClosure([group.id]);
    guaranteedGroups.forEach((id) => selected.add(id));
    const groupRelationships = new Set(unconditionalRelationships);
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
  const hasLeadership = hasLeadershipData(document);
  const hasTaxonomy = hasTaxonomyData(document);
  const fatalErrors: string[] = [];
  const knownNodes = new Set(Object.keys(document.nodes));
  const idOwners = new Map<string, IdOwner>();
  const registerId = (id: string, path: string, token: object): void => {
    const previous = idOwners.get(id);
    if (previous) {
      fatalErrors.push(`${path}: duplicate global ID "${id}" (already used by ${previous.path})`);
    } else {
      idOwners.set(id, { token, path });
    }
  };

  Object.keys(document.nodes).forEach((id) =>
    registerId(id, `nodes/${escapeJsonPointer(id)}`, document.nodes[id]!),
  );
  document.snapshots.forEach((snapshot, index) =>
    registerId(snapshot.id, `snapshots/${index}/id`, snapshot),
  );
  document.proposals.forEach((proposal, index) =>
    registerId(proposal.id, `proposals/${index}/id`, proposal),
  );
  document.relationships?.forEach((relationship, index) =>
    registerId(relationship.id, `relationships/${index}/id`, relationship),
  );
  document.zones?.forEach((zone, index) =>
    registerId(zone.id, `zones/${index}/id`, zone),
  );
  document.proposals.forEach((proposal, proposalIndex) =>
    proposal.patchGroups?.forEach((group, groupIndex) =>
      registerId(
        group.id,
        `proposals/${proposalIndex}/patchGroups/${groupIndex}/id`,
        group,
      ),
    ),
  );

  for (const snapshot of document.snapshots) {
    fatalErrors.push(...hierarchyErrors(`snapshot/${snapshot.id}`, snapshot, knownNodes));
    Object.entries(snapshot.nodes).forEach(([id, state]) => {
      fatalErrors.push(...leadershipErrors(`snapshot/${snapshot.id}/nodes/${escapeJsonPointer(id)}`, state.leadership));
    });
    if (hasTaxonomy) {
      fatalErrors.push(...resolvedTaxonomyErrors(document, snapshot.id, `snapshot/${escapeJsonPointer(snapshot.id)}`));
    }
  }
  Object.entries(document.nodes).forEach(([id, node]) => {
    fatalErrors.push(...leadershipErrors(`nodes/${escapeJsonPointer(id)}`, node.leadership));
  });
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
  document.proposals.forEach((proposal) => {
    proposal.snapshot && Object.entries(proposal.snapshot.nodes).forEach(([id, state]) => {
      fatalErrors.push(...leadershipErrors(`proposal/${escapeJsonPointer(proposal.id)}/snapshot/nodes/${escapeJsonPointer(id)}`, state.leadership));
    });
    proposal.patches?.forEach((patch, index) => {
      if (patch.type === 'set-node' || patch.type === 'add-node') {
        fatalErrors.push(...leadershipErrors(`proposal/${escapeJsonPointer(proposal.id)}/patches/${index}/value`, patch.value?.leadership));
      }
    });
    proposal.patchGroups?.forEach((group, groupIndex) => {
      group.patches.forEach((patch, patchIndex) => {
        if (patch.type === 'set-node' || patch.type === 'add-node') {
          fatalErrors.push(...leadershipErrors(`proposal/${escapeJsonPointer(proposal.id)}/patchGroups/${groupIndex}/patches/${patchIndex}/value`, patch.value?.leadership));
        }
      });
    });
  });
  if (fatalErrors.length > 0) return { ok: false, errors: fatalErrors };

  const recordIntroducedOwners = (patches: readonly Patch[], path: string): void => {
    patches.forEach((patch, patchIndex) => {
      if (patch.type === 'add-relationship' && !idOwners.has(patch.relationship.id)) {
        idOwners.set(patch.relationship.id, {
          token: patch,
          path: `${path}/${patchIndex}`,
        });
      }
    });
  };
  document.proposals.forEach((proposal) => {
    const proposalPath = `proposal/${escapeJsonPointer(proposal.id)}`;
    recordIntroducedOwners(proposal.patches ?? [], `${proposalPath}/patches`);
    proposal.patchGroups?.forEach((group, groupIndex) => {
      recordIntroducedOwners(
        group.patches,
        `${proposalPath}/patchGroups/${groupIndex}/patches`,
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
        if (hasLeadership) {
          const leadershipResult = resolvedLeadershipErrors(
            document,
            proposal.id,
            `proposal/${escapeJsonPointer(proposal.id)}`,
          );
          if (leadershipResult.length > 0) mutableViewErrors.set(proposal.id, leadershipResult);
        }
        if (hasTaxonomy) {
          const taxonomyResult = resolvedTaxonomyErrors(
            document,
            proposal.id,
            `proposal/${escapeJsonPointer(proposal.id)}`,
          );
          if (taxonomyResult.length > 0) mutableViewErrors.set(proposal.id, taxonomyResult);
          const selectableResult = selectableTaxonomyErrors(document, proposal);
          if (selectableResult.length > 0) {
            mutableViewErrors.set(proposal.id, [
              ...(mutableViewErrors.get(proposal.id) ?? []),
              ...selectableResult,
            ]);
          }
        }
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
