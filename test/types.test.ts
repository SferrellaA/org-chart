import { expect, it } from 'vitest';

import type {
  NodeState,
  OrgDocument,
  PatchGroup,
  ResolvedParent,
  SemanticAnnotation,
  Snapshot,
  Source,
  ValidationResult,
} from '../src/model/types';

function assertReadonlyArrays(
  document: OrgDocument,
  snapshot: Snapshot,
  group: PatchGroup,
  state: NodeState,
  result: ValidationResult,
  parent: ResolvedParent,
): void {
  // @ts-expect-error Public document arrays are immutable.
  document.proposals.push({ id: 'x', label: 'X', base: 'current' });
  // @ts-expect-error Snapshot hierarchy is immutable.
  snapshot.hierarchy.pop();
  // @ts-expect-error Patch collections are immutable.
  group.patches.splice(0, 1);
  // @ts-expect-error Source collections are immutable.
  state.sources?.push({ label: 'X', url: 'https://example.com' });
  if (!result.ok) {
    // @ts-expect-error Fatal validation errors are immutable.
    result.errors.push('extra error');
  }
  // @ts-expect-error Resolved parent sources are immutable.
  parent.sources?.push({ label: 'X', url: 'https://example.com' });
}

it('exposes readonly collections and exact metadata and annotation shapes', () => {
  const source: Source = { label: 'Source', url: 'https://example.com' };
  const state: NodeState = {
    sources: [source],
    metadata: { active: true, employees: 10, note: null, code: 'state' },
  };
  const annotation: SemanticAnnotation = {
    semantic: 'shared leadership',
    nodes: ['state', 'usaid'],
    note: 'Applies to both nodes',
    sources: [source],
  };
  const parent: ResolvedParent = {
    parent: 'state',
    relationship: 'internal',
    note: 'Reports through headquarters',
    sources: [source],
  };

  // @ts-expect-error Metadata values cannot contain objects.
  const invalidState: NodeState = { metadata: { nested: { value: true } } };
  void invalidState;
  void assertReadonlyArrays;
  expect(annotation.nodes).toEqual(['state', 'usaid']);
  expect(state.metadata?.note).toBeNull();
  expect(parent.note).toBe('Reports through headquarters');
});
