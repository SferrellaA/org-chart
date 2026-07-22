import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import exampleDocument from '../examples/state-department.json';
import { initialPatchSelection } from '../src/model/selection';
import { resolveView } from '../src/model/resolve';
import { validateDocument } from '../src/model/validate';
import { applyViewerQuery, readViewerSource, startViewer } from '../src/viewer';

describe('viewer query', () => {
  it.each([
    ['/examples/chart.json', '/examples/chart.json'],
    ['./chart.json', './chart.json'],
    ['../chart.json', '../chart.json'],
    ['http://example.test/chart.json', 'http://example.test/chart.json'],
    ['https://example.test/chart.json?view=current', 'https://example.test/chart.json?view=current'],
  ])('accepts safe src %s', (src, expected) => {
    expect(readViewerSource(`?src=${encodeURIComponent(src)}`)).toBe(expected);
  });

  it.each([
    '',
    '?src=',
    '?src=chart.json',
    '?src=%2F%2Fevil.example%2Fchart.json',
    '?src=javascript%3Aalert(1)',
    '?src=data%3Aapplication%2Fjson%2C%7B%7D',
    '?src=file%3A%2F%2F%2Ftmp%2Fchart.json',
    '?src=ftp%3A%2F%2Fexample.test%2Fchart.json',
    '?src=%2F%5Cevil.example%2Fchart.json',
    '?src=.%2F%5Cevil.example%2Fchart.json',
    '?src=%2Fchart%0A.json',
  ])('rejects missing or unsafe source %s', (search) => {
    expect(() => readViewerSource(search)).toThrow(/src/i);
  });

  it('copies only validated viewer parameters as attributes', () => {
    const chart = document.createElement('org-delta-chart');

    applyViewerQuery(
      '?src=%2Fchart.json&initial-view=proposal-1&compare-to=current' +
        '&show-internal=false&show-relationships=1&unknown=ignored',
      chart,
    );

    expect(Object.fromEntries([...chart.attributes].map(({ name, value }) => [name, value])))
      .toEqual({
        src: '/chart.json',
        'initial-view': 'proposal-1',
        'compare-to': 'current',
        'show-internal': 'false',
        'show-relationships': '1',
      });
  });

  it('rejects invalid known parameters without injecting markup', () => {
    const chart = document.createElement('org-delta-chart');
    const attack = '<img src=x onerror=alert(1)>';

    expect(() =>
      applyViewerQuery(
        `?src=%2Fchart.json&initial-view=${encodeURIComponent(attack)}`,
        chart,
      )
    ).toThrow(/initial-view/i);
    expect(chart.querySelector('img')).toBeNull();
    expect(document.querySelector('img')).toBeNull();
  });

  it('sets the source before registering the custom element', async () => {
    const chart = document.createElement('org-delta-chart');
    const sourcesAtRegistration: Array<string | null> = [];

    await startViewer('?src=%2Fchart.json', chart, async () => {
      sourcesAtRegistration.push(chart.getAttribute('src'));
    });

    expect(sourcesAtRegistration).toEqual(['/chart.json']);
  });
});

describe('State Department example', () => {
  it('is valid and every proposal resolves with its default selection', () => {
    const validation = validateDocument(exampleDocument);

    expect(validation.ok).toBe(true);
    if (!validation.ok) return;
    expect([...validation.viewErrors]).toEqual([]);
    for (const proposal of validation.value.proposals) {
      const selection = initialPatchSelection(proposal);
      expect(selection.error).toBeUndefined();
      expect(() =>
        resolveView(validation.value, {
          viewId: proposal.id,
          selectedGroups: selection.selected,
        })
      ).not.toThrow();
    }
  });
});

describe('viewer build', () => {
  it('preserves library and schema artifacts and emits a bundled viewer', () => {
    const root = resolve(import.meta.dirname, '..');
    execFileSync('npm', ['run', 'build'], { cwd: root, stdio: 'pipe' });

    expect(existsSync(resolve(root, 'dist/org-delta-chart.js'))).toBe(true);
    expect(existsSync(resolve(root, 'dist/org-delta-chart.schema.json'))).toBe(true);
    expect(existsSync(resolve(root, 'dist/viewer.html'))).toBe(true);
    const viewer = readFileSync(resolve(root, 'dist/viewer.html'), 'utf8');
    expect(viewer).toMatch(/<script type="module" crossorigin src="\.\/assets\/.+\.js"><\/script>/);
    expect(viewer).not.toContain('/src/viewer.ts');
  }, 60_000);
});
