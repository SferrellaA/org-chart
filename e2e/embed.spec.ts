import { expect, test, type Page } from '@playwright/test';

const example = '/examples/state-department.html';

async function ready(page: Page, url = example): Promise<void> {
  await page.goto(url);
  await expect(page.locator('org-delta-chart')).toHaveAttribute('src', /state-department\.json/);
  await expect(page.getByRole('heading', {
    name: 'Illustrative U.S. government organization demo',
  })).toBeVisible();
  await expect(page.getByRole('status')).toContainText('ready');
}

test('direct example and viewer load the same chart', async ({ page }) => {
  await ready(page);
  const directTitle = await page.getByRole('heading', { level: 1 }).textContent();

  await ready(page, '/viewer.html?src=/examples/state-department.json');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(directTitle!);
});

test('publisher iframe has a title and renders the chart', async ({ page }) => {
  await page.goto('/examples/iframe.html');
  const iframe = page.locator('iframe');
  await expect(iframe).toHaveAttribute('title', 'Illustrative organization chart');
  const chart = page.frameLocator('iframe');
  await expect(chart.getByRole('heading', {
    name: 'Illustrative U.S. government organization demo',
  })).toBeVisible();
  await expect(chart.getByRole('status')).toContainText('ready');
});

test('proposal selection, requirements, conflicts, and diff signals work', async ({ page }) => {
  await ready(page);
  await page.getByRole('combobox', { name: 'View' }).selectOption('spin-out-proposal');
  await expect(page.locator('[data-selection-status]')).toContainText(
    'Compared with: Illustrative current arrangement',
  );
  await expect(page.getByRole('status')).toContainText(
    'Rename and spin-out demonstration ready',
  );
  await expect(page.getByRole('status')).toContainText(/[1-9]\d* modified/);
  await expect(page.locator('.org-delta-node--modified')).toBeVisible();
  await expect(page.locator('.org-delta-node--modified')).toHaveCSS('border-left-style', 'dashed');
  await expect(page.getByRole('button', { name: /View changes/ }).first())
    .toBeVisible();
  await page.getByRole('button', { name: /View changes/ }).first().focus();
  await page.getByRole('button', { name: /View changes/ }).first().press('Enter');
  await expect(page.locator('aside.details')).toBeVisible();
  await page.getByRole('button', { name: 'Close details' }).click();

  const rename = page.getByRole('checkbox', { name: 'Rename the fictional Policy Lab' });
  const spinOut = page.getByRole('checkbox', { name: 'Spin out as a subordinate organization' });
  const retain = page.getByRole('checkbox', { name: 'Retain as an internal office' });
  await spinOut.uncheck();
  await rename.uncheck();
  await spinOut.check();
  await expect(rename).toBeChecked();
  await retain.check();
  await expect(spinOut).not.toBeChecked();
  await expect(page.getByRole('status')).toContainText(/modified|unchanged/);
});

test('hidden internal offices remain searchable and are revealed and centered', async ({ page }) => {
  await ready(page);
  await page.getByRole('checkbox', { name: 'Show internal units' }).uncheck();
  await expect(page.locator('[data-hidden-internal-count]')).toContainText('hidden');
  await expect(page.getByRole('button', { name: 'Office of Consular Demonstrations' }))
    .toHaveCount(0);

  const search = page.getByRole('combobox', { name: 'Find organization' });
  await search.fill('Consular demo office');
  await page.getByRole('button', { name: 'Office of Consular Demonstrations' }).click();
  await expect(page.locator('[data-activate-id="consular"]'))
    .toBeVisible();
  await expect(page.getByRole('status')).toHaveText(/Revealed Office of Consular Demonstrations/);
});

