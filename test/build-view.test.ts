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
  return { nodes, relationships, annotations: [], summary };
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
      { id: 'root', label: 'root', hiddenInternal: false },
      { id: 'a', label: 'a', hiddenInternal: true },
      { id: 'b', label: 'b', hiddenInternal: true },
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
      hiddenInternal: false,
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
});
