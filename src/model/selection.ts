import type { Patch, PatchGroup, Proposal } from './types';

export interface PatchSelection {
  selected: readonly string[];
  disabled: ReadonlyMap<string, string>;
  error?: string;
}

interface GroupIndex {
  groups: readonly PatchGroup[];
  byId: ReadonlyMap<string, PatchGroup>;
  ids: ReadonlySet<string>;
  dependents: ReadonlyMap<string, readonly string[]>;
  positions: ReadonlyMap<string, number>;
  declaredConflicts: ReadonlyMap<string, ReadonlySet<string>>;
  writes: ReadonlyMap<string, ReadonlyMap<string, ConcreteWrite>>;
  writeIndex: ReadonlyMap<string, ReadonlyMap<string, ReadonlySet<string>>>;
}

interface GroupConflict {
  first: string;
  second: string;
  message: string;
}

function indexGroups(proposal: Proposal): GroupIndex {
  const groups = proposal.patchGroups ?? [];
  const byId = new Map(groups.map((group) => [group.id, group]));
  const dependents = new Map<string, string[]>();
  const declaredConflicts = new Map<string, Set<string>>();
  const writes = new Map<string, ReadonlyMap<string, ConcreteWrite>>();
  const writeIndex = new Map<string, Map<string, Set<string>>>();
  for (const group of groups) {
    for (const requirement of group.requires ?? []) {
      const entries = dependents.get(requirement) ?? [];
      entries.push(group.id);
      dependents.set(requirement, entries);
    }
    for (const conflict of group.conflictsWith ?? []) {
      const own = declaredConflicts.get(group.id) ?? new Set<string>();
      const other = declaredConflicts.get(conflict) ?? new Set<string>();
      own.add(conflict);
      other.add(group.id);
      declaredConflicts.set(group.id, own);
      declaredConflicts.set(conflict, other);
    }
    const groupWrites = effectiveWrites(group);
    writes.set(group.id, groupWrites);
    for (const [target, write] of groupWrites) {
      const fingerprints = writeIndex.get(target) ?? new Map<string, Set<string>>();
      const owners = fingerprints.get(write.fingerprint) ?? new Set<string>();
      owners.add(group.id);
      fingerprints.set(write.fingerprint, owners);
      writeIndex.set(target, fingerprints);
    }
  }
  return {
    groups,
    byId,
    ids: new Set(byId.keys()),
    dependents,
    positions: new Map(groups.map((group, position) => [group.id, position])),
    declaredConflicts,
    writes,
    writeIndex,
  };
}

function dependencyClosure(index: GroupIndex, initial: Iterable<string>): Set<string> {
  const result = new Set<string>();
  const pending = [...initial];
  while (pending.length > 0) {
    const id = pending.pop()!;
    if (result.has(id)) continue;
    result.add(id);
    const requirements = index.byId.get(id)?.requires ?? [];
    for (let position = requirements.length - 1; position >= 0; position -= 1) {
      pending.push(requirements[position]!);
    }
  }
  return result;
}

function ordered(index: GroupIndex, selected: ReadonlySet<string>): string[] {
  return index.groups.filter((group) => selected.has(group.id)).map((group) => group.id);
}

export interface ConcreteWrite {
  target: string;
  value: unknown;
  fingerprint: string;
}

