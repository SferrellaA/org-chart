# Taxonomy Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add versioned comparison tiers, named taxonomy systems, granular order-independent taxonomy patches, resolved assignments, validation, and diffs.

**Architecture:** Extend snapshots and resolved charts with a renderer-neutral taxonomy catalog while keeping authored node assignments in node state. Isolate transactional taxonomy mutation and reference checks in `src/model/taxonomy.ts`, then integrate that unit with the existing resolver, selection conflict detection, validation contract, and diff engine. Preserve the existing component and renderer boundary for the next roadmap phase.

**Tech Stack:** TypeScript, JSON Schema draft 2020-12, Ajv, Vitest, Vite, Playwright.

---

## File Structure

- Modify `src/model/types.ts` with taxonomy catalog, assignment, resolved assignment, and granular patch types.
- Modify `public/org-delta-chart.schema.json` with taxonomy state, assignment, and patch schemas.
- Create `src/model/taxonomy.ts` for cloning catalogs, compiling order-independent writes, applying transactions, and validating final references.
- Modify `src/model/resolve.ts` to carry taxonomy state, collect taxonomy patches per proposal, and resolve assignment tiers after structural changes.
- Modify `src/model/selection.ts` so taxonomy writes participate in patch-group conflict detection.
- Modify `src/model/validate.ts` for snapshot catalog checks and view-scoped proposal transaction errors.
- Modify `src/model/diff.ts` with catalog and node assignment/tier diffs.
- Modify `test/fixtures.ts` with a compact synthetic Air Division removal fixture.
- Modify `test/types.test.ts`, `test/validate.test.ts`, `test/resolve.test.ts`, `test/selection.test.ts`, and `test/diff.test.ts` with focused acceptance coverage.
- Modify `README.md` and `docs/roadmap.md` after verification.

## Task 1: Public Types, Schema, And Synthetic Fixture

**Files:**
- Modify: `src/model/types.ts`
- Modify: `public/org-delta-chart.schema.json`
- Modify: `test/types.test.ts`
- Modify: `test/validate.test.ts`
- Modify: `test/fixtures.ts`

- [ ] **Step 1: Add compile-time type coverage**

Add a typed document in `test/types.test.ts` containing:

```ts
taxonomy: {
  comparisonTiers: [
    { id: 'naf-equivalent', label: 'NAF equivalent' },
    { id: 'division-equivalent', label: 'Division equivalent' },
    { id: 'wing', label: 'Wing' },
  ],
  systems: [
    {
      id: 'usaf-echelon',
      label: 'USAF echelon',
      levels: [
        { id: 'numbered-air-force', label: 'Numbered Air Force', tier: 'naf-equivalent' },
        { id: 'air-division', label: 'Air Division', tier: 'division-equivalent' },
        { id: 'wing', label: 'Wing', tier: 'wing' },
      ],
    },
  ],
}
```

Add `taxonomyAssignments: { 'usaf-echelon': 'wing' }` to one node and instantiate every new patch type in a `Patch[]` value.

- [ ] **Step 2: Run the type check and confirm failure**

Run: `npm run check`

Expected: TypeScript rejects `taxonomy`, `taxonomyAssignments`, and taxonomy patch discriminants because they are not defined.

- [ ] **Step 3: Add the public taxonomy types**

Define in `src/model/types.ts`:

```ts
export interface EntityDetails {
  note?: string;
  sources?: readonly Source[];
}

export interface ComparisonTier extends EntityDetails {
  id: string;
  label: string;
}

export interface TaxonomyLevel extends EntityDetails {
  id: string;
  label: string;
  tier: string;
}

export interface TaxonomySystem extends EntityDetails {
  id: string;
  label: string;
  levels: readonly TaxonomyLevel[];
}

export interface TaxonomyState {
  comparisonTiers: readonly ComparisonTier[];
  systems: readonly TaxonomySystem[];
}

export interface ResolvedTaxonomyAssignment {
  systemId: string;
  levelId: string;
  tierId: string;
}
```

