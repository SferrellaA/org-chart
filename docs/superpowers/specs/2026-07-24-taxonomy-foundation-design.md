# Taxonomy Foundation Design

## Purpose

Add versioned taxonomy data to the canonical model without changing the existing embeddable component or adding taxonomy layout. The foundation must support comparisons between differently named organizational systems, proposal changes to taxonomy definitions and assignments, final-state validation, and diffs suitable for the later taxonomy renderer.

The motivating case is the historical removal of Air Divisions. In the baseline, an Army Division and a USAF Air Division occupy the same comparison tier. In the proposal, the Air Division level and its organizations disappear, Numbered Air Forces move to that comparison tier, and surviving wings receive explicit new parents.

## Taxonomy Model

Each resolved view has an optional complete taxonomy state:

```ts
interface TaxonomyState {
  comparisonTiers: readonly ComparisonTier[];
  systems: readonly TaxonomySystem[];
}

interface ComparisonTier {
  id: string;
  label: string;
  note?: string;
  sources?: readonly Source[];
}

interface TaxonomySystem {
  id: string;
  label: string;
  levels: readonly TaxonomyLevel[];
  note?: string;
  sources?: readonly Source[];
}

interface TaxonomyLevel {
  id: string;
  label: string;
  tier: string;
  note?: string;
  sources?: readonly Source[];
}
```

The `comparisonTiers` array defines shared display order. Every level maps to one explicit comparison-tier ID. Several levels, including levels from different systems, may map to the same tier.

Tier IDs and system IDs are unique within a resolved taxonomy state. Level IDs are unique within their system and are addressed by the composite system and level IDs. IDs remain stable when labels, mappings, or ordering change.

`NodeState` gains an optional `taxonomyAssignments` record. Each key is a taxonomy-system ID and each value is one level ID from that system. The record shape enforces at most one assignment per node per system while allowing a node to participate in any number of systems. Node definitions may provide assignment defaults, snapshots may replace the whole assignment record, and `set-node` retains its existing whole-field replacement behavior.

Missing assignments are valid and remain absent in the resolved model. Resolution never invents a taxonomy level. The later taxonomy renderer may derive display placement from hierarchy without presenting that placement as authored classification.

Snapshots contain a complete optional `taxonomy` state. Omission means that the snapshot has no taxonomy. A complete proposal snapshot replaces taxonomy together with nodes and hierarchy; omission from that replacement likewise means no taxonomy. Ordinary proposals inherit their base taxonomy state and mutate it through patches.

## Resolved Assignments

Each resolved node assignment exposes its authored system and level IDs plus the comparison-tier ID derived from the resolved taxonomy catalog:

```ts
interface ResolvedTaxonomyAssignment {
  systemId: string;
  levelId: string;
  tierId: string;
}
```

This distinction is required when a proposal changes a level mapping without changing node assignments. In the Air Division case, a Numbered Air Force retains its `numbered-air-force` level but its derived tier changes. The resolved chart preserves the catalog and these resolved assignments as renderer-neutral data.

## Granular Patches

The patch vocabulary gains:

- `add-comparison-tier`, `set-comparison-tier`, and `remove-comparison-tier`.
- `set-comparison-tier-order`, containing the complete resulting ordered tier ID list.
- `add-taxonomy-system`, `set-taxonomy-system`, and `remove-taxonomy-system`.
- `add-taxonomy-level`, `set-taxonomy-level`, and `remove-taxonomy-level`.
- `set-taxonomy-assignment` and `remove-taxonomy-assignment`.

Add operations carry complete definitions. Set operations address a stable ID and carry partial replacement fields other than identity. System add and set operations affect system metadata; levels use their own operations. Assignment operations address a node and system, then set one level or remove the assignment. Every operation supports existing patch details such as notes, sources, semantics, and related nodes.

Tier ordering is declarative rather than index-based. Any transaction that adds or removes comparison tiers must include `set-comparison-tier-order` listing every final tier ID exactly once. This avoids order-sensitive move operations and ambiguous insertion behavior. Taxonomy levels do not have a separate authored order; their comparison tiers determine placement, and stable IDs provide deterministic ordering when several levels share a tier.

## Transaction Semantics

