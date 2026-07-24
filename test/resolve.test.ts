import { describe, expect, it } from 'vitest';

import { ResolutionError, resolveView } from '../src/model/resolve';
import type { OrgDocument, Patch } from '../src/model/types';
import { cloneValidDocument, taxonomyDocument, type DeepMutable } from './fixtures';

describe('resolveView', () => {
  it('resolves taxonomy assignments to their comparison tiers', () => {
    const document = taxonomyDocument();

    const result = resolveView(document, { viewId: 'current', selectedGroups: [] });

    expect(result.taxonomy.comparisonTiers.map(({ id }) => id)).toEqual([
      'naf-equivalent', 'division-equivalent', 'wing',
    ]);
    expect(result.nodes.get('wing-a')?.resolvedTaxonomyAssignments).toEqual([
      { systemId: 'usaf-echelon', levelId: 'wing', tierId: 'wing' },
    ]);
  });

  it('applies taxonomy and structural changes independent of patch order', () => {
    const documents = [taxonomyDocument(), taxonomyDocument(), taxonomyDocument()];
    documents[1]!.proposals[0]!.patches!.reverse();
    const patches = documents[2]!.proposals[0]!.patches!;
    documents[2]!.proposals[0]!.patches = [patches[3]!, patches[0]!, patches[7]!, patches[5]!, patches[1]!, patches[6]!, patches[2]!, patches[4]!];

    const results = documents.map((document) =>
      resolveView(document, { viewId: 'remove-air-divisions', selectedGroups: [] }));
    const normalize = (result: (typeof results)[number]) => ({
      taxonomy: result.taxonomy,
      parents: [...result.parents],
      nodes: [...result.nodes],
    });

    expect(normalize(results[1]!)).toEqual(normalize(results[0]!));
    expect(normalize(results[2]!)).toEqual(normalize(results[0]!));
    expect(results[0]!.taxonomy?.systems
      .find(({ id }) => id === 'usaf-echelon')?.levels
      .find(({ id }) => id === 'numbered-air-force')?.tier).toBe('division-equivalent');
    expect(results[0]!.nodes.has('air-division-a')).toBe(false);
    expect(results[0]!.parents.get('wing-b')?.parent).toBe('naf-b');
  });

  it('deep-clones taxonomy definitions and assignment records', () => {
    const document = taxonomyDocument();
    const first = resolveView(document, { viewId: 'current', selectedGroups: [] });
    const second = resolveView(document, { viewId: 'current', selectedGroups: [] });

    expect(first.taxonomy).not.toBe(document.snapshots[0]!.taxonomy);
    expect(first.taxonomy?.comparisonTiers[0]).not.toBe(document.snapshots[0]!.taxonomy!.comparisonTiers[0]);
    expect(first.taxonomy?.systems[0]?.levels[0]).not.toBe(document.snapshots[0]!.taxonomy!.systems[0]!.levels[0]);
    expect(first.nodes.get('wing-a')?.taxonomyAssignments).not.toBe(document.nodes['wing-a']!.taxonomyAssignments);
    expect(first.taxonomy).not.toBe(second.taxonomy);
  });

  it('rejects contradictory taxonomy operations regardless of order', () => {
    for (const reverse of [false, true]) {
      const document = taxonomyDocument();
      document.proposals[0]!.patches = [
        { type: 'set-taxonomy-level', taxonomy: 'usaf-echelon', level: 'wing', value: { label: 'Wing equivalent' } },
        { type: 'remove-taxonomy-level', taxonomy: 'usaf-echelon', level: 'wing' },
      ];
      if (reverse) document.proposals[0]!.patches.reverse();

      expect(() => resolveView(document, { viewId: 'remove-air-divisions', selectedGroups: [] }))
        .toThrow(/conflicting taxonomy.*usaf-echelon.*wing/i);
    }
  });

  it('rejects granular assignments that disagree with set-node assignment records', () => {
    const document = taxonomyDocument();
    document.proposals[0]!.patches = [
      { type: 'set-node', node: 'wing-a', value: { taxonomyAssignments: { 'usaf-echelon': 'wing' } } },
      { type: 'set-taxonomy-assignment', node: 'wing-a', taxonomy: 'usaf-echelon', level: 'air-division' },
    ];

    expect(() => resolveView(document, { viewId: 'remove-air-divisions', selectedGroups: [] }))
      .toThrow(/conflicting taxonomy assignment writes/i);
  });

  it('rejects conflicting whole-record taxonomy assignment writes', () => {
    const document = taxonomyDocument();
    document.proposals[0]!.patches = [
      { type: 'set-node', node: 'wing-a', value: { taxonomyAssignments: { 'usaf-echelon': 'wing' } } },
      { type: 'set-node', node: 'wing-a', value: { taxonomyAssignments: { 'usaf-echelon': 'air-division' } } },
    ];

    expect(() => resolveView(document, { viewId: 'remove-air-divisions', selectedGroups: [] }))
      .toThrow(/conflicting taxonomy assignment record writes/i);
  });

  it('retains semantic annotations from taxonomy patches', () => {
    const document = taxonomyDocument();
    document.proposals[0]!.patches = [{
      type: 'set-taxonomy-level',
      taxonomy: 'usaf-echelon',
      level: 'numbered-air-force',
      value: { tier: 'division-equivalent' },
      semantic: 'echelon realignment',
      relatedNodes: ['naf-a', 'naf-b'],
    }];

    const result = resolveView(document, { viewId: 'remove-air-divisions', selectedGroups: [] });

    expect(result.semanticAnnotations).toContainEqual({
      semantic: 'echelon realignment',
      nodes: ['naf-a', 'naf-b'],
      note: undefined,
      sources: undefined,
    });
  });

  it('does not confuse taxonomy IDs that share a prefix', () => {
    const document = taxonomyDocument();
    document.snapshots[0]!.taxonomy!.systems[1]!.levels.push({
      id: 'air-division-reserve',
      label: 'Reserve Air Division',
      tier: 'division-equivalent',
    });
    document.proposals[0]!.patches!.push({
      type: 'set-taxonomy-level',
      taxonomy: 'usaf-echelon',
      level: 'air-division-reserve',
      value: { label: 'Air Reserve Division' },
    });

    const result = resolveView(document, { viewId: 'remove-air-divisions', selectedGroups: [] });

    expect(result.taxonomy.systems[1]?.levels.find(({ id }) => id === 'air-division-reserve')?.label)
      .toBe('Air Reserve Division');
  });

  it('composes adds and sets independent of taxonomy patch order', () => {
    const document = cloneValidDocument();
    delete document.proposals[0]!.patchGroups;
    document.proposals[0]!.patches = [
      { type: 'set-taxonomy-assignment', node: 'usaid', taxonomy: 'usaf', level: 'wing' },
      { type: 'add-taxonomy-level', taxonomy: 'usaf', level: { id: 'wing', label: 'Wing', tier: 'wing' } },
      { type: 'set-taxonomy-system', taxonomy: 'usaf', value: { label: 'Air Force echelon' } },
      { type: 'add-taxonomy-system', taxonomy: { id: 'usaf', label: 'USAF echelon' } },
      { type: 'set-comparison-tier', tier: 'wing', value: { label: 'Wing equivalent' } },
      { type: 'add-comparison-tier', tier: { id: 'wing', label: 'Wing' } },
      { type: 'set-comparison-tier-order', tiers: ['wing'] },
    ];

    const result = resolveView(document, { viewId: 'proposal-a', selectedGroups: [] });

    expect(result.taxonomy.comparisonTiers[0]?.label).toBe('Wing equivalent');
    expect(result.taxonomy.systems[0]?.label).toBe('Air Force echelon');
    expect(result.nodes.get('usaid')?.resolvedTaxonomyAssignments?.[0]?.tierId).toBe('wing');
  });

  it('treats deeply equal taxonomy writes as identical regardless of object key order', () => {
    const document = cloneValidDocument();
    delete document.proposals[0]!.patchGroups;
    document.proposals[0]!.patches = [
      { type: 'add-comparison-tier', tier: { id: 'wing', label: 'Wing', note: 'Equivalent tier' } },
      { type: 'add-comparison-tier', tier: { note: 'Equivalent tier', label: 'Wing', id: 'wing' } },
      { type: 'set-comparison-tier-order', tiers: ['wing'] },
    ];

    const result = resolveView(document, { viewId: 'proposal-a', selectedGroups: [] });

    expect(result.taxonomy.comparisonTiers).toEqual([
      { id: 'wing', label: 'Wing', note: 'Equivalent tier' },
    ]);
  });

  it('orders newly added systems and levels deterministically', () => {
    const documents = [cloneValidDocument(), cloneValidDocument()];
    const patches: DeepMutable<Patch>[] = [
      { type: 'add-comparison-tier', tier: { id: 'unit', label: 'Unit' } },
      { type: 'set-comparison-tier-order', tiers: ['unit'] },
      { type: 'add-taxonomy-system', taxonomy: { id: 'z-system', label: 'Z system' } },
      { type: 'add-taxonomy-system', taxonomy: { id: 'a-system', label: 'A system' } },
      { type: 'add-taxonomy-level', taxonomy: 'z-system', level: { id: 'z-level', label: 'Z level', tier: 'unit' } },
      { type: 'add-taxonomy-level', taxonomy: 'z-system', level: { id: 'a-level', label: 'A level', tier: 'unit' } },
    ];
    for (const [index, document] of documents.entries()) {
      delete document.proposals[0]!.patchGroups;
      document.proposals[0]!.patches = structuredClone(index === 0 ? patches : [...patches].reverse());
    }

    const results = documents.map((document) => resolveView(document, { viewId: 'proposal-a', selectedGroups: [] }));

    expect(results[1]!.taxonomy).toEqual(results[0]!.taxonomy);
    expect(results[0]!.taxonomy.systems.map(({ id }) => id)).toEqual(['a-system', 'z-system']);
    expect(results[0]!.taxonomy.systems[1]!.levels.map(({ id }) => id)).toEqual(['a-level', 'z-level']);
  });
  it('resolves a complete snapshot with inherited definitions without mutating input', () => {
    const document = cloneValidDocument();
    document.nodes.state!.note = 'Default note';
    document.snapshots[0]!.nodes.state = { name: 'State now', metadata: { year: 2026 } };
    const before = structuredClone(document);

    const first = resolveView(document, { viewId: 'current', selectedGroups: [] });
    const second = resolveView(document, { viewId: 'current', selectedGroups: [] });

    expect(first.nodes.get('state')).toMatchObject({
      id: 'state',
      name: 'State now',
      note: 'Default note',
      metadata: { year: 2026 },
    });
    expect(first.parents.get('state-hq')).toEqual({
      parent: 'state',
      relationship: 'internal',
      note: 'Headquarters reports within State',
      sources: [{ label: 'State', url: 'https://www.state.gov/' }],
    });
    expect(first.relationships.get('shared-leadership')).toMatchObject({ id: 'shared-leadership' });
    expect(first.presentation).toEqual({});
    expect(first.nodes).not.toBe(second.nodes);
    expect(first.parents).not.toBe(second.parents);
    expect(first.relationships).not.toBe(second.relationships);
    expect(document).toEqual(before);
  });

  it('resolves nested proposal bases oldest-to-newest', () => {
    const document = cloneValidDocument();
    delete document.proposals[0]!.patchGroups;
    document.proposals[0]!.patches = [
      { type: 'set-node', node: 'state-hr', value: { name: 'People Operations' } },
    ];
    document.proposals.push({
      id: 'proposal-a-v2',
      label: 'Move people operations',
      base: 'proposal-a',
      patches: [
        {
          type: 'set-parent',
          node: 'state-hr',
          parent: 'state',
          relationship: 'subordinate',
        },
      ],
    });

    const result = resolveView(document, { viewId: 'proposal-a-v2', selectedGroups: [] });

    expect(result.nodes.get('state-hr')?.name).toBe('People Operations');
    expect(result.parents.get('state-hr')).toEqual({
      parent: 'state',
      relationship: 'subordinate',
      note: undefined,
      sources: undefined,
    });
  });

  it('lets a proposal snapshot replace state before applying patches', () => {
    const document = cloneValidDocument();
    document.proposals[0]!.snapshot = {
      nodes: { state: {}, 'state-hr': {} },
      hierarchy: [{ child: 'state-hr', parent: 'state', relationship: 'internal' }],
    };
    document.proposals[0]!.patches = [
      { type: 'set-node', node: 'state-hr', value: { name: 'People Team' } },
    ];
    delete document.proposals[0]!.patchGroups;

    const result = resolveView(document, { viewId: 'proposal-a', selectedGroups: [] });

    expect([...result.nodes.keys()]).toEqual(['state', 'state-hr']);
    expect(result.nodes.get('state-hr')?.name).toBe('People Team');
    expect(result.nodes.has('usaid')).toBe(false);
    expect(result.relationships.has('shared-leadership')).toBe(true);
  });

  it('throws an exact contextual error for a missing patch node', () => {
    const document = cloneValidDocument();
    delete document.proposals[0]!.patchGroups;
    document.proposals[0]!.patches = [
      { type: 'set-node', node: 'missing', value: { name: 'Missing' } },
    ];

    expect(() =>
      resolveView(document, { viewId: 'proposal-a', selectedGroups: [] }),
    ).toThrowError(new ResolutionError('proposal-a/patches/0: node "missing" does not exist'));
  });

  it('applies every patch variant and cleans up relationships when removing a node', () => {
    const document = cloneValidDocument();
    document.nodes.new = { name: 'New default', aliases: ['New alias'] };
    document.relationships!.push({
      id: 'headquarters-link',
      type: 'coordination',
      source: 'state-hq',
      target: 'usaid',
      label: 'Coordinates',
    });
    delete document.proposals[0]!.patchGroups;
    const patches: Patch[] = [
      { type: 'add-node', node: 'new', value: { name: 'New override' } },
      { type: 'set-node', node: 'new', value: { note: 'Updated' } },
      {
        type: 'set-parent',
        node: 'new',
        parent: 'state',
        relationship: 'subordinate',
        note: 'Edge note',
        sources: [{ label: 'Edge', url: 'https://example.com/edge' }],
      },
      { type: 'remove-parent', node: 'new' },
      {
        type: 'add-relationship',
        relationship: {
          id: 'new-link',
          type: 'coordination',
          source: 'new',
          target: 'state-hr',
          label: 'Coordinates',
        },
      },
      {
        type: 'set-relationship',
        relationship: 'new-link',
        value: { label: 'Works with', target: 'usaid' },
      },
      { type: 'remove-relationship', relationship: 'new-link' },
      { type: 'remove-node', node: 'state-hq' },
    ];
    document.proposals[0]!.patches = patches as NonNullable<
      (typeof document.proposals)[number]['patches']
    >;

    const result = resolveView(document, { viewId: 'proposal-a', selectedGroups: [] });

    expect(result.nodes.get('new')).toMatchObject({
      id: 'new',
      name: 'New override',
      aliases: ['New alias'],
      note: 'Updated',
    });
    expect(result.parents.has('new')).toBe(false);
    expect(result.nodes.has('state-hq')).toBe(false);
    expect(result.parents.has('state-hr')).toBe(false);
    expect(result.relationships.has('new-link')).toBe(false);
    expect(result.relationships.has('headquarters-link')).toBe(false);
  });

  it('rejects a hierarchy cycle at the patch that introduces it', () => {
    const document = cloneValidDocument();
    delete document.proposals[0]!.patchGroups;
    document.proposals[0]!.patches = [
      { type: 'set-parent', node: 'state', parent: 'state-hr', relationship: 'internal' },
      { type: 'set-node', node: 'usaid', value: { name: 'Unrelated rename' } },
    ];

    expect(() =>
      resolveView(document, { viewId: 'proposal-a', selectedGroups: [] }),
    ).toThrowError('proposal-a/patches/0: hierarchy contains a cycle');
  });

  it('resolves 5,000 node renames without rescanning the hierarchy per patch', () => {
    const count = 5_000;
    const nodes = Object.fromEntries(
      Array.from({ length: count }, (_, index) => [`node-${index}`, { name: `Node ${index}` }]),
    );
    const document: OrgDocument = {
      title: 'Large chart',
      nodes,
      snapshots: [
        {
          id: 'current',
          label: 'Current',
          nodes: Object.fromEntries(Object.keys(nodes).map((id) => [id, {}])),
          hierarchy: Array.from({ length: count - 1 }, (_, index) => ({
            child: `node-${index + 1}`,
            parent: `node-${index}`,
            relationship: 'internal' as const,
          })),
        },
      ],
      proposals: [
        {
          id: 'renamed',
          label: 'Renamed',
          base: 'current',
          patches: Array.from({ length: count }, (_, index) => ({
            type: 'set-node' as const,
            node: `node-${index}`,
            value: { name: `Renamed ${index}` },
          })),
        },
      ],
    };

    const start = performance.now();
    const result = resolveView(document, { viewId: 'renamed', selectedGroups: [] });
    const duration = performance.now() - start;

    expect(result.nodes.get('node-4999')?.name).toBe('Renamed 4999');
    expect(duration).toBeLessThan(1_000);
  });

  it('creates deduplicated semantic annotations including relationship endpoints', () => {
    const document = cloneValidDocument();
    delete document.proposals[0]!.patchGroups;
    document.proposals[0]!.patches = [
      {
        type: 'set-node',
        node: 'usaid',
        value: {},
        semantic: 'merge',
        relatedNodes: ['usaid', 'state', 'state'],
      },
      {
        type: 'set-relationship',
        relationship: 'shared-leadership',
        value: {},
        semantic: 'coordination',
        relatedNodes: ['state'],
      },
    ];

    const result = resolveView(document, { viewId: 'proposal-a', selectedGroups: [] });

    expect(result.semanticAnnotations).toEqual([
      { semantic: 'merge', nodes: ['usaid', 'state'], note: undefined, sources: undefined },
      {
        semantic: 'coordination',
        nodes: ['state', 'usaid'],
        note: undefined,
        sources: undefined,
      },
    ]);
  });

  it('preserves relationship map key and stable ID when setting a relationship', () => {
    const document = cloneValidDocument();
    delete document.proposals[0]!.patchGroups;
    document.proposals[0]!.patches = [
      {
        type: 'set-relationship',
        relationship: 'shared-leadership',
        value: {
          id: 'replacement-id',
          label: 'Updated leadership',
        } as { label: string },
      },
    ];

    const result = resolveView(document, { viewId: 'proposal-a', selectedGroups: [] });

    expect(result.relationships.has('replacement-id')).toBe(false);
    expect(result.relationships.get('shared-leadership')).toMatchObject({
      id: 'shared-leadership',
      label: 'Updated leadership',
    });
  });

  it('deep-clones all nested input values across repeated resolutions', () => {
    const document = cloneValidDocument();
    document.nodes.state = {
      name: 'Department of State',
      aliases: ['State Department'],
      symbol: { type: 'image', url: 'https://example.com/state.svg', alt: 'State seal' },
      leadership: [
        {
          id: 'state-commander',
          title: 'Commander',
          authorizedRank: { label: 'Colonel', marker: { type: 'bundled', id: 'usaf-o6' } },
          occupant: {
            name: 'Alex Example',
            rank: { label: 'Lieutenant Colonel', marker: { type: 'bundled', id: 'usaf-o5' } },
            acting: true,
          },
          vacant: true,
        } as never,
      ],
    };
    document.relationships![0]!.sources = [
      { label: 'Relationship source', url: 'https://example.com/relationship' },
    ];
    document.presentation = { initialExpansionDepth: 2, focusNodes: ['state'] };
    delete document.proposals[0]!.patchGroups;
    document.proposals[0]!.patches = [
      {
        type: 'set-node',
        node: 'state',
        value: {
          metadata: { budget: 10 },
          sources: [{ label: 'Node source', url: 'https://example.com/node' }],
        },
        semantic: 'updated',
        relatedNodes: ['usaid'],
        sources: [{ label: 'Patch source', url: 'https://example.com/patch' }],
      },
    ];
    const before = structuredClone(document);

    const first = resolveView(document, { viewId: 'proposal-a', selectedGroups: [] });
    const node = first.nodes.get('state')! as unknown as {
      aliases: string[];
      symbol: { alt: string };
      leadership: Array<{
        title: string;
        authorizedRank: { label: string; marker: { id: string } };
        occupant: { name: string; rank: { label: string }; acting: boolean };
      }>;
      metadata: Record<string, number>;
      sources: { label: string }[];
    };
    node.aliases.push('Mutated alias');
    node.symbol.alt = 'Mutated symbol';
    node.leadership[0]!.title = 'Mutated title';
    node.leadership[0]!.authorizedRank.marker.id = 'mutated-marker';
    node.leadership[0]!.occupant.rank.label = 'Mutated rank';
    node.metadata.budget = 99;
    node.sources[0]!.label = 'Mutated node source';
    (first.parents.get('state-hq')!.sources as unknown as { label: string }[])[0]!.label =
      'Mutated edge source';
    (
      first.relationships.get('shared-leadership')!.sources as unknown as { label: string }[]
    )[0]!.label = 'Mutated relationship source';
    (first.semanticAnnotations[0]!.nodes as string[]).push('state-hq');
    (first.semanticAnnotations[0]!.sources as unknown as { label: string }[])[0]!.label =
      'Mutated patch source';
    (first.presentation.focusNodes as string[]).push('usaid');

    const second = resolveView(document, { viewId: 'proposal-a', selectedGroups: [] });

    expect(document).toEqual(before);
    expect(second.nodes.get('state')).toMatchObject({
      aliases: ['State Department'],
      symbol: { alt: 'State seal' },
      leadership: [
        {
          title: 'Commander',
          authorizedRank: { marker: { id: 'usaf-o6' } },
          occupant: { rank: { label: 'Lieutenant Colonel' } },
        },
      ],
      metadata: { budget: 10 },
      sources: [{ label: 'Node source' }],
    });
    expect(second.parents.get('state-hq')?.sources?.[0]?.label).toBe('State');
    expect(second.relationships.get('shared-leadership')?.sources?.[0]?.label).toBe(
      'Relationship source',
    );
    expect(second.semanticAnnotations[0]).toMatchObject({
      nodes: ['state', 'usaid'],
      sources: [{ label: 'Patch source' }],
    });
    expect(second.presentation.focusNodes).toEqual(['state']);
  });

  it('replaces leadership through set-node patches', () => {
    const document = cloneValidDocument();
    document.nodes.state = {
      name: document.nodes.state!.name,
      ...document.nodes.state,
      leadership: [{ id: 'wing-do', title: 'Director of Operations' }] as never,
    };
    delete document.proposals[0]!.patchGroups;
    document.proposals[0]!.patches = [
      {
        type: 'set-node',
        node: 'state',
        value: {
          leadership: [
            {
              id: 'wing-do',
              title: 'Commander',
              authorizedRank: { label: 'O-5', marker: { type: 'bundled', id: 'usaf-o5' } },
            },
          ],
        } as never,
      },
    ];

    const result = resolveView(document, { viewId: 'proposal-a', selectedGroups: [] });

    expect(result.nodes.get('state')?.leadership).toEqual([
      {
        id: 'wing-do',
        title: 'Commander',
        authorizedRank: { label: 'O-5', marker: { type: 'bundled', id: 'usaf-o5' } },
      },
    ]);
  });

  it('applies explicitly selected groups in document order', () => {
    const document = cloneValidDocument();
    document.proposals[0]!.patchGroups = [
      {
        id: 'selected-late-name',
        label: 'Selected',
        patches: [{ type: 'set-node', node: 'usaid', value: { note: 'Selected' } }],
      },
      {
        id: 'unselected',
        label: 'Unselected',
        patches: [{ type: 'set-node', node: 'usaid', value: { note: 'Do not apply' } }],
      },
      {
        id: 'locked-final-name',
        label: 'Locked',
        locked: true,
        patches: [{ type: 'set-node', node: 'usaid', value: { name: 'Locked' } }],
      },
    ];

    const result = resolveView(document, {
      viewId: 'proposal-a',
      selectedGroups: ['selected-late-name', 'locked-final-name'],
    });

    expect(result.nodes.get('usaid')?.name).toBe('Locked');
    expect(result.nodes.get('usaid')?.note).toBe('Selected');
    expect(() =>
      resolveView(document, { viewId: 'proposal-a', selectedGroups: ['missing-group'] }),
    ).toThrowError('proposal-a/patchGroups: group "missing-group" does not exist');
  });

  it('resolves a 15,000-proposal chain without overflowing', () => {
    const document = cloneValidDocument();
    document.proposals = Array.from({ length: 15_000 }, (_, index) => ({
      id: `proposal-${index}`,
      label: `Proposal ${index}`,
      base: index === 0 ? 'current' : `proposal-${index - 1}`,
      patches:
        index === 14_999
          ? [{ type: 'set-node' as const, node: 'state', value: { name: 'Final State' } }]
          : [],
    }));

    const result = resolveView(document, {
      viewId: 'proposal-14999',
      selectedGroups: [],
    });

    expect(result.nodes.get('state')?.name).toBe('Final State');
  });

  it('reports an unknown view contextually', () => {
    expect(() =>
      resolveView(cloneValidDocument(), { viewId: 'missing', selectedGroups: [] }),
    ).toThrowError('view "missing" does not exist');
  });

  it('rejects group selections for a snapshot view', () => {
    expect(() =>
      resolveView(cloneValidDocument(), {
        viewId: 'current',
        selectedGroups: ['shared-leadership-group'],
      }),
    ).toThrowError('current/patchGroups: group "shared-leadership-group" does not exist');
  });

  it('reports unsupported runtime patches with their exact group patch path', () => {
    const document = cloneValidDocument();
    document.proposals[0]!.patchGroups = [
      {
        id: 'unknown-patch-group',
        label: 'Unknown patch',
        patches: [{ type: 'unknown-patch' } as never],
      },
    ];

    expect(() =>
      resolveView(document, {
        viewId: 'proposal-a',
        selectedGroups: ['unknown-patch-group'],
      }),
    ).toThrowError(
      new ResolutionError(
        'proposal-a/patchGroups/0/patches/0: unsupported patch type "unknown-patch"',
      ),
    );
  });

  it('reports null runtime patches with an escaped proposal path', () => {
    const document = cloneValidDocument();
    document.proposals[0]!.id = 'proposal~/runtime';
    delete document.proposals[0]!.patchGroups;
    document.proposals[0]!.patches = [null as never];

    expect(() =>
      resolveView(document, { viewId: 'proposal~/runtime', selectedGroups: [] }),
    ).toThrowError(
      new ResolutionError('proposal~0~1runtime/patches/0: patch must be an object'),
    );
  });

  it('reports null add-relationship payloads contextually', () => {
    const document = cloneValidDocument();
    delete document.proposals[0]!.patchGroups;
    document.proposals[0]!.patches = [
      { type: 'add-relationship', relationship: null } as never,
    ];

    expect(() =>
      resolveView(document, { viewId: 'proposal-a', selectedGroups: [] }),
    ).toThrowError(
      new ResolutionError('proposal-a/patches/0: relationship must be an object'),
    );
  });

  it('reports null set-relationship values contextually', () => {
    const document = cloneValidDocument();
    delete document.proposals[0]!.patchGroups;
    document.proposals[0]!.patches = [
      {
        type: 'set-relationship',
        relationship: 'shared-leadership',
        value: null,
      } as never,
    ];

    expect(() =>
      resolveView(document, { viewId: 'proposal-a', selectedGroups: [] }),
    ).toThrowError(
      new ResolutionError('proposal-a/patches/0: relationship value must be an object'),
    );
  });

  it('rejects null proposal patch lists contextually', () => {
    const document = cloneValidDocument();
    delete document.proposals[0]!.patchGroups;
    document.proposals[0]!.patches = null as never;

    expect(() =>
      resolveView(document, { viewId: 'proposal-a', selectedGroups: [] }),
    ).toThrowError(new ResolutionError('proposal-a/patches: patches must be an array'));
  });

  it.each([
    ['object', {}, false],
    ['string', 'not-a-list', true],
  ])('rejects %s patch-group patch lists contextually', (_kind, patches, selected) => {
    const document = cloneValidDocument();
    document.proposals[0]!.patchGroups = [
      {
        id: 'invalid-list',
        label: 'Invalid list',
        patches: patches as never,
      },
    ];

    expect(() =>
      resolveView(document, {
        viewId: 'proposal-a',
        selectedGroups: selected ? ['invalid-list'] : [],
      }),
    ).toThrowError(
      new ResolutionError(
        'proposal-a/patchGroups/0/patches: patches must be an array',
      ),
    );
  });
});
