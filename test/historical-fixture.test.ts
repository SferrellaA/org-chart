import { describe, expect, it } from 'vitest';

import historicalDocument from '../examples/1992-air-force-reorganization.json';
import { diffCharts } from '../src/model/diff';
import { resolveView } from '../src/model/resolve';
import { validateDocument } from '../src/model/validate';
import { buildTaxonomyRenderView } from '../src/presentation/build-taxonomy-view';

function resolvedFixture() {
  const validation = validateDocument(historicalDocument);
  if (!validation.ok) throw new Error(validation.errors.join('\n'));
  const baseline = resolveView(validation.value, {
    viewId: 'pre-reorganization',
    selectedGroups: [],
  });
  const selected = resolveView(validation.value, {
    viewId: 'june-1992',
    selectedGroups: [],
  });
  const diff = diffCharts(baseline, selected);
  return { validation, baseline, selected, diff };
}

describe('1992 Air Force reorganization fixture', () => {
  it('is schema-valid with two resolvable historical snapshots', () => {
    const { validation } = resolvedFixture();

    expect(validation.viewErrors.size).toBe(0);
    expect(validation.value.snapshots.map(({ id }) => id)).toEqual([
      'pre-reorganization',
      'june-1992',
    ]);
  });

  it('preserves all 53 tracked wings across the command transition', () => {
    const { baseline, selected } = resolvedFixture();
    const baselineWings = [...baseline.nodes.values()].filter((node) =>
      node.resolvedTaxonomyAssignments?.some(({ levelId }) => levelId === 'wing')
    );

    expect(baselineWings).toHaveLength(53);
    expect(baselineWings.every(({ id }) => selected.nodes.has(id))).toBe(true);
  });

  it('removes SAC, TAC, and the 28th Air Division while adding ACC and AMC', () => {
    const { diff } = resolvedFixture();
    const idsFor = (kind: 'added' | 'removed') => [...diff.nodes.values()]
      .filter((node) => node.kind === kind)
      .map(({ id }) => id)
      .sort();

    expect(idsFor('removed')).toEqual(['28-ad', 'sac', 'tac']);
    expect(idsFor('added')).toEqual(['acc', 'amc']);
  });

  it('captures representative parent changes and Air Division removal', () => {
    const { baseline, selected, diff } = resolvedFixture();

    expect(baseline.parents.get('552-acw')?.parent).toBe('28-ad');
    expect(selected.parents.get('552-acw')?.parent).toBe('acc');
    expect(diff.nodes.get('552-acw')?.changes).toContain('parent');
    expect(selected.parents.get('fifteenth-af')?.parent).toBe('amc');
    expect(selected.parents.get('twentieth-af')?.parent).toBe('acc');
    expect(selected.nodes.has('28-ad')).toBe(false);
  });

  it('projects only the selected state into its three authored taxonomy tiers', () => {
    const { baseline, selected, diff } = resolvedFixture();
    const view = buildTaxonomyRenderView(baseline, selected, diff, {
      comparison: true,
      showInternal: true,
      showRelationships: true,
      revealedInternalIds: new Set(),
    });

    expect(view.tiers.map(({ id }) => id)).toEqual(['majcom', 'naf', 'wing']);
    expect(view.baseline).toBeUndefined();
    expect(view.movements).toEqual([]);
    expect(view.proposed.nodes).toHaveLength(selected.nodes.size);
    expect(view.proposed.nodes.find(({ id }) => id === 'acc')?.tierId).toBe('majcom');
    expect(view.proposed.nodes.find(({ id }) => id === 'fifteenth-af')?.tierId).toBe('naf');
    expect(view.proposed.nodes.find(({ id }) => id === '19-arw')?.tierId).toBe('wing');
  });
});
