# org-delta-chart

`org-delta-chart` is a JSON-first web component for publishing organization charts, comparing snapshots, and explaining proposed structural changes. It renders subordinate reporting lines as the visible tree and keeps internal offices searchable without forcing every internal unit into the main diagram.

## Direct Embed

Use the built component bundle and point it at a JSON document:

```html
<org-delta-chart src="./state-department.json"></org-delta-chart>
<script type="module" src="/assets/org-delta-chart.js"></script>
```

Give the custom element an explicit height in page CSS:

```css
org-delta-chart { height: 720px; }
```

## Iframe Embed

For publishers that cannot load custom elements directly, embed the viewer in an iframe. Use a root-relative JSON URL so the viewer resolves the data from the site root, not from the current article path:

```html
<iframe
  src="/viewer.html?src=/examples/state-department.json"
  title="Illustrative organization chart"
></iframe>
```

## JSON MVP

The MVP format is JSON only. A document contains stable node definitions, one or more snapshots, optional proposals, optional cross-links, and optional presentation defaults. The schema is published at `https://org-delta-chart.dev/schema/org-delta-chart.schema.json` and packaged as `org-delta-chart/schema`.

Minimal shape:

```json
{
  "$schema": "https://org-delta-chart.dev/schema/org-delta-chart.schema.json",
  "title": "Illustrative U.S. government organization demo",
  "nodes": {
    "state": { "name": "Department of State (illustrative)" }
  },
  "snapshots": [
    {
      "id": "current",
      "label": "Illustrative current arrangement",
      "nodes": { "state": {} },
      "hierarchy": []
    }
  ],
  "proposals": []
}
```

Use stable IDs for nodes, snapshots, proposals, patch groups, relationships, and zones. IDs should be durable across releases because proposals, links, saved URLs, and search results refer to them. Do not include control characters in IDs; prefer lowercase URL-safe strings such as `state-hq`, `spin-out-proposal`, and `illustrative-shared-leadership`.

## Hierarchy Edges

Hierarchy edges connect child nodes to parent nodes and declare whether the child is an internal unit or a subordinate organization:

```json
[
  { "child": "state-hq", "parent": "state", "relationship": "internal" },
  { "child": "usaid", "parent": "state", "relationship": "subordinate" }
]
```

`internal` edges flatten into internal rows under the nearest outer organization unless the reader chooses to show internal units or reveals one through search. `subordinate` edges create visible tree nodes.

## Leadership

Nodes can carry ordered leadership billets in definitions, snapshots, or `set-node` patches. The chart renders every supplied billet on subordinate cards and internal organizations:

```json
"wing": {
  "name": "Example Wing",
  "leadership": [
    {
      "id": "wing-cc",
      "title": "Commander",
      "authorizedRank": {
        "label": "Colonel",
        "marker": { "type": "bundled", "id": "usaf-o6" }
      },
      "occupant": {
        "name": "Morgan Example",
        "rank": { "label": "Lieutenant Colonel", "marker": { "type": "bundled", "id": "usaf-o5" } },
        "acting": true
      },
      "vacant": true
    }
  ]
}
```

`title`, `authorizedRank`, `occupant`, and `vacant` are all optional individually, but a billet must include at least one renderable value. `occupant` is display-only text; billet identity comes from the optional document-wide `id`. Identified billets can move between organizations in proposals and still produce connected leadership diffs. Anonymous billets remain valid but are shown as unrelated before/after records when changed.

Rank markers support bundled IDs, HTTPS images, text, or emoji. See `docs/marker-catalog.md` for bundled marker IDs.

## Taxonomies And Tier Comparison

Snapshots may define ordered comparison tiers and named taxonomy systems. Levels in different systems map to shared tiers, allowing unlike echelon names to be compared without treating those names as equivalent identities:

