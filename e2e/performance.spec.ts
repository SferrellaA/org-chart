import { expect, test } from '@playwright/test';

test('benchmark fixture is ready and exact search reveal remains responsive', async ({ page }, testInfo) => {
  test.skip(!testInfo.project.name.includes('desktop'), 'Chromium desktop benchmark only.');

  const start = performance.now();
  await page.goto('/examples/benchmark.html');
  const chart = page.locator('org-delta-chart');
  await expect(chart).toHaveAttribute('src', /generated-5000\.json/);
  await expect(page.getByRole('heading', { name: 'Generated 5,000 node benchmark' }))
    .toBeVisible({ timeout: 10_000 });
  await expect(page.getByRole('status')).toContainText('ready', { timeout: 10_000 });
  const readyMs = performance.now() - start;
  console.info(`benchmark navigation-to-ready: ${readyMs.toFixed(1)}ms`);
  testInfo.annotations.push({
    type: 'benchmark navigation-to-ready',
    description: `${readyMs.toFixed(1)}ms`,
  });
  await testInfo.attach('navigation-to-ready-ms', {
    body: readyMs.toFixed(1),
    contentType: 'text/plain',
  });
  expect(readyMs).toBeLessThan(10_000);

  await page.getByRole('checkbox', { name: 'Show internal units' }).uncheck();
  const search = page.getByRole('combobox', { name: 'Find organization' });
  const revealStart = performance.now();
  await search.fill('Office 4999');
  await search.press('Enter');
  await expect(page.getByRole('status')).toHaveText(/Revealed Office 4999\./, { timeout: 1_000 });
  const revealMs = performance.now() - revealStart;
  console.info(`benchmark exact search reveal: ${revealMs.toFixed(1)}ms`);
  testInfo.annotations.push({
    type: 'benchmark exact-search-reveal',
    description: `${revealMs.toFixed(1)}ms`,
  });
  await testInfo.attach('exact-search-reveal-ms', {
    body: revealMs.toFixed(1),
    contentType: 'text/plain',
  });
  expect(revealMs).toBeLessThan(1_000);

  await expect(page.getByRole('button', { name: 'Fit chart' })).toBeEnabled();
  await expect(search).toBeFocused();
});
