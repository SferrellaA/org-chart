# Org Delta Chart Roadmap

This roadmap records the agreed sequence for post-MVP work. Future sessions should treat each phase as a separate project with its own implementation plan, tests, and documentation updates.

## Session Workflow

- Prefer inline execution with review checkpoints.
- Avoid subagents by default; use them only for narrow, read-only research when explicitly requested.
- Start each feature session by reviewing this roadmap and the current code state.
- Write a focused implementation plan before editing feature code.
- Keep each phase independently shippable and tested before moving to the next one.
- Use small synthetic fixtures for isolated behavior, the working 1992 reconstruction for renderer acceptance, and reserve the comprehensive Air Force example for its later roadmap phase.

## Feature Sequence

1. **Leadership** - completed 2026-07-24
   Add versioned authorized leadership data to organization nodes. Support billet title, authorized rank or grade, optional occupant, acting/vacant status, and fixed-size rank markers from bundled SVG IDs, HTTPS image URLs, text, or emoji. Render leadership consistently for subordinate cards and internal units, expose it in details, and include leadership changes in proposal diffs.

2. **Taxonomy Foundation** - completed 2026-07-24
   Add versioned taxonomy data to the canonical model and schema. Support ordered comparison tiers, named taxonomy systems, taxonomy levels mapped to explicit tiers, multiple node assignments, proposal changes to assignments and definitions, validation, resolution, and diffs. Missing assignments should remain valid and use hierarchy fallback.

3. **Taxonomy Renderer** - completed 2026-07-25
   Add a second renderer mode over the shared resolved model. The existing depth renderer remains hierarchy-first with compact internal rows. The taxonomy renderer aligns complete baseline and proposed charts to shared comparison tiers, renders internal organizations as smaller subdued cards, shows every taxonomy system supplied by each view, and connects organizations that move between tiers.

4. **Historical Renderer Review & Polish** - completed 2026-07-25
   Exercise both renderers with an accepted working reconstruction of the 1992 SAC/TAC transition to ACC/AMC. Add provenance tooltips, shared organization cards, hierarchy-positioned selected-state taxonomy rendering, configurable motion, persistent desktop controls, a mobile controls drawer, and historical integration and browser acceptance coverage.

5. **Focus Sets**
   Turn the existing dormant zone-like concept into authored named focus sets with versioned membership. Allow one active set at a time. Members receive the set accent while nonmembers are de-emphasized but retained as context. Support the feature in both depth and taxonomy renderers, including removed nodes, and author wing-mission sets such as fighter, bomber, tanker, reconnaissance, air control, missile, and composite over the historical cohort.

6. **YAML Authoring**
   Add a human- and AI-friendly YAML shorthand compiled into canonical JSON. Require explicit stable IDs. Support the full feature set, including snapshots, proposals, leadership, taxonomies, focus sets, relationships, and patch groups. Provide deterministic output, source-location diagnostics, validation commands, examples, and AI authoring guidance.

7. **Full Air Force Example**
   Build a realistic YAML-authored acceptance fixture after the leadership, taxonomy, focus-set, and authoring features exist. Use it to demonstrate operational and staff structures, historical Air Divisions, skipped tiers, internal/subordinate distinctions, rank markers, taxonomy changes, and named focus sets.

8. **Integration Hardening**
   Polish accessibility, mobile behavior, performance, schema documentation, package exports, visual examples, and end-to-end tests using the realistic fixture and stress cases.

9. **Cross-Taxonomy Ambiguity**
   Visualize organizations whose assignments in different taxonomy systems map to different comparison tiers without duplicating the organization or privileging one taxonomy.

## Key Design Decisions

- Keep one embeddable Web Component and one canonical schema family.
- Do not fork the project unless the taxonomy renderer proves impossible to keep isolated.
- Keep leadership and taxonomy data versioned so snapshots and proposals can change them.
- Keep layout mode as presentation configuration, not organization identity.
- Do not require every chart to use leadership, taxonomies, focus sets, or YAML authoring.
- Treat AI authoring as an accelerator, not as the only supported authoring path.
