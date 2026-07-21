# Org Delta Chart Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a read-only `<org-delta-chart>` web component that loads colocated JSON, resolves historical and proposed organization structures, compares them, and renders an accessible large-chart explorer with D3.

**Architecture:** Pure TypeScript modules validate, resolve, and diff renderer-neutral chart data. A presentation builder separates subordinate outer nodes from visually contained internal offices, while a `d3-org-chart` adapter owns layout and a separate SVG overlay owns cross-links and internal-origin connectors. A framework-free custom element coordinates loading, controls, notes, and responsive presentation.

**Tech Stack:** TypeScript, Vite, Vitest, jsdom, Ajv, D3 v7, d3-org-chart v3, Playwright, native Web Components

---

## File Structure

Create the following focused files:

```text
package.json                         package scripts and dependencies
tsconfig.json                       strict TypeScript settings
vite.config.ts                      ESM library build
vite.viewer.config.ts               standalone viewer build
vitest.config.ts                    unit/component test configuration
playwright.config.ts                browser test configuration
viewer.html                         iframe viewer entry page
public/org-delta-chart.schema.json  published JSON Schema
src/index.ts                        package entry and custom-element registration
src/model/types.ts                  public and resolved domain types
src/model/validate.ts               Ajv validation and semantic validation
src/model/resolve.ts                snapshot/proposal/patch resolution
src/model/selection.ts              patch-group dependency/conflict selection
src/model/diff.ts                   renderer-neutral structural diff
src/presentation/build-view.ts      internal containment and outer-tree projection
src/presentation/notes.ts           details-panel item conversion
src/renderer/types.ts               renderer interface and view-state types
src/renderer/d3-renderer.ts          d3-org-chart adapter
src/renderer/overlay.ts             relationship and internal-origin SVG connectors
src/component/org-delta-chart.ts    custom element lifecycle and orchestration
src/component/template.ts           semantic HTML template
src/component/styles.ts             encapsulated default styles
src/component/controls.ts           proposal and patch-group controls
src/component/details-panel.ts      accessible notes/details panel
src/viewer.ts                       query-string to component bridge
examples/state-department.html      direct embed demonstration
examples/state-department.json      snapshots, proposal, internals, and cross-link fixture
test/fixtures.ts                    reusable valid documents
test/*.test.ts                      unit and component tests
e2e/embed.spec.ts                   direct/iframe responsive browser tests
scripts/generate-benchmark.ts       deterministic 5,000-node fixture generator
README.md                            publisher integration and JSON examples
```

Keep D3 imports inside `src/renderer/`. Domain and component tests must be able to run without invoking D3 layout.

### Task 1: Scaffold The TypeScript Package

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `vite.config.ts`
- Create: `vitest.config.ts`
- Create: `src/index.ts`
- Create: `test/registration.test.ts`

- [ ] **Step 1: Add package metadata and test/build scripts**

Create `package.json`:

```json
{
  "name": "org-delta-chart",
  "version": "0.1.0",
  "type": "module",
  "license": "MIT",
  "files": ["dist"],
  "exports": {
    ".": "./dist/org-delta-chart.js",
    "./schema": "./dist/org-delta-chart.schema.json"
  },
  "scripts": {
    "build": "vite build && vite build --config vite.viewer.config.ts",
    "check": "tsc --noEmit",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:e2e": "playwright test",
    "benchmark:generate": "tsx scripts/generate-benchmark.ts"
  },
  "dependencies": {
    "ajv": "^8.17.1",
    "d3": "^7.9.0",
    "d3-org-chart": "^3.1.1"
  },
  "devDependencies": {
    "@playwright/test": "^1.54.1",
    "@types/d3": "^7.4.3",
    "jsdom": "^26.1.0",
    "tsx": "^4.20.3",
    "typescript": "^5.8.3",
    "vite": "^7.0.5",
    "vitest": "^3.2.4"
  }
}
```

- [ ] **Step 2: Add strict compiler and test configuration**

Create `tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "declaration": true,
    "declarationMap": true,
    "skipLibCheck": true,
    "types": ["vitest/globals"]
  },
  "include": ["src", "test", "scripts", "vite*.ts", "vitest.config.ts"]
}
```

Create `vite.config.ts`:

```ts
import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    lib: { entry: 'src/index.ts', formats: ['es'], fileName: 'org-delta-chart' },
    emptyOutDir: true,
    sourcemap: true,
  },
});
```

Create `vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { environment: 'jsdom', coverage: { reporter: ['text', 'html'] } },
});
```

- [ ] **Step 3: Write the failing registration test**

Create `test/registration.test.ts`:

```ts
import '../src/index';

describe('package entry', () => {
  it('registers the org-delta-chart element', () => {
    expect(customElements.get('org-delta-chart')).toBeDefined();
  });
});
```

- [ ] **Step 4: Install dependencies and verify the test fails**

Run: `npm install && npm test -- test/registration.test.ts`

Expected: FAIL because `src/index.ts` does not exist.

- [ ] **Step 5: Add the smallest registerable element**

Create `src/index.ts`:

```ts
export class OrgDeltaChartElement extends HTMLElement {}

if (!customElements.get('org-delta-chart')) {
  customElements.define('org-delta-chart', OrgDeltaChartElement);
}
```

- [ ] **Step 6: Verify the scaffold**

Run: `npm test -- test/registration.test.ts && npm run check && npm run build`

Expected: one passing test, clean typecheck, and `dist/org-delta-chart.js` generated.

- [ ] **Step 7: Commit the scaffold**