Add `taxonomyAssignments?: Readonly<Record<string, string>>` to `NodeState`, `taxonomy?: TaxonomyState` to `SnapshotState`, `resolvedTaxonomyAssignments?: readonly ResolvedTaxonomyAssignment[]` to `ResolvedNode`, and nonoptional `taxonomy: TaxonomyState` to `ResolvedChart` (using empty arrays when a view has no taxonomy).

Add discriminated patch interfaces for the twelve operations from the design. Set operations use `value: Partial<Omit<Definition, 'id'>>`; system set values omit `levels`; assignment operations use `node`, `taxonomy`, and `level`.

- [ ] **Step 4: Add failing schema tests**

In `test/validate.test.ts`, add tests proving the synthetic taxonomy shape is accepted and these shapes are rejected:

```ts
level.tier = 'missing-tier';
node.taxonomyAssignments = { 'missing-system': 'wing' };
taxonomy.comparisonTiers.push({ id: 'wing', label: 'Duplicate' });
taxonomy.systems[0]!.levels.push({ id: 'wing', label: 'Duplicate', tier: 'wing' });
```

Also add one schema test for each taxonomy patch discriminant.

- [ ] **Step 5: Extend the JSON Schema**

Add `$defs` for `comparisonTier`, `taxonomyLevel`, `taxonomySystem`, `taxonomyState`, and `taxonomyAssignments`. Extend `snapshotState`, `nodeState`, and the patch `oneOf`. Require HTTPS sources through the existing `source` definition and preserve `additionalProperties: false` conventions.

- [ ] **Step 6: Add the synthetic fixture builder**

Export `taxonomyDocument()` from `test/fixtures.ts`. Include two NAFs, two Air Divisions, three wings, one Army Division, baseline hierarchy and assignments, Army/USAF systems, identified leadership on one Air Division, and an ungrouped proposal containing level removal, NAF remapping, Air Division node removal, wing reparenting, and billet relocation.

- [ ] **Step 7: Run focused checks**

Run: `npm test -- test/types.test.ts test/validate.test.ts && npm run check`

Expected: type and schema shape tests pass; semantic reference tests may remain red until Task 3 only when explicitly marked for that task.

- [ ] **Step 8: Commit the public format**

```bash
git add src/model/types.ts public/org-delta-chart.schema.json test/types.test.ts test/validate.test.ts test/fixtures.ts
git commit -m "Add taxonomy model and schema"
```

## Task 2: Transactional Taxonomy Resolution

**Files:**
- Create: `src/model/taxonomy.ts`
- Modify: `src/model/resolve.ts`
- Modify: `test/resolve.test.ts`

- [ ] **Step 1: Write failing resolution tests**

Add tests that assert:

```ts
const baseline = resolveView(document, { viewId: 'current', selectedGroups: [] });
expect(baseline.nodes.get('wing-a')?.resolvedTaxonomyAssignments).toEqual([
  { systemId: 'usaf-echelon', levelId: 'wing', tierId: 'wing' },
]);

const proposal = resolveView(document, { viewId: 'remove-air-divisions', selectedGroups: [] });
expect(proposal.taxonomy.systems
  .find(({ id }) => id === 'usaf-echelon')?.levels
  .find(({ id }) => id === 'numbered-air-force')?.tier
).toBe('division-equivalent');
```

Resolve cloned documents with the proposal patch list forward, reversed, and in a fixed shuffled order; compare normalized taxonomy, parents, nodes, and resolved assignments for equality. Add deep-clone assertions for tiers, systems, levels, assignments, notes, and sources.

- [ ] **Step 2: Run the resolution tests and confirm failure**

Run: `npm test -- test/resolve.test.ts`

Expected: failures show taxonomy is absent from `ResolvedChart` and patch types are unsupported.

- [ ] **Step 3: Implement the taxonomy transaction unit**

Create `src/model/taxonomy.ts` exporting focused functions:

```ts
export function cloneTaxonomy(state: TaxonomyState | undefined): TaxonomyState;
export function isTaxonomyPatch(patch: Patch): patch is TaxonomyPatch;
export function applyTaxonomyTransaction(
  base: TaxonomyState,
  nodes: ReadonlyMap<string, ResolvedNode>,
  patches: readonly TaxonomyPatch[],
  pathForPatch: (patch: TaxonomyPatch) => string,
): TaxonomyState;
export function validateTaxonomyState(
  taxonomy: TaxonomyState,
  nodes: ReadonlyMap<string, ResolvedNode>,
  path: string,
): void;
export function resolveTaxonomyAssignments(
  taxonomy: TaxonomyState,
  nodes: Map<string, ResolvedNode>,
  path: string,
): void;
```

