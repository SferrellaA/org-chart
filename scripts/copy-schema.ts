import { copyFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const source = resolve('public/org-delta-chart.schema.json');
const target = resolve('dist/org-delta-chart.schema.json');

mkdirSync(dirname(target), { recursive: true });
copyFileSync(source, target);
