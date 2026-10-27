const { randomUUID } = require('node:crypto');
const AxeBuilder = require('@axe-core/playwright').default;
const { test: base, expect } = require('./fixtures.cjs');
const { localEnvironment } = require('./local.cjs');
const test = base.extend({ deployment: [async ({}, use) => {
  if (process.env.E2E_APP_ORIGIN) throw Error('Discovery UX fixtures are local only');
  const local = await localEnvironment(); try { await use(local); } finally { await local.close(); }
}, { scope: 'worker', timeout: 180000 }] });
test.skip(Boolean(process.env.E2E_APP_ORIGIN), 'Discovery UX fixtures never use hosted resources');

test('expanded areas, responsive filters, truthful cards and recovery preserve server regional counts', async ({ browser, deployment }, testInfo) => {
  const options = { ...testInfo.project.use, baseURL: deployment.origin, ignoreHTTPSErrors: true,
    extraHTTPHeaders: { 'X-Deployment-Target': deployment.fingerprint } };
  delete options.launchOptions; delete options.trace; delete options.screenshot; delete options.video;
  const contexts = [];
  const context = async () => { const value = await browser.newContext(options); contexts.push(value); return value; };
  const post = async (actor, url, data) => {
    const res = await actor.request.post(url, { headers: { Origin: deployment.origin, 'X-CSRF-Protection': '1' }, data });
    expect(res.ok()).toBe(true); return res.status() === 204 ? {} : res.json();
  };
  const day = n => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
  const audit = async (page, name) => {
    await page.mouse.move(0, 0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    const violations = (await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations.map(row => row.id);
    await test.step('Discovery ' + name + ' WCAG rules: ' + (violations.join(', ') || 'none'), async () => expect(violations).toEqual([]));
    for (const control of await page.locator('main button:visible, main select:visible, main input:visible').all()) expect((await control.boundingBox()).height).toBeGreaterThanOrEqual(44);
  };
  try {
    const giver = await context(), receiver = await context(), anonymous = await context();
    for (const actor of [giver, receiver]) await post(actor, '/api/auth/register', { firstName: 'Local', lastName: 'Discovery', email: randomUUID() + '@example.invalid', password: randomUUID() + '!' });
    const makePlan = async (stateId, metroId, city) => (await post(giver, '/api/move-out-plans', { stateId, metroId, city, neighborhood: 'Local neighborhood', pickupTimeZone: 'UTC', moveOutDeadline: day(15) })).plan;
    const pa = await makePlan('42', '37980', 'Philadelphia'), de = await makePlan('10', '37980', 'Wilmington'), other = await makePlan('20', '28140', 'Kansas City');
    const makeItem = async (plan, name, extra = {}) => (await post(giver, '/api/move-out-plans/' + plan.id + '/items', { name,
      description: 'Synthetic household item for local browser verification.', categoryId: 'living-room', itemTypeId: 'sofa', condition: 'good', publish: true, ...extra })).item;
    const first = await makeItem(pa, 'Comfortable reading sofa with a long name that wraps on narrow screens');
    await makeItem(de, 'Wilmington reading sofa'); await makeItem(other, 'Different metro sofa');
    await makeItem(pa, 'Private draft sofa', { publish: false });
    const reserved = await makeItem(pa, 'Reserved sofa');
    const { request } = await post(receiver, '/api/pickup-requests', { itemId: reserved.id, localDateTime: day(2) + 'T12:00', timeZone: 'UTC' });
    await post(giver, '/api/pickup-requests/' + request.id + '/actions', { action: 'accept', version: request.version });
    const page = await anonymous.newPage(); let gets = 0;
    page.on('request', req => { if (new URL(req.url()).pathname === '/api/items') gets++; });
    let releaseCatalog;
    const catalogGate = new Promise(resolve => { releaseCatalog = resolve; });
    await page.route('**/api/regions', async route => { await catalogGate; await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: { message: 'Local catalog unavailable' } }) }); });
    await page.goto('/app/items'); await expect(page.getByText('Loading region options…', { exact: true })).toBeVisible();
    expect(gets).toBe(0); releaseCatalog();
    await expect(page.getByRole('alert')).toContainText('Region options are unavailable');
    await audit(page, 'region catalog error'); expect(gets).toBe(0);
    await page.unroute('**/api/regions'); await page.getByRole('button', { name: 'Retry region options', exact: true }).click();
    await expect(page.getByRole('option', { name: 'Wyoming', exact: true })).toBeAttached();
    expect(gets).toBe(0);
    await page.evaluate(() => localStorage.setItem('moveout.browse-region.v1', JSON.stringify({ stateId: '06', metroId: 'unknown' })));
    await page.goto('/app/items'); await expect(page.getByLabel('State', { exact: true })).toHaveValue(''); expect(gets).toBe(0);
    await page.getByLabel('State', { exact: true }).selectOption('42'); await page.getByLabel('Metro area', { exact: true }).selectOption('37980');
    const count = value => page.getByRole('heading', { name: value + ' available ' + (value === 1 ? 'item' : 'items'), exact: true });
    await expect(count(2)).toBeVisible();
    const results = page.getByRole('list', { name: 'Available items' });
    await expect(results.getByRole('link', { name: first.name, exact: true })).toBeVisible();
    await expect(results.getByRole('link', { name: 'Wilmington reading sofa', exact: true })).toBeVisible();
    for (const name of ['Reserved sofa', 'Private draft sofa', 'Different metro sofa']) await expect(results.getByRole('link', { name, exact: true })).toHaveCount(0);
    await expect(results.getByText('Sofa · Living Room', { exact: true })).toHaveCount(2);
    await expect(results.getByText('Condition: Good', { exact: true })).toHaveCount(2);
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('moveout.browse-region.v1')))).toEqual({ stateId: '42', metroId: '37980' });
    const widths = testInfo.project.name === 'mobile' ? [375, 320] : [1440, 768, 640];
    for (const width of widths) {
      await page.setViewportSize({ width, height: 1000 });
      await page.evaluate(zoom => { document.documentElement.style.fontSize = zoom ? '200%' : ''; }, width === 640);
      await audit(page, 'populated ' + width);
      const filters = page.getByRole('button', { name: /^Filters/ });
      await filters.click(); await expect(page.getByLabel('City', { exact: true })).toBeVisible();
      await audit(page, 'filters ' + width);
      await page.getByLabel('City', { exact: true }).focus(); await page.keyboard.press('Escape');
      await expect(filters).toBeFocused(); await expect(page.getByLabel('City', { exact: true })).toBeHidden();
      expect(await filters.evaluate(node => getComputedStyle(node).outlineStyle)).toBe('solid');
    }
    await page.evaluate(() => { document.documentElement.style.fontSize = ''; });
    await page.getByLabel('Category', { exact: true }).selectOption('living-room'); await page.getByLabel('Item type', { exact: true }).selectOption('sofa');
    await page.getByRole('button', { name: /^Filters/ }).click();
    await page.getByLabel('Condition', { exact: true }).selectOption('good'); await page.getByLabel('Sort items', { exact: true }).selectOption('deadline');
    await page.getByLabel('City', { exact: true }).selectOption('Philadelphia'); await page.getByLabel('Search items', { exact: true }).fill('couch');
    await page.getByRole('button', { name: 'Find free items', exact: true }).click(); await expect(count(1)).toBeVisible();
    await expect(results.getByRole('link', { name: first.name, exact: true })).toBeVisible();
    const url = new URL(page.url()); expect(url.searchParams.get('q')).toBe('couch'); expect(url.searchParams.get('sort')).toBe('deadline'); expect(url.searchParams.get('itemTypeId')).toBe('sofa');
    await page.getByRole('button', { name: 'Clear filters', exact: true }).click(); await expect(count(2)).toBeVisible(); expect(new URL(page.url()).searchParams.get('metroId')).toBe('37980');
    await page.goto('/app/items?stateId=10&metroId=37980'); await expect(count(2)).toBeVisible();
    await page.goto('/app/items'); await expect(count(2)).toBeVisible(); expect(new URL(page.url()).searchParams.get('stateId')).toBe('10');
    await page.goto('/app/items?stateId=20&metroId=28140'); await expect(count(1)).toBeVisible(); await expect(results.getByRole('link', { name: 'Different metro sofa', exact: true })).toBeVisible();
    await page.goto('/app/items?stateId=42&metroId=37980&cursor=invalid'); await expect(page.getByRole('alert')).toBeVisible(); await expect(count(0)).toHaveCount(0);
    await page.getByRole('button', { name: 'Start again', exact: true }).click(); await expect(count(2)).toBeVisible();
    await page.goto('/app/items?stateId=42&metroId=37980&limit=1'); await expect(count(2)).toBeVisible();
    await post(giver, '/api/move-out-plans/' + pa.id + '/items/' + first.id + '/actions', { action: 'unlist', version: first.version });
    await page.getByRole('button', { name: 'Load more', exact: true }).click();
    await expect(count(1)).toBeVisible(); await expect(page.getByText('Availability changed. Results have been refreshed.', { exact: true })).toBeVisible();
    await expect(results.getByRole('link', { name: first.name, exact: true })).toHaveCount(0);
    const ownerPage = await giver.newPage(); await ownerPage.goto('/app/items?stateId=42&metroId=37980');
    await expect(ownerPage.getByText('Your listing', { exact: true })).toBeVisible(); await expect(ownerPage.getByRole('link', { name: 'Request pickup', exact: true })).toHaveCount(0);
    await post(giver, '/api/auth/logout', {}); await ownerPage.evaluate(() => window.dispatchEvent(new Event('focus')));
    await expect(ownerPage.getByText('Your listing', { exact: true })).toHaveCount(0);
    await expect(ownerPage.getByRole('link', { name: 'Wilmington reading sofa', exact: true })).toBeVisible();
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    await page.route('**/api/items?**', async route => { await gate; await route.continue(); });
    await page.getByRole('button', { name: 'Find free items', exact: true }).click(); await expect(page.getByText('Loading listings…', { exact: true })).toBeVisible(); await expect(count(0)).toHaveCount(0); await expect(count(1)).toHaveCount(0);
    release(); await expect(count(1)).toBeVisible(); await page.unroute('**/api/items?**');
    await page.route('**/api/items?**', route => route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>Local fallback</title>' }));
    await page.getByRole('button', { name: 'Find free items', exact: true }).click(); await expect(page.getByRole('alert')).toContainText('temporarily unavailable');
    await expect(count(0)).toHaveCount(0); await expect(page.getByText(/No available items/)).toHaveCount(0); await audit(page, 'API error');
    await page.unroute('**/api/items?**'); await page.getByRole('button', { name: 'Retry results', exact: true }).click(); await expect(count(1)).toBeVisible();
    await page.getByLabel('Search items', { exact: true }).fill('no matching item'); await page.getByRole('button', { name: 'Find free items', exact: true }).click();
    await expect(count(0)).toBeVisible(); await expect(page.getByText(/No available items match these filters/)).toBeVisible(); await audit(page, 'empty filter');
    const before = gets; await page.goto('/app/items?stateId=56'); await expect(page.getByText('No metros are listed for this state yet.', { exact: true })).toBeVisible(); expect(gets).toBe(before); await expect(count(0)).toHaveCount(0);
    expect((await (await receiver.request.get('/api/regions')).json()).metros).toHaveLength(50);
    expect(deployment.serverErrors).toEqual([]);
  } finally { for (const actor of contexts) await actor.close(); }
});
