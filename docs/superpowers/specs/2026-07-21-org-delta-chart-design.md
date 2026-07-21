# Org Delta Chart Design

## Purpose

Build a read-only, embeddable organization-chart explainer for static sites. It should offer Mermaid-like publishing ergonomics while supporting large government organization charts, historical structures, competing reorganization proposals, and annotated relationships.

The MVP is a TypeScript web component backed by `d3-org-chart`. The core data and diff logic remain independent of that renderer so a custom canvas or WebGL renderer can replace it later.

## Scope

### MVP

- Load one JSON document from a URL relative to the containing page.
- Render a large, searchable, collapsible organization hierarchy.
- Render internal offices within their parent's visual boundary.
- Render subordinate offices as connected child boxes.
- Switch among complete historical snapshots and proposed branches.
- Apply optional patch groups on top of snapshots or other proposals.
- Let readers select compatible stacked patch groups.
- Compare the selected result with its base or a configured baseline.
- Explain nodes, hierarchy edges, non-hierarchy relationships, and changes in a persistent notes panel.
- Show non-hierarchy relationships such as shared leadership.
- Hide or show internal offices and relationship overlays.
- Provide a standalone iframe-friendly viewer page.
- Ship default styling so publishers only need to size the component.

### Deferred

- CSV input or a Mermaid-like text syntax.
- Authoring, editing, drag-and-drop, or browser persistence.
- Automatic semantic inference of merges and splits.
- Office symbols rendered from SVG, PNG, or styled text.
- Flexible meta-zone geometry around cross-cutting groups.
- Canvas or WebGL rendering.

The JSON schema reserves optional fields for symbols and zones so these additions do not require a breaking format change.

## Publishing Experience

A publisher places the chart JSON beside the article HTML:

```text
blog/my-post/
  index.html
  state-org-chart.json
```

The primary embed API is:

```html
<script type="module" src="/assets/org-delta-chart.js"></script>
<org-delta-chart src="./state-org-chart.json"></org-delta-chart>
```

`src` resolves according to normal browser URL rules, making a colocated `./state-org-chart.json` work on static hosts such as Render.

Optional attributes configure initial presentation:

```html
<org-delta-chart
  src="./state-org-chart.json"
  initial-view="current"
  compare-to="current"
  show-internal="true"
  show-relationships="true"
  show-zones="false"
></org-delta-chart>
```

The component includes its own default styles. Publishers may set dimensions directly:

```css
org-delta-chart {
  display: block;
  height: 720px;
}
```

A packaged standalone viewer offers an iframe alternative:

```html
<iframe
  src="/org-chart-viewer.html?src=/blog/my-post/state-org-chart.json"
  width="100%"
  height="720"
  loading="lazy"
></iframe>
```

The viewer reads and validates the `src` query parameter, then creates the same web component. Because query-parameter URLs resolve relative to the viewer rather than the embedding article, iframe authors use a root-relative or absolute chart URL. The viewer does not duplicate chart behavior.

## Architecture

The implementation has five bounded units:

1. **Schema and validation** defines the public JSON format and produces actionable errors.
2. **Resolver** turns a snapshot or proposal chain plus selected patch groups into one immutable resolved chart.
3. **Diff engine** compares two resolved charts and emits structural and annotated changes.
4. **Renderer adapter** translates resolved charts and diffs into `d3-org-chart` operations without exposing D3 types to the other units.
5. **Web component UI** loads data, owns reader state, renders controls, and coordinates the renderer and notes panel.

The data flow is:

```text
JSON URL -> validation -> normalized document
                         -> resolve selected view
                         -> resolve comparison view
                         -> compute diff
                         -> renderer adapter
                         -> chart + controls + notes panel
```

The resolver and diff engine are pure TypeScript modules. This makes proposal behavior testable without a browser and preserves the option to replace D3.

## Data Model

The canonical document contains stable entities and versioned structure:

```json
{
  "$schema": "https://example.org/org-delta-chart.schema.json",
  "title": "Department of State Reorganization",
  "nodes": {},
  "snapshots": [],
  "proposals": [],
  "relationships": [],
  "zones": []
}
```

