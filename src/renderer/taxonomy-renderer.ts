import type { TaxonomyRenderView } from '../presentation/build-taxonomy-view';
import type { HierarchyEntry } from './hierarchy-controller';
import { layoutTaxonomyView } from './taxonomy-layout';
import type { ActivationHandler } from './overlay';
import { SceneRenderer, type SceneAdapter } from './scene-renderer';
import type { ChartRenderer } from './types';

export interface TaxonomyRendererOptions {
  onActivate: ActivationHandler;
  transitionDurationMs?: number;
}

export function taxonomyHierarchy(view: TaxonomyRenderView): HierarchyEntry[] {
  return view.proposed.nodes.map((node) => ({
    id: node.id,
    ownerId: node.id,
    name: node.name,
    kind: node.internal ? 'internal' : 'node',
    ...(node.internal ? { expansionChild: false } : {}),
    ...(node.connectorSourceId ?? node.parentId
      ? { parentId: node.connectorSourceId ?? node.parentId }
      : {}),
  }));
}

const taxonomyAdapter: SceneAdapter<TaxonomyRenderView> = {
  className: 'org-delta-taxonomy-renderer',
  worldClassName: 'org-delta-taxonomy-world',
  navigationLabel: 'Proposed organization tree',
  hierarchy: taxonomyHierarchy,
  initialExpansionIds: ({ initialExpansionIds }) => initialExpansionIds,
  layout: layoutTaxonomyView,
};

export class TaxonomyRenderer implements ChartRenderer<TaxonomyRenderView> {
  private readonly renderer: SceneRenderer<TaxonomyRenderView>;

  constructor(host: HTMLElement, options: TaxonomyRendererOptions) {
    this.renderer = new SceneRenderer(host, taxonomyAdapter, options);
  }

  render(view: TaxonomyRenderView): void {
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