```json
"taxonomy": {
  "comparisonTiers": [
    { "id": "naf-equivalent", "label": "NAF equivalent" },
    { "id": "division-equivalent", "label": "Division equivalent" },
    { "id": "wing", "label": "Wing" }
  ],
  "systems": [
    {
      "id": "usaf-echelon",
      "label": "USAF echelon",
      "levels": [
        { "id": "numbered-air-force", "label": "Numbered Air Force", "tier": "naf-equivalent" },
        { "id": "air-division", "label": "Air Division", "tier": "division-equivalent" },
        { "id": "wing", "label": "Wing", "tier": "wing" }
      ]
    },
    {
      "id": "army-echelon",
      "label": "Army echelon",
      "levels": [
        { "id": "division", "label": "Division", "tier": "division-equivalent" }
      ]
    }
  ]
}
```

Nodes use a system-to-level record, which permits assignments in several systems while enforcing at most one level in each:

```json
"taxonomyAssignments": {
  "usaf-echelon": "wing"
}
```

Assignments may be omitted. Resolution preserves missing classification rather than inventing a level. In taxonomy layout, missing assignments use hierarchy fallback: internal edges remain on their parent's tier and subordinate edges descend one tier, clamped to the available range. Assignments in several systems that resolve to different tiers currently use the same fallback; explicit cross-taxonomy ambiguity visualization is deferred on the roadmap.

Taxonomy definitions and assignments are versioned. Proposals support granular `add-`, `set-`, and `remove-` patches for comparison tiers, taxonomy systems, and levels, plus `set-taxonomy-assignment` and `remove-taxonomy-assignment`. `set-comparison-tier-order` declares the complete final tier order whenever tiers are added or removed.

Taxonomy patches in one proposal selection form a transaction. Writes compose by stable entity and field, not array position; conflicting writes are rejected, and references are checked only against the final state after structural patches. Consequently, a proposal may remove Air Division nodes and the `air-division` level, remap `numbered-air-force` to `division-equivalent`, and explicitly reparent surviving wings in any patch order. Removals never cascade to surviving nodes.

Set taxonomy layout as a document default:

```json
"presentation": {
  "layoutMode": "taxonomy"
}
```

An embed author can override the document without changing its organization data:

```html
<org-delta-chart src="./chart.json" layout-mode="depth"></org-delta-chart>
```

`layoutMode` and `layout-mode` accept `depth` or `taxonomy`; the component attribute takes precedence and the default is `depth`. If taxonomy mode is requested for a view with no comparison tiers, the component announces the condition and falls back to depth layout.

Taxonomy deltas align two complete charts to shared tier rows. The baseline and proposed halves each show all organizations and every taxonomy system supplied by that resolved view, including duplicated unchanged organizations and version-specific leadership. Added and removed organizations appear only on their applicable side. Organizations that move tiers receive cross-chart connectors. A standalone snapshot renders as one full-width taxonomy chart.

## Snapshots And Proposals

Snapshots describe complete states. Snapshot node entries can override node definition fields for that state, and hierarchy edges describe the full tree for the snapshot:

```json
{
  "id": "current",
  "label": "Illustrative current arrangement",
  "nodes": {
    "state": {},
    "state-hq": {},
    "consular": { "note": "Illustrative current-state note." },
    "policy-lab": {},
    "usaid": {},
    "nsa": {},
    "cybercom": {}
  },
  "hierarchy": [
    { "child": "state-hq", "parent": "state", "relationship": "internal" },
    { "child": "usaid", "parent": "state", "relationship": "subordinate" }
  ]
}
```

Proposals may apply patches to a base snapshot or proposal. Patch groups let readers toggle related changes, while `requires` and `conflictsWith` model dependencies and mutually exclusive choices:

```json
{
  "id": "spin-out-lab",
  "label": "Spin out as a subordinate organization",
  "defaultSelected": true,
  "requires": ["rename-lab"],
  "conflictsWith": ["retain-internal-lab"],
  "patches": [
    {
      "type": "set-parent",
      "node": "policy-lab",
      "parent": "state",
      "relationship": "subordinate",
      "semantic": "spin-out",
      "relatedNodes": ["state-hq", "state"]
    }
  ]
}
```

