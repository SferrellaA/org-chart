import { describe, expect, it } from 'vitest';

import { validateOrgDocument } from '../src/model/validate';
import type { Proposal } from '../src/model/types';
import { cloneValidDocument, validDocument } from './fixtures';

describe('validateOrgDocument', () => {
  it('accepts the reusable valid document without view errors', () => {
    expect(validateOrgDocument(validDocument)).toEqual({
      ok: true,
      value: validDocument,
      viewErrors: new Map(),
    });
  });

  it('makes an unknown snapshot hierarchy child fatal', () => {
    const document = cloneValidDocument();
    document.snapshots[0]!.hierarchy[0]!.child = 'missing';

    const result = validateOrgDocument(document);

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

    const result = validateOrgDocument(document);

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

    const result = validateOrgDocument(document);

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

    const result = validateOrgDocument(document);

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

    const result = validateOrgDocument(document);

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

    const result = validateOrgDocument(document);

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

    const result = validateOrgDocument(document);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.viewErrors.get('proposal-a')?.join('\n')).toMatch(
        /dependency cycle/i,
      );
    }
  });

  it('rejects non-HTTP source URLs through the published schema', () => {
    const document = cloneValidDocument();
    document.nodes.state!.sources = [
      { label: 'Local file', url: 'file:///tmp/state.html' },
    ];

    const result = validateOrgDocument(document);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join('\n')).toMatch(/url.*pattern/i);
  });

  it('isolates invalid optional proposals while preserving a valid snapshot', () => {
    const document = cloneValidDocument();
    const invalidProposal: Proposal = {
      id: 'proposal-invalid',
      label: 'Invalid optional view',
      base: 'current',
      patches: [{ op: 'remove-node', node: 'missing' }],
    };
    document.proposals.push(invalidProposal, {
      id: 'proposal-descendant',
      label: 'Descendant',
      base: 'proposal-invalid',
    });

    const result = validateOrgDocument(document);

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
