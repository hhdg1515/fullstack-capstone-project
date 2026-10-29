const { randomUUID } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const AxeBuilder = require('@axe-core/playwright').default;
const { test: base, expect } = require('./fixtures.cjs');
const { localEnvironment } = require('./local.cjs');

// This larger acceptance fixture must never enlarge hosted budgets or cleanup.
const test = base.extend({ deployment: [async ({}, use) => {
  if (process.env.E2E_APP_ORIGIN) throw Error('MVP acceptance uses disposable local resources only');
  const local = await localEnvironment();
  try { await use(local); } finally { await local.close(); }
}, { scope: 'worker', timeout: 180000 }] });
test.skip(Boolean(process.env.E2E_APP_ORIGIN), 'MVP acceptance never uses hosted resources');

test('two independent users complete the integrated marketplace journey with truthful history and recovery', async ({ browser, deployment }, testInfo) => {
  const mobile = testInfo.project.name === 'mobile';
  const options = { baseURL: deployment.origin, ignoreHTTPSErrors: true,
    viewport: { width: mobile ? 320 : 1440, height: 1000 },
    extraHTTPHeaders: { 'X-Deployment-Target': deployment.fingerprint } };
  const giver = await browser.newContext(options), requester = await browser.newContext(options);
  const headers = { Origin: deployment.origin, 'X-CSRF-Protection': '1' };
  const start = deployment.now(), day = n => new Date(start + n * 86400000).toISOString().slice(0, 10);
  const accounts = [giver, requester].map((context, i) => ({ context, firstName: i ? 'Local Requester' : 'Local Giver',
    email: randomUUID() + '@example.invalid', password: randomUUID() + '!' }));
  const errors = [], views = [];
  for (const context of [giver, requester]) {
    // No browser request can reach a real deployment, including read traffic.
    await context.route('**/*', route => new URL(route.request().url()).origin === deployment.origin ? route.continue() : route.abort());
    context.on('page', page => page.on('pageerror', () => errors.push('Browser JavaScript error')));
  }
  const a = await giver.newPage(), b = await requester.newPage();
  let consent = true;
  a.on('dialog', dialog => consent ? dialog.accept() : dialog.dismiss());
  b.on('dialog', dialog => dialog.accept());
  const card = name => a.getByRole('heading', { name, exact: true }).locator('xpath=ancestor::li[1]');
  const read = async (context, url) => { const r = await context.request.get(url); expect(r.ok()).toBe(true); return r.json(); };
  const primary = async (page, label) => {
    const menu = page.getByRole('button', { name: 'Menu', exact: true });
    if (await menu.isVisible()) await menu.click();
    await page.getByRole('navigation', { name: 'Primary', exact: true }).getByRole('link', { name: label, exact: true }).click();
  };
  const capture = async (page, name) => {
    await page.mouse.move(0, 0);
    await page.getByRole('heading', { level: 1 }).first().click();
    await page.evaluate(() => scrollTo(0, 0));
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    const violations = (await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations.map(v => v.id);
    await test.step('Acceptance ' + name + ' WCAG: ' + (violations.join(', ') || 'none'), async () => expect(violations).toEqual([]));
    views.push({ view: name, width: page.viewportSize().width, violations });
    if (process.env.MVP_ACCEPTANCE_EVIDENCE === '1') {
      const directory = path.join(__dirname, '../docs/assets/milestone-6.4e');
      fs.mkdirSync(directory, { recursive: true });
      await page.screenshot({ path: path.join(directory, `${testInfo.project.name}-${name}.png`), fullPage: true });
    }
  };
  const filterPanel = async page => {
    const toggle = page.getByRole('button', { name: /^Filters(?: \(\d+\))?$/ });
    if (await toggle.getAttribute('aria-expanded') === 'false') await toggle.click();
  };
  const register = async (page, account) => {
    for (const [label, value] of [['First name', account.firstName], ['Last name', 'Acceptance'], ['Email', account.email], ['Password', account.password]]) {
      await page.getByLabel(label, { exact: true }).fill(value);
    }
    await page.getByRole('button', { name: 'Register', exact: true }).click();
  };
  try {
    expect(deployment.local).toBe(true);
    expect((await read(giver, '/api/health')).databaseFingerprint).toBe(deployment.fingerprint);
    expect((await requester.request.get('/api/me')).status()).toBe(401);
    await b.goto('/'); await capture(b, 'landing');
    await primary(b, 'Find Free Items');
    await expect(b.getByRole('heading', { name: 'Where would you like to find free items?', exact: true })).toBeVisible();
    await capture(b, 'region-selection');
    await b.getByLabel('State', { exact: true }).selectOption('06');
    await b.getByLabel('Metro area', { exact: true }).selectOption('41860');
    await expect(b.getByRole('heading', { name: 'No items here yet', exact: true })).toBeVisible();
    await capture(b, 'empty-region');

    await a.goto('/app/plans');
    await expect(a.getByRole('heading', { name: 'Login', exact: true })).toBeVisible();
    await capture(a, 'login');
    await a.getByRole('link', { name: 'Register Here', exact: true }).click();
    await capture(a, 'registration');
    await register(a, accounts[0]);
    await expect(a.getByRole('heading', { name: 'No plans yet', exact: true })).toBeVisible();
    await a.getByRole('link', { name: 'Create your first plan', exact: true }).click();
    await a.getByRole('button', { name: 'Create plan', exact: true }).click();
    await expect(a.getByLabel('Move-out deadline', { exact: true })).toBeFocused();
    await a.getByLabel('State', { exact: true }).selectOption('06');
    await a.getByLabel('Metro area', { exact: true }).selectOption('41860');
    const zone = a.getByLabel('Pickup timezone (needed to receive requests)', { exact: true });
    await expect(zone).toHaveValue('America/Los_Angeles');
    await a.getByText('Change pickup timezone', { exact: true }).click(); await zone.fill('America/Los_Angeles');
    await a.getByLabel('Metro area', { exact: true }).selectOption('31080'); await expect(zone).toHaveValue('America/Los_Angeles');
    await a.getByLabel('Metro area', { exact: true }).selectOption('41860');
    for (const [label, value] of [['Move-out deadline', day(10)], ['City', 'Oakland'], ['Neighborhood', 'Temescal'], ['Plan title (optional)', 'Local move-out acceptance']]) await a.getByLabel(label, { exact: true }).fill(value);
    consent = false; await a.getByRole('link', { name: 'Cancel', exact: true }).click();
    await expect(a.getByLabel('Plan title (optional)', { exact: true })).toHaveValue('Local move-out acceptance'); consent = true;
    await capture(a, 'plan-setup');
    await a.getByRole('button', { name: 'Create plan', exact: true }).click();
    await a.getByRole('link', { name: 'Edit plan', exact: true }).click();
    await a.getByLabel('Plan title (optional)', { exact: true }).fill('Local move-out acceptance — reviewed');
    await a.getByRole('button', { name: 'Save changes', exact: true }).click();
    await expect(a.getByRole('heading', { name: 'Local move-out acceptance — reviewed', exact: true })).toBeVisible();
    await a.getByRole('link', { name: 'Manage items', exact: true }).click();
    const planId = new URL(a.url()).pathname.split('/')[3], inventory = '/api/move-out-plans/' + planId + '/items';
    await a.getByLabel('Item name', { exact: true }).fill('Local study desk');
    await a.getByRole('button', { name: 'Publish', exact: true }).click();
    await expect(a.getByLabel('Category', { exact: true })).toBeFocused();
    await expect(a.getByLabel('Category', { exact: true })).toHaveAttribute('aria-invalid', 'true');
    await capture(a, 'publication-validation');
    await a.getByRole('button', { name: 'Save Draft', exact: true }).click();
    await expect(card('Local study desk').getByText('Draft', { exact: true })).toBeVisible();
    await a.getByRole('button', { name: 'Edit Local study desk', exact: true }).click();
    for (const [label, value] of [['Category', 'office-lighting'], ['Item type', 'desk'], ['Condition (optional)', 'good']]) await a.getByLabel(label, { exact: true }).selectOption(value);
    await a.getByLabel('Description', { exact: true }).fill('A sturdy household study desk. Legs detach for transport.');
    await a.getByRole('button', { name: 'Publish', exact: true }).evaluate(node => { node.click(); node.click(); });
    await expect(card('Local study desk').getByText('Posted', { exact: true })).toBeVisible();
    await a.getByRole('button', { name: 'Add item', exact: true }).click();
    await a.getByLabel('Item name', { exact: true }).fill('Local office chair');
    await a.getByLabel('Category', { exact: true }).selectOption('office-lighting');
    await a.getByLabel('Item type', { exact: true }).selectOption('office-chair');
    await a.getByLabel('Description', { exact: true }).fill('An adjustable household office chair, with working wheels.');
    await a.getByLabel('Condition (optional)', { exact: true }).selectOption('good');
    await a.getByRole('button', { name: 'Publish', exact: true }).click();
    await expect(a.getByLabel('Item name', { exact: true })).toHaveCount(0);
    await a.getByRole('button', { name: 'Add item', exact: true }).click();
    await expect(a.getByLabel('Item name', { exact: true })).toBeFocused();
    await a.getByLabel('Item name', { exact: true }).fill('Local unfinished shelf');
    await a.getByRole('button', { name: 'Save Draft', exact: true }).click();
    await expect(a.getByText('0 of 3 items cleared', { exact: true })).toBeVisible();
    await capture(a, 'inventory');
    const owned = (await read(giver, inventory)).items;
    expect(owned).toHaveLength(3);
    const desk = owned.find(i => i.name === 'Local study desk'), chair = owned.find(i => i.name === 'Local office chair');
    expect(owned.find(i => i.name === 'Local unfinished shelf').status).toBe('draft');
    expect((await requester.request.get('/api/move-out-plans/' + planId)).status()).toBe(401);
    await a.goto('/app/items/' + desk.id);
    await expect(a.getByText('Your listing. Manage this item from My plans.', { exact: true })).toBeVisible();
    await expect(a.getByRole('link', { name: 'Request pickup', exact: true })).toHaveCount(0);
    const self = await giver.request.post('/api/pickup-requests', { headers, data: { itemId: desk.id, localDateTime: day(2) + 'T12:00', timeZone: 'America/Los_Angeles' } });
    expect(self.status()).toBe(409);

    await b.reload(); await expect(b.getByRole('heading', { name: '2 available items', exact: true })).toBeVisible();
    await capture(b, 'discovery');
    await b.getByLabel('Category', { exact: true }).selectOption('office-lighting');
    await b.getByLabel('Item type', { exact: true }).selectOption('desk');
    await filterPanel(b);
    await b.getByLabel('Condition', { exact: true }).selectOption('good');
    await b.getByLabel('Pickup availability', { exact: true }).selectOption('now');
    await b.getByLabel('Sort items', { exact: true }).selectOption('deadline');
    await b.getByRole('button', { name: 'Find free items', exact: true }).click();
    await expect(b.getByRole('heading', { name: '1 available item', exact: true })).toBeVisible();
    await capture(b, 'filtered-discovery');
    await b.getByRole('button', { name: 'Clear filters', exact: true }).click();
    await expect(b.getByRole('heading', { name: '2 available items', exact: true })).toBeVisible();
    expect(new URL(b.url()).searchParams.get('metroId')).toBe('41860');
    await b.getByRole('link', { name: desk.name, exact: true }).click(); await capture(b, 'listing-detail');
    await b.goBack(); await expect(b.getByRole('heading', { name: '2 available items', exact: true })).toBeVisible();
    await b.goForward(); await expect(b.getByRole('heading', { name: desk.name, exact: true })).toBeVisible();
    await b.getByRole('link', { name: 'Request pickup', exact: true }).click();
    await b.getByRole('heading', { name: 'Login', exact: true }).waitFor();
    await b.getByRole('link', { name: 'Register Here', exact: true }).click(); await register(b, accounts[1]);
    await b.getByLabel('Pickup date and time', { exact: true }).waitFor();
    expect(new URL(b.url()).pathname).toBe('/app/items/' + desk.id + '/request');
    const requestIds = [];
    for (const item of [desk, chair]) {
      if (item === chair) await b.goto('/app/items/' + chair.id + '/request');
      await b.getByLabel('Pickup date and time', { exact: true }).fill(day(2) + 'T12:00');
      await b.getByRole('button', { name: 'Send pickup request', exact: true }).evaluate(node => { node.click(); node.click(); });
      await b.getByText('Pending', { exact: true }).waitFor(); requestIds.push(new URL(b.url()).pathname.split('/').pop());
    }
    expect((await read(requester, '/api/pickup-requests/sent')).requests).toHaveLength(2);
    expect((await requester.request.get(inventory)).status()).toBe(404);
    await capture(b, 'pending-request');
    await a.goto('/app/pickups/incoming');
    await expect(a.getByRole('list', { name: 'Pickup requests', exact: true }).getByRole('listitem')).toHaveCount(2);
    await a.goto('/app/pickups/' + requestIds[1]); await a.getByRole('button', { name: 'Decline request', exact: true }).click();
    await a.getByText('Declined', { exact: true }).waitFor();
    await a.goto('/app/pickups/' + requestIds[0]); await a.getByRole('button', { name: 'Accept pickup', exact: true }).click();
    await a.getByText('Accepted', { exact: true }).waitFor(); await capture(a, 'accepted-request');
    await b.goto('/app/items?stateId=06&metroId=41860');
    await expect(b.getByRole('heading', { name: '1 available item', exact: true })).toBeVisible();
    await a.goto('/app/plans/' + planId + '/items'); await expect(card(desk.name).getByText('Reserved', { exact: true })).toBeVisible();
    await expect(card(desk.name).getByText('Picked Up', { exact: true })).toHaveCount(0);
    const users = await Promise.all([giver, requester].map(c => read(c, '/api/me')));
    const publicItem = JSON.stringify(await read(requester, '/api/items/' + chair.id));
    expect([users[0].user.id, users[1].user.id, accounts[0].email, accounts[1].email, 'ownerId', 'password', 'senderId'].some(value => publicItem.includes(value))).toBe(false);

    const detail = '/app/pickups/' + requestIds[0], api = '/api/pickup-requests/' + requestIds[0];
    await a.goto(detail + '#conversation'); await b.goto(detail + '#conversation');
    await expect(a.getByRole('heading', { name: 'Pickup conversation', exact: true })).toBeFocused();
    await a.getByLabel('Message', { exact: true }).fill("Let's meet at 3 PM.\nPlease use the formal time proposal to confirm.");
    const original = (await read(giver, api)).request.proposedAt;
    await a.getByRole('button', { name: 'Send message', exact: true }).click(); await a.getByText('Message sent.', { exact: true }).waitFor();
    expect((await read(requester, api)).request.proposedAt).toBe(original);
    await b.getByRole('button', { name: 'Refresh conversation', exact: true }).click();
    await expect(b.getByText("Let's meet at 3 PM.\nPlease use the formal time proposal to confirm.", { exact: true })).toBeVisible();
    await b.getByLabel('Message', { exact: true }).fill('I will approve the formal proposal.');
    await b.getByRole('button', { name: 'Send message', exact: true }).click(); await b.getByText('Message sent.', { exact: true }).waitFor();
    await a.getByRole('button', { name: 'Refresh conversation', exact: true }).click();
    await expect(a.locator('.chat-message')).toHaveCount(2); await capture(a, 'conversation');
    await a.getByRole('button', { name: 'Propose new time', exact: true }).click();
    await a.getByLabel('New pickup date and time', { exact: true }).fill(day(3) + 'T15:00');
    await a.getByRole('button', { name: 'Propose time change', exact: true }).click();
    await a.getByRole('group', { name: 'Pending time change' }).waitFor();
    expect((await read(giver, api)).request.proposedAt).toBe(original);
    await b.getByRole('button', { name: 'Reload request', exact: true }).click();
    await b.getByRole('button', { name: 'Accept proposed time', exact: true }).waitFor(); await capture(b, 'time-proposal');
    await b.getByRole('button', { name: 'Accept proposed time', exact: true }).click();
    await expect(b.getByRole('group', { name: 'Pending time change' })).toHaveCount(0);
    const revised = (await read(requester, api)).request.proposedAt; expect(revised).not.toBe(original);
    await b.getByRole('button', { name: 'Propose new time', exact: true }).click();
    await b.getByLabel('New pickup date and time', { exact: true }).fill(day(4) + 'T12:00');
    await b.getByRole('button', { name: 'Propose time change', exact: true }).click(); await b.getByRole('group', { name: 'Pending time change' }).waitFor();
    await a.getByRole('button', { name: 'Reload request', exact: true }).click();
    await a.getByRole('button', { name: 'Decline time change', exact: true }).click();
    await expect(a.getByRole('group', { name: 'Pending time change' })).toHaveCount(0);
    expect((await read(giver, api)).request.proposedAt).toBe(revised);

    // A declined item's new request is a distinct lifecycle, not reopening history.
    await b.goto('/app/pickups/' + requestIds[1] + '#conversation');
    await expect(b.getByText(/This request is closed. You can read/)).toBeVisible();
    await expect(b.getByRole('button', { name: 'Send message', exact: true })).toHaveCount(0);
    await b.goto('/app/items/' + chair.id + '/request');
    await b.getByLabel('Pickup date and time', { exact: true }).fill(day(2) + 'T14:00');
    await b.getByRole('button', { name: 'Send pickup request', exact: true }).click(); await b.getByText('Pending', { exact: true }).waitFor();
    expect(new URL(b.url()).pathname.split('/').pop()).not.toBe(requestIds[1]);
    await b.getByRole('button', { name: 'Cancel request', exact: true }).click(); await b.getByText('Cancelled', { exact: true }).waitFor();
    deployment.advance(Date.parse(revised) + 1000);
    for (const page of [a, b]) await page.clock.setFixedTime(new Date(deployment.now()));
    await a.getByRole('button', { name: 'Reload request', exact: true }).click();
    await a.getByRole('button', { name: 'Confirm handoff', exact: true }).click(); await a.getByText('Completed', { exact: true }).waitFor();
    await b.goto(detail + '#conversation');
    await expect(b.getByText(/This request is closed. You can read/)).toBeVisible();
    await expect(b.locator('.chat-message')).toHaveCount(2); await expect(b.getByRole('button', { name: 'Send message', exact: true })).toHaveCount(0);
    const closed = await requester.request.post(api + '/conversation/messages', { headers, data: { text: 'This must be rejected.' } }); expect(closed.status()).toBe(404);
    await capture(b, 'closed-history');
    await a.goto('/app/plans/' + planId + '/items');
    await expect(card(desk.name).getByText('Picked Up', { exact: true })).toBeVisible();
    await expect(card(chair.name).getByText('Posted', { exact: true })).toBeVisible();
    await expect(a.getByText('1 of 3 items cleared', { exact: true })).toBeVisible();
    await b.route('**/api/items?*', route => route.fulfill({ status: 503, contentType: 'text/html', body: '<!doctype html><title>Local service unavailable</title>' }));
    await b.goto('/app/items?stateId=06&metroId=41860'); await b.getByRole('heading', { name: 'Could not load items', exact: true }).waitFor();
    await expect(b.getByRole('heading', { name: 'No items here yet', exact: true })).toHaveCount(0);
    await expect(b.getByRole('heading', { name: /^\d+ available items?$/ })).toHaveCount(0); await capture(b, 'recoverable-error');
    await b.unroute('**/api/items?*'); await b.getByRole('button', { name: 'Retry results', exact: true }).click();
    await expect(b.getByRole('heading', { name: '1 available item', exact: true })).toBeVisible();
    if (!mobile) for (const [label, width, text] of [['tablet', 768, ''], ['mobile390', 390, ''], ['mobile375', 375, ''], ['text200', 640, '200%']]) {
      await b.setViewportSize({ width, height: 1000 }); await b.evaluate(value => { document.documentElement.style.fontSize = value; }, text);
      await capture(b, 'reflow-' + label);
    }
    expect(errors).toEqual([]); expect(deployment.serverErrors).toEqual([]);
    if (process.env.MVP_ACCEPTANCE_EVIDENCE === '1') fs.writeFileSync(path.join(__dirname, `../docs/assets/milestone-6.4e/${testInfo.project.name}-audit.json`), JSON.stringify({ project: testInfo.project.name, browser: browser.version(), views }, null, 2) + '\n');
  } finally { await giver.close(); await requester.close(); }
});
