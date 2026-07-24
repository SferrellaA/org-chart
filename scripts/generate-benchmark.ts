import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import type { HierarchyEdge, OrgDocument, Relationship } from '../src/model/types';
import { validateDocument } from '../src/model/validate';
import { resolveView } from '../src/model/resolve';

const NODE_COUNT = 5_000;
const CROSS_LINK_COUNT = 100;
const MAX_DEPTH = 6;
const outputPath = resolve(import.meta.dirname, '../examples/generated-5000.json');

const source = {
  label: 'Synthetic benchmark methodology',
  url: 'https://example.com/org-delta-chart/benchmark-methodology',
};

type NodeId = `office-${number}`;

function id(index: number): NodeId {
  return `office-${index}`;
}

function parentIndexFor(index: number, depths: readonly number[]): number {
  const preferred = Math.floor((index - 1) / 4);
  if ((depths[preferred] ?? 0) < MAX_DEPTH) return preferred;
  for (let candidate = preferred - 1; candidate >= 0; candidate -= 1) {
    if ((depths[candidate] ?? 0) < MAX_DEPTH) return candidate;
  }
  return 0;
}

export function generateBenchmarkDocument(): OrgDocument {
  const nodes: OrgDocument['nodes'] = {};
  const snapshotNodes: OrgDocument['snapshots'][number]['nodes'] = {};
  const hierarchy: HierarchyEdge[] = [];
  const depths: number[] = [0];

  for (let index = 0; index < NODE_COUNT; index += 1) {
    const nodeId = id(index);
    nodes[nodeId] = {
      name: `Office ${index}`,
      aliases: [`office-${index}`, `Benchmark office ${index}`],
      metadata: {
        benchmarkIndex: index,
        synthetic: true,
      },
    };
    if (index % 250 === 0) {
      nodes[nodeId] = {
        ...nodes[nodeId],
        note: `Synthetic benchmark note for Office ${index}.`,
        sources: [source],
      };
    }
    snapshotNodes[nodeId] = index % 500 === 0
      ? { note: `Snapshot state annotation for Office ${index}.` }
      : {};

    if (index === 0) continue;
    const parentIndex = parentIndexFor(index, depths);
    depths[index] = (depths[parentIndex] ?? 0) + 1;
    const relationship = index % 5 === 0 && depths[index]! <= MAX_DEPTH ? 'internal' : 'subordinate';
    hierarchy.push({
      child: nodeId,
      parent: id(parentIndex),
      relationship,
      ...(index % 750 === 0
        ? { note: `Synthetic ${relationship} edge note for Office ${index}.`, sources: [source] }
        : {}),
    });
  }

  const relationships: Relationship[] = Array.from({ length: CROSS_LINK_COUNT }, (_unused, index) => {
    const sourceIndex = (index * 37 + 11) % NODE_COUNT;
    const targetIndex = (index * 91 + 503) % NODE_COUNT;
    return {
      id: `cross-link-${String(index).padStart(3, '0')}`,
      type: 'coordination',
      source: id(sourceIndex),
      target: id(targetIndex === sourceIndex ? (targetIndex + 1) % NODE_COUNT : targetIndex),
      label: `Coordination link ${index}`,
      ...(index % 20 === 0
        ? { note: `Synthetic cross-link note ${index}.`, sources: [source] }
        : {}),
    };
  });

  return {
    $schema: 'https://org-delta-chart.dev/schema/org-delta-chart.schema.json',
    title: 'Generated 5,000 node benchmark',
    nodes,
    snapshots: [
      {
        id: 'current',
        label: 'Generated current structure',
        nodes: snapshotNodes,
        hierarchy,
      },
    ],
    proposals: [
      {
        id: 'benchmark-realignment',
        label: 'Benchmark realignment proposal',
        base: 'current',
        patchGroups: [
          {
            id: 'rename-office-4999',
            label: 'Rename Office 4999 for benchmark diffing',
            defaultSelected: true,
            note: 'Synthetic proposal group used to exercise node diffing.',
            sources: [source],
            patches: [
              {
                type: 'set-node',
                node: 'office-4999',
                value: {
                  name: 'Office 4999',
                  note: 'Synthetic proposal annotation for the exact-search target.',
                },
                semantic: 'rename',
                relatedNodes: ['office-4096'],
                sources: [source],
              },
            ],
          },
          {
            id: 'move-office-4096',
            label: 'Move Office 4096 under Office 42',
            defaultSelected: true,
            requires: ['rename-office-4999'],
            note: 'Synthetic proposal group used to exercise hierarchy diffing.',
            patches: [
              {
                type: 'set-parent',
                node: 'office-4096',
                parent: 'office-42',
                relationship: 'subordinate',
                note: 'Synthetic move for benchmark projection.',
                semantic: 'realignment',
                relatedNodes: ['office-4999'],
              },
            ],
          },
        ],
      },
      {
        id: 'benchmark-complete-snapshot',
        label: 'Benchmark complete proposal snapshot',
        base: 'current',
        snapshot: {
          nodes: {
            ...snapshotNodes,
            'office-4999': { note: 'Complete proposal snapshot annotation for Office 4999.' },
          },
          hierarchy: hierarchy.map((edge) => edge.child === 'office-4096'
            ? {
                child: 'office-4096',
                parent: 'office-42',
                relationship: 'subordinate',
                note: 'Complete snapshot move for benchmark projection.',
              }
            : edge),
        },
      },
    ],
    relationships,
    zones: [
      {
        id: 'benchmark-zone-a',
        label: 'Benchmark meta-zone A',
        nodes: ['office-1', 'office-2', 'office-3', 'office-4'],
        note: 'Synthetic zone metadata; rendering is intentionally deferred.',
        style: { fill: '#e8eef8' },
      },
    ],
    presentation: {
      initialExpansionDepth: 0,
      focusNodes: ['office-0'],
    },
  };
}

const document = generateBenchmarkDocument();
const validation = validateDocument(document);
if (!validation.ok) throw new Error(validation.errors.join('\n'));
resolveView(validation.value, { viewId: 'current', selectedGroups: [] });
resolveView(validation.value, {
  viewId: 'benchmark-realignment',
  selectedGroups: ['rename-office-4999', 'move-office-4096'],
});
resolveView(validation.value, { viewId: 'benchmark-complete-snapshot', selectedGroups: [] });

mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, `${JSON.stringify(document, null, 2)}\n`);
console.info(`Wrote ${outputPath}`);
