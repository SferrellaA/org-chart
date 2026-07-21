export class OrgDeltaChartElement extends HTMLElement {}

if (!customElements.get('org-delta-chart')) {
  customElements.define('org-delta-chart', OrgDeltaChartElement);
}
