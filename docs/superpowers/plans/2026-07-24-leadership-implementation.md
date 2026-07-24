# Leadership Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add versioned leadership billets, rank markers, rendering, details, and diffs for subordinate and internal organizations.

**Architecture:** Store leadership as optional ordered node state. Reuse existing snapshot and `set-node` semantics, project leadership into renderer-neutral view data, and render fixed-size markers in the D3 adapter. Keep marker catalog resolution isolated from author data.

**Tech Stack:** TypeScript, JSON Schema draft 2020-12, Vitest, jsdom, d3-org-chart adapter, Vite build.

---

## File Structure

- Modify `src/model/types.ts` for leadership, rank, marker, diff, and render-view types.
- Modify `public/org-delta-chart.schema.json` for leadership JSON validation.
- Modify `src/model/resolve.ts` to deep-clone leadership and reject duplicate resolved billet IDs.
- Modify `src/model/validate.ts` to report view-scoped duplicate billet IDs and unknown marker IDs.
- Modify `src/model/diff.ts` to classify leadership changes and emit per-billet leadership diffs.
- Modify `src/presentation/build-view.ts` to copy leadership to outer cards, internal rows, search entries where needed, and ghost nodes.
- Modify `src/presentation/notes.ts` and `src/component/details-panel.ts` for structured leadership details.
- Create `src/markers/catalog.ts` for bundled marker metadata and trusted SVG markup/data.
- Modify `src/renderer/d3-renderer.ts` and `src/component/styles.ts` for leadership rows and markers.
- Modify `test/fixtures.ts` or create focused helpers in existing tests for the Wing/CSS/OSS/WSA acceptance fixture.
- Modify `test/validate.test.ts`, `test/resolve.test.ts`, `test/diff.test.ts`, `test/build-view.test.ts`, `test/d3-renderer.test.ts`, `test/component.test.ts`, `test/types.test.ts`, and docs.

## Tasks

### Task 1: Model, Schema, And Resolution

- [ ] Write failing tests in `test/validate.test.ts` for accepted leadership shapes, rejected empty billets, rejected bad marker URLs, unknown bundled marker IDs, and duplicate resolved billet IDs.
- [ ] Write failing tests in `test/resolve.test.ts` proving leadership is deep-cloned and `set-node` replaces leadership in proposals.
- [ ] Add leadership and marker types to `src/model/types.ts`.
- [ ] Add marker catalog metadata in `src/markers/catalog.ts`.
- [ ] Extend `public/org-delta-chart.schema.json` leadership definitions.
- [ ] Extend `src/model/resolve.ts` clone logic and resolved-view duplicate billet validation.
- [ ] Extend `src/model/validate.ts` with view-scoped marker and duplicate billet checks.
- [ ] Run `npm test -- test/validate.test.ts test/resolve.test.ts test/types.test.ts`.

### Task 2: Diffs And Details

- [ ] Write failing tests in `test/diff.test.ts` for identified billet movement, retitling, rank promotion, anonymous before/after records, and modified source/destination nodes.
- [ ] Write failing tests in `test/build-view.test.ts` for `nodeDetails` and `changeDetails` leadership text.
- [ ] Extend `src/model/diff.ts` with `leadership` node changes and leadership diff records.
- [ ] Extend `src/presentation/notes.ts` and `src/component/details-panel.ts` with structured leadership detail sections.
- [ ] Run `npm test -- test/diff.test.ts test/build-view.test.ts`.

### Task 3: Projection And Rendering

- [ ] Write failing tests in `test/build-view.test.ts` proving outer nodes, internal rows, and removed ghost nodes retain leadership.
- [ ] Write failing tests in `test/d3-renderer.test.ts` proving all leadership rows render, bundled markers render safely, external markers use `img`, and internal rows include leadership.
- [ ] Extend renderer-neutral types and `src/presentation/build-view.ts` to project leadership.
- [ ] Extend `src/renderer/d3-renderer.ts` with marker and leadership HTML rendering.
- [ ] Extend `src/component/styles.ts` for fixed-size markers and leadership rows.
- [ ] Run `npm test -- test/build-view.test.ts test/d3-renderer.test.ts`.

### Task 4: Component, Docs, And Full Verification

- [ ] Write failing component tests for the Wing/CSS/OSS/WSA fixture and details panel leadership output.
- [ ] Update fixtures and README leadership examples.
- [ ] Add marker catalog documentation and source/licensing notes.
- [ ] Update `docs/roadmap.md` to mark the Leadership phase in progress or complete after verification.
- [ ] Run `npm test`, `npm run check`, `npm run build`, and `npm run test:e2e`.
