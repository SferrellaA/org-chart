import { describe, expect, it } from 'vitest';

import * as publicApi from '../src/index';
import { ResolutionError, resolveView } from '../src/model/resolve';
import {
  initialPatchSelection,
  togglePatchGroup,
  validateSelection,
} from '../src/model/selection';
import type { PatchGroup, Proposal } from '../src/model/types';
import { cloneValidDocument } from './fixtures';

function proposal(groups: readonly PatchGroup[]): Proposal {
  return { id: 'proposal', label: 'Proposal', base: 'current', patchGroups: groups };
}

function group(id: string, options: Partial<PatchGroup> = {}): PatchGroup {
  return { id, label: id, patches: [], ...options };
}

describe('patch selection', () => {
  it('detects divergent writes to the same taxonomy level field', () => {
    const input = proposal([
      group('first', { patches: [{ type: 'set-taxonomy-level', taxonomy: 'usaf', level: 'naf', value: { tier: 'command' } }] }),
      group('second', { patches: [{ type: 'set-taxonomy-level', taxonomy: 'usaf', level: 'naf', value: { tier: 'division' } }] }),
    ]);

    expect(validateSelection(input, ['first', 'second'])).toMatch(/both set.*tier/i);
  });

  it('allows disjoint writes to the same taxonomy level', () => {
    const input = proposal([
      group('label', { patches: [{ type: 'set-taxonomy-level', taxonomy: 'usaf', level: 'naf', value: { label: 'Numbered Air Force' } }] }),
      group('tier', { patches: [{ type: 'set-taxonomy-level', taxonomy: 'usaf', level: 'naf', value: { tier: 'division' } }] }),
    ]);

    expect(validateSelection(input, ['label', 'tier'])).toBeUndefined();
  });

  it('detects removing and changing the same taxonomy level', () => {
    const input = proposal([
      group('remove', { patches: [{ type: 'remove-taxonomy-level', taxonomy: 'usaf', level: 'naf' }] }),
      group('change', { patches: [{ type: 'set-taxonomy-level', taxonomy: 'usaf', level: 'naf', value: { tier: 'division' } }] }),
    ]);

    expect(validateSelection(input, ['remove', 'change'])).toMatch(/both set.*existence/i);
  });
  it('exports selection helpers from the package entry point', () => {
    expect(publicApi.initialPatchSelection).toBe(initialPatchSelection);
    expect(publicApi.togglePatchGroup).toBe(togglePatchGroup);
    expect(publicApi.validateSelection).toBe(validateSelection);
  });

  it('selects defaults, locked groups, and transitive requirements in document order', () => {
    const input = proposal([
      group('rename'),
      group('unrelated'),
      group('prepare', { requires: ['rename'] }),
      group('spin-out', { defaultSelected: true, requires: ['prepare'] }),
      group('locked', { locked: true }),
    ]);

    expect(initialPatchSelection(input).selected).toEqual([
      'rename',
      'prepare',
      'spin-out',
      'locked',
    ]);
  });

  it('excludes and disables a default that conflicts with the locked closure', () => {
    const input = proposal([
      group('alternative', { defaultSelected: true, conflictsWith: ['foundation'] }),
      group('foundation'),
      group('locked', { locked: true, requires: ['foundation'] }),
    ]);

    const result = initialPatchSelection(input);

    expect(result.selected).toEqual(['foundation', 'locked']);
    expect(result.disabled.get('alternative')).toMatch(/locked|foundation/i);
    expect(result.error).toBeUndefined();
  });

  it('keeps the first compatible default in document order', () => {
    const input = proposal([
      group('first', { defaultSelected: true, conflictsWith: ['second'] }),
      group('second', { defaultSelected: true, conflictsWith: ['first'] }),
      group('third', { defaultSelected: true }),
    ]);

    const result = initialPatchSelection(input);

    expect(result.selected).toEqual(['first', 'third']);
    expect(result.error).toBeUndefined();
  });

  it('gives the first default root precedence over a later default conflicting with its support', () => {
    const input = proposal([
      group('first', { defaultSelected: true, requires: ['support'] }),
      group('second', { defaultSelected: true, conflictsWith: ['support'] }),
      group('support', { conflictsWith: ['second'] }),
    ]);

    const result = initialPatchSelection(input);

    expect(result.selected).toEqual(['first', 'support']);
    expect(result.disabled.has('second')).toBe(false);
    expect(result.error).toBeUndefined();
  });

  it('lets a user replace the earlier of two conflicting optional defaults', () => {
    const input = proposal([
      group('first', { defaultSelected: true, conflictsWith: ['second'] }),
      group('second', { defaultSelected: true, conflictsWith: ['first'] }),
    ]);
    const initial = initialPatchSelection(input);

    expect(initial.selected).toEqual(['first']);
    expect(initial.disabled.has('second')).toBe(false);

    const toggled = togglePatchGroup(input, initial, 'second', true);

    expect(toggled.selected).toEqual(['second']);
    expect(toggled.error).toBeUndefined();
  });

  it('initializes 4,000 independent defaults without quadratic growth', () => {
    const measure = (count: number): number => {
      const input = proposal(
        Array.from({ length: count }, (_, index) =>
          group(`default-${index}`, { defaultSelected: true }),
        ),
      );
      const start = performance.now();
      expect(initialPatchSelection(input).selected).toHaveLength(count);
      return performance.now() - start;
    };

    measure(250);
    const twoThousand = measure(2_000);
    const fourThousand = measure(4_000);

    expect(fourThousand).toBeLessThan(1_500);
    expect(fourThousand / Math.max(twoThousand, 1)).toBeLessThan(4);
  });

  it('indexes adversarial equal-write buckets without pair expansion', () => {
    const measure = (count: number): number => {
      const input = proposal(
        Array.from({ length: count }, (_, index) =>
          group(`writer-${index}`, {
            defaultSelected: true,
            patches: [
              {
                type: 'set-node',
                node: 'state-hr',
                value: { name: index % 2 === 0 ? 'People' : 'Talent' },
              },
            ],
          }),
        ),
      );
      const start = performance.now();
      const result = initialPatchSelection(input);
      expect(result.selected).toHaveLength(Math.ceil(count / 2));
      return performance.now() - start;
    };

    measure(250);
    const twoThousand = measure(2_000);
    const fourThousand = measure(4_000);
    const eightThousand = measure(8_000);

    expect(eightThousand).toBeLessThan(2_000);
    expect(eightThousand / Math.max(fourThousand, 1)).toBeLessThan(4);
    expect(fourThousand / Math.max(twoThousand, 1)).toBeLessThan(4);
  }, 30_000);

  it('checking a group deselects conflicting optional groups', () => {
    const input = proposal([
      group('old', { defaultSelected: true, conflictsWith: ['new'] }),
      group('new', { conflictsWith: ['old'] }),
    ]);

    const result = togglePatchGroup(input, initialPatchSelection(input), 'new', true);

    expect(result.selected).toEqual(['new']);
  });

  it('disables a group that conflicts with the locked closure and leaves selection unchanged', () => {
    const input = proposal([
      group('foundation'),
      group('locked', { locked: true, requires: ['foundation'] }),
      group('alternative', { conflictsWith: ['foundation'] }),
    ]);
    const initial = initialPatchSelection(input);

    expect(initial.disabled.get('alternative')).toMatch(/locked|foundation/i);
    expect(togglePatchGroup(input, initial, 'alternative', true)).toEqual(initial);
  });

  it('deselecting a requirement also deselects all transitive dependents', () => {
    const input = proposal([
      group('rename', { defaultSelected: true }),
      group('prepare', { defaultSelected: true, requires: ['rename'] }),
      group('spin-out', { defaultSelected: true, requires: ['prepare'] }),
    ]);

    expect(togglePatchGroup(input, initialPatchSelection(input), 'rename', false).selected).toEqual(
      [],
    );
  });

  it('reports an exact conflict when two groups rename the same node differently', () => {
    const input = proposal([
      group('a', {
        patches: [{ type: 'set-node', node: 'state-hr', value: { name: 'People' } }],
      }),
      group('b', {
        patches: [{ type: 'set-node', node: 'state-hr', value: { name: 'Talent' } }],
      }),
    ]);

    expect(validateSelection(input, ['a', 'b'])).toBe(
      'Patch groups "a" and "b" both set state-hr.name differently',
    );
  });

  it('allows equal writes', () => {
    const input = proposal([
      group('a', {
        patches: [{ type: 'set-node', node: 'state-hr', value: { name: 'People' } }],
      }),
      group('b', {
        patches: [{ type: 'set-node', node: 'state-hr', value: { name: 'People' } }],
      }),
    ]);

    expect(validateSelection(input, ['a', 'b'])).toBeUndefined();
  });

  it.each([
    [
      'node field',
      [{ type: 'set-node', node: 'state', value: { note: 'One' } }],
      [{ type: 'set-node', node: 'state', value: { note: 'Two' } }],
      'state.note',
    ],
    [
      'relationship field',
      [{ type: 'set-relationship', relationship: 'link', value: { label: 'One' } }],
      [{ type: 'set-relationship', relationship: 'link', value: { label: 'Two' } }],
      'link.label',
    ],
    [
      'parent relationship status',
      [{ type: 'set-parent', node: 'state-hr', parent: 'state', relationship: 'internal' }],
      [{ type: 'set-parent', node: 'state-hr', parent: 'state', relationship: 'subordinate' }],
      'state-hr.parent',
    ],
  ] as const)('detects a field-level %s conflict', (_name, first, second, target) => {
    const input = proposal([
      group('a', { patches: first }),
      group('b', { patches: second }),
    ]);

    expect(validateSelection(input, ['a', 'b'])).toBe(
      `Patch groups "a" and "b" both set ${target} differently`,
    );
  });

  it.each([
    ['note', { note: 'First' }, { note: 'Second' }],
    [
      'source',
      { sources: [{ label: 'Source', url: 'https://example.com/one' }] },
      { sources: [{ label: 'Source', url: 'https://example.com/two' }] },
    ],
  ] as const)('detects differing parent %s metadata', (_name, first, second) => {
    const input = proposal([
      group('a', {
        patches: [
          {
            type: 'set-parent',
            node: 'state-hr',
            parent: 'state',
            relationship: 'internal',
            ...first,
          },
        ],
      }),
      group('b', {
        patches: [
          {
            type: 'set-parent',
            node: 'state-hr',
            parent: 'state',
            relationship: 'internal',
            ...second,
          },
        ],
      }),
    ]);

    expect(validateSelection(input, ['a', 'b'])).toBe(
      'Patch groups "a" and "b" both set state-hr.parent differently',
    );
  });

  it('allows equal parent metadata with deeply equal normalized sources', () => {
    const input = proposal([
      group('a', {
        patches: [
          {
            type: 'set-parent',
            node: 'state-hr',
            parent: 'state',
            relationship: 'internal',
            sources: [{ label: 'Source', url: 'https://example.com/source' }],
          },
        ],
      }),
      group('b', {
        patches: [
          {
            type: 'set-parent',
            node: 'state-hr',
            parent: 'state',
            relationship: 'internal',
            sources: [{ url: 'https://example.com/source', label: 'Source' }],
          },
        ],
      }),
    ]);

    expect(validateSelection(input, ['a', 'b'])).toBeUndefined();
  });

  it('handles transitive requirements and conflicts without recursion overflow', () => {
    const count = 15_000;
    const groups = Array.from({ length: count }, (_, index) =>
      group(`group-${index}`, index === 0 ? {} : { requires: [`group-${index - 1}`] }),
    );
    groups[100] = group('group-100', {
      requires: ['group-99'],
      conflictsWith: ['blocked'],
    });
    groups.splice(101, 0, group('blocked', { defaultSelected: true }));
    const input = proposal(groups);

    const result = togglePatchGroup(
      input,
      initialPatchSelection(input),
      `group-${count - 1}`,
      true,
    );

    expect(result.selected).toHaveLength(count);
    expect(result.selected[0]).toBe('group-0');
    expect(result.selected).not.toContain('blocked');
    expect(result.selected.at(-1)).toBe(`group-${count - 1}`);
  });

  it('returns robust errors for unknown references and dependency cycles', () => {
    expect(validateSelection(proposal([group('a', { requires: ['missing'] })]), ['a'])).toBe(
      'Patch group "a" requires unknown group "missing"',
    );
    expect(
      validateSelection(
        proposal([
          group('a', { requires: ['b'] }),
          group('b', { requires: ['a'] }),
        ]),
        ['a', 'b'],
      ),
    ).toMatch(/cycle/i);
  });

  it('resolves duplicate equal remove-node patches idempotently', () => {
    const document = cloneValidDocument();
    document.proposals[0]!.patchGroups = [
      {
        id: 'remove-first',
        label: 'Remove first',
        patches: [{ type: 'remove-node', node: 'usaid' }],
      },
      {
        id: 'remove-again',
        label: 'Remove again',
        patches: [{ type: 'remove-node', node: 'usaid' }],
      },
    ];

    const result = resolveView(document, {
      viewId: 'proposal-a',
      selectedGroups: ['remove-first', 'remove-again'],
    });

    expect(result.nodes.has('usaid')).toBe(false);
  });

  it('resolves duplicate equal add-node patches idempotently', () => {
    const document = cloneValidDocument();
    document.nodes.new = { name: 'New node' };
    document.proposals[0]!.patchGroups = [
      {
        id: 'add-first',
        label: 'Add first',
        patches: [{ type: 'add-node', node: 'new', value: { note: 'Added' } }],
      },
      {
        id: 'add-again',
        label: 'Add again',
        patches: [{ type: 'add-node', node: 'new', value: { note: 'Added' } }],
      },
    ];

    const result = resolveView(document, {
      viewId: 'proposal-a',
      selectedGroups: ['add-first', 'add-again'],
    });

    expect(result.nodes.get('new')).toMatchObject({ name: 'New node', note: 'Added' });
  });

  it('rejects a first selected add-node against matching base state', () => {
    const document = cloneValidDocument();
    document.proposals[0]!.patchGroups = [
      {
        id: 'add-existing',
        label: 'Add existing',
        patches: [{ type: 'add-node', node: 'usaid' }],
      },
    ];

    expect(() =>
      resolveView(document, { viewId: 'proposal-a', selectedGroups: ['add-existing'] }),
    ).toThrowError('proposal-a/patchGroups/0/patches/0: node "usaid" already exists');
  });

  it('rejects a first selected remove-node against absent base state', () => {
    const document = cloneValidDocument();
    document.nodes.new = { name: 'New' };
    document.proposals[0]!.patchGroups = [
      {
        id: 'remove-absent',
        label: 'Remove absent',
        patches: [{ type: 'remove-node', node: 'new' }],
      },
    ];

    expect(() =>
      resolveView(document, { viewId: 'proposal-a', selectedGroups: ['remove-absent'] }),
    ).toThrowError('proposal-a/patchGroups/0/patches/0: node "new" does not exist');
  });

  it('rejects a first selected remove-parent against parentless base state', () => {
    const document = cloneValidDocument();
    document.proposals[0]!.patchGroups = [
      {
        id: 'remove-parent',
        label: 'Remove parent',
        patches: [{ type: 'remove-parent', node: 'state' }],
      },
    ];

    expect(() =>
      resolveView(document, { viewId: 'proposal-a', selectedGroups: ['remove-parent'] }),
    ).toThrowError('proposal-a/patchGroups/0/patches/0: node "state" does not have a parent');
  });

  it('rejects a first selected remove-parent against a missing base node', () => {
    const document = cloneValidDocument();
    document.nodes.new = { name: 'New' };
    document.proposals[0]!.patchGroups = [
      {
        id: 'remove-parent',
        label: 'Remove parent',
        patches: [{ type: 'remove-parent', node: 'new' }],
      },
    ];

    expect(() =>
      resolveView(document, { viewId: 'proposal-a', selectedGroups: ['remove-parent'] }),
    ).toThrowError('proposal-a/patchGroups/0/patches/0: node "new" does not exist');
  });

  it('rejects a first selected remove-relationship against absent base state', () => {
    const document = cloneValidDocument();
    document.proposals[0]!.patchGroups = [
      {
        id: 'remove-absent',
        label: 'Remove absent',
        patches: [{ type: 'remove-relationship', relationship: 'missing' }],
      },
    ];

    expect(() =>
      resolveView(document, { viewId: 'proposal-a', selectedGroups: ['remove-absent'] }),
    ).toThrowError('proposal-a/patchGroups/0/patches/0: relationship "missing" does not exist');
  });

  it('reapplies an equal historical write after an intervening state change', () => {
    const document = cloneValidDocument();
    document.nodes.usaid!.name = 'Talent';
    document.proposals[0]!.patchGroups = [
      {
        id: 'a-people',
        label: 'People first',
        patches: [{ type: 'set-node', node: 'usaid', value: { name: 'People' } }],
      },
      {
        id: 'b-talent',
        label: 'Talent between',
        patches: [
          { type: 'remove-node', node: 'usaid' },
          { type: 'add-node', node: 'usaid' },
        ],
      },
      {
        id: 'c-people',
        label: 'People final',
        patches: [{ type: 'set-node', node: 'usaid', value: { name: 'People' } }],
      },
    ];

    const result = resolveView(document, {
      viewId: 'proposal-a',
      selectedGroups: ['a-people', 'b-talent', 'c-people'],
    });

    expect(result.nodes.get('usaid')?.name).toBe('People');
  });

  it('emits every ordered annotation for duplicate equal selected patches', () => {
    const document = cloneValidDocument();
    document.proposals[0]!.patchGroups = [
      {
        id: 'first',
        label: 'First narrative',
        patches: [
          {
            type: 'set-node',
            node: 'usaid',
            value: { note: 'Shared state' },
            semantic: 'first narrative',
          },
        ],
      },
      {
        id: 'second',
        label: 'Second narrative',
        patches: [
          {
            type: 'set-node',
            node: 'usaid',
            value: { note: 'Shared state' },
            semantic: 'second narrative',
          },
        ],
      },
    ];

    const result = resolveView(document, {
      viewId: 'proposal-a',
      selectedGroups: ['first', 'second'],
    });

    expect(result.semanticAnnotations.map((annotation) => annotation.semantic)).toEqual([
      'first narrative',
      'second narrative',
    ]);
  });

  it('treats selected remove-parent as annotated no-op when the node is absent', () => {
    const document = cloneValidDocument();
    document.proposals[0]!.patchGroups = [
      {
        id: 'remove-node',
        label: 'Remove node',
        patches: [{ type: 'remove-node', node: 'usaid' }],
      },
      {
        id: 'remove-parent',
        label: 'Remove absent parent',
        patches: [
          {
            type: 'remove-parent',
            node: 'usaid',
            semantic: 'already parentless',
          },
        ],
      },
    ];

    const result = resolveView(document, {
      viewId: 'proposal-a',
      selectedGroups: ['remove-node', 'remove-parent'],
    });

    expect(result.nodes.has('usaid')).toBe(false);
    expect(result.semanticAnnotations).toContainEqual({
      semantic: 'already parentless',
      nodes: ['usaid'],
      note: undefined,
      sources: undefined,
    });
  });

  it('preserves relationship participants for repeated removal annotations', () => {
    const document = cloneValidDocument();
    document.proposals[0]!.patchGroups = [
      {
        id: 'remove-first',
        label: 'Remove relationship',
        patches: [
          {
            type: 'remove-relationship',
            relationship: 'shared-leadership',
            semantic: 'first removal',
          },
        ],
      },
      {
        id: 'remove-again',
        label: 'Confirm relationship removal',
        patches: [
          {
            type: 'remove-relationship',
            relationship: 'shared-leadership',
            semantic: 'second removal',
          },
        ],
      },
    ];

    const result = resolveView(document, {
      viewId: 'proposal-a',
      selectedGroups: ['remove-first', 'remove-again'],
    });

    expect(result.relationships.has('shared-leadership')).toBe(false);
    expect(result.semanticAnnotations).toMatchObject([
      { semantic: 'first removal', nodes: ['state', 'usaid'] },
      { semantic: 'second removal', nodes: ['state', 'usaid'] },
    ]);
  });

  it('persists selected provenance across proposal bases', () => {
    const document = cloneValidDocument();
    document.proposals[0]!.patchGroups = [
      {
        id: 'remove-first',
        label: 'Remove first',
        patches: [{ type: 'remove-node', node: 'usaid' }],
      },
    ];
    document.proposals.push({
      id: 'proposal-b',
      label: 'Proposal B',
      base: 'proposal-a',
      patchGroups: [
        {
          id: 'remove-again',
          label: 'Remove again',
          patches: [{ type: 'remove-node', node: 'usaid' }],
        },
      ],
    });

    expect(
      resolveView(document, {
        viewId: 'proposal-b',
        selectedGroups: ['remove-first', 'remove-again'],
      }).nodes.has('usaid'),
    ).toBe(false);
  });

  it('invalidates selected provenance touched by an unconditional proposal patch', () => {
    const document = cloneValidDocument();
    document.relationships = [];
    document.proposals[0]!.patchGroups = [
      {
        id: 'add-selected',
        label: 'Add selected',
        patches: [
          {
            type: 'add-relationship',
            relationship: {
              id: 'temporary',
              type: 'coordination',
              source: 'state',
              target: 'usaid',
              label: 'Temporary',
            },
          },
        ],
      },
    ];
    document.proposals.push({
      id: 'proposal-b',
      label: 'Proposal B',
      base: 'proposal-a',
      patches: [{ type: 'remove-relationship', relationship: 'temporary' }],
      patchGroups: [
        {
          id: 'remove-selected',
          label: 'Remove selected',
          patches: [{ type: 'remove-relationship', relationship: 'temporary' }],
        },
      ],
    });

    expect(() =>
      resolveView(document, {
        viewId: 'proposal-b',
        selectedGroups: ['add-selected', 'remove-selected'],
      }),
    ).toThrowError('proposal-b/patchGroups/0/patches/0: relationship "temporary" does not exist');
  });

  it('clears selected provenance when a proposal snapshot replaces state', () => {
    const document = cloneValidDocument();
    document.nodes.new = { name: 'New' };
    document.proposals[0]!.patchGroups = [
      {
        id: 'add-selected',
        label: 'Add selected',
        patches: [{ type: 'add-node', node: 'new' }],
      },
    ];
    document.proposals.push({
      id: 'proposal-b',
      label: 'Proposal B',
      base: 'proposal-a',
      snapshot: {
        nodes: { state: {}, new: {} },
        hierarchy: [{ child: 'new', parent: 'state', relationship: 'internal' }],
      },
      patchGroups: [
        {
          id: 'add-again',
          label: 'Add again',
          patches: [{ type: 'add-node', node: 'new' }],
        },
      ],
    });

    expect(() =>
      resolveView(document, {
        viewId: 'proposal-b',
        selectedGroups: ['add-selected', 'add-again'],
      }),
    ).toThrowError('proposal-b/patchGroups/0/patches/0: node "new" already exists');
  });

  it('rejects incomplete manual resolver selections and accepts valid selections', () => {
    const document = cloneValidDocument();
    document.proposals[0]!.patchGroups = [
      {
        id: 'required',
        label: 'required',
        locked: true,
        patches: [{ type: 'set-node', node: 'usaid', value: { note: 'Required' } }],
      },
      {
        id: 'optional',
        label: 'optional',
        requires: ['required'],
        patches: [{ type: 'set-node', node: 'usaid', value: { name: 'Agency' } }],
      },
    ];

    expect(() =>
      resolveView(document, { viewId: 'proposal-a', selectedGroups: ['optional'] }),
    ).toThrowError(new ResolutionError('proposal-a/patchGroups: locked group "required" is not selected'));

    expect(
      resolveView(document, {
        viewId: 'proposal-a',
        selectedGroups: ['required', 'optional'],
      }).nodes.get('usaid'),
    ).toMatchObject({ name: 'Agency', note: 'Required' });
  });

  it('does not mutate proposal, current selection, or returned state across calls', () => {
    const input = proposal([
      group('required'),
      group('choice', { requires: ['required'] }),
    ]);
    const before = structuredClone(input);
    const current = initialPatchSelection(input);
    const currentSelected = [...current.selected];
    const currentDisabled = new Map(current.disabled);

    const result = togglePatchGroup(input, current, 'choice', true);
    (result.selected as string[]).push('mutated');
    (result.disabled as Map<string, string>).set('mutated', 'mutated');
    const fresh = togglePatchGroup(input, current, 'choice', true);

    expect(input).toEqual(before);
    expect(current.selected).toEqual(currentSelected);
    expect(current.disabled).toEqual(currentDisabled);
    expect(fresh.selected).toEqual(['required', 'choice']);
    expect(fresh.disabled.has('mutated')).toBe(false);
  });
});
