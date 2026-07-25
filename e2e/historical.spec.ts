import { expect, test, type Page } from '@playwright/test';

async function openControls(page: Page, projectName: string): Promise<void> {
  if (!projectName.includes('mobile')) return;
  const toggle = page.getByRole('button', { name: 'Controls', exact: true });
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
}

async function closeControls(page: Page, projectName: string): Promise<void> {
  if (!projectName.includes('mobile')) return;
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Controls', exact: true }))
    .toHaveAttribute('aria-expanded', 'false');
}

async function ready(page: Page, mode: 'depth' | 'taxonomy'): Promise<void> {
  await page.goto(`/examples/1992-reorganization-${mode}.html`);
  await expect(page.getByRole('heading', {
    name: '1992 U.S. Air Force command reorganization (working reconstruction)',
  })).toBeVisible();
  await expect(page.getByRole('status')).toContainText('Initial June 1992 command structure ready');
}

test('historical depth view exposes provenance and responsive combined details', async ({ page }, testInfo) => {
  await ready(page, 'depth');
  const acc = page.locator('[data-node-id="acc"] [data-activate-id="acc"]');
  await expect(acc).toBeVisible();
  await expect(page.locator('[data-node-id="amc"] [data-activate-id="amc"]')).toBeVisible();

  await acc.hover();
  const tooltip = page.getByRole('tooltip');
  await expect(tooltip).toBeVisible();
  await expect(tooltip).toContainText('Activated on 1 June 1992');
  await expect(tooltip).toContainText('AFHRA Air Combat Command lineage');

  await acc.click();
  const details = page.locator('aside.details');
  await expect(page.getByRole('heading', { name: 'Air Combat Command', level: 2 })).toBeVisible();
  await expect(details).toContainText('Changes');
  await expect(details.getByRole('link', { name: 'AFHRA Air Combat Command lineage' })).toBeVisible();
  const geometry = await details.evaluate((panel) => {
    const rect = panel.getBoundingClientRect();
    const workspace = panel.parentElement!.getBoundingClientRect();
    return { top: rect.top, left: rect.left, workspaceTop: workspace.top, workspaceLeft: workspace.left };
  });
  if (testInfo.project.name.includes('mobile')) {
    expect(geometry.top).toBeGreaterThan(geometry.workspaceTop);
    expect(geometry.left).toBe(geometry.workspaceLeft);
  } else {
    expect(geometry.left).toBeGreaterThan(geometry.workspaceLeft);
    expect(geometry.top).toBe(geometry.workspaceTop);
  }
});

test('historical taxonomy view reveals a moved wing in the selected hierarchy', async ({ page }, testInfo) => {
  await ready(page, 'taxonomy');
  await expect(page.locator('[data-taxonomy-tier]')).toHaveCount(3);
  await expect(page.locator('[data-view-side="baseline"][data-node-id]')).toHaveCount(0);
  await expect(page.locator('[data-taxonomy-movement]')).toHaveCount(0);

  const acc = await page.locator('[data-node-id="acc"]').boundingBox();
  const amc = await page.locator('[data-node-id="amc"]').boundingBox();
  expect(acc).not.toBeNull();
  expect(amc).not.toBeNull();
  expect(Math.abs(acc!.x - amc!.x)).toBeGreaterThan(acc!.width);

  await openControls(page, testInfo.project.name);
  const search = page.getByRole('combobox', { name: 'Find organization' });
  await search.fill('552d Air Control Wing');
  await page.locator('#org-chart-search-results')
    .getByRole('button', { name: '552d Air Control Wing' })
    .click();
  await closeControls(page, testInfo.project.name);

  const wing = page.locator('[data-node-id="552-acw"] [data-activate-id="552-acw"]');
  await expect(wing).toBeVisible();
  await expect(page.locator('[data-node-id="552-acw"]')).toHaveAttribute('data-tier-id', 'wing');
  const wingBox = await wing.boundingBox();
  expect(wingBox).not.toBeNull();
  expect(wingBox!.y).toBeGreaterThan(acc!.y);

  await wing.click();
  const details = page.locator('aside.details');
  await expect(page.getByRole('heading', { name: '552d Air Control Wing', level: 2 })).toBeVisible();
  await expect(details).toContainText('Changes');
  await expect(details.getByRole('link', { name: 'AFHRA 552 Air Control Wing lineage' })).toBeVisible();
});
