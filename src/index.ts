export class OrgDeltaChartElement extends HTMLElement {}

export { validateDocument, validateOrgDocument } from './model/validate';
export type * from './model/types';

if (!customElements.get('org-delta-chart')) {
  customElements.define('org-delta-chart', OrgDeltaChartElement);
}
