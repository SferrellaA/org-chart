import { expect, it } from 'vitest';

import type {
  NodeState,
  OrgDocument,
  Patch,
  PatchGroup,
  ResolvedParent,
  SemanticAnnotation,
  SetRelationshipPatch,
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
  const renamedRelationship: SetRelationshipPatch = {
    type: 'set-relationship',
    relationship: 'existing',
    // @ts-expect-error Relationship IDs cannot be changed by set patches.
    value: { id: 'replacement' },
  };

  // @ts-expect-error Metadata values cannot contain objects.
  const invalidState: NodeState = { metadata: { nested: { value: true } } };
  void invalidState;
  void renamedRelationship;
  void assertReadonlyArrays;
  expect(annotation.nodes).toEqual(['state', 'usaid']);
  expect(state.metadata?.note).toBeNull();
  expect(parent.note).toBe('Reports through headquarters');
});

it('exposes versioned taxonomy catalogs, assignments, and granular patches', () => {
  const document: OrgDocument = {
    title: 'Taxonomy example',
    presentation: { layoutMode: 'taxonomy' },
    nodes: {
      wing: {
        name: 'Example Wing',
        taxonomyAssignments: { 'usaf-echelon': 'wing' },
      },
    },
    snapshots: [{
      id: 'current',
      label: 'Current',
      nodes: { wing: {} },
      hierarchy: [],
      taxonomy: {
        comparisonTiers: [
          { id: 'division-equivalent', label: 'Division equivalent' },
          { id: 'wing', label: 'Wing' },
        ],
        systems: [{
          id: 'usaf-echelon',
          label: 'USAF echelon',
          levels: [{ id: 'wing', label: 'Wing', tier: 'wing' }],
        }],
      },
    }],
    proposals: [],
  };
  const patches: Patch[] = [
    { type: 'add-comparison-tier', tier: { id: 'command', label: 'Command' } },
    { type: 'set-comparison-tier', tier: 'wing', value: { label: 'Wing equivalent' } },
    { type: 'remove-comparison-tier', tier: 'command' },
    { type: 'set-comparison-tier-order', tiers: ['division-equivalent', 'wing'] },
    { type: 'add-taxonomy-system', taxonomy: { id: 'army-echelon', label: 'Army echelon' } },
    { type: 'set-taxonomy-system', taxonomy: 'usaf-echelon', value: { label: 'Air Force echelon' } },
    { type: 'remove-taxonomy-system', taxonomy: 'army-echelon' },
    {
      type: 'add-taxonomy-level',
      taxonomy: 'usaf-echelon',
      level: { id: 'air-division', label: 'Air Division', tier: 'division-equivalent' },
    },
    {
      type: 'set-taxonomy-level',
      taxonomy: 'usaf-echelon',
      level: 'wing',
      value: { tier: 'division-equivalent' },
    },
    { type: 'remove-taxonomy-level', taxonomy: 'usaf-echelon', level: 'air-division' },
    { type: 'set-taxonomy-assignment', node: 'wing', taxonomy: 'usaf-echelon', level: 'wing' },
    { type: 'remove-taxonomy-assignment', node: 'wing', taxonomy: 'usaf-echelon' },
  ];

  expect(document.snapshots[0]?.taxonomy?.systems[0]?.id).toBe('usaf-echelon');
  expect(document.presentation?.layoutMode).toBe('taxonomy');
  expect(patches).toHaveLength(12);
});
