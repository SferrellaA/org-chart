import type { DiffKind } from '../model/diff';

export interface InternalRow {
  id: string;
  name: string;
  depth: number;
  diffKind: DiffKind;
  hasSubordinateChildren: boolean;
}

export interface RenderNode {
  id: string;
  parentId?: string;
  connectorSourceId?: string;
  name: string;
  internalRows: readonly InternalRow[];
  hiddenInternalCount: number;
  hiddenChangeCount: number;
  diffKind: DiffKind;
  ghost: boolean;
}

export interface RenderRelationship {
  id: string;
  source: string;
  target: string;
  label: string;
  type: string;
  aggregated: boolean;
  diffKind: DiffKind;
}

export interface SearchEntry {
  id: string;
  label: string;
  hiddenInternal: boolean;
}

export interface RenderView {
  nodes: readonly RenderNode[];
  relationships: readonly RenderRelationship[];
  searchEntries: readonly SearchEntry[];
  initialExpansionIds: readonly string[];
}

export interface ChartRenderer {
  render(view: RenderView): void;
  reveal(nodeId: string): void;
  fit(): void;
  destroy(): void;
}