All addressable records use stable, document-unique string IDs. Display names are not identifiers.

### Nodes

Nodes define identity and default metadata independently of any snapshot:

```json
{
  "state-hr": {
    "name": "Bureau of Human Resources",
    "aliases": ["Bureau of Global Talent Management"],
    "note": "Headquarters personnel office.",
    "sources": [
      {
        "label": "Department organization page",
        "url": "https://example.gov/organization"
      }
    ]
  }
}
```

Version-specific names and notes may override defaults in snapshots or patches.

The schema reserves an optional `symbol` object with `type: "image" | "text"`, accessible text, and type-specific content. The MVP validates but does not render it.

### Snapshots

A snapshot is a complete resolved structural state. It records node state and hierarchy edges. Internal and subordinate relationships use the same representation:

```json
{
  "id": "current",
  "label": "Current structure",
  "nodes": {
    "state": {},
    "state-hq": {},
    "state-hr": { "name": "Bureau of Global Talent Management" },
    "usaid": {}
  },
  "hierarchy": [
    {
      "child": "state-hq",
      "parent": "state",
      "relationship": "internal"
    },
    {
      "child": "state-hr",
      "parent": "state-hq",
      "relationship": "internal",
      "note": "Part of headquarters."
    },
    {
      "child": "usaid",
      "parent": "state",
      "relationship": "subordinate",
      "note": "A separately constituted subordinate entity."
    }
  ]
}
```

Each node present in a snapshot has at most one hierarchy parent. A snapshot may have multiple roots. Cycles are invalid.

### Proposals And Branches

A proposal names a view derived from a snapshot or another proposal. It may contain a complete `snapshot` using the same `nodes` and `hierarchy` fields as a standalone snapshot, ordered patches, selectable patch groups, or a combination:

```json
{
  "id": "proposal-a",
  "label": "Proposal A",
  "base": "current",
  "snapshot": null,
  "patches": [],
  "patchGroups": []
}
```

When `snapshot` is present, it replaces the base's complete node and hierarchy state before proposal-level patches and patch groups are applied. The base remains meaningful as the proposal's default comparison target.

`base` may reference one snapshot or proposal, allowing branches such as:

```text
current -> proposal-a -> proposal-a-v2
        -> proposal-b
        -> proposal-c
```

Base-reference cycles are invalid. Resolution walks from the oldest base to the selected view and applies patches in declared order.

### Patches

The MVP patch vocabulary is:

- `add-node`
- `remove-node`
- `set-node`
- `set-parent`
- `remove-parent`
- `add-relationship`
- `remove-relationship`
- `set-relationship`

`set-node` handles renames and note or metadata changes. `set-parent` sets both the parent ID and `relationship: "internal" | "subordinate"`, allowing an internal office to be spun out as a subordinate office in one operation.

Patches may carry `note`, `sources`, and an optional semantic annotation:

```json
{
  "type": "set-parent",
  "node": "state-hr",
  "parent": "state",
  "relationship": "subordinate",
  "semantic": "spin-out",
  "note": "Creates a separately reporting office."
}
```

Semantic annotations include `rename`, `move`, `merge`, `split`, `spin-out`, and free-form values. They explain author intent but do not alter patch execution. This avoids unreliable automatic inference for merges and splits.

### Stacked Patch Groups

Proposal authors may expose compatible sub-proposals as reader-selectable checkboxes:

```json
{
  "id": "spin-out-hr",
  "label": "Spin out the personnel office",
  "defaultSelected": false,
  "requires": ["rename-hr"],
  "conflictsWith": ["merge-hr-admin"],
  "patches": []
}
```

Patch groups apply in document order. A group may be:

- `defaultSelected`: selected when the proposal opens.
- `locked`: selected and not reader-toggleable.
- dependent on other groups through `requires`.
- incompatible with groups listed in `conflictsWith`.

Selecting a group selects its transitive requirements. Selecting it also deselects conflicting optional groups. A group is disabled when a selected locked group conflicts with it, or when satisfying its requirements would create a conflict with a selected locked group. The UI explains disabled states. Validation rejects missing references, dependency cycles, asymmetric conflicts, and directly contradictory declarations.