Compile entity-field writes into maps before mutating. Reject divergent duplicate writes and set/remove contradictions. Apply adds and field sets to cloned maps, apply removals, apply the complete tier order, rebuild arrays, then validate only the final catalog and surviving node references. Sort system IDs and same-tier level IDs only where a deterministic map-to-array conversion needs it; preserve baseline array order otherwise.

- [ ] **Step 4: Integrate transactions into proposal resolution**

Extend mutable resolution with `taxonomy`. Snapshot resolution clones `snapshot.taxonomy ?? { comparisonTiers: [], systems: [] }`. For each proposal, collect taxonomy patches from ungrouped patches and selected groups, skip them in the ordinary imperative loop, execute ordinary patches, then apply one taxonomy transaction and resolve all surviving node assignments. A complete proposal snapshot replaces taxonomy before its patches.

Ensure `set-node` and add-node clone `taxonomyAssignments`. Recompute resolved assignments after every proposal transaction and once for a standalone snapshot.

- [ ] **Step 5: Run resolution tests**

Run: `npm test -- test/resolve.test.ts`

Expected: all baseline, proposal, deep-clone, and permutation tests pass.

- [ ] **Step 6: Commit resolution**

```bash
git add src/model/taxonomy.ts src/model/resolve.ts test/resolve.test.ts
git commit -m "Resolve taxonomy transactions"
```

## Task 3: Validation And Patch-Group Selection

**Files:**
- Modify: `src/model/selection.ts`
- Modify: `src/model/validate.ts`
- Modify: `test/selection.test.ts`
- Modify: `test/validate.test.ts`

- [ ] **Step 1: Write failing conflict and validation tests**

Cover these selected-group cases:

```ts
// Compatible: one group relabels a level while another remaps its tier.
// Conflict: two groups assign different tiers to the same system/level.
// Conflict: one group removes a level while another sets it.
// Invalid final view: a removed level remains assigned to a surviving node.
// Valid final view: the assigned node is removed in the same proposal.
// Invalid order: set-comparison-tier-order omits or duplicates a final tier.
```

Assert malformed snapshots return `ok: false`, while proposal transaction failures appear in `viewErrors.get(proposalId)`.

- [ ] **Step 2: Run focused tests and confirm failure**

Run: `npm test -- test/selection.test.ts test/validate.test.ts`

Expected: taxonomy writes do not conflict and semantic catalog errors are not reported correctly.

- [ ] **Step 3: Add taxonomy concrete writes**

Extend `concretePatchWrites()` with stable targets:

```ts
taxonomy.tiers.<tierId>.existence
taxonomy.tiers.<tierId>.<field>
taxonomy.tierOrder
taxonomy.systems.<systemId>.existence
taxonomy.systems.<systemId>.<field>
taxonomy.systems.<systemId>.levels.<levelId>.existence
taxonomy.systems.<systemId>.levels.<levelId>.<field>
nodes.<nodeId>.taxonomyAssignments.<systemId>
```

Use the existing fingerprint logic so identical writes compose and divergent field writes conflict. Add remove-versus-set conflict footprints by making removal claim the entity existence target and every operation on that entity claim a compatible existence requirement in the selection index.

- [ ] **Step 4: Add semantic validation**

Validate every snapshot catalog directly with the shared taxonomy helper. During proposal validation, retain the existing static target checks, then resolve each proposal with default groups to convert transaction failures into view-scoped errors. Validate each selectable group dependency closure using the same resolver path so selected combinations cannot leave dangling taxonomy references.

Avoid exhaustive power-set validation. Existing guaranteed groups plus one candidate closure at a time remains the bounded validation strategy.

- [ ] **Step 5: Run validation and selection tests**

Run: `npm test -- test/selection.test.ts test/validate.test.ts test/resolve.test.ts`

