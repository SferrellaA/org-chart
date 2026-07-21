export class OrgDeltaChartElement extends HTMLElement {}

export { validateDocument, validateOrgDocument } from './model/validate';
export { ResolutionError, resolveView } from './model/resolve';
export type { ResolveOptions } from './model/resolve';
export {
  initialPatchSelection,
  togglePatchGroup,
  validateSelection,
} from './model/selection';
export type { PatchSelection } from './model/selection';
export { diffCharts } from './model/diff';
export type * from './model/diff';
export type * from './model/types';
export { buildRenderView } from './presentation/build-view';
export type { BuildRenderViewOptions } from './presentation/build-view';
export {
  changeDetails,
  hierarchyDetails,
  nodeDetails,
  patchGroupDetails,
  relationshipDetails,
} from './presentation/notes';
export type { DetailsItem } from './presentation/notes';
export type * from './renderer/types';

if (!customElements.get('org-delta-chart')) {
  customElements.define('org-delta-chart', OrgDeltaChartElement);
}