```bash
git add package.json package-lock.json tsconfig.json vite.config.ts vitest.config.ts src/index.ts test/registration.test.ts
git commit -m "Set up TypeScript web component package"
```

### Task 2: Define And Validate The Public Document

**Files:**
- Create: `public/org-delta-chart.schema.json`
- Create: `src/model/types.ts`
- Create: `src/model/validate.ts`
- Create: `test/validate.test.ts`
- Create: `test/fixtures.ts`

- [ ] **Step 1: Define reusable test data**

Create `test/fixtures.ts` with one valid document containing `state`, `state-hq`, `state-hr`, and `usaid`; a `current` snapshot; a `proposal-a` proposal; one shared-leadership relationship; and one patch group. Export it as `validDocument` using `structuredClone` in tests to prevent mutation.

The snapshot hierarchy must contain:

```ts
[
  { child: 'state-hq', parent: 'state', relationship: 'internal' },
  { child: 'state-hr', parent: 'state-hq', relationship: 'internal' },
  { child: 'usaid', parent: 'state', relationship: 'subordinate' },
]
```

- [ ] **Step 2: Write failing validation tests**

Create `test/validate.test.ts`:

```ts
import { validDocument } from './fixtures';
import { validateDocument } from '../src/model/validate';

describe('validateDocument', () => {
  it('accepts the complete fixture', () => {
    expect(validateDocument(structuredClone(validDocument))).toEqual({
      ok: true,
      value: validDocument,
      viewErrors: new Map(),
    });
  });

  it('rejects an unknown hierarchy child with its path', () => {
    const input = structuredClone(validDocument);
    input.snapshots[0]!.hierarchy[0]!.child = 'missing';
    const result = validateDocument(input);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join('\n')).toContain('missing');
  });

  it('isolates proposal base cycles to the affected views', () => {
    const input = structuredClone(validDocument);
    input.proposals.push({ id: 'cycle', label: 'Cycle', base: 'proposal-a', patches: [] });
    input.proposals[0]!.base = 'cycle';
    const result = validateDocument(input);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.viewErrors.get('proposal-a')?.join('\n')).toContain('base cycle');
  });
});
```

- [ ] **Step 3: Run the validation tests to verify failure**

Run: `npm test -- test/validate.test.ts`

Expected: FAIL because model files do not exist.

- [ ] **Step 4: Add renderer-neutral public types**

Create `src/model/types.ts` with explicit interfaces for `Source`, `NodeState`, `NodeDefinition`, `HierarchyEdge`, `Relationship`, `SnapshotState`, `Snapshot`, each patch variant, `PatchGroup`, `Proposal`, `Zone`, `OrgDocument`, `ResolvedNode`, `ResolvedParent`, `SemanticAnnotation`, and `ResolvedChart`.

Use these discriminated unions exactly:

```ts
export type HierarchyRelationship = 'internal' | 'subordinate';

export interface NodeState {
  name?: string;
  note?: string;
  sources?: readonly Source[];
  metadata?: Readonly<Record<string, string | number | boolean | null>>;
}

export interface SemanticAnnotation {
  semantic: string;
  nodes: readonly string[];
  note?: string;
  sources?: readonly Source[];
}

export type Patch =
  | { type: 'add-node'; node: string; value?: NodeState; note?: string; semantic?: string; relatedNodes?: readonly string[] }
  | { type: 'remove-node'; node: string; note?: string; semantic?: string; relatedNodes?: readonly string[] }
  | { type: 'set-node'; node: string; value: NodeState; note?: string; semantic?: string; relatedNodes?: readonly string[] }
  | { type: 'set-parent'; node: string; parent: string; relationship: HierarchyRelationship; note?: string; semantic?: string; relatedNodes?: readonly string[] }
  | { type: 'remove-parent'; node: string; note?: string; semantic?: string; relatedNodes?: readonly string[] }
  | { type: 'add-relationship'; relationship: Relationship; note?: string; semantic?: string; relatedNodes?: readonly string[] }
  | { type: 'remove-relationship'; relationship: string; note?: string; semantic?: string; relatedNodes?: readonly string[] }
  | { type: 'set-relationship'; relationship: string; value: Partial<Relationship>; note?: string; semantic?: string; relatedNodes?: readonly string[] };
```

Define `ResolvedChart` with `ReadonlyMap<string, ResolvedNode>`, `ReadonlyMap<string, ResolvedParent>`, `ReadonlyMap<string, Relationship>`, `readonly SemanticAnnotation[]`, and presentation defaults. Define `SnapshotState` as the reusable complete `nodes` plus `hierarchy` shape used by both snapshots and proposal `snapshot` fields. Define optional document presentation settings as `{ initialExpansionDepth?: number; focusNodes?: readonly string[] }`. When a patch has `semantic`, resolution emits one `SemanticAnnotation` whose nodes are the target node plus unique `relatedNodes`; this gives merge/split annotations explicit participants.

Define `ValidationResult` as `{ ok: true; value: OrgDocument; viewErrors: ReadonlyMap<string, readonly string[]> } | { ok: false; errors: string[] }`. Schema failures, duplicate global IDs, and invalid snapshots are fatal. Errors confined to an optional proposal are stored under that proposal ID and inherited by proposals based on it, allowing valid snapshots and branches to remain usable.

- [ ] **Step 5: Publish a strict JSON Schema**

Create `public/org-delta-chart.schema.json` as draft 2020-12. Require `title`, `nodes`, `snapshots`, and `proposals`; set `additionalProperties: false` on all fixed records; encode all patch variants with `oneOf`; constrain hierarchy relationships to `internal` and `subordinate`; constrain source URLs to `^https?://`; allow patch `relatedNodes` as unique known node IDs; include optional presentation defaults; and reserve `symbol` and `zones` according to the design spec.

