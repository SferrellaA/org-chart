import { describe, expect, it } from 'vitest';

import { validateDocument } from '../src/model/validate';
import type { OrgDocument, Proposal } from '../src/model/types';
import { cloneValidDocument, validDocument, type DeepMutable } from './fixtures';

function renameUsaid(document: DeepMutable<OrgDocument>, id: string): void {
  document.nodes[id] = document.nodes.usaid!;
  delete document.nodes.usaid;
  for (const snapshot of document.snapshots) {
    snapshot.nodes[id] = snapshot.nodes.usaid!;
    delete snapshot.nodes.usaid;
    for (const edge of snapshot.hierarchy) {
      if (edge.child === 'usaid') edge.child = id;
      if (edge.parent === 'usaid') edge.parent = id;
    }
  }
  const patch = document.proposals[0]!.patchGroups![0]!.patches[0]!;
  if (!('node' in patch)) throw new Error('Expected node patch in fixture');
  patch.node = id;
  patch.relatedNodes = ['state'];
  document.relationships![0]!.target = id;
}

describe('validateDocument', () => {
  it('accepts the reusable valid document without view errors', () => {
    expect(validateDocument(validDocument)).toEqual({
      ok: true,
      value: validDocument,
      viewErrors: new Map(),
    });
  });

  it('accepts a root $schema identifier', () => {
    const document = cloneValidDocument() as unknown as Record<string, unknown>;
    document.$schema = 'https://example.com/org-chart.schema.json';

    expect(validateDocument(document).ok).toBe(true);
  });

  it.each(['ID with spaces', '組織/部門', `quoted "ID" -> next`])(
    'accepts printable stable IDs and matching references: %s',
    (id) => {
      const document = cloneValidDocument();
      renameUsaid(document, `${id} node`);
      document.snapshots[0]!.id = `${id} snapshot`;
      document.proposals[0]!.base = `${id} snapshot`;

      expect(validateDocument(document)).toEqual({
        ok: true,
        value: document,
        viewErrors: new Map(),
      });
    },
  );

  it.each(['\u0000', '\u001f', '\u007f'])(
    'rejects U+%s in every stable ID category and matching references',
    (control) => {
      const documents: DeepMutable<OrgDocument>[] = [];

      const node = cloneValidDocument();
      renameUsaid(node, `bad${control}node`);
      documents.push(node);

      const snapshot = cloneValidDocument();
      snapshot.snapshots[0]!.id = `bad${control}snapshot`;
      snapshot.proposals[0]!.base = `bad${control}snapshot`;
      documents.push(snapshot);

      const proposal = cloneValidDocument();
      proposal.proposals[0]!.id = `bad${control}proposal`;
      documents.push(proposal);

      const relationship = cloneValidDocument();
      relationship.relationships![0]!.id = `bad${control}relationship`;
      documents.push(relationship);

      const patchGroup = cloneValidDocument();
      patchGroup.proposals[0]!.patchGroups![0]!.id = `bad${control}group`;
      documents.push(patchGroup);

      const zone = cloneValidDocument();
      zone.zones = [{ id: `bad${control}zone`, label: 'Zone', nodes: ['state'] }];
      documents.push(zone);

      for (const document of documents) expect(validateDocument(document).ok).toBe(false);
    },
  );

  it('accepts proposal snapshot replacements', () => {
    const document = cloneValidDocument();
    document.proposals[0]!.snapshot = {
      nodes: structuredClone(document.snapshots[0]!.nodes),
      hierarchy: structuredClone(document.snapshots[0]!.hierarchy),
    };

    const result = validateDocument(document);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.viewErrors.size).toBe(0);
  });

  it('accepts every exact public wire patch shape', () => {
    const document = cloneValidDocument();
    delete document.proposals[0]!.patchGroups;
    document.proposals[0]!.patches = [
      { type: 'add-node', node: 'usaid' },
      { type: 'remove-node', node: 'usaid' },
      { type: 'set-node', node: 'usaid', value: { name: 'USAID' } },
      {
        type: 'set-parent',
        node: 'usaid',
        parent: 'state-hq',
        relationship: 'subordinate',
      },
      { type: 'remove-parent', node: 'usaid' },
      {
        type: 'add-relationship',
        relationship: {
          id: 'coordination',
          type: 'coordination',
          source: 'state',
          target: 'usaid',
          label: 'Coordinates with',
        },
      },
      {
        type: 'set-relationship',
        relationship: 'shared-leadership',
        value: { label: 'Joint leadership' },
      },
      { type: 'remove-relationship', relationship: 'shared-leadership' },
    ];

    const result = validateDocument(document);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.viewErrors.size).toBe(0);
  });

  it('accepts leadership billets with authorized and occupant rank markers', () => {
    const document = cloneValidDocument() as unknown as Record<string, unknown>;
    const typed = document as DeepMutable<OrgDocument>;
    typed.nodes.state = {
      ...typed.nodes.state!,
      leadership: [
        {
          id: 'wing-commander',
          title: 'Commander',
          authorizedRank: { label: 'Colonel', marker: { type: 'bundled', id: 'usaf-o6' } },
          occupant: {
            name: 'Alex Example',
            rank: { label: 'Lieutenant Colonel', marker: { type: 'bundled', id: 'usaf-o5' } },
            acting: true,
          },
          vacant: true,
        } as never,
        {
          title: 'Civilian Director',
          authorizedRank: {
            marker: { type: 'image', url: 'https://example.com/ses.svg', alt: 'SES' },
          },
        } as never,
        { authorizedRank: { marker: { type: 'text', text: 'GS-15' } } } as never,
        { authorizedRank: { marker: { type: 'emoji', emoji: '★', label: 'star' } } } as never,
      ],
    };

    const result = validateDocument(document);

    expect(result).toEqual({ ok: true, value: document, viewErrors: new Map() });
  });

  it('rejects empty leadership billets and unsafe marker values', () => {
    const empty = cloneValidDocument() as unknown as Record<string, unknown>;
    (empty as DeepMutable<OrgDocument>).nodes.state = {
      ...(empty as DeepMutable<OrgDocument>).nodes.state!,
      leadership: [{} as never],
    };
    expect(validateDocument(empty).ok).toBe(false);

    const unsafeImage = cloneValidDocument() as unknown as Record<string, unknown>;
    (unsafeImage as DeepMutable<OrgDocument>).nodes.state = {
      ...(unsafeImage as DeepMutable<OrgDocument>).nodes.state!,
      leadership: [
        {
          authorizedRank: {
            marker: { type: 'image', url: 'javascript:alert(1)', alt: 'bad' },
          },
        } as never,
      ],
    };
    expect(validateDocument(unsafeImage).ok).toBe(false);
  });

  it('rejects unknown bundled marker IDs and duplicate resolved billet IDs', () => {
    const unknownMarker = cloneValidDocument() as unknown as Record<string, unknown>;
    (unknownMarker as DeepMutable<OrgDocument>).nodes.state = {
      ...(unknownMarker as DeepMutable<OrgDocument>).nodes.state!,
      leadership: [
        { authorizedRank: { marker: { type: 'bundled', id: 'missing-rank' } } } as never,
      ],
    };
    expect(validateDocument(unknownMarker)).toEqual({
      ok: false,
      errors: ['nodes/state/leadership/0/authorizedRank/marker/id: unknown bundled marker "missing-rank"'],
    });

    const duplicate = cloneValidDocument() as unknown as Record<string, unknown>;
    const document = duplicate as DeepMutable<OrgDocument>;
    document.proposals[0]!.patches = [
      {
        type: 'set-node',
        node: 'usaid',
        value: { leadership: [{ id: 'shared-billet', title: 'Commander' }] } as never,
      },
      {
        type: 'set-node',
        node: 'state',
        value: { leadership: [{ id: 'shared-billet', title: 'Director' }] } as never,
      },
    ];
    delete document.proposals[0]!.patchGroups;

    const result = validateDocument(duplicate);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.viewErrors.get('proposal-a')).toContain(
        'proposal/proposal-a/resolved/leadership: duplicate billet ID "shared-billet" on nodes "state" and "usaid"',
      );
    }
  });

  it('tracks added relationships for later set and remove patches', () => {
    const document = cloneValidDocument();
    delete document.proposals[0]!.patchGroups;
    document.proposals[0]!.patches = [
      {
        type: 'add-relationship',
        relationship: {
          id: 'new-relationship',
          type: 'coordination',
          source: 'state',
          target: 'usaid',
          label: 'Coordinates with',
        },
      },
      {
        type: 'set-relationship',
        relationship: 'new-relationship',
        value: { label: 'Works with' },
      },
      { type: 'remove-relationship', relationship: 'new-relationship' },
    ];

    const result = validateDocument(document);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.viewErrors.size).toBe(0);
  });

  it('carries relationship state from a base proposal to its descendant', () => {
    const document = cloneValidDocument();
    delete document.proposals[0]!.patchGroups;
    document.proposals[0]!.patches = [
      {
        type: 'add-relationship',
        relationship: {
          id: 'base-relationship',
          type: 'coordination',
          source: 'state',
          target: 'usaid',
          label: 'Coordinates with',
        },
      },
    ];
    document.proposals.push({
      id: 'proposal-b',
      label: 'Descendant proposal',
      base: 'proposal-a',
      patches: [
        {
          type: 'set-relationship',
          relationship: 'base-relationship',
          value: { label: 'Works with' },
        },
        { type: 'remove-relationship', relationship: 'base-relationship' },
      ],
    });

    const result = validateDocument(document);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.viewErrors.size).toBe(0);
  });

  it('does not let an unselected prior group supply a relationship ID', () => {
    const document = cloneValidDocument();
    document.proposals[0]!.patchGroups = [
      {
        id: 'relationship-addition',
        label: 'Add relationship',
        patches: [
          {
            type: 'add-relationship',
            relationship: {
              id: 'group-relationship',
              type: 'coordination',
              source: 'state',
              target: 'usaid',
              label: 'Coordinates with',
            },
          },
        ],
      },
      {
        id: 'relationship-update',
        label: 'Update relationship',
        patches: [
          {
            type: 'set-relationship',
            relationship: 'group-relationship',
            value: { label: 'Works with' },
          },
          { type: 'remove-relationship', relationship: 'group-relationship' },
        ],
      },
    ];

    const result = validateDocument(document);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.viewErrors.get('proposal-a')?.join('\n')).toMatch(
        /patchGroups\/1.*unknown relationship "group-relationship"/i,
      );
    }
  });

  it('lets a declared group requirement supply a relationship ID', () => {
    const document = cloneValidDocument();
    document.proposals[0]!.patchGroups = [
      {
        id: 'relationship-addition',
        label: 'Add relationship',
        patches: [
          {
            type: 'add-relationship',
            relationship: {
              id: 'group-relationship',
              type: 'coordination',
              source: 'state',
              target: 'usaid',
              label: 'Coordinates with',
            },
          },
        ],
      },
      {
        id: 'relationship-update',
        label: 'Update relationship',
        requires: ['relationship-addition'],
        patches: [
          {
            type: 'set-relationship',
            relationship: 'group-relationship',
            value: { label: 'Works with' },
          },
        ],
      },
    ];

    const result = validateDocument(document);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.viewErrors.size).toBe(0);
  });

  it('does not reorder a later required group before its dependent', () => {
    const document = cloneValidDocument();
    document.proposals[0]!.patchGroups = [
      {
        id: 'relationship-update',
        label: 'Update relationship',
        requires: ['relationship-addition'],
        patches: [
          {
            type: 'set-relationship',
            relationship: 'later-relationship',
            value: { label: 'Works with' },
          },
        ],
      },
      {
        id: 'relationship-addition',
        label: 'Add relationship later',
        patches: [
          {
            type: 'add-relationship',
            relationship: {
              id: 'later-relationship',
              type: 'coordination',
              source: 'state',
              target: 'usaid',
              label: 'Coordinates with',
            },
          },
        ],
      },
    ];

    const result = validateDocument(document);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.viewErrors.get('proposal-a')?.join('\n')).toMatch(
        /patchGroups\/0.*unknown relationship "later-relationship"/i,
      );
    }
  });

  it('does not pre-apply a later locked group for an earlier optional group', () => {
    const document = cloneValidDocument();
    document.proposals[0]!.patchGroups = [
      {
        id: 'early-optional-update',
        label: 'Early optional update',
        patches: [
          {
            type: 'set-relationship',
            relationship: 'later-locked-relationship',
            value: { label: 'Works with' },
          },
        ],
      },
      {
        id: 'later-locked-addition',
        label: 'Later locked addition',
        locked: true,
        patches: [
          {
            type: 'add-relationship',
            relationship: {
              id: 'later-locked-relationship',
              type: 'coordination',
              source: 'state',
              target: 'usaid',
              label: 'Coordinates with',
            },
          },
        ],
      },
    ];

    const result = validateDocument(document);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.viewErrors.get('proposal-a')?.join('\n')).toMatch(
        /patchGroups\/0.*unknown relationship "later-locked-relationship"/i,
      );
    }
  });

  it('inherits relationships from locked groups in a base proposal', () => {
    const document = cloneValidDocument();
    document.proposals[0]!.patchGroups = [
      {
        id: 'locked-relationship',
        label: 'Guaranteed relationship',
        locked: true,
        patches: [
          {
            type: 'add-relationship',
            relationship: {
              id: 'locked-base-relationship',
              type: 'coordination',
              source: 'state',
              target: 'usaid',
              label: 'Coordinates with',
            },
          },
        ],
      },
    ];
    document.proposals.push({
      id: 'proposal-b',
      label: 'Descendant proposal',
      base: 'proposal-a',
      patches: [
        {
          type: 'set-relationship',
          relationship: 'locked-base-relationship',
          value: { label: 'Works with' },
        },
      ],
    });

    const result = validateDocument(document);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.viewErrors.size).toBe(0);
  });

  it('does not reapply a locked group required by an optional group', () => {
    const document = cloneValidDocument();
    document.proposals[0]!.patchGroups = [
      {
        id: 'locked-relationship',
        label: 'Guaranteed relationship',
        locked: true,
        patches: [
          {
            type: 'add-relationship',
            relationship: {
              id: 'locked-relationship-id',
              type: 'coordination',
              source: 'state',
              target: 'usaid',
              label: 'Coordinates with',
            },
          },
        ],
      },
      {
        id: 'optional-update',
        label: 'Optional update',
        requires: ['locked-relationship'],
        patches: [
          {
            type: 'set-relationship',
            relationship: 'locked-relationship-id',
            value: { label: 'Works with' },
          },
        ],
      },
    ];

    const result = validateDocument(document);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.viewErrors.size).toBe(0);
  });

  it('validates a 15,000-group dependency chain without overflowing', () => {
    const document = cloneValidDocument();
    document.proposals[0]!.patchGroups = Array.from(
      { length: 15_000 },
      (_, index) => ({
        id: `group-${index}`,
        label: `Group ${index}`,
        patches: [],
        ...(index === 14_999 ? {} : { requires: [`group-${index + 1}`] }),
      }),
    );

    let result: ReturnType<typeof validateDocument> | undefined;
    expect(() => {
      result = validateDocument(document);
    }).not.toThrow();
    expect(result?.ok).toBe(true);
  });

  it('validates a 15,000-proposal base chain without overflowing', () => {
    const document = cloneValidDocument();
    document.proposals = Array.from({ length: 15_000 }, (_, index) => ({
      id: `proposal-${index}`,
      label: `Proposal ${index}`,
      base: index === 14_999 ? 'current' : `proposal-${index + 1}`,
    }));

    let result: ReturnType<typeof validateDocument> | undefined;
    expect(() => {
      result = validateDocument(document);
    }).not.toThrow();
    expect(result?.ok).toBe(true);
    if (result?.ok) expect(result.viewErrors.size).toBe(0);
  });

  it('rejects empty relationship replacements', () => {
    const document = cloneValidDocument();
    delete document.proposals[0]!.patchGroups;
    document.proposals[0]!.patches = [
      {
        type: 'set-relationship',
        relationship: 'shared-leadership',
        value: {},
      },
    ];

    const result = validateDocument(document);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join('\n')).toMatch(/fewer than 1 propert/i);
  });

  it('rejects relationship ID replacements', () => {
    const document = cloneValidDocument() as unknown as Record<string, unknown>;
    const proposals = document.proposals as Array<Record<string, unknown>>;
    delete proposals[0]!.patchGroups;
    proposals[0]!.patches = [
      {
        type: 'set-relationship',
        relationship: 'shared-leadership',
        value: { id: 'renamed-relationship' },
      },
    ];

    const result = validateDocument(document);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join('\n')).toMatch(/value.*additional properties/i);
  });

  it('reports duplicate added relationship IDs in the proposal view', () => {
    const document = cloneValidDocument();
    delete document.proposals[0]!.patchGroups;
    const relationship = {
      id: 'new-relationship',
      type: 'coordination',
      source: 'state',
      target: 'usaid',
      label: 'Coordinates with',
    };
    document.proposals[0]!.patches = [
      { type: 'add-relationship', relationship },
      { type: 'add-relationship', relationship },
    ];

    const result = validateDocument(document);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.viewErrors.get('proposal-a')?.join('\n')).toMatch(
        /duplicate.*new-relationship/i,
      );
    }
  });

  it('reports duplicate relationship IDs introduced by separate optional groups', () => {
    const document = cloneValidDocument();
    const relationship = {
      id: 'duplicate-group-relationship',
      type: 'coordination',
      source: 'state',
      target: 'usaid',
      label: 'Coordinates with',
    };
    document.proposals[0]!.patchGroups = [
      {
        id: 'first-addition',
        label: 'First addition',
        patches: [{ type: 'add-relationship', relationship }],
      },
      {
        id: 'second-addition',
        label: 'Second addition',
        patches: [{ type: 'add-relationship', relationship }],
      },
    ];

    const result = validateDocument(document);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.viewErrors.get('proposal-a')?.join('\n')).toMatch(
        /duplicate.*duplicate-group-relationship/i,
      );
    }
  });

  it('reports duplicate relationship IDs introduced by separate proposals', () => {
    const document = cloneValidDocument();
    delete document.proposals[0]!.patchGroups;
    const relationship = {
      id: 'cross-proposal-relationship',
      type: 'coordination',
      source: 'state',
      target: 'usaid',
      label: 'Coordinates with',
    };
    document.proposals[0]!.patches = [
      { type: 'add-relationship', relationship },
    ];
    document.proposals.push({
      id: 'proposal-b',
      label: 'Separate branch',
      base: 'current',
      patches: [{ type: 'add-relationship', relationship }],
    });

    const result = validateDocument(document);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.viewErrors.get('proposal-b')?.join('\n')).toMatch(
        /duplicate.*cross-proposal-relationship/i,
      );
    }
  });

  it('makes an unknown snapshot hierarchy child fatal', () => {
    const document = cloneValidDocument();
    document.snapshots[0]!.hierarchy[0]!.child = 'missing';

    const result = validateDocument(document);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join('\n')).toMatch(/current.*missing/i);
  });

  it.each([
    ['global node map', (document: DeepMutable<OrgDocument>) => {
      document.nodes[''] = { name: 'Empty ID' };
    }],
    ['snapshot node map', (document: DeepMutable<OrgDocument>) => {
      document.snapshots[0]!.nodes[''] = {};
    }],
    ['proposal snapshot node map', (document: DeepMutable<OrgDocument>) => {
      document.proposals[0]!.snapshot = { nodes: { '': {} }, hierarchy: [] };
    }],
  ])('rejects empty IDs in the %s', (_label, mutate) => {
    const document = cloneValidDocument();
    mutate(document);

    const result = validateDocument(document);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.join('\n')).toMatch(/fewer than 1[\s\S]*property name/i);
    }
  });

  it('uses sorted escaped snapshot node keys in semantic error paths', () => {
    const first = cloneValidDocument();
    first.snapshots[0]!.nodes['z/key'] = {};
    first.snapshots[0]!.nodes['a~key'] = {};
    const second = cloneValidDocument();
    second.snapshots[0]!.nodes['a~key'] = {};
    second.snapshots[0]!.nodes['z/key'] = {};

    const firstResult = validateDocument(first);
    const secondResult = validateDocument(second);

    expect(firstResult.ok).toBe(false);
    expect(secondResult.ok).toBe(false);
    if (!firstResult.ok && !secondResult.ok) {
      expect(firstResult.errors).toEqual(secondResult.errors);
      expect(firstResult.errors.join('\n')).toMatch(/nodes\/a~0key.*a~key/i);
      expect(firstResult.errors.join('\n')).toMatch(/nodes\/z~1key.*z\/key/i);
    }
  });

  it('keeps proposal base cycles confined to affected proposal views', () => {
    const document = cloneValidDocument();
    document.proposals.push({
      id: 'proposal-b',
      label: 'Second proposal',
      base: 'proposal-a',
    });
    document.proposals[0]!.base = 'proposal-b';

    const result = validateDocument(document);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.viewErrors.get('proposal-a')?.join('\n')).toMatch(/base cycle/i);
      expect(result.viewErrors.get('proposal-b')?.join('\n')).toMatch(/base cycle/i);
    }
  });

  it('reports every disconnected proposal base cycle', () => {
    const document = cloneValidDocument();
    document.proposals = [
      { id: 'proposal-a', label: 'A', base: 'proposal-b' },
      { id: 'proposal-b', label: 'B', base: 'proposal-a' },
      { id: 'proposal-c', label: 'C', base: 'proposal-d' },
      { id: 'proposal-d', label: 'D', base: 'proposal-c' },
    ];

    const result = validateDocument(document);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect([...result.viewErrors.keys()].sort()).toEqual([
        'proposal-a',
        'proposal-b',
        'proposal-c',
        'proposal-d',
      ]);
    }
  });

  it('rejects IDs duplicated across global collections', () => {
    const document = cloneValidDocument();
    document.proposals[0]!.id = 'current';

    const result = validateDocument(document);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join('\n')).toMatch(/duplicate.*current/i);
  });

  it('rejects snapshot hierarchy cycles', () => {
    const document = cloneValidDocument();
    document.snapshots[0]!.hierarchy.push({
      child: 'state',
      parent: 'state-hr',
      relationship: 'internal',
    });

    const result = validateDocument(document);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join('\n')).toMatch(/current.*cycle/i);
  });

  it('reports asymmetric patch-group conflicts in the proposal view', () => {
    const document = cloneValidDocument();
    const proposal = document.proposals[0]!;
    proposal.patchGroups!.push({
      id: 'alternate-group',
      label: 'Alternate',
      patches: [],
      conflictsWith: ['shared-leadership-group'],
    });

    const result = validateDocument(document);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.viewErrors.get('proposal-a')?.join('\n')).toMatch(
        /conflict.*symmetric/i,
      );
    }
  });

  it('reports patch-group dependency cycles in the proposal view', () => {
    const document = cloneValidDocument();
    const proposal = document.proposals[0]!;
    proposal.patchGroups![0]!.requires = ['alternate-group'];
    proposal.patchGroups!.push({
      id: 'alternate-group',
      label: 'Alternate',
      patches: [],
      requires: ['shared-leadership-group'],
    });

    const result = validateDocument(document);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.viewErrors.get('proposal-a')?.join('\n')).toMatch(
        /dependency cycle/i,
      );
    }
  });

  it('reports groups that both require and conflict with the same group', () => {
    const document = cloneValidDocument();
    const group = document.proposals[0]!.patchGroups![0]!;
    group.requires = ['alternate-group'];
    group.conflictsWith = ['alternate-group'];
    document.proposals[0]!.patchGroups!.push({
      id: 'alternate-group',
      label: 'Alternate',
      patches: [],
      conflictsWith: ['shared-leadership-group'],
    });

    const result = validateDocument(document);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.viewErrors.get('proposal-a')?.join('\n')).toMatch(
        /requires.*conflicts|contradict/i,
      );
    }
  });

  it('reports mutually conflicting locked groups as impossible selection', () => {
    const document = cloneValidDocument();
    document.proposals[0]!.patchGroups = [
      {
        id: 'locked-a',
        label: 'Locked A',
        locked: true,
        conflictsWith: ['locked-b'],
        patches: [],
      },
      {
        id: 'locked-b',
        label: 'Locked B',
        locked: true,
        conflictsWith: ['locked-a'],
        patches: [],
      },
    ];

    const result = validateDocument(document);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.viewErrors.get('proposal-a')?.join('\n')).toMatch(
        /locked.*conflict.*impossible/i,
      );
    }
  });

  it('reports conflicts inside a locked group transitive requirements closure', () => {
    const document = cloneValidDocument();
    document.proposals[0]!.patchGroups = [
      {
        id: 'locked-root',
        label: 'Locked root',
        locked: true,
        requires: ['middle'],
        patches: [],
      },
      {
        id: 'middle',
        label: 'Middle dependency',
        requires: ['required-a', 'required-b'],
        patches: [],
      },
      {
        id: 'required-a',
        label: 'Required A',
        conflictsWith: ['required-b'],
        patches: [],
      },
      {
        id: 'required-b',
        label: 'Required B',
        conflictsWith: ['required-a'],
        patches: [],
      },
    ];

    const result = validateDocument(document);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.viewErrors.get('proposal-a')?.join('\n')).toMatch(
        /required-a.*required-b.*impossible/i,
      );
    }
  });

  it.each([
    ['node', 'state'],
    ['proposal', 'proposal-a'],
    ['patch group', 'shared-leadership-group'],
  ])('rejects proposal relationship IDs colliding with a %s ID', (_kind, id) => {
    const document = cloneValidDocument();
    document.proposals[0]!.patches = [
      {
        type: 'add-relationship',
        relationship: {
          id,
          type: 'coordination',
          source: 'state',
          target: 'usaid',
          label: 'Coordinates with',
        },
      },
    ];

    const result = validateDocument(document);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.viewErrors.get('proposal-a')?.join('\n')).toMatch(
        new RegExp(`duplicate.*${id}`, 'i'),
      );
    }
  });

  it('does not collapse distinct relationship owners whose legal IDs contain slashes', () => {
    const document = cloneValidDocument();
    const relationship = {
      id: 'duplicate/path',
      type: 'coordination',
      source: 'state',
      target: 'usaid',
      label: 'Coordinates with',
    };
    document.proposals = [
      {
        id: 'owner/patchGroups/0',
        label: 'Direct owner',
        base: 'current',
        patches: [{ type: 'add-relationship', relationship }],
      },
      {
        id: 'owner',
        label: 'Group owner',
        base: 'current',
        patchGroups: [
          {
            id: 'owner-group',
            label: 'Owner group',
            patches: [{ type: 'add-relationship', relationship }],
          },
        ],
      },
    ];

    const result = validateDocument(document);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.viewErrors.get('owner')?.join('\n')).toMatch(
        /duplicate.*duplicate\/path/i,
      );
    }
  });

  it('rejects non-HTTP source URLs through the published schema', () => {
    const document = cloneValidDocument();
    document.nodes.state!.sources = [
      { label: 'Local file', url: 'file:///tmp/state.html' },
    ];

    const result = validateDocument(document);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join('\n')).toMatch(/url.*pattern/i);
  });

  it('accepts primitive and null metadata values', () => {
    const document = cloneValidDocument();
    document.nodes.state!.metadata = {
      active: true,
      employees: 100,
      parent: null,
      abbreviation: 'State',
    };

    expect(validateDocument(document).ok).toBe(true);
  });

  it('rejects structured metadata values', () => {
    const document = cloneValidDocument() as unknown as Record<string, unknown>;
    const nodes = document.nodes as Record<string, Record<string, unknown>>;
    nodes.state!.metadata = { nested: { active: true } };

    const result = validateDocument(document);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join('\n')).toMatch(/metadata/i);
  });

  it('isolates invalid optional proposals while preserving a valid snapshot', () => {
    const document = cloneValidDocument();
    const invalidProposal: DeepMutable<Proposal> = {
      id: 'proposal-invalid',
      label: 'Invalid optional view',
      base: 'current',
      patches: [{ type: 'remove-node', node: 'missing' }],
    };
    document.proposals.push(invalidProposal, {
      id: 'proposal-descendant',
      label: 'Descendant',
      base: 'proposal-invalid',
    });

    const result = validateDocument(document);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBe(document);
      expect(result.viewErrors.get('proposal-invalid')?.join('\n')).toMatch(
        /missing/i,
      );
      expect(result.viewErrors.get('proposal-descendant')?.join('\n')).toMatch(
        /proposal-invalid/i,
      );
      expect(result.viewErrors.has('current')).toBe(false);
    }
  });
});
