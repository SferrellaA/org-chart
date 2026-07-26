import { describe, expect, it } from 'vitest';

import type { ChartDiff } from '../src/model/diff';
import type { ResolvedChart } from '../src/model/types';
import { projectHierarchy } from '../src/presentation/hierarchy-projection';

function chart(): ResolvedChart {
  return {
    nodes: new Map([
      ['root', { id: 'root', name: 'Root', aliases: ['HQ'] }],
      ['office', { id: 'office', name: 'Office' }],
      ['team', { id: 'team', name: 'Team' }],
      ['agency', { id: 'agency', name: 'Agency' }],
      ['other', { id: 'other', name: 'Other' }],
    ]),
    parents: new Map([
      ['office', { parent: 'root', relationship: 'internal' }],
      ['team', { parent: 'office', relationship: 'internal' }],
      ['agency', { parent: 'office', relationship: 'subordinate' }],
    ]),
    relationships: new Map([
      ['coordination', {
        id: 'coordination', source: 'team', target: 'agency',
        type: 'coordination', label: 'Coordinates',
      }],
    ]),
    semanticAnnotations: [],
    taxonomy: { comparisonTiers: [], systems: [] },
    presentation: { initialExpansionDepth: 0, focusNodes: ['agency'] },
  };
}

function diff(): ChartDiff {
  return {
    nodes: new Map([
      ['office', { id: 'office', kind: 'modified', changes: ['name'] }],
    ]),
    relationships: new Map(),
    leadership: [],
    taxonomy: {
      comparisonTiers: new Map(), systems: new Map(), levels: new Map(), assignments: new Map(),
    },
    annotations: [],
    summary: { added: 0, removed: 0, modified: 1, unchanged: 4 },
  };
}

describe('projectHierarchy', () => {
  it('projects hierarchy identity and deterministic outer ownership once', () => {
    const projection = projectHierarchy(chart(), diff(), {
      showInternal: true,
      showRelationships: true,
      revealedInternalIds: new Set(),
    });

    expect(projection.entries.map(({ id }) => id)).toEqual([
      'root', 'office', 'team', 'agency', 'other',
    ]);
    expect(projection.entries.find(({ id }) => id === 'team')).toMatchObject({
      parentId: 'office', relationship: 'internal', internal: true,
      internalDepth: 2, outerId: 'root', outerDepth: 0,
    });
    expect(projection.entries.find(({ id }) => id === 'agency')).toMatchObject({
      parentId: 'office', relationship: 'subordinate', internal: false,
      internalDepth: 0, outerId: 'agency', outerParentId: 'root', outerDepth: 1,
    });
    expect(projection.initialExpansionIds).toEqual([
      'root', 'office', 'team', 'other', 'agency',
    ]);
  });

  it('shares hidden-internal anchors, search entries, and aggregated relationships', () => {
    const projection = projectHierarchy(chart(), diff(), {
      showInternal: false,
      showRelationships: true,
      revealedInternalIds: new Set(['office']),
    });

    expect(projection.visibleEntries.map(({ id }) => id)).toEqual([
      'root', 'office', 'agency', 'other',
    ]);
    expect(projection.visibleAnchors.get('team')).toBe('office');
    expect(projection.searchEntries.find(({ id }) => id === 'team')).toEqual({
      id: 'team', label: 'Team', aliases: [], hiddenInternal: true, ownerId: 'root',
    });
    expect(projection.relationships).toEqual([
      expect.objectContaining({
        id: 'coordination', source: 'office', target: 'agency', aggregated: true,
        sourceAncestors: ['office', 'root'], targetAncestors: ['agency', 'root'],
      }),
    ]);
  });
});
