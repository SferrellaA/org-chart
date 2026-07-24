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

## Reader Controls And Accessibility

The component provides native controls for selecting views, toggling proposal patch groups, showing or hiding internal units, showing or hiding relationships, fitting the chart, and searching organizations. Hidden internal units remain indexed; selecting an exact search result reveals the internal chain needed to show the match.

The rendered chart includes a keyboard-navigable tree separate from the visual diagram. Status updates use an ARIA live region, details open in a focus-managed panel, and controls preserve focus where possible across re-renders.

## Deferred Fields

The schema accepts symbols and meta-zones so publishers can preserve richer editorial data before every rendering feature exists. For example, the State Department fixture includes a text symbol:

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
