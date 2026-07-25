# Historical Renderer Review Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a sourced SAC/TAC-to-ACC/AMC historical fixture, render it in both modes, pause for visual approval, and then adopt it for acceptance coverage.

**Architecture:** Keep one canonical JSON document with representative before and after snapshots and two HTML presentation entry points. Add component-owned delegated provenance tooltips over existing renderer activation elements, then retain small synthetic unit fixtures while using the historical document for cross-layer integration and browser acceptance tests.

**Tech Stack:** TypeScript, Web Components, D3, JSON Schema draft 2020-12, Ajv, Vitest, Vite, Playwright.

---

## File Structure

- Create `docs/research/1992-air-force-reorganization.md` as the source and assignment ledger.
- Create `examples/1992-air-force-reorganization.json` as the canonical fixture.
- Create `examples/1992-reorganization-depth.html` and `examples/1992-reorganization-taxonomy.html` as renderer entry points.
- Create `src/component/node-tooltip.ts` for accessible tooltip rendering and positioning.
- Modify `src/component/template.ts`, `src/component/org-delta-chart.ts`, and `src/component/styles.ts` to host and control tooltips.
- Add focused tooltip tests, then add historical integration and Playwright coverage after visual approval.
- Update `README.md` and `docs/roadmap.md` after the accepted behavior is established.

### Task 1: Historical Research Ledger

**Status:** Closed by scope decision. The user accepted the sourced working reconstruction as a renderer demo without requiring exhaustive lineage cross-checking; unresolved items remain documented and the fixture does not claim to be authoritative.

- [x] Define exact inclusion, exclusion, representative-date, and source-confidence rules.
- [x] Inventory the working SAC and TAC MAJCOM, NAF, air-division, and wing cohort.
- [x] Record each tracked wing's represented ACC or AMC destination and effective-date caveats.
- [x] Preserve the explicit unresolved list rather than presenting inferred data as authoritative.

### Task 2: Canonical Historical Fixture

- [x] Author the shared JSON with stable IDs, sourced notes, two snapshots, and comparison taxonomy.
- [x] Create depth and taxonomy HTML entry points over the same document.
- [x] Load both examples manually and correct data or schema failures without adding acceptance assertions.
- [x] Run the existing test, type-check, and build suites to protect the baseline.

### Task 3: Provenance Tooltips

- [x] Write failing unit tests for node and assignment tooltip content, source labels, accessible association, and cleanup.
- [x] Run focused tests and confirm failures are caused by the absent tooltip behavior.
- [x] Implement the minimal shared tooltip and delegated component event handling.
- [x] Run focused and full Vitest suites to green.

### Task 4: Visual Review Gate

- [x] Serve both examples through Vite and provide the exact URLs.
- [x] Review desktop and mobile density, hierarchy spacing, taxonomy rows, typography, change signals, connectors, and tooltips with the user.
- [x] Stop before historical acceptance-test migration.
- [x] Apply requested aesthetic changes and repeat the review until approved.

### Task 4A: Approved Visual Refinements

- [x] Add failing schema, type, resolution, and component tests for `transitionDurationMs`, the `transition-duration` override, bounds, precedence, and the 700 ms default.
- [x] Implement motion configuration and run focused tests to green.
- [x] Add failing card and details tests for one activation surface per organization, no View changes controls, baseline fallback for removed nodes, and combined unit/diff details.
- [x] Implement single-box outer and internal organization buttons and combined details, then run renderer and component tests to green.
- [x] Add failing taxonomy renderer tests for system labels appearing once per side and level-only tier cells.
- [x] Move taxonomy names to column headers and run taxonomy tests to green.
- [x] Add failing component tests for the desktop controls sidebar and focus-managed mobile drawer.
- [x] Move title, selection, controls, search, and status into the controls sidebar; preserve the desktop details sidebar and mobile bottom sheet.
- [x] Add failing renderer tests for configured depth duration, taxonomy keyed movement and entry fades, immediate initial render, and reduced motion.
- [x] Implement depth and taxonomy motion and run focused tests to green.
- [x] Repeat the desktop and mobile visual review gate before Task 5.

### Task 4B: Selected-State Taxonomy And Shared Primitives

- [x] Add failing presentation tests proving taxonomy contains only the selected state, selected tiers, and no visual diff kinds or movement records.
- [x] Simplify taxonomy projection and component integration while retaining comparison details outside the renderer.
- [x] Add failing pure layout tests for parent centering, sibling order, multiple roots, skipped tiers, collisions, and deterministic width.
- [x] Create `src/renderer/taxonomy-layout.ts` and use its absolute positions for taxonomy cards and connectors.
- [x] Add failing shared-card tests for equivalent mode markup, 250/220 pixel variants, centered names, and left-aligned supporting content.
- [x] Refactor `src/renderer/card.ts` around one card primitive and update both renderer wrappers.
- [x] Add failing tests for shared right/down chevrons in taxonomy and `d3-org-chart.buttonContent`.
- [x] Implement the shared expansion artwork without changing keyboard or ARIA behavior.
- [x] Add canvas-only text-selection and grab/grabbing styles and verify sidebar/details remain selectable.
- [x] Repeat the desktop and mobile visual review gate before Task 5.

### Task 5: Historical Acceptance Coverage

- [x] Add fixture tests for schema validity, complete tracked disposition, Air Division removal, parent changes, and taxonomy placement.
- [x] Add desktop and mobile Playwright tests for both pages, tooltips, details links, and representative geometry.
- [x] Move broad renderer acceptance assertions to the historical fixture while retaining focused synthetic edge-case tests.
- [x] Run focused and full test suites to green.

### Task 6: Documentation And Completion

- [x] Document the example URLs, source method, representative-date caveat, and tooltip behavior in `README.md`.
- [x] Insert Historical Renderer Review & Polish as Phase 4 in `docs/roadmap.md` and add wing-mission authoring to Focus Sets.
- [x] Run `npm test`, `npm run check`, `npm run build`, `npm run test:e2e`, and `git diff --check`.
- [x] Review the final diff and mark Phase 4 complete only after all checks and user visual approval pass.