The resolver also detects concrete write conflicts, such as two active groups assigning different parents or names to the same node. Validation catches unconditional conflicts; runtime selection rejects conditional conflicts with an explanatory message.

### Non-Hierarchy Relationships

Relationships represent cross-cutting connections without changing hierarchy:

```json
{
  "id": "nsa-cybercom-dual-hat",
  "type": "shared-leadership",
  "source": "nsa",
  "target": "cybercom",
  "label": "Shared Director / Commander",
  "note": "The two organizations are led by the same person.",
  "sources": []
}
```

Relationships may be global or scoped to snapshots/proposals through patches. Their `type` is an open string so authors can represent shared leadership, coordination, funding, operational control, statutory relationships, or domain-specific links.

### Zones

A zone identifies a cross-cutting set of nodes:

```json
{
  "id": "jsoc-air-force",
  "label": "Air Force component",
  "nodes": ["24-sow", "af-special-tactics"],
  "note": "Air Force organizations associated with JSOC.",
  "style": {
    "fill": "#4f80ff"
  }
}
```

Zones can vary by snapshot through patches. The MVP reserves and validates this structure but does not render flexible background shapes. A later renderer may choose rounded bounds, circles, soft hulls, or node badges depending on geometry.

### Notes And Sources

Nodes, hierarchy edges, non-hierarchy relationships, patches, patch groups, and zones may contain:

- `note`: plain text.
- `sources`: labeled HTTP or HTTPS links.

MVP notes are plain text and never accept arbitrary HTML. A later schema version may add an explicitly typed safe Markdown field.

## Resolution And Diff Semantics

The resolver produces a complete immutable chart for any selected snapshot or proposal configuration. Complete snapshots and base-plus patches therefore share one downstream representation.

The diff engine compares stable node and relationship IDs. It reports:

- created and deleted nodes.
- parent moves.
- internal/subordinate status changes.
- renamed or otherwise modified nodes.
- added, removed, and modified non-hierarchy relationships.
- explicit semantic annotations, including merges and splits.

Layout position is never part of a semantic diff.

By default, a proposal compares against its immediate base. Embed configuration may select another comparison view. Historical snapshots can be compared in either direction, with labels making the baseline and selected state explicit.

Removed nodes remain available to the renderer as diff-only ghosts while comparison highlighting is active. They are not included in the resolved selected structure.

## Rendering

### Renderer Boundary

The `d3-org-chart` adapter receives renderer-neutral nodes, hierarchy edges, visible cross-links, and diff annotations. Only the adapter imports D3 or `d3-org-chart` types.

The adapter uses `d3-org-chart` for the outer subordinate hierarchy, including layout, pan, zoom, collapse, search navigation, fit-to-screen, and minimap behavior. Internal children render inside custom parent node content.

### Internal Containment

`relationship: "internal"` has visual containment semantics. Internal offices appear as compact rows or nested mini-cards inside the boundary of their parent. `relationship: "subordinate"` produces an outer chart node connected to its parent.

Internal offices may themselves own subordinate children. The renderer promotes such an internal office to an addressable anchor within the parent card so subordinate connectors can originate from it.

The initial implementation supports one visual level of expanded internal containment per outer node. Deeper internal chains are represented as an indented compact list within that node. This prevents recursively nested cards from producing unusable dimensions while preserving the complete relationship data.

When internal offices are hidden:

- parent nodes collapse their internal contents.
- the parent shows the number of hidden internal offices.
- hidden internal descendants remain searchable.
- selecting a hidden search result reveals its chain.
- a parent badge reports diff activity among hidden internals.

### Delta Presentation

The selected and baseline states share a stable layout where practical. Transitions animate retained nodes between old and new positions. Motion respects `prefers-reduced-motion`.

Diff styling uses color plus shape, line, text, or badges so color is not the only signal:

- added nodes.
- removed ghost nodes.
- moved nodes and changed parent paths.
- renamed or otherwise modified nodes.
- internal/subordinate status changes.

Explicit merge and split annotations appear in change details and may highlight all referenced nodes. The renderer does not pretend these semantics were inferred.

