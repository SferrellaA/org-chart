import { describe, expect, it } from 'vitest';

import type { ChartDiff, NodeDiff } from '../src/model/diff';
import type {
  PatchGroup,
  Relationship,
  ResolvedChart,
  ResolvedNode,
  ResolvedParent,
} from '../src/model/types';
import { buildRenderView } from '../src/presentation/build-view';
import {
  changeDetails,
  hierarchyDetails,
  nodeDetails,
  patchGroupDetails,
  relationshipDetails,
} from '../src/presentation/notes';

function node(id: string, name = id): ResolvedNode {
  return { id, name };
}

function chart(
  ids: readonly string[],
  parents: readonly (readonly [string, ResolvedParent])[] = [],
  options: Partial<ResolvedChart> = {},
): ResolvedChart {
  return {
    nodes: new Map(ids.map((id) => [id, node(id)])),
    parents: new Map(parents),
    relationships: new Map(),
    semanticAnnotations: [],
    taxonomy: { comparisonTiers: [], systems: [] },
    presentation: {},
    ...options,
  };
}

function diff(
  entries: readonly (readonly [string, Partial<NodeDiff>])[],
  relationships: ChartDiff['relationships'] = new Map(),
): ChartDiff {
  const nodes = new Map(
    entries.map(([id, value]) => [
      id,
      { id, kind: 'unchanged', changes: [], ...value } as NodeDiff,
    ]),
  );
  const summary = { added: 0, removed: 0, modified: 0, unchanged: 0 };
  for (const value of nodes.values()) summary[value.kind] += 1;
  return {
    nodes,
    relationships,
    leadership: [],
    taxonomy: {
      comparisonTiers: new Map(), systems: new Map(), levels: new Map(), assignments: new Map(),
    },
    annotations: [],
    summary,
  };
}

const options = {
  showInternal: true,
  showRelationships: true,
  revealedInternalIds: new Set<string>(),
};

