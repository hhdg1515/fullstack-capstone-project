const { randomUUID } = require('node:crypto');
const fs = require('node:fs'); const path = require('node:path');
const AxeBuilder = require('@axe-core/playwright').default;
const { test: base, expect } = require('./fixtures.cjs');
const { localEnvironment } = require('./local.cjs');
const test = base.extend({ deployment: [async ({}, use) => {
  if (process.env.E2E_APP_ORIGIN) throw Error('Classification fixtures are local only');
  const local = await localEnvironment(); try { await use(local); } finally { await local.close(); }
}, { scope: 'worker', timeout: 180000 }] });
test.skip(Boolean(process.env.E2E_APP_ORIGIN), 'Classification fixtures never use hosted resources');
test('searchable types, explicit fallback, existing edits and category discovery stay compatible', async ({ browser, deployment }, info) => {
  const mobile = info.project.name === 'mobile';
  const context = await browser.newContext({ viewport: { width: mobile ? 320 : 1440, height: mobile ? 740 : 1000 }, baseURL: deployment.origin,
    ignoreHTTPSErrors: true, extraHTTPHeaders: { 'X-Deployment-Target': deployment.fingerprint } });
  const post = async (url, data) => {
    const result = await context.request.post(url, { headers: { Origin: deployment.origin, 'X-CSRF-Protection': '1' }, data }); expect(result.ok()).toBe(true); return result.json();
  };
  const day = n => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
  const page = await context.newPage();
  const evidence = async name => {
    if (!process.env.CLASSIFICATION_SCREENSHOTS) return;
    const directory = path.join(__dirname, '../docs/verification/item-classification'); fs.mkdirSync(directory, { recursive: true });
    // A tall capture viewport avoids Chromium painting an offscreen fixed skip link
    // into stitched screenshots. Interaction/reflow/axe still use the normal viewport.
    const viewport = page.viewportSize();
    try {
      await page.setViewportSize({ width: viewport.width, height: Math.max(viewport.height, await page.evaluate(() => document.documentElement.scrollHeight)) });
      await page.screenshot({ path: path.join(directory, `${mobile ? 'mobile' : 'desktop'}-${name}.png`), fullPage: true });
    } finally { await page.setViewportSize(viewport); }
  };
  const axe = async name => {
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    const errors = (await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations.map(row => row.id);
    await test.step('Classification ' + name + ' WCAG rules: ' + (errors.join(', ') || 'none'), async () => expect(errors).toEqual([]));
  };
  try {
    await post('/api/auth/register', { firstName: 'Local', lastName: 'Giver', email: randomUUID() + '@example.invalid', password: randomUUID() + '!' });
    const { plan } = await post('/api/move-out-plans', { title: 'Local classification review', city: 'Oakland', neighborhood: 'Temescal', stateId: '06', metroId: '41860', pickupTimeZone: 'America/Los_Angeles', moveOutDeadline: day(10) });
    const inventory = '/app/plans/' + plan.id + '/items';
    await page.goto(inventory); await page.getByLabel('Item name', { exact: true }).fill('Household item');
    const type = page.getByRole('combobox', { name: 'Item type', exact: true });
    await expect(type).toBeEnabled(); await type.fill('tv');
    await expect(page.getByRole('option', { name: 'Television Living Room', exact: true })).toBeVisible();
    await evidence('search'); await axe('search');
    await type.press('Escape'); await expect(type).toHaveAttribute('aria-expanded', 'false');
    await type.press('Tab'); await expect(page.getByRole('button', { name: 'Clear item type', exact: true })).toBeFocused();
    await expect(type).toHaveValue('tv');
    page.once('dialog', dialog => { expect(dialog.type()).toBe('confirm'); return dialog.dismiss(); });
    await page.getByRole('link', { name: 'Back to plan', exact: true }).click();
    await expect(page).toHaveURL(deployment.origin + inventory); await expect(type).toHaveValue('tv');
    await type.fill('television'); await type.press('ArrowDown'); await type.press('Enter');
    await expect(type).toHaveValue('Television'); await expect(type).toBeFocused();
    await expect(page.getByLabel('Category', { exact: true })).toHaveCount(0);
    await page.getByLabel('Description', { exact: true }).fill('A synthetic television for local testing.');
    await page.getByRole('button', { name: 'Publish', exact: true }).click();
    let card = page.getByRole('heading', { name: 'Household item', exact: true }).locator('xpath=ancestor::li[1]');
    await expect(card.getByText('Television', { exact: true })).toBeVisible();
    await expect(page.getByLabel('Item name', { exact: true })).toHaveCount(0);
    await card.getByRole('button', { name: 'Edit Household item', exact: true }).click(); await expect(type).toHaveValue('Television');
    await type.fill('bike'); await type.press('ArrowDown'); await type.press('Enter'); await expect(type).toHaveValue('Bicycle');
    page.once('dialog', dialog => dialog.accept()); await page.getByRole('button', { name: 'Save Changes', exact: true }).click();
    await expect(card.getByText('Bicycle', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Add item', exact: true }).click();
    await page.getByLabel('Item name', { exact: true }).fill('Useful equipment'); await type.fill('sewing machine');
    await expect(page.getByRole('status').filter({ hasText: 'No matching types' })).toBeVisible();
    await page.getByRole('option', { name: 'Other Other Household', exact: true }).click();
    const custom = page.getByLabel('Custom type (optional)', { exact: true });
    await custom.fill('Sewing machine'); await page.getByLabel('Description', { exact: true }).fill('A synthetic sewing machine.');
    await evidence('custom'); await axe('custom');
    await custom.fill('<script>'); await page.getByRole('button', { name: 'Publish', exact: true }).click(); await expect(custom).toBeFocused();
    await expect(custom).toHaveAttribute('aria-invalid', 'true'); await evidence('invalid'); await axe('invalid');
    await custom.fill('Sewing machine');
    await page.getByRole('button', { name: 'Publish', exact: true }).click();
    card = page.getByRole('heading', { name: 'Useful equipment', exact: true }).locator('xpath=ancestor::li[1]');
    await expect(card.getByText('Sewing machine', { exact: true })).toBeVisible(); await evidence('inventory'); await axe('inventory');
    const items = (await (await context.request.get('/api/move-out-plans/' + plan.id + '/items')).json()).items;
    expect(items).toHaveLength(2); expect(items.find(row => row.name === 'Household item').classification.category.id).toBe('other-household');
    const customItem = items.find(row => row.name === 'Useful equipment'); expect(customItem.classification.customItemType).toBe('Sewing machine');
    await page.goto('/app/items?stateId=06&metroId=41860&q=sewing+machine&categoryId=other-household&itemTypeId=other');
    await expect(page.getByRole('heading', { name: /1 available/ })).toBeVisible(); await expect(page.getByRole('link', { name: 'Useful equipment', exact: true })).toBeVisible();
    await expect(page.getByText('Sewing machine · Other Household', { exact: true })).toBeVisible(); await evidence('discovery'); await axe('discovery');
    // 375px gets the same controls and no horizontal overflow, in addition to 320px checks above.
    if (mobile) { await page.setViewportSize({ width: 375, height: 812 }); await page.goto(inventory); await page.getByRole('button', { name: 'Add item', exact: true }).click(); await type.fill('vacuum'); await expect(page.getByRole('option', { name: 'Vacuum Cleaner Other Household', exact: true })).toBeVisible(); await evidence('375-search'); await axe('375'); }
  } finally { await context.close(); }
});
