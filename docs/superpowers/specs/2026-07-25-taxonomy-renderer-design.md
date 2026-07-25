# Taxonomy Renderer Design

## Purpose

Add a taxonomy-based presentation mode alongside the existing hierarchy-first depth renderer. Taxonomy mode compares complete baseline and proposed organization charts against shared comparison-tier rows while preserving version-specific taxonomy definitions, leadership, hierarchy, internal organizations, and relationships.

## Configuration

`presentation.layoutMode` accepts `depth` or `taxonomy` and defaults to `depth`. A `layout-mode` Web Component attribute overrides the document default. Layout mode is presentation configuration, not organization identity.

If taxonomy mode is requested but the selected view has no comparison tiers, the component renders the depth view and announces the fallback in its status text.

## Architecture

The existing `D3OrgChartRenderer` remains responsible for depth mode. A separate `TaxonomyRenderer` consumes a dedicated projection built from both the baseline and selected resolved charts. Shared card rendering keeps leadership, rank markers, activation, escaping, and change treatment consistent without coupling the two layout engines.

## Comparison Layout

A delta uses one shared tier grid:

```text
baseline taxonomies | baseline chart | movement gutter | proposed chart | proposed taxonomies
```

Both chart halves are complete. Every organization present in each resolved view appears in that half, including unchanged organizations. Added and removed organizations appear only on their applicable side. Version-specific cards show their own leadership and internal state rather than partial markers.

When baseline and selected view are identical, taxonomy mode renders one full-width chart. For a delta, proposed tier order controls shared rows. Baseline-only tiers remain as removed rows near their former neighbors. Every taxonomy system provided by a resolved view receives a side column only in that view.

Subordinate organizations use full cards. Internal organizations use separate, smaller subdued cards rather than compact rows inside an outer card. Hierarchy and authored relationships remain within their respective chart half. Cross-gutter connectors initially appear only when an organization changes displayed tiers; this choice remains subject to later visual acceptance review.

## Tier Placement

If all authored taxonomy assignments on a node resolve to one comparison tier, that tier determines placement. Missing assignments and assignments that resolve to different tiers use hierarchy fallback without changing the authored classification:

- roots begin at the first comparison tier;
- internal edges retain the nearest placed ancestor's tier;
- subordinate edges move down one tier;
- fallback positions clamp to the available tier range.

Rich visualization of contradictory cross-taxonomy assignments is deferred to the Cross-Taxonomy Ambiguity roadmap phase.

## Interaction And Accessibility

One pan and zoom transform moves both chart halves and taxonomy columns together. Expansion and collapse synchronize by organization ID across baseline and proposal. Search reveals and highlights both counterparts and centers the pair when possible. Internal-unit and relationship controls affect both halves.

Mobile retains the paired spatial layout and starts fitted rather than stacking the comparison. Keyboard users receive separately labeled baseline and proposed semantic trees with synchronized expansion. Existing details, activation, reduced-motion, forced-color, and focus behavior remain available. Activations retain baseline or proposed context so details use the correct resolved state.

## Errors And Acceptance

Projection and layout must be deterministic. Unit coverage includes merged tier order, baseline-only tiers, explicit and fallback placement, complete paired views, internal cards, side-specific taxonomy systems, and movement connectors. Component coverage includes configuration precedence, renderer switching, fallback, search, synchronized expansion, and version-correct details. End-to-end coverage includes desktop and mobile layouts, pan and zoom, keyboard navigation, and differing baseline and proposed content.

Tests and examples use a small synthetic fixture. The realistic Air Force fixture remains deferred until the roadmap reaches that phase.
