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
