import { describe, expect, it } from 'vitest';

import { renderTaxonomyCard } from '../src/renderer/card';

describe('renderTaxonomyCard', () => {
  it('renders a side-aware subdued internal card with leadership and safe activation', () => {
    const markup = renderTaxonomyCard({
      id: 'office&lt;',
      name: 'Plans <script>',
      tierId: 'division',
      internal: true,
      diffKind: 'modified',
      leadership: [{ title: 'Director', occupant: { name: 'Alex & Taylor' } }],
    }, 'baseline');

    expect(markup).toContain('org-delta-taxonomy-card--internal');
    expect(markup).toContain('data-view-side="baseline"');
    expect(markup).toContain('data-activate-kind="internal"');
    expect(markup).toContain('data-activate-kind="change"');
    expect(markup).toContain('View changes');
    expect(markup).toContain('Plans &lt;script&gt;');
    expect(markup).toContain('Alex &amp; Taylor');
    expect(markup).not.toContain('<script>');
  });
});
