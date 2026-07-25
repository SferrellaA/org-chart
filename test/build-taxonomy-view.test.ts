import { describe, expect, it } from 'vitest';

import { diffCharts } from '../src/model/diff';
import type { ComparisonTier, ResolvedChart } from '../src/model/types';
import { resolveView } from '../src/model/resolve';
import { buildTaxonomyRenderView } from '../src/presentation/build-taxonomy-view';
import { taxonomyDocument } from './fixtures';

function chart(comparisonTiers: readonly ComparisonTier[]): ResolvedChart {
  return {
    nodes: new Map(),
    parents: new Map(),
    relationships: new Map(),
    semanticAnnotations: [],
    taxonomy: { comparisonTiers, systems: [] },
    presentation: {},
  };
}

const options = {
  comparison: true,
  showInternal: true,
  showRelationships: true,
  revealedInternalIds: new Set<string>(),
};

describe('buildTaxonomyRenderView', () => {
  it('uses proposed tier order and retains baseline-only tiers by their former neighbors', () => {
    const baseline = chart([
      { id: 'command', label: 'Command' },
      { id: 'division', label: 'Division' },
      { id: 'wing', label: 'Wing' },
    ]);
    const proposed = chart([
      { id: 'command', label: 'Command' },
      { id: 'wing', label: 'Wing' },
      { id: 'squadron', label: 'Squadron' },
    ]);

    const view = buildTaxonomyRenderView(baseline, proposed, diffCharts(baseline, proposed), options);

    expect(view.tiers.map(({ id }) => id)).toEqual([
      'command',
      'division',
      'wing',
      'squadron',
    ]);
    expect(view.tiers[1]).toMatchObject({
      id: 'division',
      kind: 'removed',
      baseline: { label: 'Division' },
    });
    expect(view.tiers[3]).toMatchObject({
      id: 'squadron',
      kind: 'added',
      proposed: { label: 'Squadron' },
    });
  });

  it('projects complete version-specific chart halves and records tier movements', () => {
    const document = taxonomyDocument();
    const baseline = resolveView(document, { viewId: 'current', selectedGroups: [] });
    const proposed = resolveView(document, {
      viewId: 'remove-air-divisions',
      selectedGroups: [],
    });

    const view = buildTaxonomyRenderView(
      baseline,
      proposed,
      diffCharts(baseline, proposed),
      options,
    );

    expect(view.baseline?.nodes).toHaveLength(8);
    expect(view.proposed.nodes).toHaveLength(6);
    expect(view.baseline?.systems.map(({ id }) => id)).toEqual(['army-echelon', 'usaf-echelon']);
    expect(view.proposed.systems.map(({ id }) => id)).toEqual(['army-echelon', 'usaf-echelon']);
    expect(view.baseline?.nodes.find(({ id }) => id === 'air-division-a')).toMatchObject({
      tierId: 'division-equivalent',
      diffKind: 'removed',
      leadership: [{ title: 'Commander' }],
    });
    expect(view.proposed.nodes.find(({ id }) => id === 'naf-a')).toMatchObject({
      tierId: 'division-equivalent',
      diffKind: 'modified',
      leadership: [{ title: 'Deputy Commander' }],
    });
    expect(view.movements).toContainEqual({
      nodeId: 'naf-a',
      fromTierId: 'naf-equivalent',
      toTierId: 'division-equivalent',
    });
    expect(view.searchEntries.find(({ id }) => id === 'air-division-a')).toMatchObject({
      label: 'Example Air Division A',
      ownerId: 'air-division-a',
    });
  });

  it('uses hierarchy fallback for missing and conflicting assignments and clamps deep nodes', () => {
    const value: ResolvedChart = {
      nodes: new Map([
        ['root', {
          id: 'root',
          name: 'Root',
          resolvedTaxonomyAssignments: [{ systemId: 'first', levelId: 'top', tierId: 'top' }],
        }],
        ['internal', { id: 'internal', name: 'Internal' }],
        ['conflict', {
          id: 'conflict',
          name: 'Conflict',
          resolvedTaxonomyAssignments: [
            { systemId: 'first', levelId: 'top', tierId: 'top' },
            { systemId: 'second', levelId: 'bottom', tierId: 'bottom' },
          ],
        }],
        ['deep', { id: 'deep', name: 'Deep' }],
        ['deeper', { id: 'deeper', name: 'Deeper' }],
      ]),
      parents: new Map([
        ['internal', { parent: 'root', relationship: 'internal' }],
        ['conflict', { parent: 'internal', relationship: 'subordinate' }],
        ['deep', { parent: 'conflict', relationship: 'subordinate' }],
        ['deeper', { parent: 'deep', relationship: 'subordinate' }],
      ]),
      relationships: new Map(),
      semanticAnnotations: [],
      taxonomy: {
        comparisonTiers: [
          { id: 'top', label: 'Top' },
          { id: 'middle', label: 'Middle' },
          { id: 'bottom', label: 'Bottom' },
        ],
        systems: [],
      },
      presentation: {},
    };

    const view = buildTaxonomyRenderView(value, value, diffCharts(value, value), {
      ...options,
      comparison: false,
    });
    const placement = Object.fromEntries(view.proposed.nodes.map(({ id, tierId }) => [id, tierId]));

    expect(view.baseline).toBeUndefined();
    expect(placement).toEqual({
      root: 'top',
      internal: 'top',
      conflict: 'middle',
      deep: 'bottom',
      deeper: 'bottom',
    });
  });

  it('hides internal cards while retaining searchable hierarchy and relationship context', () => {
    const value: ResolvedChart = {
      nodes: new Map([
        ['root', { id: 'root', name: 'Root' }],
        ['office', { id: 'office', name: 'Office', aliases: ['HQ office'] }],
        ['agency', { id: 'agency', name: 'Agency' }],
      ]),
      parents: new Map([
        ['office', { parent: 'root', relationship: 'internal' }],
        ['agency', { parent: 'office', relationship: 'subordinate' }],
      ]),
      relationships: new Map([
        ['coordination', {
          id: 'coordination',
          source: 'office',
          target: 'agency',
          type: 'coordination',
          label: 'Coordinates',
        }],
      ]),
      semanticAnnotations: [],
      taxonomy: {
        comparisonTiers: [{ id: 'top', label: 'Top' }, { id: 'lower', label: 'Lower' }],
        systems: [],
      },
      presentation: {},
    };

    const view = buildTaxonomyRenderView(value, value, diffCharts(value, value), {
      ...options,
      comparison: false,
      showInternal: false,
    });

    expect(view.proposed.nodes.map(({ id }) => id)).toEqual(['root', 'agency']);
    expect(view.proposed.nodes.find(({ id }) => id === 'agency')).toMatchObject({
      parentId: 'office',
      connectorSourceId: 'root',
    });
    expect(view.proposed.relationships).toEqual([
      expect.objectContaining({ source: 'root', target: 'agency', aggregated: true }),
    ]);
    expect(view.searchEntries).toContainEqual({
      id: 'office',
      label: 'Office',
      aliases: ['HQ office'],
      hiddenInternal: true,
      ownerId: 'root',
    });
  });

  it('carries initial hierarchy expansion into taxonomy rendering', () => {
    const value: ResolvedChart = {
      nodes: new Map([
        ['root', { id: 'root', name: 'Root' }],
        ['child', { id: 'child', name: 'Child' }],
        ['grandchild', { id: 'grandchild', name: 'Grandchild' }],
      ]),
      parents: new Map([
        ['child', { parent: 'root', relationship: 'subordinate' }],
        ['grandchild', { parent: 'child', relationship: 'subordinate' }],
      ]),
      relationships: new Map(),
      semanticAnnotations: [],
      taxonomy: {
        comparisonTiers: [
          { id: 'top', label: 'Top' },
          { id: 'middle', label: 'Middle' },
          { id: 'bottom', label: 'Bottom' },
        ],
        systems: [],
      },
      presentation: { initialExpansionDepth: 0 },
    };

    const view = buildTaxonomyRenderView(value, value, diffCharts(value, value), {
      ...options,
      comparison: false,
    });

    expect(view.initialExpansionIds).toEqual(['root']);
  });

  it('uses each side own tiers for hierarchy fallback', () => {
    const baseline = chart([
      { id: 'retired', label: 'Retired' },
      { id: 'shared', label: 'Shared' },
    ]);
    baseline.nodes = new Map([['unit', { id: 'unit', name: 'Unit' }]]);
    const proposed = chart([
      { id: 'shared', label: 'Shared' },
      { id: 'new', label: 'New' },
    ]);
    proposed.nodes = new Map([['unit', { id: 'unit', name: 'Unit' }]]);

    const view = buildTaxonomyRenderView(
      baseline,
      proposed,
      diffCharts(baseline, proposed),
      options,
    );

    expect(view.baseline?.nodes[0]?.tierId).toBe('retired');
    expect(view.proposed.nodes[0]?.tierId).toBe('shared');
  });

  it('uses shared rows when taxonomy is introduced by the proposal', () => {
    const baseline = chart([]);
    baseline.nodes = new Map([['unit', { id: 'unit', name: 'Unit' }]]);
    const proposed = chart([
      { id: 'top', label: 'Top' },
      { id: 'lower', label: 'Lower' },
    ]);
    proposed.nodes = new Map([['unit', { id: 'unit', name: 'Unit' }]]);

    const view = buildTaxonomyRenderView(
      baseline,
      proposed,
      diffCharts(baseline, proposed),
      options,
    );

    expect(view.baseline?.systems).toEqual([]);
    expect(view.baseline?.nodes[0]?.tierId).toBe('top');
  });
});