- [ ] **Step 6: Implement schema and semantic validation**

Create `src/model/validate.ts`:

```ts
import Ajv2020 from 'ajv/dist/2020.js';
import schema from '../../public/org-delta-chart.schema.json';
import type { OrgDocument, ValidationResult } from './types';

const ajv = new Ajv2020({ allErrors: true, strict: true });
const validateSchema = ajv.compile<OrgDocument>(schema);

export function validateDocument(input: unknown): ValidationResult {
  if (!validateSchema(input)) {
    return {
      ok: false,
      errors: (validateSchema.errors ?? []).map(
        ({ instancePath, message }) => `${instancePath || '/'} ${message ?? 'is invalid'}`,
      ),
    };
  }

  const { fatalErrors, viewErrors } = validateReferences(input);
  return fatalErrors.length
    ? { ok: false, errors: fatalErrors }
    : { ok: true, value: input, viewErrors };
}
```

Implement `validateReferences` with small helpers for unique IDs, known node references, one parent per child, hierarchy DFS cycle detection, proposal-base DFS cycle detection, known patch references, known requirement/conflict IDs, symmetric conflicts, and patch-group dependency cycles. Return deterministic fatal errors and per-proposal errors prefixed with the owning snapshot or proposal ID. Propagate a proposal error to every descendant proposal without converting it to a fatal document error.

- [ ] **Step 7: Verify validation and types**

Run: `npm test -- test/validate.test.ts && npm run check`

Expected: all validation tests pass and TypeScript reports no errors.

- [ ] **Step 8: Commit schema validation**

```bash
git add public/org-delta-chart.schema.json src/model/types.ts src/model/validate.ts test/fixtures.ts test/validate.test.ts
git commit -m "Define org chart document schema"
```

### Task 3: Resolve Snapshots, Proposals, And Patches

**Files:**
- Create: `src/model/resolve.ts`
- Create: `test/resolve.test.ts`

- [ ] **Step 1: Write failing resolution tests**

Create `test/resolve.test.ts` covering these exact behaviors:

```ts
it('resolves a complete snapshot without mutating the document', () => {
  const input = structuredClone(validDocument);
  const result = resolveView(input, { viewId: 'current', selectedGroups: [] });
  expect(result.nodes.get('state-hr')?.name).toBe('Bureau of Human Resources');
  expect(input).toEqual(validDocument);
});

it('walks nested bases and applies patches in order', () => {
  // Add proposal-a-v2 based on proposal-a. proposal-a renames state-hr;
  // proposal-a-v2 spins it out under state as subordinate.
  expect(result.nodes.get('state-hr')?.name).toBe('Global Talent Office');
  expect(result.parents.get('state-hr')).toEqual({
    parent: 'state', relationship: 'subordinate', note: undefined, sources: undefined,
  });
});

it('uses a proposal snapshot as replacement state before patches', () => {
  // Give proposal-a a snapshot without usaid and then patch in a rename.
  expect(result.nodes.has('usaid')).toBe(false);
  expect(result.nodes.get('state-hr')?.name).toBe('Global Talent Office');
});

it('throws a contextual error when a patch targets missing state', () => {
  expect(() => resolveView(input, options)).toThrow(
    'proposal-a/patches/0: node "missing" does not exist',
  );
});
```

- [ ] **Step 2: Run resolution tests to verify failure**

Run: `npm test -- test/resolve.test.ts`

Expected: FAIL because `resolveView` is missing.

- [ ] **Step 3: Implement immutable resolution**

Create `src/model/resolve.ts` exporting:

```ts
export interface ResolveOptions {
  viewId: string;
  selectedGroups: readonly string[];
}

export class ResolutionError extends Error {}

export function resolveView(document: OrgDocument, options: ResolveOptions): ResolvedChart;
```

Implementation sequence:

1. Find the snapshot or proposal by ID.
2. Recursively resolve a proposal's base.
3. Replace state if the proposal has `snapshot`.
4. Apply proposal `patches` in order.
5. Apply selected `patchGroups` in document order.
6. Return fresh `Map` instances for nodes, parents, and relationships plus applied semantic annotations.

Implement one exhaustive `applyPatch` switch. `remove-node` must also remove its parent edge, child parent edges, and non-hierarchy relationships touching it. After each patch list, validate parent references and hierarchy acyclicity. Include the proposal/group path in every `ResolutionError`.

- [ ] **Step 4: Verify resolution**

Run: `npm test -- test/resolve.test.ts && npm run check`

Expected: all resolution tests pass.

- [ ] **Step 5: Commit resolution**

```bash
git add src/model/resolve.ts test/resolve.test.ts
git commit -m "Resolve snapshots and proposal patches"
```

### Task 4: Implement Selectable Stacked Deltas

**Files:**
- Create: `src/model/selection.ts`
- Create: `test/selection.test.ts`
- Modify: `src/model/resolve.ts`

- [ ] **Step 1: Write failing selection tests**

Create `test/selection.test.ts` for:

- Selecting a group automatically selects transitive `requires`.
- Selecting a group deselects conflicting optional groups.
- A group conflicting with a locked selected group is disabled with a readable reason.
- Deselecting a required group also deselects dependents.
- Two selected groups that rename one node differently return a concrete write-conflict error.

Use this assertion shape:

```ts
expect(togglePatchGroup(proposal, state, 'spin-out-hr', true)).toEqual({
  selected: ['rename-hr', 'spin-out-hr'],
  disabled: new Map(),
  error: undefined,
});
```

- [ ] **Step 2: Run selection tests to verify failure**

Run: `npm test -- test/selection.test.ts`

Expected: FAIL because selection functions are missing.

- [ ] **Step 3: Implement deterministic group selection**

Create `src/model/selection.ts` exporting:

```ts
export interface PatchSelection {
  selected: readonly string[];
  disabled: ReadonlyMap<string, string>;
  error?: string;
}

export function initialPatchSelection(proposal: Proposal): PatchSelection;
export function togglePatchGroup(
  proposal: Proposal,
  current: PatchSelection,
  groupId: string,
  checked: boolean,
): PatchSelection;
```

Order every returned `selected` list by proposal document order. Implement `patchWriteKey` to identify concrete collisions for node existence, node fields, parent assignment, and relationship fields. Equal writes are compatible; differing writes produce `Patch groups "a" and "b" both set state-hr.parent differently`.

- [ ] **Step 4: Make the resolver reject invalid selected group sets**

Before applying selected groups in `resolveView`, call a shared `validateSelection` exported by `selection.ts`. Throw `ResolutionError` if requirements are absent, conflicts coexist, or concrete writes differ.

- [ ] **Step 5: Verify stacked deltas**

Run: `npm test -- test/selection.test.ts test/resolve.test.ts && npm run check`

Expected: all tests pass.

- [ ] **Step 6: Commit stacked delta behavior**

```bash
git add src/model/selection.ts src/model/resolve.ts test/selection.test.ts test/resolve.test.ts
git commit -m "Support compatible stacked proposal deltas"
```

### Task 5: Compute Structural And Annotated Diffs

**Files:**
- Create: `src/model/diff.ts`
- Create: `test/diff.test.ts`

- [ ] **Step 1: Write failing diff tests**

Create `test/diff.test.ts` with independently constructed `ResolvedChart` values and assert:

```ts
expect(diff.nodes.get('new-office')?.kind).toBe('added');
expect(diff.nodes.get('old-office')?.kind).toBe('removed');
expect(diff.nodes.get('state-hr')).toMatchObject({
  kind: 'modified',
  changes: ['name', 'parent', 'relationship'],
});
expect(diff.relationships.get('dual-hat')?.kind).toBe('modified');
expect(diff.annotations).toContainEqual(
  expect.objectContaining({ semantic: 'split', nodes: ['office-a', 'office-b'] }),
);
```

Also assert that differing layout coordinates, if added to test-only objects, do not affect output.

- [ ] **Step 2: Run diff tests to verify failure**

Run: `npm test -- test/diff.test.ts`

Expected: FAIL because the diff module is missing.

- [ ] **Step 3: Implement stable-ID diffing**

Create `src/model/diff.ts` with:

```ts
export type DiffKind = 'added' | 'removed' | 'modified' | 'unchanged';

export interface NodeDiff {
  id: string;
  kind: DiffKind;
  before?: ResolvedNode;
  after?: ResolvedNode;
  changes: readonly ('name' | 'note' | 'metadata' | 'parent' | 'relationship')[];
}

export interface RelationshipDiff {
  id: string;
  kind: DiffKind;
  before?: Relationship;
  after?: Relationship;
  changes: readonly ('type' | 'source' | 'target' | 'label' | 'note')[];
}

export interface ChartDiff {
  nodes: ReadonlyMap<string, NodeDiff>;
  relationships: ReadonlyMap<string, RelationshipDiff>;
  annotations: readonly SemanticAnnotation[];
  summary: { added: number; removed: number; modified: number; unchanged: number };
}

export function diffCharts(before: ResolvedChart, after: ResolvedChart): ChartDiff;
```

Compare names, notes, metadata, parent IDs, and hierarchy relationship values. Compare non-hierarchy relationships by stable relationship ID. Preserve removed node data for ghost rendering. Carry semantic annotations from applied after-state patches into the result.

- [ ] **Step 4: Verify diff semantics**

Run: `npm test -- test/diff.test.ts && npm run check`

Expected: all diff tests pass.

- [ ] **Step 5: Commit diffing**

```bash
git add src/model/diff.ts test/diff.test.ts
git commit -m "Compute organization chart deltas"
```

### Task 6: Build The Renderer-Neutral Presentation View

**Files:**
- Create: `src/presentation/build-view.ts`
- Create: `src/presentation/notes.ts`
- Create: `src/renderer/types.ts`
- Create: `test/build-view.test.ts`

- [ ] **Step 1: Write failing presentation tests**

Create `test/build-view.test.ts` proving:

- Subordinate nodes become outer renderer nodes.
- Internal descendants become nested `internalRows` on the nearest outer node.
- An internal office with a subordinate child gives that child `connectorSourceId` equal to the internal office ID.
- With `showInternal: false`, rows disappear, hidden counts aggregate recursively, and search entries still include hidden internals.
- A removed diff node is included as a ghost outer node.
- A relationship with one collapsed endpoint resolves to the nearest visible ancestor and sets `aggregated: true`.

- [ ] **Step 2: Run presentation tests to verify failure**

Run: `npm test -- test/build-view.test.ts`

Expected: FAIL because presentation modules are missing.

- [ ] **Step 3: Define the renderer contract**

Create `src/renderer/types.ts`:

```ts
export interface RenderNode {
  id: string;
  parentId?: string;
  connectorSourceId?: string;
  name: string;
  internalRows: readonly InternalRow[];
  hiddenInternalCount: number;
  hiddenChangeCount: number;
  diffKind: DiffKind;
  ghost: boolean;
}

export interface InternalRow {
  id: string;
  name: string;
  depth: number;
  diffKind: DiffKind;
  hasSubordinateChildren: boolean;
}

export interface RenderRelationship {
  id: string;
  source: string;
  target: string;
  label: string;
  type: string;
  aggregated: boolean;
  diffKind: DiffKind;
}

export interface RenderView {
  nodes: readonly RenderNode[];
  relationships: readonly RenderRelationship[];
  searchEntries: readonly { id: string; label: string; hiddenInternal: boolean }[];
  initialExpansionIds: readonly string[];
}

export interface ChartRenderer {
  render(view: RenderView): void;
  reveal(nodeId: string): void;
  fit(): void;
  destroy(): void;
}
```

- [ ] **Step 4: Implement containment projection**

Create `src/presentation/build-view.ts` exporting:

```ts
export function buildRenderView(
  chart: ResolvedChart,
  diff: ChartDiff,
  options: {
    showInternal: boolean;
    showRelationships: boolean;
    revealedInternalIds: ReadonlySet<string>;
  },
): RenderView;
```

Use a parent index and memoized `nearestOuterAncestor`. Preserve one visual internal level; flatten deeper internal chains into indented rows with a `depth` number. For a subordinate node whose direct parent is internal, assign its outer `parentId` to the nearest outer ancestor and `connectorSourceId` to its direct internal parent. Build search entries from every resolved node before visibility filtering. When internals are globally hidden, retain rows whose IDs or ancestors occur in `revealedInternalIds`. Set `initialExpansionIds` from roots through the document's configured expansion depth, defaulting to two outer levels.

- [ ] **Step 5: Implement details conversion**

Create `src/presentation/notes.ts` with a `DetailsItem` union and pure functions `nodeDetails`, `hierarchyDetails`, `relationshipDetails`, and `changeDetails`. Each returns title, kind label, plain-text note, and sanitized HTTP/HTTPS source links; invalid links are omitted.

- [ ] **Step 6: Verify the presentation boundary**

Run: `npm test -- test/build-view.test.ts && npm run check`

Expected: presentation tests pass without importing D3.

- [ ] **Step 7: Commit presentation projection**

```bash
git add src/presentation src/renderer/types.ts test/build-view.test.ts
git commit -m "Project resolved charts for contained rendering"
```

### Task 7: Adapt d3-org-chart And Draw Overlay Connectors

**Files:**
- Create: `src/renderer/d3-renderer.ts`
- Create: `src/renderer/overlay.ts`
- Create: `test/overlay.test.ts`

- [ ] **Step 1: Write failing overlay geometry tests**

Create `test/overlay.test.ts` for a pure exported `connectorPath` function:

```ts
expect(connectorPath(
  { left: 10, top: 10, width: 80, height: 20 },
  { left: 200, top: 100, width: 80, height: 40 },
)).toBe('M 50 30 C 50 65, 240 65, 240 100');
```

Also test zero-width bounds, relationship paths, and that `syncOverlay` omits a connector when either DOM anchor is absent.

- [ ] **Step 2: Run overlay tests to verify failure**

Run: `npm test -- test/overlay.test.ts`

Expected: FAIL because overlay functions are missing.

- [ ] **Step 3: Implement the overlay layer**

Create `src/renderer/overlay.ts`. Render an absolutely positioned, pointer-aware SVG over the chart container. Export `connectorPath`, `relationshipPath`, and `syncOverlay(svg, host, view)`.

Find anchors through escaped selectors:

```ts
const internal = host.querySelector<HTMLElement>(`[data-internal-id="${CSS.escape(id)}"]`);
const outer = host.querySelector<HTMLElement>(`[data-node-id="${CSS.escape(id)}"]`);
```

Convert `getBoundingClientRect()` values to host-relative coordinates. Mark paths with `data-relationship-id` or `data-internal-connector`. Add a transparent 12px hit path beside each visible 2px path so mouse/touch selection is practical.

- [ ] **Step 4: Implement the D3 adapter**

Create `src/renderer/d3-renderer.ts` exporting `D3OrgChartRenderer implements ChartRenderer`.

Constructor arguments:

```ts
constructor(
  host: HTMLElement,
  callbacks: {
    onActivate: (
      kind: 'node' | 'internal' | 'hierarchy' | 'relationship' | 'change',
      id: string,
      trigger: HTMLElement | SVGElement,
    ) => void;
  },
)
```

Configure `new OrgChart()` with typed callback parameters for `RenderNode`, plus `nodeId`, `parentNodeId`, variable node height based on `internalRows.length`, custom `nodeContent`, zoom/pan, minimap, and paging. `nodeContent` must escape text and emit `data-node-id`, `data-internal-id`, buttons for activation, count badges, and diff classes. Use `linkUpdate` to hide D3's default parent link when `connectorSourceId` is present; the overlay replaces it. Normal hierarchy links activate `kind: 'hierarchy'`; node diff badges activate `kind: 'change'`. Overlay relationship paths activate `kind: 'relationship'`.

After render and after D3 zoom/layout changes, schedule one `syncOverlay` call with `requestAnimationFrame`. `destroy()` removes listeners, chart DOM, and overlay DOM.

- [ ] **Step 5: Verify adapter typing and overlay tests**

Run: `npm test -- test/overlay.test.ts && npm run check`

Expected: geometry tests pass and the actual `d3-org-chart` API typechecks.

- [ ] **Step 6: Create a temporary manual fixture page and inspect connector routing**

