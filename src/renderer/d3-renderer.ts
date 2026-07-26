import { layoutDepthView } from './depth-layout';
import type { HierarchyEntry } from './hierarchy-controller';
import type { ActivationHandler } from './overlay';
import { SceneRenderer, type SceneAdapter } from './scene-renderer';
import type { ChartRenderer, RenderView } from './types';

export interface D3OrgChartRendererOptions {
  onActivate: ActivationHandler;
  transitionDurationMs?: number;
}

export function depthHierarchy(view: RenderView): HierarchyEntry[] {
  const entries: HierarchyEntry[] = [];
  for (const node of view.nodes) {
    entries.push({
      id: node.id,
      ownerId: node.id,
      name: node.name,
      kind: 'node',
      ...(node.parentId ? { parentId: node.connectorSourceId ?? node.parentId } : {}),
    });
    const internalAtDepth = new Map<number, HierarchyEntry>();
    for (const row of node.internalRows) {
      const parent = internalAtDepth.get(row.depth - 1);
      const entry: HierarchyEntry = {
        id: row.id,
        ownerId: node.id,
        name: row.name,
        kind: 'internal',
        parentId: parent?.id ?? node.id,
        expansionChild: false,
      };
      entries.push(entry);
      internalAtDepth.set(row.depth, entry);
      for (const depth of [...internalAtDepth.keys()]) {
        if (depth > row.depth) internalAtDepth.delete(depth);
      }
    }
  }
  return entries;
}

const depthAdapter: SceneAdapter<RenderView> = {
  className: 'org-delta-renderer-root org-delta-depth-renderer',
  hierarchy: depthHierarchy,
  initialExpansionIds: ({ initialExpansionIds }) => initialExpansionIds,
  layout: layoutDepthView,
};

export class D3OrgChartRenderer implements ChartRenderer<RenderView> {
  private readonly renderer: SceneRenderer<RenderView>;

  constructor(host: HTMLElement, options: D3OrgChartRendererOptions) {
    this.renderer = new SceneRenderer(host, depthAdapter, options);
  }

  render(view: RenderView): void {
    this.renderer.render(view);
  }

  reveal(nodeId: string): void {
    this.renderer.reveal(nodeId);
  }

  fit(): void {
    this.renderer.fit();
  }

  destroy(): void {
    this.renderer.destroy();
  }
}
