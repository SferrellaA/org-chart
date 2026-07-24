# Leadership Design

## Purpose

Add versioned authorized leadership data to organization nodes without changing the existing embeddable component model. Leadership should explain billets, authorized ranks, occupants, acting or vacant states, and rank markers for both subordinate cards and internal organizations.

## Data Model

`NodeDefinition` and `NodeState` gain an optional ordered `leadership` array. Omitting the array means the organization has no displayed leadership.

Each leadership position is a billet:

```ts
interface LeadershipPosition {
  id?: string;
  title?: string;
  authorizedRank?: RankDisplay;
  occupant?: {
    name: string;
    rank?: RankDisplay;
    acting?: boolean;
  };
  vacant?: boolean;
}

interface RankDisplay {
  label?: string;
  marker?: RankMarker;
}
```

`RankMarker` supports bundled SVG IDs, HTTPS image URLs, text, and emoji. Bundled markers derive accessible names from the marker catalog. External images and emoji require accessible labels when the rank label cannot provide one.

A billet may show title, authorized rank, both, neither, a named occupant, vacancy, or an acting occupant. Validation rejects a completely empty billet. `vacant: true` may coexist with a named acting occupant because a permanent billet can be vacant while temporarily filled by someone whose actual rank differs from the authorized rank. Authorized rank and occupant rank are separate and may each have a marker.

Optional billet IDs are unique across the whole document in any resolved view. Identified billets carry cross-view identity and can move between organizations. Anonymous billets remain valid, but diffs show anonymous before/after leadership entries as unrelated records.

Leadership is versioned through existing node-state semantics. Node definitions provide defaults, snapshots override the whole leadership list for the snapshot, and `set-node` patches replace the whole list for a proposal. No new patch operation is added.

## Rendering

Every authored leadership position renders in declared order. There are no hidden-position flags or leadership visibility controls.

Subordinate organization cards and compact internal organization rows use the same leadership-row content with denser spacing for internal rows. A row can include:

- authorized marker, authorized rank, and billet title as the primary line.
- named occupant with optional distinct rank marker and rank label as the secondary line.
- explicit `Acting` and `Vacant` text badges.

Missing fields collapse naturally. Marker boxes are fixed-size and preserve intrinsic aspect ratio. Marker-only ranks remain accessible through catalog or author-provided labels.

Bundled SVG markers are trusted package data. External HTTPS images remain `<img>` resources and are never injected as inline SVG or HTML. Failed external images reserve marker space and expose text fallback.

Leadership rows are not separate interaction targets. Activating an organization continues to open organization details.

## Diffs And Details

Node diffs gain a `leadership` change classification while preserving existing node summary counts.

Diffs match identified billets globally by ID and detect:

- additions and removals.
- moves between organizations.
- order changes.
- title, authorized rank, occupant, acting, vacancy, and marker changes.

Moving an identified billet marks both affected organizations as modified. Anonymous leadership changes mark the owning organization modified and show complete before/after entries without inferred identity.

Organization details list all current leadership in structured text. Change details show field-level before/after values for identified billets and complete before/after records for anonymous leadership changes. Occupants are display-only strings; the system does not track people independently from billets.

## Validation And Tests

Validation covers leadership shape, marker shape, empty billets, duplicate identified billets in resolved views, unknown bundled marker IDs, HTTPS external marker images, and accessible marker labels when no rank label supplies one.

Tests use a small synthetic Wing/CSS/OSS/WSA fixture:

- A wing starts with commander, vice commander, and director of operations billets.
- Commander Support Section is internal and has no listed leadership.
- A proposal promotes the Director of Operations from O-4 to O-5, retitles it Commander, moves the billet to an Operational Support Squadron, and spins CSS out into that subordinate OSS.
- The vice commander billet moves to a new internal Wing Staff Agency and becomes Deputy Wing Commander.

The realistic full Air Force example remains deferred until leadership, taxonomy, focus sets, and YAML authoring exist.
