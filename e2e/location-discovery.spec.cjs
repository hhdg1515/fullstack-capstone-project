const { randomUUID } = require('node:crypto');
const AxeBuilder = require('@axe-core/playwright').default;
const { test: base, expect } = require('./fixtures.cjs');
const { localEnvironment } = require('./local.cjs');
const test = base.extend({ deployment: [async ({}, use) => {
  if (process.env.E2E_APP_ORIGIN) throw Error('Location fixtures are local only');
  const local = await localEnvironment(); try { await use(local); } finally { await local.close(); }
}, { scope: 'worker', timeout: 180000 }] });
test.skip(Boolean(process.env.E2E_APP_ORIGIN), 'Location/category fixtures never use hosted resources');

test('regional discovery, structured items, counts and ownership work without changing plan location', async ({ browser, deployment }, testInfo) => {
  const options = { ...testInfo.project.use, baseURL: deployment.origin, ignoreHTTPSErrors: true,
    extraHTTPHeaders: { 'X-Deployment-Target': deployment.fingerprint }, ...(testInfo.project.name === 'mobile' ? { viewport: { width: 320, height: 740 } } : {}) };
  delete options.launchOptions; delete options.trace; delete options.screenshot; delete options.video;
  const contexts = [];
  const post = async (context, url, data) => {
    const result = await context.request.post(url, { maxRedirects: 0, headers: { Origin: deployment.origin, 'X-CSRF-Protection': '1' }, data });
    expect(result.ok()).toBe(true); return result.json();
  };
  const account = async name => {
    const context = await browser.newContext(options); contexts.push(context);
    await post(context, '/api/auth/register', { firstName: name, lastName: 'Local', email: randomUUID() + '@example.invalid', password: randomUUID() + '!' }); return context;
  };
  const day = n => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
  try {
    const giver = await account('Giver'), receiver = await account('Receiver');
    const a = await giver.newPage();
    await a.goto('/app/plans/new');
    await a.getByLabel('State', { exact: true }).selectOption('06'); await a.getByLabel('Metro area', { exact: true }).selectOption('41860');
    await expect(a.getByLabel('Pickup timezone (needed to receive requests)', { exact: true })).toHaveValue('America/Los_Angeles');
    for (const [label, value] of [['Move-out deadline', day(10)], ['City', 'Oakland'], ['Neighborhood', 'Temescal']]) await a.getByLabel(label, { exact: true }).fill(value);
    await a.getByRole('button', { name: 'Create plan', exact: true }).click(); await expect(a.getByRole('link', { name: 'Manage items', exact: true })).toBeVisible();
    const planId = a.url().split('/').pop(); await a.getByRole('link', { name: 'Manage items', exact: true }).click();
    await a.getByLabel('Item name', { exact: true }).fill('Comfortable seat');
    await a.getByLabel('Category', { exact: true }).selectOption('living-room'); await a.getByLabel('Item type', { exact: true }).selectOption('sofa');
    await a.getByLabel('Description', { exact: true }).fill('A comfortable local sofa.');
    await a.getByLabel('Condition (optional)', { exact: true }).selectOption('good');
    await a.getByRole('button', { name: 'Publish', exact: true }).click();
    const card = a.getByRole('heading', { name: 'Comfortable seat', exact: true }).locator('xpath=ancestor::li[1]'); await expect(card.getByText('Sofa · Good', { exact: true })).toBeVisible();
    const itemId = (await card.getByRole('link', { name: 'Public listing', exact: true }).getAttribute('href')).split('/').pop();
    const { item: reserved } = await post(giver, '/api/move-out-plans/' + planId + '/items', { description: "A household item for local pickup.", name: 'Reserved sofa', categoryId: 'living-room', itemTypeId: 'sofa', publish: true });
    const { request: pickup } = await post(receiver, '/api/pickup-requests', { itemId: reserved.id, localDateTime: day(2) + 'T12:00', timeZone: 'America/Los_Angeles' });
    await post(giver, '/api/pickup-requests/' + pickup.id + '/actions', { version: pickup.version, action: 'accept' });
    const { plan: distant } = await post(giver, '/api/move-out-plans', { city: 'Los Angeles', neighborhood: 'Echo Park', stateId: '06', metroId: '31080', pickupTimeZone: 'America/Los_Angeles', moveOutDeadline: day(10) });
    await post(giver, '/api/move-out-plans/' + distant.id + '/items', { description: "A household item for local pickup.", name: 'Other metro couch', categoryId: 'living-room', itemTypeId: 'sofa', publish: true });
    const anonymous = await browser.newContext(options); contexts.push(anonymous); const page = await anonymous.newPage(); let listingGets = 0;
    page.on('request', value => { if (value.url().includes('/api/items?')) listingGets++; });
    await page.goto('/app/items'); await expect(page.getByRole('heading', { name: 'Where would you like to find free items?', exact: true })).toBeVisible();
    expect(listingGets).toBe(0);
    await page.getByLabel('State', { exact: true }).selectOption('06'); expect(listingGets).toBe(0);
    await page.getByLabel('Metro area', { exact: true }).selectOption('41860');
    await expect(page.getByRole('heading', { name: /1 available/ })).toBeVisible();
    const results = page.getByRole('list', { name: 'Available items', exact: true });
    await expect(results.getByRole('link', { name: 'Comfortable seat', exact: true })).toBeVisible(); await expect(results.getByText('Sofa · Living Room', { exact: true })).toBeVisible(); await expect(results.getByText('Condition: Good', { exact: true })).toBeVisible();
    await expect(results.getByText('Reserved sofa', { exact: true })).toHaveCount(0); await expect(results.getByText('Other metro couch', { exact: true })).toHaveCount(0);
    await page.getByLabel('Search items', { exact: true }).fill('couch'); await page.getByRole('button', { name: 'Find free items', exact: true }).click();
    await expect(results.getByRole('link', { name: 'Comfortable seat', exact: true })).toBeVisible();
    await page.getByRole('button', { name: /^Filters/ }).click(); await page.getByLabel('Category', { exact: true }).selectOption('living-room');
    await page.getByLabel('Item type', { exact: true }).selectOption('sofa'); await page.getByLabel('Condition', { exact: true }).selectOption('fair');
    await page.getByRole('button', { name: 'Find free items', exact: true }).click(); await expect(page.getByRole('heading', { name: /0 available/ })).toBeVisible();
    await expect(page.getByText('No available items match these filters. Clear filters or try another search.', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Clear filters', exact: true }).click(); await expect(results.getByRole('link', { name: 'Comfortable seat', exact: true })).toBeVisible();
    const preference = await page.evaluate(() => JSON.parse(localStorage.getItem('moveout.browse-region.v1')));
    expect(preference).toEqual({ stateId: '06', metroId: '41860' });
    await page.goto('/app/items'); await expect(page.getByRole('heading', { name: /1 available/ })).toBeVisible();
    await page.getByRole('button', { name: 'Change region', exact: true }).click(); await page.getByLabel('Metro area', { exact: true }).selectOption('31080');
    await expect(results.getByRole('link', { name: 'Other metro couch', exact: true })).toBeVisible(); await expect(page.getByRole('heading', { name: /1 available/ })).toBeVisible();
    const savedPlan = await (await giver.request.get('/api/move-out-plans/' + planId)).json(); expect(savedPlan.plan.metroId).toBe('41860');
    await page.mouse.move(0, 0); await page.locator('main').evaluate(async node => { await Promise.all(node.getAnimations({ subtree: true }).map(animation => animation.finished.catch(() => {}))); });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    const violations = (await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations.map(row => row.id);
    await test.step('Regional discovery WCAG rules: ' + (violations.join(', ') || 'none'), async () => expect(violations).toEqual([]));
    await page.route('**/api/items?**', route => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: { code: 'DISCOVERY_BUSY', message: 'Search is busy. Retry.' } }) }));
    await page.getByRole('button', { name: 'Find free items', exact: true }).click(); await expect(page.getByRole('alert').filter({ hasText: 'Search is busy' })).toBeVisible();
    await expect(page.getByText(/No available items/)).toHaveCount(0);
    await a.goto('/app/items/' + itemId); await expect(a.getByText('Your listing. Manage this item from My plans.', { exact: true })).toBeVisible();
    await expect(a.getByRole('link', { name: 'Request pickup', exact: true })).toHaveCount(0);
    await a.goto('/app/items/' + itemId + '/request'); await expect(a.getByText('Your listing. You cannot request your own item. Manage it from My plans.', { exact: true })).toBeVisible();
    await expect(a.getByLabel('Pickup date and time', { exact: true })).toHaveCount(0);
  } finally { for (const context of contexts) await context.close(); }
});
