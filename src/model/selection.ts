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
  for (const group of groups) {
    for (const requirement of group.requires ?? []) {
      const entries = dependents.get(requirement) ?? [];
      entries.push(group.id);
      dependents.set(requirement, entries);
    }
  }
  return { groups, byId, ids: new Set(byId.keys()), dependents };
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

function normalizedFingerprint(value: unknown): string {
  if (value === undefined) return 'undefined';
  if (value === null) return 'null';
  if (typeof value === 'string') return `string:${JSON.stringify(value)}`;
  if (typeof value === 'number') return `number:${String(value)}`;
  if (typeof value === 'boolean') return `boolean:${String(value)}`;
  if (Array.isArray(value)) {
    return `array:[${value.map(normalizedFingerprint).join(',')}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .sort(([first], [second]) => first.localeCompare(second))
    .map(([key, entry]) => `${JSON.stringify(key)}:${normalizedFingerprint(entry)}`);
  return `object:{${entries.join(',')}}`;
}

function concreteWrite(target: string, value: unknown): ConcreteWrite {
  return { target, value, fingerprint: normalizedFingerprint(value) };
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
  const positions = new Map(index.groups.map((group, position) => [group.id, position]));
  const declaredPairs = new Set<string>();
  const writes = new Map<string, { group: string; fingerprint: string }>();

  for (const group of selectedGroups) {
    for (const other of group.conflictsWith ?? []) {
      if (!selected.has(other)) continue;
      const first = positions.get(group.id)! < positions.get(other)! ? group.id : other;
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
    for (const [target, write] of effectiveWrites(group)) {
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

export function validateSelection(
  proposal: Proposal,
  selectedIds: readonly string[],
): string | undefined {
  const index = indexGroups(proposal);
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

function lockedClosure(index: GroupIndex): Set<string> {
  return dependencyClosure(
    index,
    index.groups.filter((group) => group.locked).map((group) => group.id),
  );
}

function disabledGroups(proposal: Proposal, index: GroupIndex): Map<string, string> {
  const disabled = new Map<string, string>();
  const locked = lockedClosure(index);
  if (locked.size === 0) return disabled;
  const lockedDeclaredConflicts = new Map<string, string>();
  const lockedWrites = new Map<string, { group: string; fingerprint: string }>();
  for (const group of index.groups) {
    if (!locked.has(group.id)) continue;
    for (const other of group.conflictsWith ?? []) lockedDeclaredConflicts.set(other, group.id);
    for (const [target, write] of effectiveWrites(group)) {
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
    for (const [target, write] of effectiveWrites(group)) {
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
  proposal: Proposal,
  index: GroupIndex,
  selected: ReadonlySet<string>,
  error?: string,
): PatchSelection {
  return {
    selected: ordered(index, selected),
    disabled: disabledGroups(proposal, index),
    ...(error ? { error } : {}),
  };
}

export function initialPatchSelection(proposal: Proposal): PatchSelection {
  const index = indexGroups(proposal);
  const selected = lockedClosure(index);
  const disabled = disabledGroups(proposal, index);
  for (const group of index.groups) {
    if (!group.defaultSelected || selected.has(group.id) || disabled.has(group.id)) continue;
    const candidate = dependencyClosure(index, [group.id]);
    selected.forEach((id) => candidate.add(id));
    if (validateSelection(proposal, ordered(index, candidate))) continue;
    candidate.forEach((id) => selected.add(id));
  }
  return resultFor(proposal, index, selected, validateSelection(proposal, ordered(index, selected)));
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
    return resultFor(proposal, index, selected, `Unknown patch group "${groupId}"`);
  }

  if (!checked) {
    if (locked.has(groupId)) {
      return resultFor(proposal, index, selected, `Locked group "${groupId}" cannot be deselected`);
    }
    removeWithDependents(index, selected, groupId);
    return resultFor(proposal, index, selected, validateSelection(proposal, ordered(index, selected)));
  }

  if (current.disabled.has(groupId)) {
    return resultFor(proposal, index, selected, current.error);
  }

  const protectedGroups = dependencyClosure(index, [groupId]);
  locked.forEach((id) => protectedGroups.add(id));
  const protectedError = validateSelection(proposal, ordered(index, protectedGroups));
  if (protectedError) return resultFor(proposal, index, selected, protectedError);
  protectedGroups.forEach((id) => selected.add(id));

  while (true) {
    const conflict = selectedConflicts(index, selected)[0];
    if (!conflict) break;
    const victim = protectedGroups.has(conflict.first) ? conflict.second : conflict.first;
    if (protectedGroups.has(victim) || locked.has(victim)) {
      return resultFor(proposal, index, new Set(current.selected), conflict.message);
    }
    removeWithDependents(index, selected, victim);
  }
  return resultFor(proposal, index, selected, validateSelection(proposal, ordered(index, selected)));
}
