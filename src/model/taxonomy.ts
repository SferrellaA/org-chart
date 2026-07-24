import type {
  ComparisonTier,
  Patch,
  ResolvedNode,
  Source,
  TaxonomyLevel,
  TaxonomyPatch,
  TaxonomyState,
  TaxonomySystem,
} from './types';

export interface TaxonomyPatchEntry {
  patch: TaxonomyPatch;
  path: string;
}

export class TaxonomyError extends Error {
  constructor(path: string, message: string) {
    super(path ? `${path}: ${message}` : message);
    this.name = 'TaxonomyError';
  }
}

const EMPTY_TAXONOMY: TaxonomyState = { comparisonTiers: [], systems: [] };

function cloneSources(sources: readonly Source[] | undefined): Source[] | undefined {
  return sources?.map((source) => ({ ...source }));
}

function cloneTier(tier: ComparisonTier): ComparisonTier {
  return { ...tier, ...(tier.sources ? { sources: tier.sources.map((source) => ({ ...source })) } : {}) };
}

function cloneLevel(level: TaxonomyLevel): TaxonomyLevel {
  return { ...level, ...(level.sources ? { sources: level.sources.map((source) => ({ ...source })) } : {}) };
}

function cloneSystem(system: TaxonomySystem): TaxonomySystem {
  return {
    ...system,
    levels: system.levels.map(cloneLevel),
    ...(system.sources ? { sources: system.sources.map((source) => ({ ...source })) } : {}),
  };
}

export function cloneTaxonomy(state: TaxonomyState | undefined): TaxonomyState {
  const source = state ?? EMPTY_TAXONOMY;
  return {
    comparisonTiers: source.comparisonTiers.map(cloneTier),
    systems: source.systems.map(cloneSystem),
  };
}

export function isTaxonomyPatch(patch: Patch): patch is TaxonomyPatch {
  return patch.type.includes('taxonomy') || patch.type.includes('comparison-tier');
}

function equal(first: unknown, second: unknown): boolean {
  return JSON.stringify(first) === JSON.stringify(second);
}

function recordWrite(writes: Map<string, { value: unknown; path: string }>, target: string, value: unknown, path: string): void {
  const previous = writes.get(target);
  if (previous && !equal(previous.value, value)) {
    throw new TaxonomyError(path, `conflicting taxonomy writes to ${target} (first written at ${previous.path})`);
  }
  writes.set(target, { value, path });
}

export function validateTaxonomyState(
  taxonomy: TaxonomyState,
  nodes: ReadonlyMap<string, ResolvedNode>,
  path: string,
): void {
  const tiers = new Map<string, ComparisonTier>();
  for (const tier of taxonomy.comparisonTiers) {
    if (tiers.has(tier.id)) throw new TaxonomyError(path, `duplicate comparison tier "${tier.id}"`);
    tiers.set(tier.id, tier);
  }
  const systems = new Map<string, TaxonomySystem>();
  for (const system of taxonomy.systems) {
    if (systems.has(system.id)) throw new TaxonomyError(path, `duplicate taxonomy system "${system.id}"`);
    systems.set(system.id, system);
    const levels = new Set<string>();
    for (const level of system.levels) {
      if (levels.has(level.id)) throw new TaxonomyError(path, `duplicate level "${system.id}/${level.id}"`);
      levels.add(level.id);
      if (!tiers.has(level.tier)) {
        throw new TaxonomyError(path, `level "${system.id}/${level.id}" references missing tier "${level.tier}"`);
      }
    }
  }
  for (const [nodeId, node] of nodes) {
    for (const [systemId, levelId] of Object.entries(node.taxonomyAssignments ?? {})) {
      const system = systems.get(systemId);
      if (!system) throw new TaxonomyError(path, `node "${nodeId}" references missing taxonomy "${systemId}"`);
      if (!system.levels.some((level) => level.id === levelId)) {
        throw new TaxonomyError(path, `node "${nodeId}" references missing level "${systemId}/${levelId}"`);
      }
    }
  }
}

