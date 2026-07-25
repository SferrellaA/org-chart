import { describe, expect, it } from 'vitest';

import { renderDepthNodeContent, renderExpansionIcon, renderTaxonomyCard } from '../src/renderer/card';
import { componentStyles } from '../src/component/styles';

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
    expect(markup).not.toContain('data-activate-kind="change"');
    expect(markup).not.toContain('View changes');
    expect(markup).toContain('Plans &lt;script&gt;');
    expect(markup).toContain('Alex &amp; Taylor');
    expect(markup).not.toContain('<script>');
  });

  it('renders each outer and internal organization as one unnested activation button', () => {
    const template = document.createElement('template');
    template.innerHTML = renderDepthNodeContent({
      id: 'wing',
      name: 'Example Wing',
      internalRows: [{
        id: 'office',
        name: 'Plans Office',
        depth: 1,
        diffKind: 'modified',
        hasSubordinateChildren: false,
      }],
      hiddenInternalCount: 0,
      hiddenChangeCount: 1,
      diffKind: 'modified',
      ghost: false,
    });

    const controls = template.content.querySelectorAll<HTMLButtonElement>('[data-activate-kind]');
    expect([...controls].map(({ dataset }) => dataset.activateKind)).toEqual(['node', 'internal']);
    expect(template.content.querySelector('[data-activate-kind="change"]')).toBeNull();
    expect([...controls].every((button) => button.querySelector('button') === null)).toBe(true);
    expect([...controls].every((button) => button.classList.contains('org-delta-unit-card'))).toBe(true);
  });

  it('centers unit names while retaining compact shared card dimensions', () => {
    expect(componentStyles).toMatch(/\.org-delta-node-name\s*\{[^}]*text-align:\s*center/);
    expect(componentStyles).toMatch(/\.org-delta-unit-card\s*\{[^}]*min-height:\s*72px/);
    expect(componentStyles).toMatch(/\.org-delta-internal\s*\{[^}]*min-height:\s*56px/);
  });

  it('suppresses selection only on the draggable canvas', () => {
    expect(componentStyles).toMatch(/\.canvas\s*\{[^}]*user-select:\s*none/);
    expect(componentStyles).toMatch(/\.canvas\s*\{[^}]*cursor:\s*grab/);
    expect(componentStyles).not.toMatch(/\.details\s*\{[^}]*user-select:\s*none/);
    expect(componentStyles).not.toMatch(/\.controls-sidebar\s*\{[^}]*user-select:\s*none/);
  });

  it('renders a centered bordered expansion-control boundary', () => {
    expect(renderExpansionIcon(true)).toContain('org-delta-expansion-control');
    expect(componentStyles).toMatch(/\.org-delta-expansion-control\s*\{[^}]*border:/);
    expect(componentStyles).toMatch(/\.org-delta-expansion-control\s*\{[^}]*margin:\s*auto/);
  });
});