Taxonomy patches are declarative mutations composed into one transaction per proposal and selected patch-group combination. The resolver collects all selected taxonomy writes before applying them:

- Writes are keyed by entity ID and field, not patch-array position.
- Disjoint field writes compose.
- Repeating an identical write is harmless.
- Different values for the same field conflict.
- Setting and removing the same entity conflicts.
- Adds require the entity to be absent from the base state; sets and removals require it to exist in the base state or be added coherently by the transaction.
- References and removals are validated against the final resolved state, never an intermediate patch state.

`set-node` assignment-record writes and granular assignment writes participate in the same conflict analysis. Mixing them is valid only when their final writes agree.

Removals never cascade. Removing a level is valid only if every surviving node formerly assigned to it is explicitly reassigned or has that assignment explicitly removed. Assignments on nodes removed by the same proposal do not remain as dangling references. Removing a tier requires every surviving level to map elsewhere or be removed. Removing a system requires assignments on surviving nodes to be removed.

Proposal ancestry remains ordered because each proposal derives from a resolved base. Patch order within one proposal does not affect taxonomy results. Existing structural operations retain their established behavior, but taxonomy reference validation runs after all selected structural patches so definition removal can coexist with node removal and reparenting in either authored order.

The Air Division acceptance fixture must resolve identically with its complete patch list in forward, reverse, and deterministically shuffled order.

## Diffs

Taxonomy catalog diffs report:

- added, removed, and modified comparison tiers.
- comparison-tier order changes.
- added, removed, and modified systems.
- added, removed, and modified levels.
- level-to-tier mapping changes.

Per-node taxonomy diffs are keyed by node and system. They compare both the authored level ID and derived tier ID. A level remapping therefore produces tier movement for every assigned node even when no assignment patch touched those nodes. Label-only catalog changes do not falsely mark assigned nodes as moving.

Node diffs gain a `taxonomy` change classification. Assignment changes and derived tier movement mark surviving nodes modified and participate in existing node summary counts. Removed nodes retain their baseline resolved assignments in their node diff so the later renderer can place removed ghost nodes. Catalog diffs remain separate from node summary counts.

## Validation And Errors

Schema and semantic validation cover:

- taxonomy object shape and nonempty IDs and labels.
- unique tier and system IDs and unique level IDs within each system.
- complete, duplicate-free comparison-tier order.
- level mappings to existing tiers.
- assignments to existing systems and levels.
- one assignment per node per system.
- patch targets, add/set/remove preconditions, and final references.
- conflicting writes and contradictory operations.
- selected patch-group combinations and inherited proposal transactions.

Invalid baseline snapshots remain fatal document errors. Invalid proposal results remain view-scoped errors, following the existing validation contract. Errors identify the responsible taxonomy entity and patch paths. No dangling definitions or assignments are tolerated in a final resolved view.

## Renderer Boundary

This phase changes model types, schema, validation, resolution, selection conflict detection, diffs, package exports, tests, and canonical JSON documentation. It does not add layout modes, chart controls, side columns, connectors, or hierarchy fallback rendering. Those belong to the Taxonomy Renderer phase.

## Test Fixture And Acceptance

Tests use a small synthetic historical fixture rather than the deferred realistic Air Force example:

- Shared tiers represent the old NAF-equivalent position, Division-equivalent, and Wing.
- An Army system keeps its `division` level mapped to Division-equivalent.
- A USAF system initially maps `numbered-air-force` above Division-equivalent and `air-division` to Division-equivalent.
- Two synthetic Air Divisions sit between two NAFs and several wings.
- A proposal removes the Air Division level and nodes, remaps NAF to Division-equivalent, reparents one wing directly, transfers another wing to the other NAF, and relocates one identified leadership billet.
- The Army taxonomy remains unchanged.

Acceptance coverage includes schema and type shape, deep cloning, snapshot replacement, every granular patch family, final-state validation, conflicting writes, patch-group selection, proposal inheritance, catalog diffs, assignment and derived-tier diffs, removed-node baseline data, and patch-order permutations.

The README documents the canonical JSON and transaction rules. The roadmap is marked complete only after `npm test`, `npm run check`, `npm run build`, and `npm run test:e2e` pass.
