# Taxonomy Renderer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a configurable taxonomy renderer that aligns complete baseline and proposed organization charts to shared comparison tiers.

**Architecture:** Keep the existing depth renderer intact and introduce a dedicated taxonomy projection and renderer. Build the projection from both resolved charts, share card primitives, and let the component select the effective renderer from document defaults and an attribute override.

**Tech Stack:** TypeScript, D3, Web Components, JSON Schema draft 2020-12, Ajv, Vitest, Vite, Playwright.

---

## File Structure

- Modify `src/model/types.ts` and `public/org-delta-chart.schema.json` for layout configuration.
- Create `src/presentation/build-taxonomy-view.ts` for merged tiers, complete comparison sides, fallback placement, and movement records.
- Modify `src/renderer/types.ts` with discriminated depth and taxonomy view types.
- Create `src/renderer/card.ts` for shared safe organization-card markup.
- Create `src/renderer/taxonomy-renderer.ts` for tier-grid rendering, connectors, zoom, expansion, search reveal, and semantic navigation.
- Modify `src/component/org-delta-chart.ts` to select renderers and preserve baseline/proposed activation context.
- Modify `src/component/styles.ts` and `src/index.ts` for presentation and package exports.
- Add focused Vitest coverage, a synthetic example, Playwright coverage, and README documentation.

## Task 1: Layout Configuration

- [ ] Add failing type, schema, and resolution tests for `presentation.layoutMode`.
- [ ] Run the focused tests and confirm they fail because layout mode is absent.
- [ ] Add the `depth | taxonomy` type, schema enum, cloning, and default behavior.
- [ ] Run `npm run check` and focused tests to green.

## Task 2: Taxonomy Comparison Projection

- [ ] Add failing tests for proposed-first tier merging and baseline-only insertion.
- [ ] Add failing tests for complete paired sides, single-view mode, and side-specific taxonomy systems.
- [ ] Add failing tests for explicit, hierarchy-fallback, conflicting, and clamped placement.
- [ ] Add failing tests for internal cards, visibility, relationships, search entries, and moved-tier records.
- [ ] Implement `buildTaxonomyRenderView` minimally and run its focused tests to green after each behavior.

## Task 3: Shared Card Rendering

- [ ] Add regression assertions around current depth card output.
- [ ] Extract safe card and leadership markup to `src/renderer/card.ts`.
- [ ] Add the compact taxonomy-internal variant.
- [ ] Run depth renderer unit and integration tests to green.

## Task 4: Static Taxonomy Renderer

- [ ] Add failing DOM tests for tier rows, complete baseline/proposed cards, taxonomy columns, and no-delta mode.
- [ ] Implement the deterministic tier grid and card placement.
- [ ] Add failing tests for hierarchy, relationship, and moved-tier connectors.
- [ ] Implement measured SVG connector layers and responsive styles.
- [ ] Run taxonomy renderer tests to green.

## Task 5: Interaction And Accessibility

- [ ] Add failing tests for shared zoom, fit, reveal, synchronized expansion, and cleanup.
- [ ] Add failing tests for baseline/proposed semantic trees and side-aware activation.
- [ ] Implement interactions and navigation with reduced-motion behavior.
- [ ] Run renderer and overlay tests to green.

## Task 6: Component Integration

- [ ] Add failing tests for document default, attribute override, dynamic switching, and invalid configuration.
- [ ] Add failing tests for no-tier depth fallback and status text.
- [ ] Add failing tests for paired search and version-correct details.
- [ ] Integrate projection and renderer selection, recreating only when effective mode changes.
- [ ] Run component tests to green.

## Task 7: Acceptance And Documentation

- [ ] Add a small taxonomy comparison JSON fixture and embed page.
- [ ] Add desktop and mobile Playwright checks for paired geometry, pan/zoom, cards, and keyboard navigation.
- [ ] Document both configuration surfaces, fallback, and comparison behavior in `README.md`.
- [ ] Mark the Taxonomy Renderer roadmap phase complete after all verification passes.
- [ ] Run `npm test`, `npm run check`, `npm run build`, `npm run test:e2e`, and `git diff --check`.
