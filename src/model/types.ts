export interface Source {
  label: string;
  url: string;
}

export interface BundledRankMarker {
  type: 'bundled';
  id: string;
}

export interface ImageRankMarker {
  type: 'image';
  url: string;
  alt: string;
}

export interface TextRankMarker {
  type: 'text';
  text: string;
}

export interface EmojiRankMarker {
  type: 'emoji';
  emoji: string;
  label: string;
}

export type RankMarker = BundledRankMarker | ImageRankMarker | TextRankMarker | EmojiRankMarker;

export interface RankDisplay {
  label?: string;
  marker?: RankMarker;
}

export interface LeadershipOccupant {
  name: string;
  rank?: RankDisplay;
  acting?: boolean;
}

export interface LeadershipPosition {
  id?: string;
  title?: string;
  authorizedRank?: RankDisplay;
  occupant?: LeadershipOccupant;
  vacant?: boolean;
}

export interface NodeState {
  name?: string;
  note?: string;
  sources?: readonly Source[];
  metadata?: Readonly<Record<string, string | number | boolean | null>>;
  leadership?: readonly LeadershipPosition[];
}

export interface ImageSymbol {
  type: 'image';
  url: string;
  alt: string;
}

export interface TextSymbol {
  type: 'text';
  text: string;
}

export type Symbol = ImageSymbol | TextSymbol;

export interface NodeDefinition extends NodeState {
  name: string;
  aliases?: readonly string[];
  symbol?: Symbol;
}

export type HierarchyRelationship = 'internal' | 'subordinate';

export interface HierarchyEdge {
  child: string;
  parent: string;
  relationship: HierarchyRelationship;
  note?: string;
  sources?: readonly Source[];
}

export interface Relationship {
  id: string;
  type: string;
  source: string;
  target: string;
  label: string;
  note?: string;
  sources?: readonly Source[];
}

export interface SnapshotState {
  nodes: Record<string, NodeState>;
  hierarchy: readonly HierarchyEdge[];
}

export interface Snapshot extends SnapshotState {
  id: string;
  label: string;
}

export interface PatchDetails {
  note?: string;
  sources?: readonly Source[];
  semantic?: string;
  relatedNodes?: readonly string[];
}

export interface AddNodePatch extends PatchDetails {
  type: 'add-node';
  node: string;
  value?: NodeState;
}

export interface RemoveNodePatch extends PatchDetails {
  type: 'remove-node';
  node: string;
}

export interface SetNodePatch extends PatchDetails {
  type: 'set-node';
  node: string;
  value: NodeState;
}

export interface SetParentPatch extends PatchDetails {
  type: 'set-parent';
  node: string;
  parent: string;
  relationship: HierarchyRelationship;
}

export interface RemoveParentPatch extends PatchDetails {
  type: 'remove-parent';
  node: string;
}

export interface AddRelationshipPatch extends PatchDetails {
  type: 'add-relationship';
  relationship: Relationship;
}

export interface RemoveRelationshipPatch extends PatchDetails {
  type: 'remove-relationship';
  relationship: string;
}

export interface SetRelationshipPatch extends PatchDetails {
  type: 'set-relationship';
  relationship: string;
  value: Partial<Omit<Relationship, 'id'>>;
}

export type Patch =
  | AddNodePatch
  | RemoveNodePatch
  | SetNodePatch
  | SetParentPatch
  | RemoveParentPatch
  | AddRelationshipPatch
  | RemoveRelationshipPatch
  | SetRelationshipPatch;

export interface PatchGroup {
  id: string;
  label: string;
  patches: readonly Patch[];
  defaultSelected?: boolean;
  locked?: boolean;
  requires?: readonly string[];
  conflictsWith?: readonly string[];
  note?: string;
  sources?: readonly Source[];
}

export interface Proposal {
  id: string;
  label: string;
  base: string;
  snapshot?: SnapshotState;
  patches?: readonly Patch[];
  patchGroups?: readonly PatchGroup[];
}

export interface ZoneStyle {
  fill?: string;
}

export interface Zone {
  id: string;
  label: string;
  nodes: readonly string[];
  note?: string;
  sources?: readonly Source[];
  style?: ZoneStyle;
}

export interface PresentationDefaults {
  initialExpansionDepth?: number;
  focusNodes?: readonly string[];
}

export interface OrgDocument {
  $schema?: string;
  title: string;
  nodes: Record<string, NodeDefinition>;
  snapshots: readonly Snapshot[];
  proposals: readonly Proposal[];
  relationships?: readonly Relationship[];
  zones?: readonly Zone[];
  presentation?: PresentationDefaults;
}

export interface ResolvedNode extends NodeState {
  id: string;
  name: string;
  aliases?: readonly string[];
  symbol?: Symbol;
}

export interface ResolvedParent {
  parent: string;
  relationship: HierarchyRelationship;
  note?: string;
  sources?: readonly Source[];
}

export interface SemanticAnnotation {
  semantic: string;
  nodes: readonly string[];
  note?: string;
  sources?: readonly Source[];
}

export interface ResolvedChart {
  nodes: ReadonlyMap<string, ResolvedNode>;
  parents: ReadonlyMap<string, ResolvedParent>;
  relationships: ReadonlyMap<string, Relationship>;
  semanticAnnotations: readonly SemanticAnnotation[];
  presentation: PresentationDefaults;
}

export type ValidationResult =
  | {
      ok: true;
      value: OrgDocument;
      viewErrors: ReadonlyMap<string, readonly string[]>;
    }
  | { ok: false; errors: readonly string[] };
