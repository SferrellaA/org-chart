# Renderer Consolidation Design

## Purpose

Consolidate the depth and taxonomy renderers before Focus Sets so both modes use one implementation for cards, hierarchy behavior, interaction, motion, and viewport controls. Taxonomy differs from depth only where tier-based presentation requires it. Authored data, component attributes, and public renderer APIs remain compatible.

## Architecture

One renderer core consumes a shared hierarchy scene model. The core owns unit-card DOM, expansion state, visible-subtree calculation, semantic navigation, activation, reveal, keyed transitions, reduced-motion handling, pan and zoom, fit, minimap, connectors, and lifecycle cleanup.

Two layout adapters provide positions and mode-specific decoration:

- Depth computes the top-down hierarchy and groups internal units beneath their owning outer card.
- Taxonomy retains explicit comparison-tier rows, skipped-tier placement, taxonomy labels, and tier-aware connectors.

`D3OrgChartRenderer` and `TaxonomyRenderer` remain public compatibility wrappers. The depth wrapper no longer requires `d3-org-chart`.

## Shared Projection

Both presentation builders consume one hierarchy projection for hierarchy order, internal and subordinate identity, hidden-internal anchors, relationship aggregation, search ownership, normalized card data, and initial expansion. Depth groups projected internal organizations into rows. Taxonomy places the same projected organizations independently by tier.

## Interaction

One unit-card primitive supplies activation, leadership, escaping, diff treatment, accessible naming, and content structure. Layout controls remain separate from activation buttons.

The shared hierarchy controller retains expansion by stable ID, initializes only new IDs, discards removed IDs, recursively collapses descendants, expands every ancestor during reveal, and includes internal organizations that own subordinate branches. Pointer controls and the semantic tree invoke the same toggle operation.

## Motion And Viewport

One keyed transition engine serves both layouts. Initial rendering is immediate. Retained cards move from prior coordinates, entering cards emerge from their nearest prior visible ancestor, and exiting cards move toward the nearest retained ancestor. Reduced motion, zero duration, and the existing large-chart threshold make updates immediate.

Pan, zoom, fit, connectors, and minimap are shared renderer capabilities. Taxonomy gains the same minimap as depth.

## Testing

Focused tests cover shared projection, hierarchy state, card markup, depth and taxonomy layouts, shared rendering contracts, wrapper compatibility, historical integration, browser behavior, 300-node rendering, and 5,000-node projection performance.

Focus Sets remain out of scope.
