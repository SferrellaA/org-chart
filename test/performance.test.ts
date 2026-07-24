import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { performance } from 'node:perf_hooks';

import { describe, expect, it } from 'vitest';

import { diffCharts } from '../src/model/diff';
import { resolveView } from '../src/model/resolve';
import { validateDocument } from '../src/model/validate';
import { buildRenderView } from '../src/presentation/build-view';

const fixturePath = resolve(import.meta.dirname, '../examples/generated-5000.json');

function measure<T>(label: string, action: () => T): { duration: number; value: T } {
  const start = performance.now();
  const value = action();
  const duration = performance.now() - start;
  console.info(`${label}: ${duration.toFixed(1)}ms`);
  expect(duration, label).toBeLessThan(1_000);
  return { duration, value };
}

describe('generated benchmark fixture performance', () => {
  it('validates, resolves, diffs, and projects 5,000 searchable nodes under budget', () => {
    const input = JSON.parse(readFileSync(fixturePath, 'utf8')) as unknown;

    const validation = measure('validate generated-5000', () => validateDocument(input)).value;
    expect(validation.ok).toBe(true);
    if (!validation.ok) throw new Error(validation.errors.join('\n'));
    expect(Object.keys(validation.value.nodes)).toHaveLength(5_000);
    expect(validation.value.proposals).toHaveLength(2);
    expect(validation.value.relationships).toHaveLength(100);
    const current = validation.value.snapshots.find((snapshot) => snapshot.id === 'current')!;
    const parents = new Map(current.hierarchy.map((edge) => [edge.child, edge]));
    const depthOf = (id: string): number => {
      let depth = 0;
      let currentId = id;
      const seen = new Set<string>();
      while (parents.has(currentId)) {
        expect(seen.has(currentId)).toBe(false);
        seen.add(currentId);
        depth += 1;
        currentId = parents.get(currentId)!.parent;
      }
      return depth;
    };
    expect(Math.max(...Object.keys(validation.value.nodes).map(depthOf))).toBeLessThanOrEqual(6);
    for (let index = 5; index < 5_000; index += 5) {
      expect(parents.get(`office-${index}`)?.relationship).toBe('internal');
    }

    const baseline = measure('resolve current', () =>
      resolveView(validation.value, { viewId: 'current', selectedGroups: [] })
    ).value;
    const proposed = measure('resolve proposal', () =>
      resolveView(validation.value, {
        viewId: 'benchmark-realignment',
        selectedGroups: ['rename-office-4999', 'move-office-4096'],
      })
    ).value;
    expect(baseline.nodes.size).toBe(5_000);
    expect(proposed.nodes.size).toBe(5_000);

    const diff = measure('diff charts', () => diffCharts(baseline, proposed)).value;
    expect(diff.summary.modified).toBeGreaterThan(0);

    const view = measure('build render view', () =>
      buildRenderView(proposed, diff, {
        showInternal: false,
        showRelationships: true,
        revealedInternalIds: new Set(),
      })
    ).value;
    expect(view.searchEntries).toHaveLength(5_000);
    expect(new Set(view.searchEntries.map((entry) => entry.id)).size).toBe(5_000);
    expect(view.searchEntries.some((entry) => entry.label === 'Office 4999')).toBe(true);
    expect(view.initialExpansionIds.length).toBeLessThan(500);
    console.info(`initial expansions: ${view.initialExpansionIds.length}`);
  });
});
