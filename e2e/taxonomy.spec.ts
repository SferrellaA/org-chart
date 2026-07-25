import { expect, test } from '@playwright/test';

const example = '/examples/taxonomy-comparison.html';

test.beforeEach(async ({ page }) => {
  await page.goto(example);
  await expect(page.getByRole('status')).toContainText('Remove Air Division ready');
});

test('renders complete tier-aligned baseline and proposed charts', async ({ page }) => {
  await expect(page.locator('[data-taxonomy-tier]')).toHaveCount(3);
  await expect(page.locator('article[data-view-side="baseline"]')).toHaveCount(5);
  await expect(page.locator('article[data-view-side="proposed"]')).toHaveCount(4);
  await expect(page.locator('article[data-view-side="baseline"][data-node-id="naf"]'))
    .toContainText('Major General');
  await expect(page.locator('article[data-view-side="proposed"][data-node-id="naf"]'))
    .toContainText('Lieutenant General');
  await expect(page.locator('article[data-node-id="plans"].org-delta-taxonomy-card--internal'))
    .toHaveCount(2);
  await expect(page.locator('[data-taxonomy-movement="naf"]')).toHaveCount(1);
  await expect(page.getByRole('tree', { name: 'Baseline organization tree' })).toHaveCount(1);
  await expect(page.getByRole('tree', { name: 'Proposed organization tree' })).toHaveCount(1);

  const baseline = page.locator('article[data-view-side="baseline"][data-node-id="naf"]');
  const proposed = page.locator('article[data-view-side="proposed"][data-node-id="naf"]');
  const [baselineBox, proposedBox] = await Promise.all([baseline.boundingBox(), proposed.boundingBox()]);
  expect(baselineBox).not.toBeNull();
  expect(proposedBox).not.toBeNull();
  expect(baselineBox!.x).toBeLessThan(proposedBox!.x);
  const proposedLaneX = await page.locator(
    '.org-delta-taxonomy-node-lane[data-view-side="proposed"]',
  ).evaluateAll((lanes) => lanes.map((lane) => lane.getBoundingClientRect().x));
  expect(Math.max(...proposedLaneX) - Math.min(...proposedLaneX)).toBeLessThan(1);
});

test('opens version-correct details and preserves paired layout on mobile', async ({ page }, testInfo) => {
  await page.locator(
    'article[data-view-side="baseline"][data-node-id="air-division"] [data-activate-kind="node"]',
  ).click();
  await expect(page.getByRole('heading', { name: 'Example Air Division', level: 2 })).toBeVisible();
  await expect(page.locator('aside.details')).toContainText('Brigadier General');

  if (testInfo.project.name.includes('mobile')) {
    const geometry = await page.locator('.org-delta-taxonomy-world').evaluate((world) => {
      const canvas = world.parentElement!.getBoundingClientRect();
      const rect = world.getBoundingClientRect();
      return {
        canvasWidth: canvas.width,
        contentWidth: world.scrollWidth,
        renderedWidth: rect.width,
        transform: (world as HTMLElement).style.transform,
      };
    });
    expect(geometry.contentWidth).toBeGreaterThan(geometry.canvasWidth);
    expect(geometry.renderedWidth).toBeLessThanOrEqual(geometry.canvasWidth);
    expect(geometry.transform).toContain('scale(');
  }
});