Proposals can also be nested by using another proposal as `base`, as in `nested-branch`, or can provide a complete proposal snapshot when a full replacement state is clearer than patches:

```json
{
  "id": "complete-branch",
  "label": "Complete illustrative branch",
  "base": "current",
  "snapshot": {
    "nodes": {
      "state": {},
      "policy-lab": { "name": "Policy Innovation Office" }
    },
    "hierarchy": [
      { "child": "policy-lab", "parent": "state", "relationship": "subordinate" }
    ]
  }
}
```

Patch `semantic`, `note`, `sources`, and `relatedNodes` fields are used to explain changes in the reader details panel and diff annotations.

## Notes, Sources, And Cross-Links

Nodes, hierarchy edges, proposals, patch groups, patches, relationships, and zones can carry notes and sources. Use HTTPS source URLs for reader trust and browser compatibility:

```json
{
  "name": "USAID (illustrative placement)",
  "note": "Placement is illustrative and should not be treated as a legal or current organizational claim.",
  "sources": [{ "label": "USAID public website", "url": "https://www.usaid.gov/" }]
}
```

Hovering or focusing an organization card shows a noninteractive provenance tooltip with the node note, source labels, and current parent-assignment provenance. Activating the card opens the full details surface, where source URLs remain clickable.

Cross-links live in `relationships` and are rendered separately from hierarchy:

```json
{
  "id": "illustrative-shared-leadership",
  "type": "shared-leadership-style",
  "source": "nsa",
  "target": "cybercom",
  "label": "Shared-leadership-style cross-link"
}
```

## Historical Renderer Example

The renderer-review fixture follows a working reconstruction of Regular Air Force wings assigned to Strategic Air Command or Tactical Air Command into the initial June 1992 Air Combat Command and Air Mobility Command structure. It is available in both renderer modes over the same canonical document:

- Depth: `/examples/1992-reorganization-depth.html`
- Taxonomy: `/examples/1992-reorganization-taxonomy.html`
- Data: `/examples/1992-air-force-reorganization.json`

The fixture combines documented relationships from the final reorganization period rather than claiming a precise single-day order of battle. Its source method, inclusion rules, effective-date caveats, and unresolved lineage cross-checks are recorded in `docs/research/1992-air-force-reorganization.md`. The example is an accepted renderer demo, not the later comprehensive Air Force acceptance fixture.

## Reader Controls And Accessibility

The component provides native controls for selecting views, toggling proposal patch groups, showing or hiding internal units, showing or hiding relationships, fitting the chart, and searching organizations. Hidden internal units remain indexed; selecting an exact search result reveals the internal chain needed to show the match.

The rendered chart includes a keyboard-navigable tree separate from the visual diagram. Status updates use an ARIA live region, details open in a focus-managed panel, and controls preserve focus where possible across re-renders.

## Deferred Fields

The schema accepts symbols and meta-zones so publishers can preserve richer editorial data before every rendering feature exists. Leadership rank markers render now; node-level `symbol` remains reserved. For example, the State Department fixture includes a text symbol:

```json
"symbol": { "type": "text", "text": "PL" }
```

It also includes a zone:

```json
{
  "id": "reserved-demo-zone",
  "label": "Reserved demonstration zone",
  "nodes": ["state-hq", "consular", "policy-lab"],
  "style": { "fill": "#e8eef8" }
}
```

These fields are validated and retained, but visual zone and symbol treatment is intentionally deferred.

## Local Commands

Run these from the repository root:

```sh
npm test
npm run check
npm run build
npm run test:e2e
npm run benchmark:generate
```

The benchmark generator writes `examples/generated-5000.json`, validates it with `validateDocument`, and resolves all benchmark views before saving stable pretty JSON.