Expected: all taxonomy conflict, final-reference, and view-scoped error tests pass without regressing existing patch-group behavior.

- [ ] **Step 6: Commit validation**

```bash
git add src/model/selection.ts src/model/validate.ts test/selection.test.ts test/validate.test.ts
git commit -m "Validate taxonomy patch selections"
```

## Task 4: Catalog And Node Taxonomy Diffs

**Files:**
- Modify: `src/model/diff.ts`
- Modify: `test/diff.test.ts`

- [ ] **Step 1: Write failing taxonomy diff tests**

Using `taxonomyDocument()`, assert:

```ts
expect(diff.taxonomy.levels.get('usaf-echelon\0air-division')?.kind).toBe('removed');
expect(diff.taxonomy.levels.get('usaf-echelon\0numbered-air-force')?.changes).toContain('tier');
expect(diff.taxonomy.assignments.get('naf-a\0usaf-echelon')?.changes).toContain('tier');
expect(diff.nodes.get('naf-a')?.changes).toContain('taxonomy');
expect(diff.nodes.get('army-division')?.changes).not.toContain('taxonomy');
```

Also test level-only assignment change, label-only catalog change, tier order change, added/removed system, and removed-node baseline assignment retention.

- [ ] **Step 2: Run diff tests and confirm failure**

Run: `npm test -- test/diff.test.ts`

Expected: `ChartDiff` has no taxonomy catalog or assignment diffs.

- [ ] **Step 3: Implement taxonomy diff types and cloning**

Add exported `ComparisonTierDiff`, `TaxonomySystemDiff`, `TaxonomyLevelDiff`, `TaxonomyAssignmentDiff`, and `TaxonomyDiff` interfaces. Key level maps by `${systemId}\0${levelId}` and assignment maps by `${nodeId}\0${systemId}` internally while retaining readable IDs on each value.

Compare catalog entity fields independently. Record tier order as an explicit before/after change. Compare resolved assignments by system, marking `level` and `tier` separately. Do not propagate catalog label changes into node changes.

- [ ] **Step 4: Integrate node classification and summary behavior**

Add `'taxonomy'` to `NodeChange`. For surviving nodes, any assignment level or derived tier change marks the node modified. Added and removed nodes keep their existing node kinds and cloned resolved assignments; taxonomy catalog diffs do not affect node summary counts by themselves.

- [ ] **Step 5: Run diff tests**

Run: `npm test -- test/diff.test.ts test/resolve.test.ts`

Expected: all taxonomy and existing leadership/relationship diff tests pass.

- [ ] **Step 6: Commit diffs**

```bash
git add src/model/diff.ts test/diff.test.ts
git commit -m "Diff taxonomy changes"
```

## Task 5: Documentation And Full Verification

**Files:**
- Modify: `README.md`
- Modify: `docs/roadmap.md`
- Modify: tests only if full-suite integration exposes a missing acceptance assertion

- [ ] **Step 1: Add canonical JSON documentation**

Document shared tiers, system/level definitions, one assignment per system, missing-assignment behavior, granular patches, complete tier-order writes, final-state validation, and the NAF/Air Division remapping example in `README.md`. State explicitly that taxonomy rendering is deferred to the next phase.

- [ ] **Step 2: Run the complete unit suite**

Run: `npm test`

Expected: all Vitest files pass.

- [ ] **Step 3: Run static checks and production builds**

Run: `npm run check && npm run build`

Expected: TypeScript exits zero and Vite/tsc produce the package and viewer bundles.

- [ ] **Step 4: Run browser acceptance tests**

Run: `npm run test:e2e`

Expected: all Playwright tests pass with no component behavior regression.

- [ ] **Step 5: Mark the roadmap phase complete**

Change Taxonomy Foundation to `completed 2026-07-24` only after Steps 2-4 pass. Keep Taxonomy Renderer as the next phase.

- [ ] **Step 6: Commit documentation and roadmap status**

```bash
git add README.md docs/roadmap.md
git commit -m "Document taxonomy foundation"
```

- [ ] **Step 7: Verify the final worktree**

Run: `git status --short && git log --oneline -7`

Expected: no uncommitted feature files and focused taxonomy commits following the design and plan commits.
