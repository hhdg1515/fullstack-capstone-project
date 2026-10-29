const { randomUUID } = require('node:crypto');
const { test, expect } = require('./fixtures.cjs');
test.skip(Boolean(process.env.E2E_APP_ORIGIN), 'Inventory UX fixtures are confined to disposable local data');

test('owner configures pickup explicitly and manages items before entering a repeated-add flow', async ({ browser, deployment }, testInfo) => {
  const options = { ...testInfo.project.use, baseURL: deployment.origin, ignoreHTTPSErrors: true,
    extraHTTPHeaders: { 'X-Deployment-Target': deployment.fingerprint } };
  delete options.launchOptions; delete options.trace; delete options.screenshot; delete options.video;
  const context = await browser.newContext(options), page = await context.newPage();
  const post = async (url, data) => {
    const response = await context.request.post(url, { maxRedirects: 0, headers: { Origin: deployment.origin, 'X-CSRF-Protection': '1' }, data });
    expect(response.ok()).toBe(true); return response.json();
  };
  try {
    await post('/api/auth/register', { firstName: 'Local', lastName: 'Owner', email: randomUUID() + '@example.invalid', password: randomUUID() + '!' });
    const { plan } = await post('/api/move-out-plans', { city: 'Oakland', neighborhood: 'Temescal', moveOutDeadline: new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10) });
    for (const name of ['Desk', 'Lamp']) await post('/api/move-out-plans/' + plan.id + '/items', { name });
    await page.goto('/app/plans/' + plan.id + '/items');
    await expect(page.getByLabel('Item name', { exact: true })).toBeHidden();
    await page.getByRole('link', { name: 'Set pickup timezone', exact: true }).click();
    const zone = page.getByLabel('Pickup timezone (needed to receive requests)', { exact: true });
    await expect(zone).toBeFocused(); await expect(zone).toHaveValue('');
    await zone.fill('UTC'); await page.getByRole('button', { name: 'Save changes', exact: true }).click();
    await page.getByRole('link', { name: 'Manage items', exact: true }).click();
    await expect(page.getByRole('link', { name: 'Set pickup timezone', exact: true })).toHaveCount(0);
    const inventory = page.getByRole('region', { name: 'Inventory items', exact: true });
    await expect(inventory.getByRole('heading', { name: 'Desk', exact: true })).toBeInViewport();
    for (const name of ['Box of mugs', 'Dining chairs']) {
      await page.getByRole('button', { name: 'Add item', exact: true }).click();
      const input = page.getByLabel('Item name', { exact: true }); await expect(input).toBeFocused(); await input.fill(name);
      await page.getByRole('button', { name: 'Save Draft', exact: true }).click();
      await expect(inventory.getByRole('heading', { name, exact: true })).toBeVisible();
      await expect(input).toHaveCount(0);
    }
    await expect(page.getByLabel('Item name', { exact: true })).toBeHidden();
  } finally { await context.close(); }
});