export function concreteValueFingerprint(value: unknown): string {
  if (value === undefined) return 'undefined';
  if (value === null) return 'null';
  if (typeof value === 'string') return `string:${JSON.stringify(value)}`;
  if (typeof value === 'number') return `number:${String(value)}`;
  if (typeof value === 'boolean') return `boolean:${String(value)}`;
  if (Array.isArray(value)) {
    return `array:[${value.map(concreteValueFingerprint).join(',')}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .sort(([first], [second]) => first.localeCompare(second))
    .map(([key, entry]) => `${JSON.stringify(key)}:${concreteValueFingerprint(entry)}`);
  return `object:{${entries.join(',')}}`;
}

function concreteWrite(target: string, value: unknown): ConcreteWrite {
  return { target, value, fingerprint: concreteValueFingerprint(value) };
}

export function concretePatchWrites(patch: Patch): readonly ConcreteWrite[] {
  switch (patch.type) {
    case 'add-node':
      return [
        concreteWrite(`${patch.node}.existence`, true),
        ...Object.entries(patch.value ?? {}).map(([key, value]) =>
          concreteWrite(`${patch.node}.${key}`, value),
        ),
      ];
    case 'remove-node':
      return [concreteWrite(`${patch.node}.existence`, false)];
    case 'set-node':
      return Object.entries(patch.value).map(([key, value]) =>
        concreteWrite(`${patch.node}.${key}`, value),
      );
    case 'set-parent':
      return [
        concreteWrite(`${patch.node}.parent`, {
          parent: patch.parent,
          relationship: patch.relationship,
          note: patch.note,
          sources: patch.sources?.map((source) => ({ label: source.label, url: source.url })),
        }),
      ];
    case 'remove-parent':
      return [concreteWrite(`${patch.node}.parent`, null)];
    case 'add-relationship':
      return [
        concreteWrite(`${patch.relationship.id}.existence`, true),
        ...Object.entries(patch.relationship)
          .filter(([key]) => key !== 'id')
          .map(([key, value]) => concreteWrite(`${patch.relationship.id}.${key}`, value)),
      ];
    case 'remove-relationship':
      return [concreteWrite(`${patch.relationship}.existence`, false)];
    case 'set-relationship':
      return Object.entries(patch.value).map(([key, value]) =>
        concreteWrite(`${patch.relationship}.${key}`, value),
      );
    case 'add-comparison-tier':
      return [
        concreteWrite(`taxonomy.tiers.${patch.tier.id}.existence`, true),
        ...Object.entries(patch.tier).filter(([key]) => key !== 'id').map(([key, value]) =>
          concreteWrite(`taxonomy.tiers.${patch.tier.id}.${key}`, value)),
      ];
    case 'set-comparison-tier':
      return [
        concreteWrite(`taxonomy.tiers.${patch.tier}.existence`, true),
        ...Object.entries(patch.value).map(([key, value]) => concreteWrite(`taxonomy.tiers.${patch.tier}.${key}`, value)),
      ];
    case 'remove-comparison-tier':
      return [concreteWrite(`taxonomy.tiers.${patch.tier}.existence`, false)];
    case 'set-comparison-tier-order':
      return [concreteWrite('taxonomy.tierOrder', patch.tiers)];
    case 'add-taxonomy-system':
      return [
        concreteWrite(`taxonomy.systems.${patch.taxonomy.id}.existence`, true),
        ...Object.entries(patch.taxonomy).filter(([key]) => key !== 'id').map(([key, value]) =>
          concreteWrite(`taxonomy.systems.${patch.taxonomy.id}.${key}`, value)),
      ];
    case 'set-taxonomy-system':
      return [
        concreteWrite(`taxonomy.systems.${patch.taxonomy}.existence`, true),
        ...Object.entries(patch.value).map(([key, value]) => concreteWrite(`taxonomy.systems.${patch.taxonomy}.${key}`, value)),
      ];
    case 'remove-taxonomy-system':
      return [concreteWrite(`taxonomy.systems.${patch.taxonomy}.existence`, false)];
    case 'add-taxonomy-level':
      return [
        concreteWrite(`taxonomy.systems.${patch.taxonomy}.levels.${patch.level.id}.existence`, true),
        ...Object.entries(patch.level).filter(([key]) => key !== 'id').map(([key, value]) =>
          concreteWrite(`taxonomy.systems.${patch.taxonomy}.levels.${patch.level.id}.${key}`, value)),
      ];
    case 'set-taxonomy-level':
      return [
        concreteWrite(`taxonomy.systems.${patch.taxonomy}.levels.${patch.level}.existence`, true),
        ...Object.entries(patch.value).map(([key, value]) =>
          concreteWrite(`taxonomy.systems.${patch.taxonomy}.levels.${patch.level}.${key}`, value)),
      ];
    case 'remove-taxonomy-level':
      return [concreteWrite(`taxonomy.systems.${patch.taxonomy}.levels.${patch.level}.existence`, false)];
    case 'set-taxonomy-assignment':
      return [concreteWrite(`nodes.${patch.node}.taxonomyAssignments.${patch.taxonomy}`, patch.level)];
    case 'remove-taxonomy-assignment':
      return [concreteWrite(`nodes.${patch.node}.taxonomyAssignments.${patch.taxonomy}`, null)];
    default:
      return [];
  }
}

function effectiveWrites(group: PatchGroup): ReadonlyMap<string, ConcreteWrite> {
  const writes = new Map<string, ConcreteWrite>();
  if (!Array.isArray(group.patches)) return writes;
  for (const patch of group.patches) {
    for (const write of concretePatchWrites(patch)) writes.set(write.target, write);
  }
  return writes;
}

function selectedConflicts(index: GroupIndex, selected: ReadonlySet<string>): GroupConflict[] {
  const conflicts: GroupConflict[] = [];
  const selectedGroups = index.groups.filter((group) => selected.has(group.id));
  const declaredPairs = new Set<string>();
  const writes = new Map<string, { group: string; fingerprint: string }>();

  for (const group of selectedGroups) {
    for (const other of index.declaredConflicts.get(group.id) ?? []) {
      if (!selected.has(other)) continue;
      const first = index.positions.get(group.id)! < index.positions.get(other)! ? group.id : other;
      const second = first === group.id ? other : group.id;
      const pair = `${first}\0${second}`;
      if (declaredPairs.has(pair)) continue;
      declaredPairs.add(pair);
      conflicts.push({
        first,
        second,
        message: `Patch groups "${first}" and "${second}" conflict`,
      });
    }
    for (const [target, write] of index.writes.get(group.id) ?? []) {
      const previous = writes.get(target);
      if (previous && previous.fingerprint !== write.fingerprint) {
        conflicts.push({
          first: previous.group,
          second: group.id,
          message: `Patch groups "${previous.group}" and "${group.id}" both set ${target} differently`,
        });
      }
      writes.set(target, { group: group.id, fingerprint: write.fingerprint });
    }
  }
  return conflicts;
}

function conflictingSelectedGroups(
  index: GroupIndex,
  groups: ReadonlySet<string>,
  selected: ReadonlySet<string>,
): Set<string> {
  const conflicts = new Set<string>();
  const fingerprints = new Map<string, string>();
  for (const groupId of groups) {
    for (const other of index.declaredConflicts.get(groupId) ?? []) {
      if (selected.has(other)) conflicts.add(other);
    }
    for (const [target, write] of index.writes.get(groupId) ?? []) {
      fingerprints.set(target, write.fingerprint);
    }
  }
  for (const [target, selectedFingerprint] of fingerprints) {
    for (const [fingerprint, owners] of index.writeIndex.get(target) ?? []) {
      if (fingerprint === selectedFingerprint) continue;
      for (const owner of owners) {
        if (selected.has(owner)) conflicts.add(owner);
      }
    }
  }
  groups.forEach((id) => conflicts.delete(id));
  return conflicts;
}

function closureConflict(
  index: GroupIndex,
  candidate: ReadonlySet<string>,
  accepted: ReadonlySet<string>,
  acceptedWrites: ReadonlyMap<string, { group: string; fingerprint: string }>,
): GroupConflict | undefined {
  const candidateWrites = new Map<string, { group: string; fingerprint: string }>();
  for (const groupId of candidate) {
    const group = index.byId.get(groupId);
    if (!group) continue;
    for (const other of index.declaredConflicts.get(groupId) ?? []) {
      if (!candidate.has(other) && !accepted.has(other)) continue;
      const first = index.positions.get(groupId)! < index.positions.get(other)! ? groupId : other;
      const second = first === groupId ? other : groupId;
      return {
        first,
        second,
        message: `Patch groups "${first}" and "${second}" conflict`,
      };
    }
    for (const [target, write] of index.writes.get(groupId) ?? []) {
      const previous = candidateWrites.get(target) ?? acceptedWrites.get(target);
      if (previous && previous.fingerprint !== write.fingerprint) {
        return {
          first: previous.group,
          second: groupId,
          message: `Patch groups "${previous.group}" and "${groupId}" both set ${target} differently`,
        };
      }
      candidateWrites.set(target, { group: groupId, fingerprint: write.fingerprint });
    }
  }
  return undefined;
}

function recordWrites(
  index: GroupIndex,
  groups: ReadonlySet<string>,
  writes: Map<string, { group: string; fingerprint: string }>,
): void {
  for (const groupId of groups) {
    for (const [target, write] of index.writes.get(groupId) ?? []) {
      writes.set(target, { group: groupId, fingerprint: write.fingerprint });
    }
  }
}

function dependencyCycle(index: GroupIndex, selected: ReadonlySet<string>): readonly string[] {
  const remaining = new Map<string, number>();
  const ready: string[] = [];
  for (const id of selected) {
    const count = (index.byId.get(id)?.requires ?? []).filter((required) => selected.has(required)).length;
    remaining.set(id, count);
    if (count === 0) ready.push(id);
  }
  let processed = 0;
  for (let cursor = 0; cursor < ready.length; cursor += 1) {
    const id = ready[cursor]!;
    processed += 1;
    for (const dependent of index.dependents.get(id) ?? []) {
      if (!selected.has(dependent)) continue;
      const count = remaining.get(dependent)! - 1;
      remaining.set(dependent, count);
      if (count === 0) ready.push(dependent);
    }
  }
  return processed === selected.size
    ? []
    : ordered(index, new Set([...remaining].filter(([, count]) => count > 0).map(([id]) => id)));
}

function validateIndexed(index: GroupIndex, selectedIds: readonly string[]): string | undefined {
  const selected = new Set(selectedIds);
  for (const id of selected) {
    if (!index.ids.has(id)) return `Unknown patch group "${id}"`;
  }
  for (const group of index.groups) {
    if (group.locked && !selected.has(group.id)) return `Locked group "${group.id}" is not selected`;
  }
  for (const group of index.groups) {
    if (!selected.has(group.id)) continue;
    for (const requirement of group.requires ?? []) {
      if (!index.ids.has(requirement)) {
        return `Patch group "${group.id}" requires unknown group "${requirement}"`;
      }
      if (!selected.has(requirement)) {
        return `Patch group "${group.id}" requires unselected group "${requirement}"`;
      }
    }
  }
  const cycle = dependencyCycle(index, selected);
  if (cycle.length > 0) return `Patch group dependency cycle involving ${cycle.join(', ')}`;
  return selectedConflicts(index, selected)[0]?.message;
}

export function validateSelection(
  proposal: Proposal,
  selectedIds: readonly string[],
): string | undefined {
  return validateIndexed(indexGroups(proposal), selectedIds);
}

function lockedClosure(index: GroupIndex): Set<string> {
  return dependencyClosure(
    index,
    index.groups.filter((group) => group.locked).map((group) => group.id),
  );
}

function disabledGroups(index: GroupIndex, locked = lockedClosure(index)): Map<string, string> {
  const disabled = new Map<string, string>();
  if (locked.size === 0) return disabled;
  const lockedDeclaredConflicts = new Map<string, string>();
  const lockedWrites = new Map<string, { group: string; fingerprint: string }>();
  for (const group of index.groups) {
    if (!locked.has(group.id)) continue;
    for (const other of group.conflictsWith ?? []) lockedDeclaredConflicts.set(other, group.id);
    for (const [target, write] of index.writes.get(group.id) ?? []) {
      lockedWrites.set(target, { group: group.id, fingerprint: write.fingerprint });
    }
  }
  for (const group of index.groups) {
    if (locked.has(group.id)) continue;
    const declared = (group.conflictsWith ?? []).find((id) => locked.has(id));
    const lockedDeclarer = lockedDeclaredConflicts.get(group.id);
    if (declared || lockedDeclarer) {
      const lockedGroup = declared ?? lockedDeclarer!;
      disabled.set(group.id, `Patch group "${group.id}" conflicts with locked group "${lockedGroup}"`);
      continue;
    }
    for (const [target, write] of index.writes.get(group.id) ?? []) {
      const previous = lockedWrites.get(target);
      if (previous && previous.fingerprint !== write.fingerprint) {
        disabled.set(
          group.id,
          `Patch groups "${previous.group}" and "${group.id}" both set ${target} differently`,
        );
        break;
      }
    }
  }
  const pending = [...disabled.keys()];
  for (let cursor = 0; cursor < pending.length; cursor += 1) {
    const unavailable = pending[cursor]!;
    for (const dependent of index.dependents.get(unavailable) ?? []) {
      if (disabled.has(dependent) || locked.has(dependent)) continue;
      disabled.set(dependent, disabled.get(unavailable)!);
      pending.push(dependent);
    }
  }
  return disabled;
}

function resultFor(
  index: GroupIndex,
  selected: ReadonlySet<string>,
  error?: string,
  disabled = disabledGroups(index),
): PatchSelection {
  return {
    selected: ordered(index, selected),
    disabled,
    ...(error ? { error } : {}),
  };
}

export function initialPatchSelection(proposal: Proposal): PatchSelection {
  const index = indexGroups(proposal);
  const locked = lockedClosure(index);
  const disabled = disabledGroups(index, locked);
  const selected = new Set(locked);
  const acceptedWrites = new Map<string, { group: string; fingerprint: string }>();
  recordWrites(index, locked, acceptedWrites);
  for (const group of index.groups) {
    if (!group.defaultSelected || selected.has(group.id) || disabled.has(group.id)) continue;
    const closure = dependencyClosure(index, [group.id]);
    const candidate = new Set([...closure].filter((id) => !selected.has(id)));
    const conflict = closureConflict(index, candidate, selected, acceptedWrites);
    if (conflict) continue;
    candidate.forEach((id) => selected.add(id));
    recordWrites(index, candidate, acceptedWrites);
  }
  const selectedIds = ordered(index, selected);
  return resultFor(index, selected, validateIndexed(index, selectedIds), disabled);
}

function removeWithDependents(index: GroupIndex, selected: Set<string>, initial: string): void {
  const pending = [initial];
  while (pending.length > 0) {
    const id = pending.pop()!;
    if (!selected.delete(id)) continue;
    for (const dependent of index.dependents.get(id) ?? []) {
      if (selected.has(dependent)) pending.push(dependent);
    }
  }
}

export function togglePatchGroup(
  proposal: Proposal,
  current: PatchSelection,
  groupId: string,
  checked: boolean,
): PatchSelection {
  const index = indexGroups(proposal);
  const selected = new Set(current.selected);
  const locked = lockedClosure(index);
  if (!index.ids.has(groupId)) {
    return resultFor(index, selected, `Unknown patch group "${groupId}"`);
  }

  if (!checked) {
    if (locked.has(groupId)) {
      return resultFor(index, selected, `Locked group "${groupId}" cannot be deselected`);
    }
    removeWithDependents(index, selected, groupId);
    const selectedIds = ordered(index, selected);
    return resultFor(index, selected, validateIndexed(index, selectedIds));
  }

  if (current.disabled.has(groupId)) {
    return resultFor(index, selected, current.error);
  }

  const protectedGroups = dependencyClosure(index, [groupId]);
  locked.forEach((id) => protectedGroups.add(id));
  const protectedError = validateIndexed(index, ordered(index, protectedGroups));
  if (protectedError) return resultFor(index, selected, protectedError);
  protectedGroups.forEach((id) => selected.add(id));

  for (const conflict of conflictingSelectedGroups(index, protectedGroups, selected)) {
    if (locked.has(conflict)) {
      const conflictError = validateIndexed(index, ordered(index, selected));
      return resultFor(index, new Set(current.selected), conflictError);
    }
    removeWithDependents(index, selected, conflict);
  }
  const selectedIds = ordered(index, selected);
  return resultFor(index, selected, validateIndexed(index, selectedIds));
}