### Relationship Overlays

Visible non-hierarchy relationships render as styled connectors above the hierarchy. Connectors are generated only when both endpoints are visible. If an endpoint is collapsed or internal-hidden, the connector terminates at the nearest visible ancestor and indicates aggregation.

Hover or keyboard focus shows a brief label. Click or tap opens persistent details. Readers can hide all relationship overlays.

### Large-Chart Behavior

- Open only configured upper levels by default.
- Collapse deeper branches and internal details.
- Search the complete data, including hidden nodes, and reveal result paths.
- Provide zoom, pan, fit, and minimap controls.
- Render relationship overlays only for visible nodes.
- Allow documents to declare initial focus nodes and expansion depth.
- Avoid rendering symbols, detailed notes, and other expensive content directly on every card.

The MVP performance target is smooth exploration of at least 5,000 named offices when most branches are collapsed. A benchmark fixture will measure initial load, interaction latency, and expanded-node limits. If D3/SVG cannot meet the target, the renderer adapter allows a later canvas/WebGL implementation without changing the document format.

## Reader Interface

The component presents only read-only controls:

- snapshot and proposal selector.
- selected-vs-baseline labeling.
- stacked patch-group checkboxes when explicitly exposed by a proposal.
- show/hide internal offices.
- show/hide non-hierarchy relationships.
- optional zones toggle once zones are rendered.
- search.
- zoom, fit, and minimap controls.
- notes/details panel.

Desktop hover is supplementary. Click, tap, and keyboard activation are canonical. The details panel becomes a side panel when space permits and a bottom sheet on small screens.

Nodes, hierarchy connections, relationship connectors, change badges, patch groups, and later zones can all open details with notes and sources.

## Accessibility

- All controls are keyboard reachable and have visible focus states.
- The hierarchy exposes meaningful tree semantics or an equivalent navigable textual representation.
- Internal containment and subordinate connections have textual labels.
- Diff states never rely on color alone.
- Tooltips are also available through focus.
- The notes panel manages focus and announces updates.
- Motion honors `prefers-reduced-motion`.
- The iframe viewer has a descriptive title and the component exposes an accessible chart title.

## Errors And Validation

The component renders a concise in-page error state rather than failing silently. Development details are logged to the console.

Validation covers:

- malformed or unreachable JSON.
- duplicate or missing IDs.
- unknown node, snapshot, proposal, patch-group, or relationship references.
- hierarchy and proposal-base cycles.
- multiple hierarchy parents in one resolved view.
- invalid internal/subordinate values.
- patch application against missing state.
- dependency and conflict errors.
- unsafe source URLs or unsupported note content.

Resolution errors identify the view, patch group, and patch responsible. A bad optional proposal does not corrupt already validated snapshots, but selecting it displays its error instead of a partial chart.

## Testing

### Unit Tests

- schema validation and normalization.
- snapshot and nested proposal resolution.
- deterministic patch order.
- dependency, conflict, locked-group, and conditional conflict behavior.
- parent/status transitions from internal to subordinate and back.
- diff classification and explicit merge/split annotations.
- notes and source sanitization.

### Component Tests

- relative JSON loading.
- proposal selection and comparison baseline.
- stacked checkbox states and explanations.
- hide/show internals and relationships.
- search revealing hidden internal nodes.
- details panel activation by mouse, touch-equivalent click, and keyboard.
- error states.

### Browser Tests

- direct web-component embed.
- iframe embed.
- responsive desktop and mobile layouts.
- keyboard navigation and reduced motion.
- transition behavior across snapshots and proposals.

### Performance Tests

- generated 5,000-node fixture with collapsed initial state.
- expansion stress fixture.
- relationship-overlay stress fixture.
- tracked load and interaction budgets to guide renderer replacement decisions.

## Delivery Shape

The package should produce:

- an ESM bundle that defines `<org-delta-chart>`.
- a standalone viewer HTML page for iframe use.
- the public JSON Schema.
- a small current-vs-proposals example.
- a larger government-style example and benchmark fixture.
- concise static-site integration documentation.

No server, database, account, or runtime build service is required.