describe('buildRenderView', () => {
  it('projects subordinate nodes outside and internal descendants into flattened rows', () => {
    const value = chart(
      ['root', 'office', 'team', 'agency'],
      [
        ['office', { parent: 'root', relationship: 'internal' }],
        ['team', { parent: 'office', relationship: 'internal' }],
        ['agency', { parent: 'office', relationship: 'subordinate' }],
      ],
    );

    const view = buildRenderView(value, diff([]), options);

    expect(view.nodes.map((item) => item.id)).toEqual(['root', 'agency']);
    expect(view.nodes[0]?.internalRows).toEqual([
      {
        id: 'office',
        name: 'office',
        depth: 1,
        diffKind: 'unchanged',
        hasSubordinateChildren: true,
      },
      {
        id: 'team',
        name: 'team',
        depth: 2,
        diffKind: 'unchanged',
        hasSubordinateChildren: false,
      },
    ]);
    expect(view.nodes[1]).toMatchObject({
      id: 'agency',
      parentId: 'root',
      connectorSourceId: 'office',
    });
  });

  it('projects leadership onto outer cards, internal rows, and removed ghost nodes', () => {
    const root = node('root', 'Root');
    root.leadership = [{ id: 'root-cc', title: 'Commander', authorizedRank: { label: 'O-6' } }];
    const office = node('office', 'Office');
    office.leadership = [{ title: 'Director', occupant: { name: 'Taylor Example' } }];
    const removed = node('removed', 'Removed');
    removed.leadership = [{ title: 'Former Commander', vacant: true }];
    const value = chart(
      ['root', 'office'],
      [['office', { parent: 'root', relationship: 'internal' }]],
      { nodes: new Map([['root', root], ['office', office]]) },
    );

    const result = buildRenderView(
      value,
      diff([
        ['removed', { kind: 'removed', before: removed }],
      ]),
      options,
    );

    expect(result.nodes[0]).toMatchObject({
      id: 'root',
      leadership: [{ id: 'root-cc', title: 'Commander' }],
      internalRows: [expect.objectContaining({
        id: 'office',
        leadership: [{ title: 'Director', occupant: { name: 'Taylor Example' } }],
      })],
    });
    expect(result.nodes[1]).toMatchObject({
      id: 'removed',
      leadership: [{ title: 'Former Commander', vacant: true }],
      ghost: true,
    });
  });

  it('keeps parentless state roots outer even when they have no subordinate relation', () => {
    expect(buildRenderView(chart(['state']), diff([]), options).nodes).toMatchObject([
      { id: 'state', ghost: false },
    ]);
  });

  it('hides internal rows, counts hidden changes, and indexes all resolved nodes', () => {
    const value = chart(
      ['root', 'a', 'b'],
      [
        ['a', { parent: 'root', relationship: 'internal' }],
        ['b', { parent: 'a', relationship: 'internal' }],
      ],
    );
    const result = buildRenderView(
      value,
      diff([
        ['a', { kind: 'modified' }],
        ['b', { kind: 'added' }],
      ]),
      { ...options, showInternal: false },
    );

    expect(result.nodes[0]).toMatchObject({
      internalRows: [],
      hiddenInternalCount: 2,
      hiddenChangeCount: 2,
    });
    expect(result.searchEntries).toEqual([
      { id: 'root', label: 'root', aliases: [], hiddenInternal: false, ownerId: 'root' },
      { id: 'a', label: 'a', aliases: [], hiddenInternal: true, ownerId: 'root' },
      { id: 'b', label: 'b', aliases: [], hiddenInternal: true, ownerId: 'root' },
    ]);
  });

  it('reveals a requested internal node and its necessary ancestor chain', () => {
    const value = chart(
      ['root', 'a', 'b', 'c'],
      [
        ['a', { parent: 'root', relationship: 'internal' }],
        ['b', { parent: 'a', relationship: 'internal' }],
        ['c', { parent: 'b', relationship: 'internal' }],
      ],
    );
    const result = buildRenderView(value, diff([]), {
      ...options,
      showInternal: false,
      revealedInternalIds: new Set(['c']),
    });

    expect(result.nodes[0]?.internalRows.map((row) => row.id)).toEqual(['a', 'b', 'c']);
    expect(result.nodes[0]).toMatchObject({ hiddenInternalCount: 0, hiddenChangeCount: 0 });
    expect(result.searchEntries.every((entry) => !entry.hiddenInternal)).toBe(true);
  });

  it('adds removed diff-only nodes once as ghost outer nodes', () => {
    const removed = node('removed', 'Former office');
    const result = buildRenderView(
      chart(['kept']),
      diff([
        ['kept', { kind: 'unchanged', after: node('kept') }],
        ['removed', { kind: 'removed', before: removed }],
      ]),
      options,
    );

    expect(result.nodes.map(({ id, ghost }) => ({ id, ghost }))).toEqual([
      { id: 'kept', ghost: false },
      { id: 'removed', ghost: true },
    ]);
    expect(result.searchEntries.at(-1)).toEqual({
      id: 'removed',
      label: 'Former office',
      aliases: [],
      hiddenInternal: false,
      ownerId: 'removed',
    });
  });

  it('aggregates hidden relationship endpoints and omits aggregation-created self-loops', () => {
    const relationships = new Map<string, Relationship>([
      ['external', { id: 'external', type: 'coord', source: 'inside', target: 'other', label: 'X' }],
      ['internal', { id: 'internal', type: 'coord', source: 'inside', target: 'inside2', label: 'I' }],
    ]);
    const value = chart(
      ['root', 'inside', 'inside2', 'other'],
      [
        ['inside', { parent: 'root', relationship: 'internal' }],
        ['inside2', { parent: 'root', relationship: 'internal' }],
        ['other', { parent: 'root', relationship: 'subordinate' }],
      ],
      { relationships },
    );
    const result = buildRenderView(value, diff([]), {
      ...options,
      showInternal: false,
    });

    expect(result.relationships).toEqual([
      {
        id: 'external',
        source: 'root',
        target: 'other',
        sourceAncestors: ['root'],
        targetAncestors: ['other', 'root'],
        label: 'X',
        type: 'coord',
        aggregated: true,
        diffKind: 'unchanged',
      },
    ]);
    expect(buildRenderView(value, diff([]), { ...options, showRelationships: false }).relationships).toEqual([]);
  });

  it('uses visible internal relationship endpoints without aggregation', () => {
    const relationship = { id: 'r', type: 'line', source: 'inside', target: 'other', label: 'R' };
    const value = chart(
      ['root', 'inside', 'other'],
      [
        ['inside', { parent: 'root', relationship: 'internal' }],
        ['other', { parent: 'root', relationship: 'subordinate' }],
      ],
      { relationships: new Map([['r', relationship]]) },
    );

    expect(buildRenderView(value, diff([]), options).relationships[0]).toMatchObject({
      source: 'inside',
      target: 'other',
      aggregated: false,
    });
  });

  it('aggregates hidden source and target descendants to their nearest revealed internal ancestor', () => {
    const relationships = new Map<string, Relationship>([
      [
        'hidden-source',
        { id: 'hidden-source', type: 'line', source: 'source-leaf', target: 'other', label: 'From' },
      ],
      [
        'hidden-target',
        { id: 'hidden-target', type: 'line', source: 'other', target: 'target-leaf', label: 'To' },
      ],
      [
        'collapsed-loop',
        {
          id: 'collapsed-loop',
          type: 'line',
          source: 'source-leaf',
          target: 'target-leaf',
          label: 'Within',
        },
      ],
    ]);
    const value = chart(
      ['root', 'revealed', 'source-leaf', 'target-leaf', 'other'],
      [
        ['revealed', { parent: 'root', relationship: 'internal' }],
        ['source-leaf', { parent: 'revealed', relationship: 'internal' }],
        ['target-leaf', { parent: 'revealed', relationship: 'internal' }],
        ['other', { parent: 'root', relationship: 'subordinate' }],
      ],
      { relationships },
    );

    const result = buildRenderView(value, diff([]), {
      ...options,
      showInternal: false,
      revealedInternalIds: new Set(['revealed']),
    });

    expect(result.relationships).toEqual([
      {
        id: 'hidden-source',
        source: 'revealed',
        target: 'other',
        sourceAncestors: ['revealed', 'root'],
        targetAncestors: ['other', 'root'],
        label: 'From',
        type: 'line',
        aggregated: true,
        diffKind: 'unchanged',
      },
      {
        id: 'hidden-target',
        source: 'other',
        target: 'revealed',
        sourceAncestors: ['other', 'root'],
        targetAncestors: ['revealed', 'root'],
        label: 'To',
        type: 'line',
        aggregated: true,
        diffKind: 'unchanged',
      },
    ]);
  });

  it('retains isolated endpoint lineages from visible anchors through outer ancestors', () => {
    const relationships = new Map<string, Relationship>([
      ['first', { id: 'first', type: 'line', source: 'source', target: 'target', label: 'First' }],
      ['second', { id: 'second', type: 'line', source: 'source', target: 'target', label: 'Second' }],
    ]);
    const value = chart(
      ['root', 'parent', 'source', 'target'],
      [
        ['parent', { parent: 'root', relationship: 'subordinate' }],
        ['source', { parent: 'parent', relationship: 'subordinate' }],
      ],
      { relationships },
    );

    const result = buildRenderView(value, diff([]), options);

    expect(result.relationships[0]).toMatchObject({
      source: 'source',
      target: 'target',
      sourceAncestors: ['source', 'parent', 'root'],
      targetAncestors: ['target'],
    });
    expect(result.relationships[1]?.sourceAncestors).toEqual(['source', 'parent', 'root']);
    expect(result.relationships[0]?.sourceAncestors).not.toBe(
      result.relationships[1]?.sourceAncestors,
    );
    expect(result.relationships[0]?.targetAncestors).not.toBe(
      result.relationships[1]?.targetAncestors,
    );
  });

  it('starts lineage at a visible internal anchor before its outer ancestors', () => {
    const relationship = {
      id: 'r',
      type: 'line',
      source: 'hidden',
      target: 'target',
      label: 'R',
    };
    const value = chart(
      ['root', 'visible', 'hidden', 'target'],
      [
        ['visible', { parent: 'root', relationship: 'internal' }],
        ['hidden', { parent: 'visible', relationship: 'internal' }],
      ],
      { relationships: new Map([['r', relationship]]) },
    );

    const result = buildRenderView(value, diff([]), {
      ...options,
      showInternal: false,
      revealedInternalIds: new Set(['visible']),
    });

    expect(result.relationships[0]).toMatchObject({
      source: 'visible',
      sourceAncestors: ['visible', 'root'],
      targetAncestors: ['target'],
    });
  });

  it('expands the configured initial depth and all outer paths to focus nodes', () => {
    const value = chart(
      ['root', 'child', 'grandchild', 'internal'],
      [
        ['child', { parent: 'root', relationship: 'subordinate' }],
        ['grandchild', { parent: 'child', relationship: 'subordinate' }],
        ['internal', { parent: 'grandchild', relationship: 'internal' }],
      ],
      { presentation: { initialExpansionDepth: 1, focusNodes: ['internal'] } },
    );

    expect(buildRenderView(value, diff([]), options).initialExpansionIds).toEqual([
      'root',
      'child',
      'grandchild',
    ]);
    expect(buildRenderView(chart(['root']), diff([]), options).initialExpansionIds).toEqual(['root']);
  });

  it('handles a 15,000-level internal hierarchy iteratively', () => {
    const count = 15_000;
    const ids = Array.from({ length: count }, (_, index) => `n-${index}`);
    const parents = ids.slice(1).map(
      (id, index) => [id, { parent: ids[index]!, relationship: 'internal' }] as const,
    );

    const result = buildRenderView(chart(ids, parents), diff([]), options);

    expect(result.nodes).toHaveLength(1);
    expect(result.nodes[0]?.internalRows).toHaveLength(count - 1);
    expect(result.nodes[0]?.internalRows.at(-1)?.depth).toBe(count - 1);
  });

  it('projects 5,000 deep internal relationship endpoints in near-linear time', () => {
    const count = 5_000;
    const ids = Array.from({ length: count }, (_, index) => `n-${index}`);
    const parents = ids.slice(1).map(
      (id, index) => [id, { parent: ids[index]!, relationship: 'internal' }] as const,
    );
    const relationships = new Map<string, Relationship>(
      Array.from({ length: count }, (_, index) => {
        const id = `r-${index}`;
        return [
          id,
          { id, type: 'line', source: ids[count - 1]!, target: 'target', label: id },
        ];
      }),
    );
    const value = chart([...ids, 'target'], parents, { relationships });

    const start = performance.now();
    const result = buildRenderView(value, diff([]), {
      ...options,
      showInternal: false,
    });
    const elapsed = performance.now() - start;

    expect(result.relationships).toHaveLength(count);
    expect(result.relationships[0]).toMatchObject({
      source: 'n-0',
      sourceAncestors: ['n-0'],
    });
    expect(elapsed).toBeLessThan(1_000);
  });
});

