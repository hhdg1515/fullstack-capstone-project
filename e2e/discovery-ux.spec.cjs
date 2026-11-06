const fs = require('node:fs'), path = require('node:path');
const { randomUUID } = require('node:crypto');
const AxeBuilder = require('@axe-core/playwright').default;
const { test: base, expect } = require('./fixtures.cjs');
const { localEnvironment } = require('./local.cjs');
const test = base.extend({ deployment: [async ({}, use) => {
  if (process.env.E2E_APP_ORIGIN) throw Error('Discovery UX fixtures are local only');
  const local = await localEnvironment(); try { await use(local); } finally { await local.close(); }
}, { scope: 'worker', timeout: 180000 }] });
test.skip(Boolean(process.env.E2E_APP_ORIGIN), 'Discovery UX fixtures never use hosted resources');

test('expanded areas, responsive filters, truthful cards and recovery preserve server regional counts', async ({ isolatedBrowser: browser, deployment }, testInfo) => {
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
    const makeItem = async (plan, name, extra = {}, actor = giver) => (await post(actor, '/api/move-out-plans/' + plan.id + '/items', { name,
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
    await expect(page.getByLabel('Metro area', { exact: true })).toBeEnabled();
    expect(gets).toBe(0);
    await page.evaluate(() => localStorage.setItem('moveout.browse-region.v1', JSON.stringify({ stateId: '06', metroId: 'unknown' })));
    await page.goto('/app/items'); await expect(page.getByLabel('Metro area', { exact: true })).toHaveValue(''); expect(gets).toBe(0);
    const area = page.getByLabel('Metro area', { exact: true });
    await area.click();
    const areaMenu = page.getByRole('listbox', { name: 'Metro area options', exact: true });
    await expect(areaMenu).toBeVisible();
    const triggerBox = await area.boundingBox(), menuBox = await areaMenu.boundingBox();
    expect(menuBox.y).toBeGreaterThanOrEqual(triggerBox.y + triggerBox.height);
    const optionIndex = await area.evaluate(select => [...select.options].findIndex(option => option.value === '42:37980'));
    expect(optionIndex).toBeGreaterThan(0);
    await areaMenu.getByRole('option').nth(optionIndex).click();
    await expect(areaMenu).toHaveCount(0);
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
      await expect(page.getByRole('button', { name: /^Filters/ })).toHaveCount(0);
      await expect(page.getByLabel('City', { exact: true })).toBeVisible();
      await audit(page, 'filters ' + width);
      await page.getByLabel('City', { exact: true }).focus(); await page.keyboard.press('Escape');
      await expect(page.getByLabel('City', { exact: true })).toBeFocused(); await expect(page.getByLabel('City', { exact: true })).toBeVisible();
      expect(await page.getByLabel('City', { exact: true }).evaluate(node => getComputedStyle(node.closest('.discovery-segment')).boxShadow)).not.toBe('none');
    }
    await page.evaluate(() => { document.documentElement.style.fontSize = ''; });
    await page.getByRole('group', { name: 'Category', exact: true }).getByRole('button', { name: 'Living Room', exact: true }).click(); await page.getByRole('group', { name: 'Item type', exact: true }).getByRole('button', { name: 'Sofa', exact: true }).click();
    await page.getByLabel('Condition', { exact: true }).selectOption('good'); await page.getByLabel('Sort items', { exact: true }).selectOption('deadline');
    await page.getByLabel('City', { exact: true }).selectOption('Philadelphia'); await page.getByLabel('Search items', { exact: true }).fill('couch');
    await expect(page.getByRole('button', { name: 'Find free items', exact: true })).toHaveCount(0); await expect(count(1)).toBeVisible();
    await expect(results.getByRole('link', { name: first.name, exact: true })).toBeVisible();
    const url = new URL(page.url()); expect(url.searchParams.get('q')).toBe('couch'); expect(url.searchParams.get('sort')).toBe('deadline'); expect(url.searchParams.get('itemTypeId')).toBe('sofa');
    await page.getByRole('button', { name: 'Reset', exact: true }).click(); await expect(count(2)).toBeVisible(); expect(new URL(page.url()).searchParams.get('metroId')).toBe('37980');
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
    await expect(ownerPage.getByText('Your listing', { exact: true })).toBeVisible(); await expect(ownerPage.getByRole('link', { name: "I'm interested", exact: true })).toHaveCount(0);
    await post(giver, '/api/auth/logout', {}); await ownerPage.evaluate(() => window.dispatchEvent(new Event('focus')));
    await expect(ownerPage.getByText('Your listing', { exact: true })).toHaveCount(0);
    await expect(ownerPage.getByRole('link', { name: 'Wilmington reading sofa', exact: true })).toBeVisible();
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    await page.route('**/api/items?**', async route => { await gate; await route.continue(); });
    await page.getByLabel('Search items', { exact: true }).press('Enter'); await expect(page.getByText('Loading listings…', { exact: true })).toBeVisible(); await expect(count(0)).toHaveCount(0); await expect(count(1)).toHaveCount(0);
    release(); await expect(count(1)).toBeVisible(); await page.unroute('**/api/items?**');
    await page.route('**/api/items?**', route => route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>Local fallback</title>' }));
    await page.getByLabel('Search items', { exact: true }).press('Enter'); await expect(page.getByRole('alert')).toContainText('temporarily unavailable');
    await expect(count(0)).toHaveCount(0); await expect(page.getByText(/No available items/)).toHaveCount(0); await audit(page, 'API error');
    await page.unroute('**/api/items?**'); await page.getByRole('button', { name: 'Retry results', exact: true }).click(); await expect(count(1)).toBeVisible();
    await page.getByLabel('Search items', { exact: true }).fill('no matching item');
    await expect(count(0)).toBeVisible(); await expect(page.getByText(/No available items match these filters/)).toBeVisible(); await audit(page, 'empty filter');
    const before = gets; await page.goto('/app/items?stateId=56'); await expect(page.getByRole('heading', { name: 'Choose a metro area', exact: true })).toBeVisible(); expect(gets).toBe(before); await expect(count(0)).toHaveCount(0);
    expect((await (await receiver.request.get('/api/regions')).json()).metros).toHaveLength(50);
    // Four synthetic public items demonstrate three desktop cards and a new row.
    // The earlier giver-logout assertion remains in force. Use the still
    // authenticated second account and its own plan for this final fixture.
    const gridPlan = (await post(receiver, '/api/move-out-plans', { stateId: '42', metroId: '37980', city: 'Philadelphia',
      neighborhood: 'Local neighborhood', pickupTimeZone: 'UTC', moveOutDeadline: day(15) })).plan;
    for (const name of ['Comfortable household sofa', 'Wide reading sofa', 'Compact apartment sofa']) await makeItem(gridPlan, name, {}, receiver);
    await page.setViewportSize({ width: testInfo.project.name === 'mobile' ? 375 : 1440, height: 1000 });
    await page.goto('/app/items?stateId=42&metroId=37980'); await expect(count(4)).toBeVisible();
    const columns = await results.evaluate(node => getComputedStyle(node).gridTemplateColumns.split(' ').length);
    expect(columns).toBe(testInfo.project.name === 'mobile' ? 2 : 3);
    if (testInfo.project.name === 'desktop') {
      const cards = await results.locator('.discovery-listing').all(), boxes = await Promise.all(cards.map(card => card.boundingBox()));
      expect(boxes[1].y).toBe(boxes[0].y); expect(boxes[2].y).toBe(boxes[0].y); expect(boxes[3].y).toBeGreaterThan(boxes[0].y);
    }
    await audit(page, 'wider discovery cards');
    if (process.env.DISCOVERY_POLISH_EVIDENCE) {
      fs.mkdirSync(process.env.DISCOVERY_POLISH_EVIDENCE, { recursive: true });
      await page.evaluate(() => scrollTo(0, 0));
      await page.screenshot({ path: path.join(process.env.DISCOVERY_POLISH_EVIDENCE, testInfo.project.name + '-discovery.png'), fullPage: true });
    }
    expect(deployment.serverErrors).toEqual([]);
  } finally { for (const actor of contexts) await actor.close(); }
});
