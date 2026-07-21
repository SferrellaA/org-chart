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
export type * from './model/types';

if (!customElements.get('org-delta-chart')) {
  customElements.define('org-delta-chart', OrgDeltaChartElement);
}