Run: `npm run dev -- --host 127.0.0.1`

Expected at the fixture URL: `state-hr` appears inside `state-hq`; `usaid` uses a normal subordinate link; a subordinate child of `state-hr` uses an overlay connector originating at the internal row. Resize, pan, and zoom must keep overlay endpoints attached.

Remove the temporary fixture if it is not the final example from Task 10.

- [ ] **Step 7: Commit the renderer**

```bash
git add src/renderer test/overlay.test.ts
git commit -m "Render contained org charts with D3"
```

### Task 8: Build The Custom Element Shell And Details Panel

**Files:**
- Create: `src/component/template.ts`
- Create: `src/component/styles.ts`
- Create: `src/component/details-panel.ts`
- Create: `src/component/org-delta-chart.ts`
- Modify: `src/index.ts`
- Create: `test/component.test.ts`

- [ ] **Step 1: Write failing loading and error-state tests**

Create `test/component.test.ts` with a mocked `fetch` and injected fake `ChartRenderer` factory. Verify:

- `src="./chart.json"` is requested as a page-relative URL.
- Loading status is announced.
- Valid JSON calls renderer `render`.
- HTTP failure and validation failure show concise in-page errors.
- A document with one invalid optional proposal renders its valid initial snapshot; selecting the invalid proposal shows only that proposal's error.
- Changing `src` aborts the prior request and loads the new one.
- Disconnecting destroys the renderer.

- [ ] **Step 2: Run component tests to verify failure**

Run: `npm test -- test/component.test.ts`

Expected: FAIL because the real element is missing.

- [ ] **Step 3: Create semantic template and styles**

`src/component/template.ts` must create DOM nodes without interpolating untrusted HTML. Include:

```html
<section class="chart-shell" aria-label="Organization chart">
  <header class="toolbar"></header>
  <div class="status" role="status" aria-live="polite"></div>
  <div class="workspace">
    <div class="canvas" tabindex="0"></div>
    <aside class="details" aria-label="Details" hidden></aside>
  </div>
</section>
```

`src/component/styles.ts` exports one CSS string. Include a 640px breakpoint that turns `.details` into a bottom sheet, visible `:focus-visible`, diff patterns that do not rely on color alone, a minimum 44px control target, forced-colors support, and reduced-motion rules.

- [ ] **Step 4: Implement the accessible details panel**

Create `src/component/details-panel.ts` exporting `renderDetailsPanel(container, item)` and `closeDetailsPanel(container)`. Build headings, notes, and source anchors with DOM APIs and `textContent`. Opening focuses the heading; closing returns focus to the activating element supplied to `renderDetailsPanel`.

- [ ] **Step 5: Implement loading lifecycle**

Create `src/component/org-delta-chart.ts` with observed attributes `src`, `initial-view`, `compare-to`, `show-internal`, and `show-relationships`. Attach an open shadow root, render the template, resolve `src` with `new URL(value, document.baseURI)`, fetch JSON with `AbortController`, call `validateDocument`, select initial/baseline views, resolve/diff/build view, and call an injected renderer factory.

Expose this test seam:

```ts
export interface RendererCallbacks {
  onActivate: (
    kind: 'node' | 'internal' | 'hierarchy' | 'relationship' | 'change',
    id: string,
    trigger: HTMLElement | SVGElement,
  ) => void;
}

export type RendererFactory = (host: HTMLElement, callbacks: RendererCallbacks) => ChartRenderer;
export function setRendererFactoryForTests(factory: RendererFactory | undefined): void;
```

Production defaults to `D3OrgChartRenderer`.

- [ ] **Step 6: Register the real element**

Replace `src/index.ts` with:

```ts
export { OrgDeltaChartElement } from './component/org-delta-chart';
export * from './model/types';

import { OrgDeltaChartElement } from './component/org-delta-chart';

if (!customElements.get('org-delta-chart')) {
  customElements.define('org-delta-chart', OrgDeltaChartElement);
}
```

- [ ] **Step 7: Verify component lifecycle**

Run: `npm test -- test/component.test.ts test/registration.test.ts && npm run check`

Expected: all component and registration tests pass.

- [ ] **Step 8: Commit the component shell**

```bash
git add src/component src/index.ts test/component.test.ts test/registration.test.ts
git commit -m "Load and display org chart documents"
```

### Task 9: Add Reader Controls, Search, And Notes Activation

**Files:**
- Create: `src/component/controls.ts`
- Modify: `src/component/org-delta-chart.ts`
- Modify: `test/component.test.ts`

- [ ] **Step 1: Write failing interaction tests**

Extend `test/component.test.ts` to verify:

- Snapshot/proposal buttons rerun resolution and default a proposal baseline to its immediate base.
- A configured `compare-to` overrides that baseline.
- Checking a patch group selects requirements and disables locked conflicts with explanatory text.
- “Hide internal offices” rebuilds the view with `showInternal: false`.
- “Hide relationships” rebuilds with `showRelationships: false`.
- Search includes hidden internal offices, calls `renderer.reveal(id)`, and temporarily reveals the internal chain.
- Activating a node, hierarchy relation, cross-link, or diff badge opens the correct notes item.
- Activating a patch-group information button opens that group's notes and sources.
- Fit calls `renderer.fit()`.

- [ ] **Step 2: Run interaction tests to verify failure**

Run: `npm test -- test/component.test.ts`

Expected: new interaction tests fail.

- [ ] **Step 3: Implement controls with native form elements**

Create `src/component/controls.ts` exporting `renderControls(container, state, handlers)`. Use:

- A labeled `<select>` for snapshots/proposals when more than four exist; otherwise buttons with `aria-pressed`.
- A `<fieldset>` of patch-group checkboxes.
- Native checkboxes for internal offices and relationship overlays.
- `<input type="search" list="org-search-results">` plus `<datalist>`.
- Fit button.

Disabled patch-group labels include the `PatchSelection.disabled` reason both visibly and through `aria-describedby`.
When a patch group has a note or sources, render a separate accessible “About [group label]” button beside its checkbox; activating it opens details without toggling selection.

- [ ] **Step 4: Wire control state and activation callbacks**

In `OrgDeltaChartElement`, keep only source document, selected view ID, baseline ID, patch selection, visibility toggles, temporarily revealed internal IDs, and active details item as component state. Every structural change runs one `updateChart()` pipeline:

```ts
const selected = resolveView(document, selectionOptions);
const baseline = resolveView(document, baselineOptions);
const diff = diffCharts(baseline, selected);
renderer.render(buildRenderView(selected, diff, {
  ...visibility,
  revealedInternalIds,
}));
```

Use renderer activation callbacks to convert stable IDs through `notes.ts` and open the details panel. Represent hierarchy link IDs as `${parentId}->${childId}` and resolve them back to the selected chart's parent map. Represent change activation IDs as node or relationship IDs and look them up in `ChartDiff`.

- [ ] **Step 5: Verify all reader interactions**

Run: `npm test -- test/component.test.ts && npm run check`

Expected: all component interaction tests pass.

- [ ] **Step 6: Commit reader controls**

```bash
git add src/component/controls.ts src/component/org-delta-chart.ts test/component.test.ts
git commit -m "Add proposal and exploration controls"
```

### Task 10: Ship Direct And Iframe Examples

**Files:**
- Create: `viewer.html`
- Create: `src/viewer.ts`
- Create: `vite.viewer.config.ts`
- Create: `examples/state-department.html`
- Create: `examples/state-department.json`
- Modify: `vite.config.ts`
- Create: `test/viewer.test.ts`

- [ ] **Step 1: Write failing viewer URL tests**

Create `test/viewer.test.ts`:

```ts
import { readViewerSource } from '../src/viewer';

it('accepts HTTP, HTTPS, and root-relative chart sources', () => {
  expect(readViewerSource('?src=/blog/chart.json')).toBe('/blog/chart.json');
  expect(readViewerSource('?src=https%3A%2F%2Fexample.com%2Fchart.json'))
    .toBe('https://example.com/chart.json');
});

it('rejects javascript and missing sources', () => {
  expect(() => readViewerSource('?src=javascript%3Aalert(1)')).toThrow('Invalid chart source');
  expect(() => readViewerSource('')).toThrow('Missing chart source');
});
```

- [ ] **Step 2: Run viewer tests to verify failure**

Run: `npm test -- test/viewer.test.ts`

Expected: FAIL because viewer code is missing.

- [ ] **Step 3: Implement the iframe viewer entry**

Create `src/viewer.ts` exporting `readViewerSource(search)`. Accept root-relative, same-directory relative, HTTP, and HTTPS URLs; reject every other explicit scheme. When `document` exists, set the component `src`, copy optional known query parameters to attributes, and render a visible error if parsing fails.

Create `viewer.html` with a descriptive title, viewport metadata, body margin reset, one full-height `<org-delta-chart>`, and `<script type="module" src="/src/viewer.ts"></script>`.

Create `vite.viewer.config.ts`:

```ts
import { resolve } from 'node:path';
import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    emptyOutDir: false,
    rollupOptions: { input: resolve(import.meta.dirname, 'viewer.html') },
  },
});
```

- [ ] **Step 4: Add realistic examples**

Create `examples/state-department.json` containing:

- Current and historical snapshots.
- State HQ with two internal offices.
- USAID as subordinate.
- A proposal that renames and spins out an internal office.
- Three selectable patch groups, including one declared conflict and one requirement.
- A shared-leadership relationship with notes and HTTPS sources.
- Reserved symbol and zone data.

Create `examples/state-department.html` using only the two-line direct embed plus component height CSS. Configure Vite dev serving so `/examples/state-department.html` loads without custom copying.

- [ ] **Step 5: Verify viewer build and examples**

Run: `npm test -- test/viewer.test.ts && npm run build`

Expected: tests pass; `dist/org-delta-chart.js`, `dist/viewer.html`, and `dist/org-delta-chart.schema.json` exist.

- [ ] **Step 6: Commit publishing examples**

```bash
git add viewer.html src/viewer.ts vite.viewer.config.ts vite.config.ts examples test/viewer.test.ts
git commit -m "Add static-site and iframe examples"
```

### Task 11: Add Browser Accessibility And Responsive Coverage

**Files:**
- Create: `playwright.config.ts`
- Create: `e2e/embed.spec.ts`
- Modify: `package.json`
- Modify: `src/component/org-delta-chart.ts`
- Modify: `src/renderer/d3-renderer.ts`

- [ ] **Step 1: Configure browser tests**

Create `playwright.config.ts` with Chromium desktop and a 390x844 mobile viewport. Start `vite --host 127.0.0.1` as the web server and use `http://127.0.0.1:5173` as `baseURL`.

- [ ] **Step 2: Write failing end-to-end tests**

Create `e2e/embed.spec.ts` that:

- Opens the direct example and waits for the chart title.
- Switches to a proposal and verifies an added/changed badge appears.
- Selects a compatible patch group and verifies its required group becomes checked.
- Hides internal offices and verifies the hidden count badge.
- Searches for a hidden internal office and verifies it is revealed.
- Opens node and relationship notes using keyboard activation.
- Verifies the details panel is a side panel at desktop width and bottom sheet at mobile width.
- Runs with reduced motion and verifies transition duration computes to zero.
- Opens `/viewer.html?src=/examples/state-department.json` and verifies the same chart.

- [ ] **Step 3: Install Chromium and run tests to establish failures**

Run: `npx playwright install chromium && npm run test:e2e`

Expected: failures identify missing keyboard semantics, selectors, or responsive behavior.

- [ ] **Step 4: Fix browser-only accessibility gaps**

Use native buttons for every internal row and node activation target. Give outer hierarchy items `role="treeitem"`, `aria-level`, and `aria-expanded`; keep roving `tabindex` in the D3 adapter so arrow keys move among visible nodes. Add an offscreen textual relationship description for connectors that cannot themselves receive reliable SVG focus. Ensure status text announces selected view and diff summary.

- [ ] **Step 5: Verify unit and browser suites**

Run: `npm test && npm run check && npm run test:e2e`

Expected: all tests pass in jsdom and Chromium desktop/mobile projects.

- [ ] **Step 6: Commit accessibility coverage**

```bash
git add playwright.config.ts e2e package.json package-lock.json src/component src/renderer
git commit -m "Verify accessible responsive chart interaction"
```

### Task 12: Benchmark Large Charts And Document Usage

**Files:**
- Create: `scripts/generate-benchmark.ts`
- Create: `test/performance.test.ts`
- Create: `e2e/performance.spec.ts`
- Create: `examples/benchmark.html`
- Modify: `README.md`

- [ ] **Step 1: Write a deterministic fixture generator**

Create `scripts/generate-benchmark.ts` that writes `examples/generated-5000.json` with exactly 5,000 nodes, a maximum depth of six, every fifth child internal, two proposals, and 100 cross-links. Use a fixed arithmetic sequence rather than randomness so output is stable.

- [ ] **Step 2: Write performance guard tests for pure processing**

Create `test/performance.test.ts` to load the generated fixture and measure validation, resolution, diffing, and presentation projection. Assert each completes under 1,000ms on the test runner, all 5,000 nodes remain searchable, and `initialExpansionIds` contains fewer than 500 outer nodes. Log measured durations to aid future tuning.

- [ ] **Step 3: Generate the fixture and run the guard test**

Run: `npm run benchmark:generate && npm test -- test/performance.test.ts`

Expected: fixture contains 5,000 nodes and pure processing stays within the stated budgets. If CI variance makes a 1,000ms bound unstable, optimize first; only raise it with recorded evidence in the test comment.

- [ ] **Step 4: Measure browser load and search interaction**

Create `examples/benchmark.html` with the production two-line embed pointed at `./generated-5000.json` and a fixed 720px component height. Create `e2e/performance.spec.ts`; open `/examples/benchmark.html`, measure from navigation start until the component's status announces ready, and assert it completes within 10 seconds in headless Chromium. Search for `Office 4999`, assert the result becomes visible within one second, expand its path, and assert the browser page remains responsive. Record timings with `test.info().annotations` so CI artifacts retain measured values.

Run: `npm run test:e2e -- e2e/performance.spec.ts`

Expected: benchmark chart becomes ready under 10 seconds and search/reveal completes under one second.

- [ ] **Step 5: Replace the initial README**

Document:

- Direct two-line web-component embed.
- Iframe embed with root-relative JSON URL.
- JSON-only MVP format and link to the published schema.
- Stable ID guidance.
- Internal versus subordinate hierarchy edges.
- Snapshots, nested proposals, patches, requirements, and conflicts.
- Notes and HTTPS sources.
- Reader controls and accessibility behavior.
- Deferred symbols and meta-zones.
- Local commands: `npm test`, `npm run check`, `npm run build`, and `npm run test:e2e`.

Use complete snippets drawn from `examples/state-department.json`; do not introduce a second conflicting schema example.

- [ ] **Step 6: Run complete release verification**

Run: `npm test && npm run check && npm run build && npm run test:e2e && git status --short`

Expected: all commands pass; status lists only the intentionally generated benchmark fixture and documentation changes to be committed.

- [ ] **Step 7: Commit benchmark and documentation**

```bash
git add scripts/generate-benchmark.ts examples/generated-5000.json examples/benchmark.html test/performance.test.ts e2e/performance.spec.ts README.md
git commit -m "Document and benchmark org delta chart"
```

### Task 13: Final Spec Conformance Review

**Files:**
- Modify only files implicated by discovered gaps

- [ ] **Step 1: Check every MVP requirement against running behavior**

Use `docs/superpowers/specs/2026-07-21-org-delta-chart-design.md` as the checklist. Confirm JSON loading, 5,000-node collapsed exploration, internal containment, subordinate edges, historical snapshots, nested proposals, complete proposal snapshots, stacked groups, baseline comparison, notes on every supported entity, cross-links, visibility toggles, iframe delivery, and default styling.

- [ ] **Step 2: Check deferred features stay deferred but schema-compatible**

Validate an example containing image/text symbols and zones. Confirm validation accepts them, the MVP does not render them, and no UI claims that it does.

- [ ] **Step 3: Run final verification from a clean build output**

Run: `npm test && npm run check && npm run build && npm run test:e2e`

Expected: fresh build succeeds and every unit/component/browser test passes.

- [ ] **Step 4: Inspect final repository state**

Run: `git status --short && git log --oneline -15`

Expected: no uncommitted changes and a sequence of focused implementation commits following this plan.