export function resolveTaxonomyAssignments(
  taxonomy: TaxonomyState,
  nodes: Map<string, ResolvedNode>,
  path: string,
): void {
  validateTaxonomyState(taxonomy, nodes, path);
  const systems = new Map(taxonomy.systems.map((system) => [system.id, system]));
  for (const node of nodes.values()) {
    const assignments = Object.entries(node.taxonomyAssignments ?? {})
      .sort(([first], [second]) => first.localeCompare(second))
      .map(([systemId, levelId]) => {
        const level = systems.get(systemId)!.levels.find((item) => item.id === levelId)!;
        return { systemId, levelId, tierId: level.tier };
      });
    if (assignments.length > 0) node.resolvedTaxonomyAssignments = assignments;
    else delete node.resolvedTaxonomyAssignments;
  }
}

export function applyTaxonomyTransaction(
  base: TaxonomyState,
  nodes: Map<string, ResolvedNode>,
  entries: readonly TaxonomyPatchEntry[],
  path: string,
): TaxonomyState {
  if (entries.length === 0) {
    const cloned = cloneTaxonomy(base);
    resolveTaxonomyAssignments(cloned, nodes, path);
    return cloned;
  }

  const writes = new Map<string, { value: unknown; path: string }>();
  for (const { patch, path: patchPath } of entries) {
    switch (patch.type) {
      case 'add-comparison-tier':
        recordWrite(writes, `tier/${patch.tier.id}/existence`, true, patchPath);
        recordWrite(writes, `tier/${patch.tier.id}/definition`, patch.tier, patchPath);
        break;
      case 'set-comparison-tier':
        for (const [field, value] of Object.entries(patch.value)) recordWrite(writes, `tier/${patch.tier}/${field}`, value, patchPath);
        break;
      case 'remove-comparison-tier':
        recordWrite(writes, `tier/${patch.tier}/existence`, false, patchPath);
        break;
      case 'set-comparison-tier-order':
        recordWrite(writes, 'tier/order', patch.tiers, patchPath);
        break;
      case 'add-taxonomy-system':
        recordWrite(writes, `system/${patch.taxonomy.id}/existence`, true, patchPath);
        recordWrite(writes, `system/${patch.taxonomy.id}/definition`, patch.taxonomy, patchPath);
        break;
      case 'set-taxonomy-system':
        for (const [field, value] of Object.entries(patch.value)) recordWrite(writes, `system/${patch.taxonomy}/${field}`, value, patchPath);
        break;
      case 'remove-taxonomy-system':
        recordWrite(writes, `system/${patch.taxonomy}/existence`, false, patchPath);
        break;
      case 'add-taxonomy-level':
        recordWrite(writes, `level/${patch.taxonomy}/${patch.level.id}/existence`, true, patchPath);
        recordWrite(writes, `level/${patch.taxonomy}/${patch.level.id}/definition`, patch.level, patchPath);
        break;
      case 'set-taxonomy-level':
        for (const [field, value] of Object.entries(patch.value)) recordWrite(writes, `level/${patch.taxonomy}/${patch.level}/${field}`, value, patchPath);
        break;
      case 'remove-taxonomy-level':
        recordWrite(writes, `level/${patch.taxonomy}/${patch.level}/existence`, false, patchPath);
        break;
      case 'set-taxonomy-assignment':
        recordWrite(writes, `assignment/${patch.node}/${patch.taxonomy}`, patch.level, patchPath);
        break;
      case 'remove-taxonomy-assignment':
        recordWrite(writes, `assignment/${patch.node}/${patch.taxonomy}`, null, patchPath);
        break;
    }
  }

  const taxonomy = cloneTaxonomy(base);
  const tiers = new Map(taxonomy.comparisonTiers.map((tier) => [tier.id, tier]));
  const systems = new Map(taxonomy.systems.map((system) => [system.id, system]));
  const orderWrite = writes.get('tier/order');

  for (const [target, write] of writes) {
    const parts = target.split('/');
    if (parts[0] === 'tier' && parts[1] !== 'order') {
      const id = parts[1]!;
      if (parts[2] === 'existence') {
        if (write.value === false) tiers.delete(id);
        else if (tiers.has(id)) throw new TaxonomyError(write.path, `comparison tier "${id}" already exists`);
      } else if (parts[2] === 'definition') {
        tiers.set(id, cloneTier(write.value as ComparisonTier));
      } else {
        const tier = tiers.get(id);
        if (!tier) throw new TaxonomyError(write.path, `comparison tier "${id}" does not exist`);
        (tier as unknown as Record<string, unknown>)[parts[2]!] = write.value;
      }
    }
  }
  for (const [target, write] of writes) {
    const parts = target.split('/');
    if (parts[0] !== 'system') continue;
    const id = parts[1]!;
    if (parts[2] === 'existence') {
      if (write.value === false) systems.delete(id);
      else if (systems.has(id)) throw new TaxonomyError(write.path, `taxonomy system "${id}" already exists`);
    } else if (parts[2] === 'definition') {
      systems.set(id, { ...(write.value as Omit<TaxonomySystem, 'levels'>), levels: [] });
    } else {
      const system = systems.get(id);
      if (!system) throw new TaxonomyError(write.path, `taxonomy system "${id}" does not exist`);
      (system as unknown as Record<string, unknown>)[parts[2]!] = write.value;
    }
  }
  for (const [target, write] of writes) {
    const parts = target.split('/');
    if (parts[0] !== 'level') continue;
    const system = systems.get(parts[1]!);
    if (!system) throw new TaxonomyError(write.path, `taxonomy system "${parts[1]}" does not exist`);
    const levels = new Map(system.levels.map((level) => [level.id, level]));
    const id = parts[2]!;
    if (parts[3] === 'existence') {
      if (write.value === false) levels.delete(id);
      else if (levels.has(id)) throw new TaxonomyError(write.path, `taxonomy level "${parts[1]}/${id}" already exists`);
    } else if (parts[3] === 'definition') {
      levels.set(id, cloneLevel(write.value as TaxonomyLevel));
    } else {
      const level = levels.get(id);
      if (!level) throw new TaxonomyError(write.path, `taxonomy level "${parts[1]}/${id}" does not exist`);
      (level as unknown as Record<string, unknown>)[parts[3]!] = write.value;
    }
    system.levels = [...levels.values()];
  }
  for (const [target, write] of writes) {
    const parts = target.split('/');
    if (parts[0] !== 'assignment') continue;
    const node = nodes.get(parts[1]!);
    if (!node) continue;
    const assignments = { ...(node.taxonomyAssignments ?? {}) };
    if (write.value === null) delete assignments[parts[2]!];
    else assignments[parts[2]!] = write.value as string;
    node.taxonomyAssignments = assignments;
  }

  const changedTierSet = [...writes.keys()].some((target) => /^tier\/[^/]+\/existence$/.test(target));
  if (changedTierSet && !orderWrite) throw new TaxonomyError(path, 'tier additions and removals require set-comparison-tier-order');
  const order = orderWrite ? [...(orderWrite.value as readonly string[])] : taxonomy.comparisonTiers.map((tier) => tier.id).filter((id) => tiers.has(id));
  if (order.length !== tiers.size || new Set(order).size !== order.length || order.some((id) => !tiers.has(id))) {
    throw new TaxonomyError(orderWrite?.path ?? path, 'comparison tier order must contain every final tier exactly once');
  }
  const result: TaxonomyState = {
    comparisonTiers: order.map((id) => tiers.get(id)!),
    systems: [...systems.values()],
  };
  resolveTaxonomyAssignments(result, nodes, path);
  return result;
}
