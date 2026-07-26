# Renderer Consolidation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make depth and taxonomy layouts use one hierarchy controller and one DOM renderer for cards, expansion, accessibility, transitions, pan/zoom, fit, minimap, and connectors.

**Architecture:** A shared hierarchy projection removes duplicated presentation calculations. `HierarchyController` owns stable-ID expansion and navigation state. `SceneRenderer` reconciles keyed positioned scene nodes produced by depth and taxonomy layout adapters; existing exported renderer classes remain compatibility wrappers.

**Tech Stack:** TypeScript 5.8, D3 7, Web Components, Vitest/jsdom, Playwright

---

### Task 1: Shared Projection And Hierarchy State

**Files:** `src/presentation/hierarchy-projection.ts`, `src/renderer/hierarchy-controller.ts`, both presentation builders, focused tests

- [x] Write failing tests for deterministic hierarchy projection, hidden anchors, relationships, search ownership, retained expansion, recursive collapse, and reveal.
- [x] Implement the shared projection and controller.
- [x] Migrate depth and taxonomy presentation builders and run focused parity and performance tests.

### Task 2: Shared Scene And Cards

**Files:** `src/renderer/scene-types.ts`, `src/renderer/scene-renderer.ts`, `src/renderer/card.ts`, focused tests

- [x] Write failing tests for shared card markup and renderer interaction contracts.
- [x] Implement keyed DOM reconciliation, shared activation, semantic navigation, expansion, transitions, viewport controls, connectors, and minimap.
- [x] Verify reduced motion, large-chart behavior, empty views, reveal, and cleanup.

### Task 3: Depth Layout Migration

**Files:** `src/renderer/depth-layout.ts`, `src/renderer/d3-renderer.ts`, depth tests

- [x] Write failing depth layout tests for parent centering, uneven heights, and multiple roots.
- [x] Implement the depth scene adapter.
- [x] Replace the old renderer with a compatibility wrapper and verify cards, internal owners, expansion, activation, and 300-node rendering.

### Task 4: Taxonomy Layout Migration

**Files:** `src/renderer/taxonomy-layout.ts`, `src/renderer/taxonomy-renderer.ts`, taxonomy tests

- [x] Write failing taxonomy scene tests for tiers, nodes, and connectors.
- [x] Implement tier decorations and positioned taxonomy scenes.
- [x] Replace duplicated taxonomy behavior with the shared renderer and verify taxonomy-specific geometry and labels.

### Task 5: Dependency And Documentation Cleanup

**Files:** `package.json`, `package-lock.json`, `README.md`, `docs/roadmap.md`, package tests

- [x] Add a failing package test and remove `d3-org-chart`.
- [x] Preserve public renderer exports and overlay utility compatibility.
- [x] Document the shared renderer and insert the completed roadmap phase before Focus Sets.

### Task 6: Full Verification

- [x] Run `npm run check && npm test`.
- [x] Run `npm run build`.
- [x] Run `npm run test:e2e`.
- [x] Run focused performance checks.
- [x] Inspect `git diff --check`, status, and final scope.

No commits are included because repository policy requires an explicit user request before committing.
