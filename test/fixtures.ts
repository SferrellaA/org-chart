import type { OrgDocument } from '../src/model/types';

export const validDocument: OrgDocument = {
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
        { child: 'state-hq', parent: 'state', relationship: 'internal' },
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
              op: 'set-node',
              node: 'usaid',
              value: { note: 'Led jointly with State' },
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

export function cloneValidDocument(): OrgDocument {
  return structuredClone(validDocument);
}
