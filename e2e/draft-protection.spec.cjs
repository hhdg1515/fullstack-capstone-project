const { randomUUID } = require('node:crypto');
const { test, expect } = require('./fixtures.cjs');
test.skip(Boolean(process.env.E2E_APP_ORIGIN), 'Draft scenarios use only disposable local fixtures');
test('dirty forms survive declined navigation, native reload and local editor cancellation', async ({ isolatedBrowser: browser, deployment }, testInfo) => {
  const options = { ...testInfo.project.use, baseURL: deployment.origin, ignoreHTTPSErrors: true,
    extraHTTPHeaders: { 'X-Deployment-Target': deployment.fingerprint } };
  delete options.launchOptions; delete options.trace; delete options.screenshot; delete options.video;
  const context = await browser.newContext(options), page = await context.newPage();
  const dialogs = []; let accept = false;
  page.on('dialog', async dialog => { dialogs.push(dialog.type()); if (accept) await dialog.accept(); else await dialog.dismiss(); });
  const post = async (url, data) => { const result = await context.request.post(url, { maxRedirects: 0,
    headers: { Origin: deployment.origin, 'X-CSRF-Protection': '1' }, data }); expect(result.ok()).toBe(true); return result.json(); };
  try {
    await post('/api/auth/register', { firstName: 'Local', lastName: 'Draft', email: randomUUID() + '@example.invalid', password: randomUUID() + '!' });
    await page.goto('/app/plans'); await page.getByRole('link', { name: 'Create your first plan', exact: true }).click();
    const title = page.getByLabel('Plan title (optional)', { exact: true }); await title.fill('Unfinished move');
    await page.getByRole('link', { name: 'Move-Out Marketplace', exact: true }).click();
    await expect(title).toHaveValue('Unfinished move');
    await page.evaluate(() => history.back()); await expect.poll(() => dialogs.length).toBe(2);
    await expect(title).toHaveValue('Unfinished move');
    await page.reload({ timeout: 2000 }).catch(() => null); await expect(title).toHaveValue('Unfinished move');
    expect(dialogs).toEqual(['confirm', 'confirm', 'beforeunload']);
    accept = true; await page.getByRole('link', { name: 'Move-Out Marketplace', exact: true }).click();
    await page.waitForURL(deployment.origin + '/');
    const { plan } = await post('/api/move-out-plans', { city: 'Oakland', neighborhood: 'Temescal', pickupTimeZone: 'UTC', moveOutDeadline: new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10) });
    await post('/api/move-out-plans/' + plan.id + '/items', { name: 'Desk' });
    await page.goto('/app/plans/' + plan.id + '/items'); await page.getByRole('button', { name: 'Add item', exact: true }).click();
    const name = page.getByLabel('Item name', { exact: true }); await name.fill('Unfinished box');
    accept = false; await page.getByRole('button', { name: 'Edit Desk', exact: true }).click(); await expect(name).toHaveValue('Unfinished box');
    accept = true; await page.getByRole('button', { name: 'Edit Desk', exact: true }).click(); await expect(name).toHaveValue('Desk');
    await name.fill('Edited desk'); accept = false; await page.getByRole('button', { name: 'Cancel edit', exact: true }).click(); await expect(name).toHaveValue('Edited desk');
    accept = true; await page.getByRole('button', { name: 'Save Draft', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Edited desk', exact: true })).toBeVisible();
    const count = dialogs.length; await page.getByRole('link', { name: 'Back to plan', exact: true }).click();
    await expect(page.getByRole('link', { name: 'Manage items', exact: true })).toBeVisible(); expect(dialogs.length).toBe(count);
  } finally { await context.close(); }
});
