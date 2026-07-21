export interface Source {
  label: string;
  url: string;
}

export interface NodeState {
  name?: string;
  note?: string;
  sources?: Source[];
  metadata?: Record<string, unknown>;
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
  aliases?: string[];
  symbol?: Symbol;
}

export type HierarchyRelationship = 'internal' | 'subordinate';

export interface HierarchyEdge {
  child: string;
  parent: string;
  relationship: HierarchyRelationship;
}

export interface Relationship {
  id: string;
  type: string;
  source: string;
  target: string;
  label: string;
  note?: string;
  sources?: Source[];
}

export interface SnapshotState {
  nodes: Record<string, NodeState>;
  hierarchy: HierarchyEdge[];
}

export interface Snapshot extends SnapshotState {
  id: string;
  label: string;
}

export interface PatchDetails {
  note?: string;
  semantic?: string;
  relatedNodes?: string[];
}

export interface AddNodePatch extends PatchDetails {
  op: 'add-node';
  node: string;
  value: NodeState;
}

export interface RemoveNodePatch extends PatchDetails {
  op: 'remove-node';
  node: string;
}

export interface SetNodePatch extends PatchDetails {
  op: 'set-node';
  node: string;
  value: NodeState;
}

export interface SetParentPatch extends PatchDetails {
  op: 'set-parent';
  child: string;
  parent: string;
  relationship: HierarchyRelationship;
}

export interface RemoveParentPatch extends PatchDetails {
  op: 'remove-parent';
  child: string;
}

export interface AddRelationshipPatch extends PatchDetails {
  op: 'add-relationship';
  relationship: Relationship;
}

export interface RemoveRelationshipPatch extends PatchDetails {
  op: 'remove-relationship';
  relationship: string;
}

export interface SetRelationshipPatch extends PatchDetails {
  op: 'set-relationship';
  relationship: string;
  value: Relationship;
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
  patches: Patch[];
  defaultSelected?: boolean;
  locked?: boolean;
  requires?: string[];
  conflictsWith?: string[];
  note?: string;
  sources?: Source[];
}

export interface Proposal {
  id: string;
  label: string;
  base: string;
  complete?: SnapshotState;
  patches?: Patch[];
  patchGroups?: PatchGroup[];
}

export interface ZoneStyle {
  fill?: string;
}

export interface Zone {
  id: string;
  label: string;
  nodes: string[];
  note?: string;
  sources?: Source[];
  style?: ZoneStyle;
}

export interface PresentationDefaults {
  initialExpansionDepth?: number;
  focusNodes?: string[];
}

export interface OrgDocument {
  title: string;
  nodes: Record<string, NodeDefinition>;
  snapshots: Snapshot[];
  proposals: Proposal[];
  relationships?: Relationship[];
  zones?: Zone[];
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
}

export interface SemanticAnnotation {
  proposal: string;
  semantic: string;
  target: string;
  relatedNodes: readonly string[];
  note?: string;
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
  | { ok: false; errors: string[] };
