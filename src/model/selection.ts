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

function sameValue(first: unknown, second: unknown): boolean {
  if (Object.is(first, second)) return true;
  if (typeof first !== typeof second || first === null || second === null) return false;
  if (Array.isArray(first) || Array.isArray(second)) {
    return (
      Array.isArray(first) &&
      Array.isArray(second) &&
      first.length === second.length &&
      first.every((value, index) => sameValue(value, second[index]))
    );
  }
  if (typeof first !== 'object') return false;
  const firstRecord = first as Record<string, unknown>;
  const secondRecord = second as Record<string, unknown>;
  const firstKeys = Object.keys(firstRecord).sort();
  const secondKeys = Object.keys(secondRecord).sort();
  return (
    firstKeys.length === secondKeys.length &&
    firstKeys.every(
      (key, keyIndex) =>
        key === secondKeys[keyIndex] && sameValue(firstRecord[key], secondRecord[key]),
    )
  );
}

function patchWrites(patch: Patch): readonly (readonly [string, unknown])[] {
  switch (patch.type) {
    case 'add-node':
      return [
        [`${patch.node}.existence`, true],
        ...Object.entries(patch.value ?? {}).map(([key, value]) => [
          `${patch.node}.${key}`,
          value,
        ] as const),
      ];
    case 'remove-node':
      return [[`${patch.node}.existence`, false]];
    case 'set-node':
      return Object.entries(patch.value).map(([key, value]) => [`${patch.node}.${key}`, value]);
    case 'set-parent':
      return [[`${patch.node}.parent`, { parent: patch.parent, relationship: patch.relationship }]];
    case 'remove-parent':
      return [[`${patch.node}.parent`, null]];
    case 'add-relationship':
      return [
        [`${patch.relationship.id}.existence`, true],
        ...Object.entries(patch.relationship)
          .filter(([key]) => key !== 'id')
          .map(([key, value]) => [`${patch.relationship.id}.${key}`, value] as const),
      ];
    case 'remove-relationship':
      return [[`${patch.relationship}.existence`, false]];
    case 'set-relationship':
      return Object.entries(patch.value).map(([key, value]) => [
        `${patch.relationship}.${key}`,
        value,
      ]);
    default:
      return [];
  }
}

function effectiveWrites(group: PatchGroup): ReadonlyMap<string, unknown> {
  const writes = new Map<string, unknown>();
  if (!Array.isArray(group.patches)) return writes;
  for (const patch of group.patches) {
    for (const [target, value] of patchWrites(patch)) writes.set(target, value);
  }
  return writes;
}

function selectedConflicts(index: GroupIndex, selected: ReadonlySet<string>): GroupConflict[] {
  const conflicts: GroupConflict[] = [];
  const selectedGroups = index.groups.filter((group) => selected.has(group.id));
  const positions = new Map(index.groups.map((group, position) => [group.id, position]));
  const declaredPairs = new Set<string>();
  const writes = new Map<string, { group: string; value: unknown }>();

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
    for (const [target, value] of effectiveWrites(group)) {
      const previous = writes.get(target);
      if (previous && !sameValue(previous.value, value)) {
        conflicts.push({
          first: previous.group,
          second: group.id,
          message: `Patch groups "${previous.group}" and "${group.id}" both set ${target} differently`,
        });
      }
      writes.set(target, { group: group.id, value });
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
  const lockedWrites = new Map<string, { group: string; value: unknown }>();
  for (const group of index.groups) {
    if (!locked.has(group.id)) continue;
    for (const other of group.conflictsWith ?? []) lockedDeclaredConflicts.set(other, group.id);
    for (const [target, value] of effectiveWrites(group)) {
      lockedWrites.set(target, { group: group.id, value });
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
    for (const [target, value] of effectiveWrites(group)) {
      const previous = lockedWrites.get(target);
      if (previous && !sameValue(previous.value, value)) {
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
  const selected = dependencyClosure(
    index,
    index.groups
      .filter((group) => group.locked || group.defaultSelected)
      .map((group) => group.id),
  );
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
