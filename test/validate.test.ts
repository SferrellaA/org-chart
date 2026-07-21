import { describe, expect, it } from 'vitest';

import { validateDocument } from '../src/model/validate';
import type { OrgDocument, Proposal } from '../src/model/types';
import { cloneValidDocument, validDocument, type DeepMutable } from './fixtures';

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
