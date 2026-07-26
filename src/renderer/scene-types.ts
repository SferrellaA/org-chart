import type { ComparisonSide } from './card';

export interface SceneAnchor {
  id: string;
  kind: 'node' | 'internal';
  side?: ComparisonSide;
}

export interface SceneNode {
  key: string;
  id: string;
  ownerId: string;
  parentId?: string;
  name: string;
  kind: 'node' | 'internal';
  left: number;
  top: number;
  width: number;
  height: number;
  markup: string;
  side?: ComparisonSide;
}

export interface SceneConnector {
  key: string;
  kind: 'hierarchy' | 'relationship';
  source: SceneAnchor;
  target: SceneAnchor;
  activationId: string;
  label: string;
  aggregated?: boolean;
  side?: ComparisonSide;
}

export interface SceneDecoration {
  key: string;
  className: string;
  left: number;
  top: number;
  width: number;
  height: number;
  markup?: string;
}

export interface RenderScene {
  width: number;
  height: number;
  nodes: readonly SceneNode[];
  connectors: readonly SceneConnector[];
  decorations: readonly SceneDecoration[];
  worldAttributes?: Readonly<Record<string, string>>;
}
