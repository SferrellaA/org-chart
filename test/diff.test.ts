import { describe, expect, it } from 'vitest';

import { diffCharts, type ChartDiff, type ResolvedChart, type ResolvedNode } from '../src';

function node(id: string, overrides: Partial<ResolvedNode> = {}): ResolvedNode {
  return { id, name: id, ...overrides };
}

function chart(
  nodes: readonly ResolvedNode[],
  options: Partial<Omit<ResolvedChart, 'nodes'>> = {},
): ResolvedChart {
  return {
    nodes: new Map(nodes.map((item) => [item.id, item])),
    parents: new Map(),
    relationships: new Map(),
    semanticAnnotations: [],
    presentation: {},
    ...options,
  };
}

describe('diffCharts', () => {
  it('classifies added, removed, modified, and unchanged nodes in stable order', () => {
    const before = chart(
      [node('same'), node('removed', { note: 'old' }), node('changed', { name: 'Old' })],
      {
        parents: new Map([
          ['changed', { parent: 'same', relationship: 'internal' }],
        ]),
      },
    );
    const after = chart(
      [node('changed', { name: 'New' }), node('same'), node('added', { note: 'new' })],
      {
        parents: new Map([
          ['changed', { parent: 'added', relationship: 'subordinate' }],
        ]),
      },
    );

    const result = diffCharts(before, after);

    expect([...result.nodes.keys()]).toEqual(['same', 'removed', 'changed', 'added']);
    expect(result.nodes.get('same')).toMatchObject({ id: 'same', kind: 'unchanged', changes: [] });
    expect(result.nodes.get('removed')).toEqual({
      id: 'removed',
      kind: 'removed',
      before: { id: 'removed', name: 'removed', note: 'old' },
      changes: [],
    });
    expect(result.nodes.get('changed')).toMatchObject({
      id: 'changed',
      kind: 'modified',
      changes: ['name', 'parent', 'relationship'],
    });
    expect(result.nodes.get('added')).toEqual({
      id: 'added',
      kind: 'added',
      after: { id: 'added', name: 'added', note: 'new' },
      changes: [],
    });
    // Summary intentionally counts node kinds only; relationship counts are read from their map.
    expect(result.summary).toEqual({ added: 1, removed: 1, modified: 1, unchanged: 1 });
  });

  it('deep-compares metadata by value and ignores renderer-only fields', () => {
    const beforeNode = node('n', { metadata: { alpha: 1, beta: true } });
    const afterNode = node('n', { metadata: { beta: true, alpha: 1 } });
    (beforeNode as ResolvedNode & { x: number }).x = 10;
    (afterNode as ResolvedNode & { x: number }).x = 900;

    expect(diffCharts(chart([beforeNode]), chart([afterNode])).nodes.get('n')?.kind).toBe(
      'unchanged',
    );

    afterNode.metadata = { beta: false, alpha: 1 };
    expect(diffCharts(chart([beforeNode]), chart([afterNode])).nodes.get('n')).toMatchObject({
      kind: 'modified',
      changes: ['metadata'],
    });
  });

  it('detects hierarchy note and source changes as edge metadata', () => {
    const nodes = [node('parent'), node('child')];
    const oldSource = { label: 'Source', url: 'https://example.test/old' };
    const before = chart(nodes, {
      parents: new Map([
        [
          'child',
          {
            parent: 'parent',
            relationship: 'internal',
            note: 'Old edge',
            sources: [oldSource],
          },
        ],
      ]),
    });
    const noteChanged = chart(nodes, {
      parents: new Map([
        [
          'child',
          {
            parent: 'parent',
            relationship: 'internal',
            note: 'New edge',
            sources: [{ url: oldSource.url, label: oldSource.label }],
          },
        ],
      ]),
    });

    expect(diffCharts(before, noteChanged).nodes.get('child')).toMatchObject({
      kind: 'modified',
      changes: ['edgeMetadata'],
    });

    const sourceChanged = chart(nodes, {
      parents: new Map([
        [
          'child',
          {
            parent: 'parent',
            relationship: 'internal',
            note: 'Old edge',
            sources: [{ url: 'https://example.test/new', label: 'Source' }],
          },
        ],
      ]),
    });
    expect(diffCharts(before, sourceChanged).nodes.get('child')).toMatchObject({
      kind: 'modified',
      changes: ['edgeMetadata'],
    });

    const reorderedSourceKeys = chart(nodes, {
      parents: new Map([
        [
          'child',
          {
            parent: 'parent',
            relationship: 'internal',
            note: 'Old edge',
            sources: [{ url: oldSource.url, label: oldSource.label }],
          },
        ],
      ]),
    });
    expect(diffCharts(before, reorderedSourceKeys).nodes.get('child')?.kind).toBe('unchanged');
  });

  it('classifies relationship additions, removals, and all meaningful modifications', () => {
    const nodes = [node('a'), node('b'), node('c')];
    const before = chart(nodes, {
      relationships: new Map([
        [
          'removed',
          { id: 'removed', type: 'old', source: 'a', target: 'b', label: 'Removed' },
        ],
        [
          'changed',
          {
            id: 'changed',
            type: 'old',
            source: 'a',
            target: 'b',
            label: 'Old',
            note: 'Before',
            sources: [{ label: 'Old', url: 'https://example.test/old' }],
          },
        ],
      ]),
    });
    const after = chart(nodes, {
      relationships: new Map([
        [
          'changed',
          {
            id: 'changed',
            type: 'new',
            source: 'c',
            target: 'a',
            label: 'New',
            note: 'After',
            sources: [{ url: 'https://example.test/new', label: 'New' }],
          },
        ],
        ['added', { id: 'added', type: 'new', source: 'a', target: 'c', label: 'Added' }],
      ]),
    });

    const result = diffCharts(before, after);

    expect([...result.relationships.keys()]).toEqual(['removed', 'changed', 'added']);
    expect(result.relationships.get('removed')).toMatchObject({ kind: 'removed' });
    expect(result.relationships.get('added')).toMatchObject({ kind: 'added' });
    expect(result.relationships.get('changed')).toMatchObject({
      kind: 'modified',
      changes: ['type', 'source', 'target', 'label', 'note', 'sources'],
    });
  });

  it('carries after annotations in order and deeply isolates all nested output', () => {
    const beforeNode = node('removed', {
      aliases: ['alias'],
      symbol: { type: 'text', text: 'R' },
      metadata: { value: 1 },
      sources: [{ label: 'Node source', url: 'https://example.test/node' }],
    });
    const beforeRelationship = {
      id: 'removed-link',
      type: 'link',
      source: 'removed',
      target: 'kept',
      label: 'Link',
      sources: [{ label: 'Link source', url: 'https://example.test/link' }],
    };
    const before = chart([beforeNode, node('kept')], {
      relationships: new Map([[beforeRelationship.id, beforeRelationship]]),
    });
    const annotations = [
      {
        semantic: 'split',
        nodes: ['kept', 'left', 'right'],
        note: 'Participants',
        sources: [{ label: 'Decision', url: 'https://example.test/decision' }],
      },
      { semantic: 'follow-up', nodes: ['right'] },
    ];
    const after = chart([node('kept')], { semanticAnnotations: annotations });

    const result = diffCharts(before, after);
    const removed = result.nodes.get('removed')!.before!;
    const removedLink = result.relationships.get('removed-link')!.before!;
    const mutable = result as unknown as {
      annotations: Array<{ nodes: string[]; sources?: Array<{ label: string; url: string }> }>;
    };
    (removed.aliases as string[])[0] = 'changed';
    (removed.metadata as Record<string, number>).value = 2;
    (removed.sources![0] as { label: string }).label = 'changed';
    (removedLink.sources![0] as { label: string }).label = 'changed';
    mutable.annotations[0]!.nodes[0] = 'changed';
    mutable.annotations[0]!.sources![0]!.label = 'changed';

    expect(result.annotations.map((item) => item.semantic)).toEqual(['split', 'follow-up']);
    expect(beforeNode).toMatchObject({
      aliases: ['alias'],
      metadata: { value: 1 },
      sources: [{ label: 'Node source' }],
    });
    expect(beforeRelationship.sources[0]!.label).toBe('Link source');
    expect(annotations[0]).toMatchObject({
      nodes: ['kept', 'left', 'right'],
      sources: [{ label: 'Decision' }],
    });
  });

  it('handles 15,000 nodes iteratively', () => {
    const nodes = Array.from({ length: 15_000 }, (_, index) => node(`node-${index}`));
    const before = chart(nodes);
    const after = chart(nodes.map((item) => ({ ...item })));

    const result: ChartDiff = diffCharts(before, after);

    expect(result.nodes).toHaveLength(15_000);
    expect(result.summary).toEqual({ added: 0, removed: 0, modified: 0, unchanged: 15_000 });
  });
});
