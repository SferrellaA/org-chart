import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('published package', () => {
  it('does not ship the replaced d3-org-chart dependency', () => {
    const packageJson = JSON.parse(readFileSync('package.json', 'utf8')) as {
      dependencies?: Record<string, string>;
    };

    expect(packageJson.dependencies).not.toHaveProperty('d3-org-chart');
  });

  it('provides declarations to TypeScript consumers', () => {
    const packageRoot = process.cwd();
    const temporaryDirectory = mkdtempSync(join(tmpdir(), 'org-delta-chart-'));
    const consumerDirectory = join(temporaryDirectory, 'consumer');

    try {
      execFileSync('npm', ['run', 'build'], { cwd: packageRoot });
      const packOutput = execFileSync(
        'npm',
        ['pack', '--json', '--pack-destination', temporaryDirectory],
        { cwd: packageRoot, encoding: 'utf8' },
      );
      const [{ filename }] = JSON.parse(packOutput) as [{ filename: string }];

      execFileSync(
        'npm',
        [
          'install',
          '--prefix',
          consumerDirectory,
          '--ignore-scripts',
          '--no-audit',
          '--no-fund',
          '--package-lock=false',
          join(temporaryDirectory, filename),
        ],
      );
      writeFileSync(
        join(consumerDirectory, 'index.ts'),
        "import { OrgDeltaChartElement, validateDocument, type OrgDocument } from 'org-delta-chart';\n\nconst element: HTMLElement = new OrgDeltaChartElement();\nconst document = {} as OrgDocument;\nvalidateDocument(document);\n",
      );
      writeFileSync(
        join(consumerDirectory, 'tsconfig.json'),
        JSON.stringify({
          compilerOptions: {
            lib: ['ES2022', 'DOM'],
            module: 'ESNext',
            moduleResolution: 'Bundler',
            strict: true,
            target: 'ES2022',
          },
          include: ['index.ts'],
        }),
      );

      const packageJson = JSON.parse(
        readFileSync(
          join(consumerDirectory, 'node_modules/org-delta-chart/package.json'),
          'utf8',
        ),
      ) as { exports: { '.': { types?: string }; './schema'?: string } };
      expect(packageJson.exports['.'].types).toEqual(expect.any(String));
      expect(packageJson.exports['./schema']).toBe('./dist/org-delta-chart.schema.json');
      const publishedSchema = JSON.parse(
        readFileSync(
          join(
            consumerDirectory,
            'node_modules/org-delta-chart/dist/org-delta-chart.schema.json',
          ),
          'utf8',
        ),
      ) as { $schema?: string };
      expect(publishedSchema.$schema).toBe(
        'https://json-schema.org/draft/2020-12/schema',
      );
      expect(
        existsSync(
          join(consumerDirectory, 'node_modules/org-delta-chart/dist/viewer.html'),
        ),
      ).toBe(true);

      expect(() =>
        execFileSync(
          process.execPath,
          [join(packageRoot, 'node_modules/typescript/bin/tsc'), '--noEmit'],
          { cwd: consumerDirectory },
        ),
      ).not.toThrow();
    } finally {
      rmSync(temporaryDirectory, { force: true, recursive: true });
    }
  }, 60_000);
});
