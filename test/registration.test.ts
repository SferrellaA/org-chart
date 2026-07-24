import { describe, expect, it } from 'vitest';

import { OrgDeltaChartElement } from '../src/index';

describe('org-delta-chart registration', () => {
  it('defines the custom element', () => {
    expect(customElements.get('org-delta-chart')).toBe(OrgDeltaChartElement);
  });
});
