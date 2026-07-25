import { describe, expect, it } from 'vitest';

import {
  buildTaxonomyRenderView,
  OrgDeltaChartElement,
  TaxonomyRenderer,
} from '../src/index';

describe('org-delta-chart registration', () => {
  it('defines the custom element', () => {
    expect(customElements.get('org-delta-chart')).toBe(OrgDeltaChartElement);
  });

  it('exports the taxonomy projection and renderer', () => {
    expect(buildTaxonomyRenderView).toBeTypeOf('function');
    expect(TaxonomyRenderer).toBeTypeOf('function');
  });
});
