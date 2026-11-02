const { selectItemType } = require('./item-type.cjs');
const { randomUUID } = require('node:crypto');
const AxeBuilder = require('@axe-core/playwright').default;
const { test: base, expect } = require('./fixtures.cjs');
const { localEnvironment } = require('./local.cjs');
const test = base.extend({ deployment: [async ({}, use) => {
  if (process.env.E2E_APP_ORIGIN) throw Error('Listing refinement fixtures are local only');
  const local = await localEnvironment(); try { await use(local); } finally { await local.close(); }
}, { scope: 'worker', timeout: 180000 }] });
test.skip(Boolean(process.env.E2E_APP_ORIGIN), 'Inventory evidence never uses hosted data');

test('giver publishes a draft, distinguishes reservations and handoffs, and recovers unsaved/conflicting edits', async ({ isolatedBrowser: browser, deployment }, testInfo) => {
  const options = { baseURL: deployment.origin, ignoreHTTPSErrors: true,
    viewport: { width: testInfo.project.name === 'mobile' ? 320 : 1440, height: 1000 },
    extraHTTPHeaders: { 'X-Deployment-Target': deployment.fingerprint } };
  const giver = await browser.newContext(options), receiver = await browser.newContext(options);
  const headers = { Origin: deployment.origin, 'X-CSRF-Protection': '1' };
  const call = async (context, method, url, data) => {
    const result = await context.request[method](url, { headers, data }); expect(result.ok()).toBe(true); return result.json();
  };
  const day = n => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
  try {
    for (const [context, firstName] of [[giver, 'Local Giver'], [receiver, 'Local Receiver']]) await call(context, 'post', '/api/auth/register', { firstName, lastName: 'Inventory', email: randomUUID() + '@example.invalid', password: randomUUID() + '!' });
    const page = await giver.newPage(); let confirm = true; page.on('dialog', dialog => confirm ? dialog.accept() : dialog.dismiss());
    const audit = async state => {
      await page.mouse.move(0, 0); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
      const rules = (await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations.map(r => r.id);
      await test.step(state + ' WCAG rules: ' + (rules.join(', ') || 'none'), async () => expect(rules).toEqual([]));
    };
    await page.goto('/app/plans/new');
    await page.getByLabel('State', { exact: true }).selectOption('06'); await page.getByLabel('Metro area', { exact: true }).selectOption('41860');
    const zone = page.getByLabel('Pickup timezone (needed to receive requests)', { exact: true });
    await expect(zone).toHaveValue('America/Los_Angeles'); await expect(zone).toBeHidden();
    await page.getByText('Change pickup timezone', { exact: true }).click(); await zone.fill('UTC');
    await page.getByLabel('Metro area', { exact: true }).selectOption('31080'); await expect(zone).toHaveValue('UTC');
    for (const [label, value] of [['Move-out deadline', day(10)], ['City', 'Los Angeles'], ['Neighborhood', 'Local area']]) await page.getByLabel(label, { exact: true }).fill(value);
    await page.getByRole('button', { name: 'Create plan', exact: true }).click(); await expect(page.getByRole('link', { name: 'Manage items', exact: true })).toBeVisible();
    const planId = new URL(page.url()).pathname.split('/').pop(), root = '/api/move-out-plans/' + planId + '/items';
    await page.getByRole('link', { name: 'Manage items', exact: true }).click();
    let creations = 0, patches = 0;
    page.on('request', request => { const url = new URL(request.url()); if (url.pathname === root && request.method() === 'POST') creations++; if (url.pathname.startsWith(root + '/') && request.method() === 'PATCH') patches++; });
    await page.getByRole('button', { name: 'Publish', exact: true }).click(); await expect(page.getByLabel('Item name', { exact: true })).toBeFocused();
    await page.getByLabel('Item name', { exact: true }).fill('Local chair');
    await page.getByRole('button', { name: 'Publish', exact: true }).click(); await expect(page.getByLabel('Item type', { exact: true })).toBeFocused();
    await audit('Publication errors'); expect(creations).toBe(0);
    await page.getByRole('button', { name: 'Save Draft', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Local chair', exact: true })).toBeVisible(); expect(creations).toBe(1);
    await expect(page.getByLabel('Item name', { exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Use plan availability', exact: true })).toHaveCount(0);
    await expect(page.getByLabel('Available until (optional)', { exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: 'Edit Local chair', exact: true }).click();
    await selectItemType(page, 'office-chair');
    await page.getByLabel('Description', { exact: true }).fill('Local chair with a detailed description. '.repeat(15));
    await page.getByText('More details', { exact: true }).click(); await page.getByLabel('Condition (optional)', { exact: true }).selectOption('good');
    await page.getByRole('button', { name: 'Publish', exact: true }).evaluate(node => { node.click(); node.click(); });
    const card = name => page.getByRole('heading', { name, exact: true }).locator('xpath=ancestor::li[1]');
    await expect(card('Local chair').getByText('Posted', { exact: true })).toBeVisible(); expect(patches).toBe(1); await audit('Posted inventory');
    const itemId = (await card('Local chair').getByRole('link', { name: 'Public listing', exact: true }).getAttribute('href')).split('/').pop();
    const { request } = await call(receiver, 'post', '/api/pickup-requests', { itemId, localDateTime: day(1) + 'T12:00', timeZone: 'UTC' });
    const { request: accepted } = await call(giver, 'post', '/api/pickup-requests/' + request.id + '/actions', { action: 'accept', version: request.version });
    await page.getByRole('button', { name: 'Refresh inventory', exact: true }).click(); await expect(card('Local chair').getByText('Reserved', { exact: true })).toBeVisible();
    await expect(card('Local chair').getByText('Picked Up', { exact: true })).toHaveCount(0); await audit('Reserved inventory');
    await expect(card('Local chair').getByRole('button', { name: 'Hide Local chair', exact: true })).toHaveCount(0);
    await expect(card('Local chair').getByText('Reserved', { exact: true })).toBeVisible(); confirm = true;
    const { item: manual } = await call(giver, 'post', root, { name: 'Local manually dealt with item' });
    await page.getByRole('button', { name: 'Refresh inventory', exact: true }).click(); await expect(card(manual.name)).toBeVisible();
    await card(manual.name).locator('summary').click(); confirm = false;
    await card(manual.name).getByRole('button', { name: 'Mark ' + manual.name + ' cleared', exact: true }).click(); await expect(card(manual.name).getByText('Draft', { exact: true })).toBeVisible();
    confirm = true; await card(manual.name).getByRole('button', { name: 'Mark ' + manual.name + ' cleared', exact: true }).click();
    await expect(card(manual.name).getByText('Cleared', { exact: true })).toBeVisible();
    deployment.advance(Date.parse(accepted.proposedAt) + 1000);
    await call(giver, 'post', '/api/pickup-requests/' + accepted.id + '/actions', { action: 'complete', version: accepted.version });
    await page.getByRole('button', { name: 'Refresh inventory', exact: true }).click();
    await expect(card('Local chair').getByText('Picked Up', { exact: true })).toBeVisible(); await expect(page.getByText('2 of 2 items cleared', { exact: true })).toBeVisible(); await audit('Completed and manual clearance');
    await card(manual.name).getByRole('button', { name: 'Edit ' + manual.name, exact: true }).click();
    const description = page.getByLabel('Description', { exact: true }); await description.fill('Unsaved local description');
    confirm = false; await page.getByRole('button', { name: 'Cancel edit', exact: true }).click(); await expect(description).toHaveValue('Unsaved local description');
    await page.getByRole('link', { name: 'Back to plan', exact: true }).click(); await expect(description).toHaveValue('Unsaved local description');
    const state = (await call(giver, 'get', root)).items.find(row => row.id === manual.id);
    await call(giver, 'patch', root + '/' + manual.id, { version: state.version, name: 'Local newer saved item' });
    await page.getByRole('button', { name: 'Save Changes', exact: true }).click(); await expect(page.getByRole('alert')).toContainText('This item changed');
    await expect(description).toHaveValue('Unsaved local description'); await audit('Version conflict');
    confirm = true; await page.getByRole('button', { name: 'Refresh inventory', exact: true }).click(); await expect(page.getByLabel('Item name', { exact: true })).toHaveValue('Local newer saved item');
    expect(deployment.serverErrors).toEqual([]);
  } finally { await giver.close(); await receiver.close(); }
});