describe('presentation details', () => {
  const sources = [
    { label: 'Secure', url: 'https://example.test/a' },
    { label: 'Plain HTTP', url: 'http://example.test/b' },
    { label: 'Script', url: 'javascript:alert(1)' },
    { label: 'Broken', url: 'not a URL' },
  ];

  it('returns plain node details with cloned, sanitized sources', () => {
    const input = { id: 'n', name: '<b>Office</b>', note: '<script>x</script>', sources };
    const result = nodeDetails(input);

    expect(result).toEqual({
      title: '<b>Office</b>',
      kindLabel: 'Node',
      note: '<script>x</script>',
      sources: sources.slice(0, 2),
    });
    expect(result.sources).not.toBe(sources);
    expect(result.sources[0]).not.toBe(sources[0]);
  });

  it('retains hierarchy edge, relationship, change, and patch-group details', () => {
    const edge = { parent: 'parent', relationship: 'internal' as const, note: 'Edge note', sources };
    const relationship = {
      id: 'rel', type: 'oversight', source: 'a', target: 'b', label: 'Oversees', note: 'Rel note', sources,
    };
    const change: NodeDiff = {
      id: 'n', kind: 'modified', before: node('n', 'Old'), after: node('n', 'New'), changes: ['name'],
    };
    const group: PatchGroup = { id: 'g', label: 'Reform', patches: [], note: 'Group note', sources };

    expect(hierarchyDetails(node('child', 'Child'), node('parent', 'Parent'), edge)).toEqual({
      title: 'Child -> Parent', kindLabel: 'Internal hierarchy', note: 'Edge note', sources: sources.slice(0, 2),
    });
    expect(relationshipDetails(relationship)).toEqual({
      title: 'Oversees', kindLabel: 'oversight', note: 'Rel note', sources: sources.slice(0, 2),
    });
    expect(changeDetails(change)).toEqual({
      title: 'New', kindLabel: 'Modified node', sources: [],
    });
    expect(patchGroupDetails(group)).toEqual({
      title: 'Reform', kindLabel: 'Patch group', note: 'Group note', sources: sources.slice(0, 2),
    });
  });

  it('includes leadership text in node and change details', () => {
    const before = node('wing', 'Wing');
    before.leadership = [
      { id: 'wing-do', title: 'Director of Operations', authorizedRank: { label: 'O-4' } },
    ];
    const after = node('oss', 'Operational Support Squadron');
    after.leadership = [
      {
        id: 'wing-do',
        title: 'Commander',
        authorizedRank: { label: 'O-5' },
        occupant: { name: 'Morgan Example', rank: { label: 'O-4' }, acting: true },
        vacant: true,
      },
    ];

    expect(nodeDetails(after).leadership).toEqual([
      'O-5 Commander; Acting O-4 Morgan Example; Vacant',
    ]);
    expect(changeDetails({
      id: 'wing-do',
      kind: 'modified',
      beforeNodeId: 'wing',
      afterNodeId: 'oss',
      before: before.leadership[0]!,
      after: after.leadership[0]!,
      changes: ['node', 'title', 'authorizedRank', 'occupant', 'vacant'],
    }).leadership).toEqual([
      'Before: O-4 Director of Operations',
      'After: O-5 Commander; Acting O-4 Morgan Example; Vacant',
    ]);

    expect(changeDetails({
      id: 'oss',
      kind: 'modified',
      before,
      after,
      changes: ['leadership'],
    }).leadership).toEqual([
      'Before: O-4 Director of Operations',
      'After: O-5 Commander; Acting O-4 Morgan Example; Vacant',
    ]);
  });
});
