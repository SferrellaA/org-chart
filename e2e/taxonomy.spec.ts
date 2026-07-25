import { expect, test } from '@playwright/test';

const example = '/examples/taxonomy-comparison.html';

test.beforeEach(async ({ page }) => {
  await page.goto(example);
  await expect(page.getByRole('status')).toContainText('Remove Air Division ready');
});

test('renders one hierarchy-positioned selected chart in taxonomy tiers', async ({ page }) => {
  await expect(page.locator('[data-taxonomy-tier]')).toHaveCount(3);
  await expect(page.locator('article[data-view-side="baseline"]')).toHaveCount(0);
  await expect(page.locator('article[data-view-side="proposed"]')).toHaveCount(4);
  await expect(page.locator('article[data-view-side="proposed"][data-node-id="naf"]'))
    .toContainText('Lieutenant General');
  await expect(page.locator('article[data-node-id="plans"].org-delta-taxonomy-card--internal'))
    .toHaveCount(1);
  await expect(page.locator('[data-taxonomy-movement]')).toHaveCount(0);
  await expect(page.getByRole('tree', { name: 'Baseline organization tree' })).toHaveCount(0);
  await expect(page.getByRole('tree', { name: 'Proposed organization tree' })).toHaveCount(1);

  const naf = await page.locator('[data-node-id="naf"]').boundingBox();
  const plans = await page.locator('[data-node-id="plans"]').boundingBox();
  const wing = await page.locator('[data-node-id="wing"]').boundingBox();
  const army = await page.locator('[data-node-id="army-division"]').boundingBox();
  expect(naf).not.toBeNull();
  expect(plans).not.toBeNull();
  expect(wing).not.toBeNull();
  expect(army).not.toBeNull();
  const nafCenter = naf!.x + naf!.width / 2;
  const descendantCenter = (
    plans!.x + plans!.width / 2 + wing!.x + wing!.width / 2
  ) / 2;
  expect(Math.abs(nafCenter - descendantCenter)).toBeLessThan(1);
  expect(army!.x).toBeGreaterThan(naf!.x);
});

test('opens selected-state comparison details and fits the hierarchy on mobile', async ({ page }, testInfo) => {
  await page.locator(
    'article[data-view-side="proposed"][data-node-id="naf"] [data-activate-kind="node"]',
  ).click();
  await expect(page.getByRole('heading', { name: 'Example Numbered Air Force', level: 2 }))
    .toBeVisible();
  await expect(page.locator('aside.details')).toContainText('Lieutenant General');
  await expect(page.locator('aside.details')).toContainText('Changes');

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
