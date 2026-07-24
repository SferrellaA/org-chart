import type { OrgDocument } from '../src/model/types';

export type DeepMutable<T> = T extends readonly (infer Item)[]
  ? DeepMutable<Item>[]
  : T extends object
    ? { -readonly [Key in keyof T]: DeepMutable<T[Key]> }
    : T;

export const validDocument: OrgDocument = {
  $schema: 'https://org-delta-chart.dev/schema/org-delta-chart.schema.json',
  title: 'US government organizations',
  nodes: {
    state: { name: 'Department of State' },
    'state-hq': { name: 'State Headquarters' },
    'state-hr': { name: 'State Human Resources' },
    usaid: { name: 'USAID' },
  },
  snapshots: [
    {
      id: 'current',
      label: 'Current organization',
      nodes: {
        state: {},
        'state-hq': {},
        'state-hr': {},
        usaid: {},
      },
      hierarchy: [
        {
          child: 'state-hq',
          parent: 'state',
          relationship: 'internal',
          note: 'Headquarters reports within State',
          sources: [{ label: 'State', url: 'https://www.state.gov/' }],
        },
        {
          child: 'state-hr',
          parent: 'state-hq',
          relationship: 'internal',
        },
        { child: 'usaid', parent: 'state', relationship: 'subordinate' },
      ],
    },
  ],
  proposals: [
    {
      id: 'proposal-a',
      label: 'Shared leadership',
      base: 'current',
      patchGroups: [
        {
          id: 'shared-leadership-group',
          label: 'Shared leadership changes',
          defaultSelected: true,
          patches: [
            {
              type: 'set-node',
              node: 'usaid',
              value: { note: 'Led jointly with State' },
              sources: [{ label: 'Proposal', url: 'https://example.com/proposal' }],
              semantic: 'shared leadership',
              relatedNodes: ['state'],
            },
          ],
        },
      ],
    },
  ],
  relationships: [
    {
      id: 'shared-leadership',
      type: 'shared-leadership',
      source: 'state',
      target: 'usaid',
      label: 'Shared leadership',
    },
  ],
};

export function cloneValidDocument(): DeepMutable<OrgDocument> {
  return structuredClone(validDocument) as DeepMutable<OrgDocument>;
}

export function taxonomyDocument(): DeepMutable<OrgDocument> {
  return structuredClone({
    title: 'Synthetic Air Division transition',
    nodes: {
      'naf-a': { name: 'Example Numbered Air Force A', taxonomyAssignments: { 'usaf-echelon': 'numbered-air-force' } },
      'naf-b': { name: 'Example Numbered Air Force B', taxonomyAssignments: { 'usaf-echelon': 'numbered-air-force' } },
      'air-division-a': {
        name: 'Example Air Division A',
        taxonomyAssignments: { 'usaf-echelon': 'air-division' },
        leadership: [{ id: 'division-commander', title: 'Commander' }],
      },
      'air-division-b': { name: 'Example Air Division B', taxonomyAssignments: { 'usaf-echelon': 'air-division' } },
      'wing-a': { name: 'Example Wing A', taxonomyAssignments: { 'usaf-echelon': 'wing' } },
      'wing-b': { name: 'Example Wing B', taxonomyAssignments: { 'usaf-echelon': 'wing' } },
      'wing-c': { name: 'Example Wing C', taxonomyAssignments: { 'usaf-echelon': 'wing' } },
      'army-division': { name: 'Example Army Division', taxonomyAssignments: { 'army-echelon': 'division' } },
    },
    snapshots: [{
      id: 'current',
      label: 'With Air Divisions',
      nodes: {
        'naf-a': {}, 'naf-b': {}, 'air-division-a': {}, 'air-division-b': {},
        'wing-a': {}, 'wing-b': {}, 'wing-c': {}, 'army-division': {},
      },
      hierarchy: [
        { child: 'air-division-a', parent: 'naf-a', relationship: 'subordinate' },
        { child: 'air-division-b', parent: 'naf-b', relationship: 'subordinate' },
        { child: 'wing-a', parent: 'air-division-a', relationship: 'subordinate' },
        { child: 'wing-b', parent: 'air-division-a', relationship: 'subordinate' },
        { child: 'wing-c', parent: 'air-division-b', relationship: 'subordinate' },
      ],
      taxonomy: {
        comparisonTiers: [
          { id: 'naf-equivalent', label: 'NAF equivalent' },
          { id: 'division-equivalent', label: 'Division equivalent' },
          { id: 'wing', label: 'Wing' },
        ],
        systems: [
          {
            id: 'army-echelon', label: 'Army echelon',
            levels: [{ id: 'division', label: 'Division', tier: 'division-equivalent' }],
          },
          {
            id: 'usaf-echelon', label: 'USAF echelon',
            levels: [
              { id: 'numbered-air-force', label: 'Numbered Air Force', tier: 'naf-equivalent' },
              { id: 'air-division', label: 'Air Division', tier: 'division-equivalent' },
              { id: 'wing', label: 'Wing', tier: 'wing' },
            ],
          },
        ],
      },
    }],
    proposals: [{
      id: 'remove-air-divisions',
      label: 'Remove Air Divisions',
      base: 'current',
      patches: [
        { type: 'remove-taxonomy-level', taxonomy: 'usaf-echelon', level: 'air-division' },
        { type: 'set-taxonomy-level', taxonomy: 'usaf-echelon', level: 'numbered-air-force', value: { tier: 'division-equivalent' } },
        { type: 'remove-node', node: 'air-division-a' },
        { type: 'remove-node', node: 'air-division-b' },
        { type: 'set-parent', node: 'wing-a', parent: 'naf-a', relationship: 'subordinate' },
        { type: 'set-parent', node: 'wing-b', parent: 'naf-b', relationship: 'subordinate' },
        { type: 'set-parent', node: 'wing-c', parent: 'naf-b', relationship: 'subordinate' },
        { type: 'set-node', node: 'naf-a', value: { leadership: [{ id: 'division-commander', title: 'Deputy Commander' }] } },
      ],
    }],
  } satisfies OrgDocument) as DeepMutable<OrgDocument>;
}