test('keyboard activations open notes in a responsive details surface', async ({ page }, testInfo) => {
  await ready(page);
  await page.getByRole('combobox', { name: 'View' }).selectOption('historical-demo');
  await expect(page.getByRole('status')).toContainText('Illustrative historical arrangement ready');
  const node = page.getByRole('button', { name: 'Department of State (illustrative)', exact: true });
  await node.focus();
  await node.press('Enter');
  await expect(page.getByRole('heading', { name: 'Department of State (illustrative)', level: 2 }))
    .toBeFocused();

  const geometry = await page.locator('aside.details').evaluate((panel) => {
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
  await page.getByRole('button', { name: 'Close details' }).click();
  await expect(node).toBeFocused();

  const internal = page.getByRole('button', { name: 'State Headquarters', exact: true });
  await expect(internal).toHaveCount(1);
  await internal.focus();
  await internal.press('Enter');
  await expect(page.locator('.details__note')).toHaveText('Illustrative headquarters container.');
  await page.getByRole('button', { name: 'Close details' }).click();

  const hierarchy = page.locator(
    '[data-activate-kind="hierarchy"][aria-label*="subordinate relationship"]',
  );
  await expect(hierarchy).toHaveCount(1);
  await hierarchy.focus();
  await hierarchy.press('Enter');
  await expect(page.locator('.details__kind')).toHaveText('Subordinate hierarchy');
  await expect(page.locator('.details__note')).toHaveText('Illustrative demo placement.');
  await page.getByRole('button', { name: 'Close details' }).click();

  const relationship = page.locator(
    '[data-relationship-id="illustrative-shared-leadership"][tabindex="0"]',
  );
  await expect(relationship).toHaveCount(1);
  await relationship.focus();
  await relationship.press('Enter');
  await expect(page.getByRole('heading', {
    name: 'Shared-leadership-style cross-link', level: 2,
  })).toBeVisible();
  await expect(page.locator('.details__note')).toHaveText(
    'Illustrative relationship used to demonstrate cross-links; consult authoritative sources for actual command arrangements.',
  );
  await page.getByRole('button', { name: 'Close details' }).click();
});

test('visible organization tree supports roving arrow traversal and activation', async ({ page }) => {
  await ready(page);
  const tree = page.getByRole('tree', { name: 'Organization hierarchy' });
  await expect(tree).toBeVisible();
  const items = tree.getByRole('treeitem');
  expect(await items.count()).toBeGreaterThan(1);
  await expect(items.first()).toHaveAttribute('aria-level', /[1-9]/);
  await expect(items.first()).toHaveAttribute('tabindex', '0');
  await items.first().focus();
  await items.first().press('ArrowDown');
  await expect(items.nth(1)).toBeFocused();
  await expect(items.nth(1)).toHaveCSS('outline-style', 'solid');
  await expect(items.nth(1)).toHaveCSS('outline-width', '3px');
  await items.nth(1).press('ArrowUp');
  await expect(items.first()).toBeFocused();
  await items.first().press('Enter');
  await expect(page.locator('aside.details')).toBeVisible();
  await page.getByRole('button', { name: 'Close details' }).click();

  const expandable = tree.locator('[role="treeitem"][aria-expanded="true"]').first();
  await expect(expandable).toHaveCount(1);
  await tree.evaluate((svg) => {
    const modes = ['display', 'visibility', 'opacity', 'hidden', 'aria-hidden', 'inert', 'rect'];
    for (const mode of modes) {
      const wrapper = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      wrapper.dataset.hiddenFocusFixture = mode;
      if (mode === 'display') wrapper.style.display = 'none';
      if (mode === 'visibility') wrapper.style.visibility = 'hidden';
      if (mode === 'opacity') wrapper.style.opacity = '0';
      if (mode === 'hidden') wrapper.setAttribute('hidden', '');
      if (mode === 'aria-hidden') wrapper.setAttribute('aria-hidden', 'true');
      if (mode === 'inert') wrapper.setAttribute('inert', '');
      const item = document.createElement('button');
      item.dataset.treeNode = '';
      item.dataset.nodeId = `hidden-${mode}`;
      item.tabIndex = 0;
      if (mode === 'rect') {
        item.style.position = 'absolute';
        item.style.width = '0';
        item.style.height = '0';
      }
      wrapper.append(item);
      svg.append(wrapper);
    }
  });
  const nodeId = await expandable.getAttribute('data-node-id');
  await expandable.focus();
  await expandable.press(' ');
  const collapsed = tree.locator(`[role="treeitem"][data-node-id="${nodeId}"]`);
  await expect(collapsed).toHaveAttribute('aria-expanded', 'false');
  await expect(collapsed).toBeFocused();
  await expect(collapsed).toHaveCSS('outline-style', 'solid');
  const hiddenFixtures = page.locator('[data-hidden-focus-fixture] [data-tree-node]');
  await expect(hiddenFixtures).toHaveCount(7);
  for (const fixture of await hiddenFixtures.all()) {
    await expect(fixture).toHaveAttribute('tabindex', '-1');
  }
  await collapsed.press('ArrowRight');
  await expect(tree.locator(`[role="treeitem"][data-node-id="${nodeId}"]`))
    .toHaveAttribute('aria-expanded', 'true');
  await tree.locator(`[role="treeitem"][data-node-id="${nodeId}"]`).press('ArrowLeft');
  await expect(tree.locator(`[role="treeitem"][data-node-id="${nodeId}"]`))
    .toHaveAttribute('aria-expanded', 'false');
});

test('accessibility semantics describe hierarchy, internals, relationships, and changes', async ({ page }) => {
  await ready(page);
  const treeitems = page.getByRole('treeitem');
  expect(await treeitems.count()).toBeGreaterThan(0);
  for (const item of await treeitems.all()) {
    await expect(item).toHaveAttribute('aria-level');
  }
  await expect(page.locator('[data-internal-id="state-hq"]')).toHaveAttribute(
    'aria-label', /internal unit/i,
  );
  await expect(page.locator(
    '[data-relationship-id="illustrative-shared-leadership"][tabindex="0"]',
  )).toHaveAttribute(
      'aria-label', /Shared-leadership-style cross-link/,
    );
  await expect(page.locator('.org-delta-relationship-descriptions')).toContainText(
    'Shared-leadership-style cross-link',
  );
  await expect(page.locator('.org-delta-node--unchanged').first()).toHaveAttribute(
    'data-diff-kind', 'unchanged',
  );
  await expect(page.locator('.org-delta-node--unchanged').first()).toHaveCSS('border-left-style', /solid|double|dashed/);
  await expect(page.locator('[aria-hidden="true"] [tabindex="0"]')).toHaveCount(0);
  await expect(page.locator('[style*="display: none"] [tabindex="0"]')).toHaveCount(0);
  const focusTargets = page.locator(
    '[tabindex], a[href], button, input, select, textarea',
  );
  for (const target of await focusTargets.all()) {
    const state = await target.evaluate((element) => {
      let current: Element | null = element;
      let hidden = false;
      let excludedByLayout = false;
      while (current) {
        const style = getComputedStyle(current);
        const layoutHidden = current.hasAttribute('hidden') || current.hasAttribute('inert')
          || style.display === 'none' || style.visibility === 'hidden'
          || style.visibility === 'collapse';
        excludedByLayout ||= layoutHidden;
        hidden ||= layoutHidden || current.getAttribute('aria-hidden') === 'true'
          || Number(style.opacity) === 0;
        current = current.parentElement;
      }
      const rect = element.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) {
        hidden = true;
        excludedByLayout = true;
      }
      return { hidden, excludedByLayout, tabIndex: (element as HTMLElement).tabIndex };
    });
    if (state.hidden) expect(state.excludedByLayout || state.tabIndex < 0).toBe(true);
  }
});

test('reduced motion removes transition and animation duration', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await ready(page);
  const node = page.locator('.org-delta-node').first();
  await expect(node).toHaveCSS('transition-duration', '0s');
  await expect(node).toHaveCSS('animation-duration', '0s');
  await page.getByRole('combobox', { name: 'View' }).selectOption('spin-out-proposal');
  await expect(page.getByRole('status')).toContainText('ready');
  await expect(page.locator('.org-delta-node').first()).toBeAttached();
});

test('forced colors mode keeps the chart operable', async ({ page }) => {
  await page.emulateMedia({ forcedColors: 'active' });
  await ready(page);
  expect(await page.evaluate(() => matchMedia('(forced-colors: active)').matches)).toBe(true);
  expect(await page.locator('org-delta-chart').evaluate((chart) =>
    getComputedStyle(chart).getPropertyValue('--org-delta-forced-colors').trim()
  )).toBe('active');
  await expect(page.locator('.chart-shell')).toBeVisible();
  await page.getByRole('combobox', { name: 'View' }).selectOption('spin-out-proposal');
  const modified = page.locator('.org-delta-node--modified');
  await expect(modified).toHaveCSS('border-left-style', 'dashed');
  await expect(modified).toHaveCSS('border-left-width', '8px');
  await expect(page.locator('.org-delta-connector--relationship').first())
    .toHaveCSS('stroke', /rgb|rgba/);
  await page.getByRole('button', { name: 'Fit chart' }).click();
  await expect(page.getByRole('tree', { name: 'Organization hierarchy' })).toBeVisible();
});
