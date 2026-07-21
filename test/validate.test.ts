import { describe, expect, it } from 'vitest';

import { validateDocument } from '../src/model/validate';
import type { Proposal } from '../src/model/types';
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

  it('makes an unknown snapshot hierarchy child fatal', () => {
    const document = cloneValidDocument();
    document.snapshots[0]!.hierarchy[0]!.child = 'missing';

    const result = validateDocument(document);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join('\n')).toMatch(/current.*missing/i);
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
