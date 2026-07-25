# Historical Renderer Review Design

## Purpose

Phase 4 creates the first historically grounded chart used to inspect both renderers. It pauses feature development before Focus Sets so the existing product can be reviewed and polished against recognizable Air Force organization data.

## Historical Scope

Use one canonical JSON document that follows Regular Air Force wings assigned to Strategic Air Command or Tactical Air Command through the June 1992 reorganization. The baseline is a documented representative arrangement from the period immediately before the reorganization; the after state represents the initial Air Combat Command and Air Mobility Command arrangement. The labels and notes must not imply a precise single-day order of battle when sources reflect different effective dates.

Include MAJCOMs, numbered air forces, air divisions, and wings. Wings are the lowest echelon. Include every verifiable active-duty SAC and TAC wing in the selected cohort and preserve destinations outside ACC, principally AMC, rather than depicting transfers as inactivations. Exclude Air National Guard, Air Force Reserve, provisional organizations, groups, squadrons, zones, and leadership.

Every organization and parent assignment must have an authoritative source or a documented unresolved status. Do not infer missing assignments. The fixture may be described as complete only when the unresolved list is empty.

## Rendering

Two HTML examples reference the same JSON document. One opens in depth mode and one in taxonomy mode. Both present the selected after state while retaining comparison counts and surviving-organization changes. Removed organizations are omitted from the rendered hierarchy and search index rather than introduced as disconnected roots.

The initial dataset and renderer output are a review artifact, not an accepted visual design. After both pages render and existing automated checks pass, implementation stops for user review. Acceptance tests must not migrate to the historical fixture until the user approves the visual result. Requested aesthetic changes are applied and reviewed before proceeding.

The approved refinement moves the title, selection summary, controls, search, and visible status into a persistent left sidebar on desktop. On mobile the same content opens as a focus-managed drawer from a compact Controls button. The details surface remains a right sidebar on desktop and a bottom sheet on mobile.

Every organization is represented by one bordered activation button rather than a bordered wrapper containing a smaller name button. Changed organizations have no separate View changes action; their single activation opens combined organization and diff information. Internal organizations are separate full-width unit buttons beneath their outer organization so controls are never nested. Expansion controls remain separate because they navigate the hierarchy rather than opening details.

Taxonomy system names appear once as column headers. Each tier row contains only the level label that maps to that tier.

Taxonomy mode also omits a paired baseline chart, movement connectors, and visual diff decoration; comparison information remains available in unit details. Within the selected chart, horizontal positions derive from the visible hierarchy rather than row order. Leaves receive ordered slots, parents center over descendant spans, multiple roots remain separate, and collision handling widens the world when necessary. Taxonomy tiers still control vertical placement, including skipped tiers.

Depth and taxonomy use one shared unit-card primitive. Outer cards are approximately 250 pixels wide with a 72 pixel minimum height; compact internal cards are approximately 220 pixels wide with a 56 pixel minimum height. Unit names are centered while leadership, counts, badges, and internal content remain left-aligned. Both renderers also use the same right/down chevron artwork for collapsed and expanded hierarchy controls.

Text selection is disabled only on the draggable canvas, with grab and grabbing cursors. Sidebar and details text remain selectable.

## Motion

Presentation configuration accepts `transitionDurationMs`, with a `transition-duration` component attribute override and a 700 ms default. Valid values are integers from 0 through 5000 milliseconds. Attribute configuration takes precedence over document configuration. Reduced-motion preferences always force zero-duration behavior.

Depth layout uses the configured duration for structural movement, expansion, and fit operations. Taxonomy layout animates surviving keyed cards between old and new positions and fades entering cards. Initial rendering is immediate.

## Provenance Tooltips

Node names expose a shared tooltip on pointer hover and keyboard focus in both renderers. The tooltip contains the node note and source labels plus the current snapshot's parent-assignment note and source labels. Raw URLs remain in the existing details panel as clickable links. The tooltip is noninteractive, touch-safe, associated through `aria-describedby`, and removed on pointer exit, focus exit, rerender, or disconnect.

## Testing

Focused synthetic fixtures remain the unit-test source for isolated model and renderer edge cases. After visual approval, the historical JSON becomes a shared integration and browser acceptance fixture covering validation, resolution, diffs, both renderers, provenance tooltips, source links, and desktop/mobile behavior.

## Later Phases

Focus Sets will add authored, versioned wing-mission sets such as fighter, bomber, tanker, reconnaissance, air control, missile, and composite using this historical cohort. YAML Authoring will convert the fixture. The later Full Air Force Example phase will broaden and deepen it rather than replace it.

Integration Hardening will add authored color schemes and broader theming options.
