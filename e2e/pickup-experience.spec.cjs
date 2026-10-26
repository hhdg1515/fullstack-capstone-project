const { randomUUID } = require('node:crypto');
const AxeBuilder = require('@axe-core/playwright').default;
const { test: base, expect } = require('./fixtures.cjs');
const { localEnvironment } = require('./local.cjs');
const test = base.extend({ deployment: [async ({}, use) => {
  if (process.env.E2E_APP_ORIGIN) throw Error('Pickup UX fixtures are local only');
  const local = await localEnvironment(); try { await use(local); } finally { await local.close(); }
}, { scope: 'worker', timeout: 180000 }] });
test.skip(Boolean(process.env.E2E_APP_ORIGIN), 'Pickup UX fixtures cannot use hosted resources');

test('participants enter canonical conversations and keep request context, decisions and private history', async ({ browser, deployment }, testInfo) => {
  const options = { ...testInfo.project.use, baseURL: deployment.origin, ignoreHTTPSErrors: true, extraHTTPHeaders: { 'X-Deployment-Target': deployment.fingerprint } };
  delete options.launchOptions; delete options.trace; delete options.screenshot; delete options.video;
  const contexts = [];
  const post = async (actor, url, data) => { const r = await actor.request.post(url, { headers: { Origin: deployment.origin, 'X-CSRF-Protection': '1' }, data }); expect(r.ok()).toBe(true); return r.status() === 204 ? {} : r.json(); };
  const account = async firstName => { const c = await browser.newContext(options); contexts.push(c); await post(c, '/api/auth/register', { firstName, lastName: 'Local', email: randomUUID() + '@example.invalid', password: randomUUID() + '!' }); return c; };
  const day = n => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
  const audit = async (page, state) => {
    await page.mouse.move(0, 0); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    const violations = (await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations.map(x => x.id);
    await test.step('Pickup experience ' + state + ' WCAG: ' + (violations.join(', ') || 'none'), async () => expect(violations).toEqual([]));
  };
  try {
    const giver = await account('Giver'), requester = await account('Requester'), outsider = await account('Unrelated');
    const { plan } = await post(giver, '/api/move-out-plans', { city: 'Oakland', neighborhood: 'Temescal', stateId: '06', metroId: '41860', pickupTimeZone: 'UTC', moveOutDeadline: day(10) });
    const { item } = await post(giver, '/api/move-out-plans/' + plan.id + '/items', { name: 'Local coordination desk', categoryId: 'office-lighting', itemTypeId: 'desk', description: 'Synthetic local desk for browser verification.', publish: true });
    const { request } = await post(requester, '/api/pickup-requests', { itemId: item.id, localDateTime: day(2) + 'T12:00', timeZone: 'UTC', note: 'I can bring a bag.' });
    const a = await giver.newPage(), b = await requester.newPage(), stranger = await outsider.newPage();
    a.on('dialog', d => d.accept()); b.on('dialog', d => d.accept());
    if (testInfo.project.name === 'mobile') for (const p of [a, b, stranger]) await p.setViewportSize({ width: 320, height: 1000 });
    await a.goto('/app/pickups/incoming'); await a.getByLabel('Request status', { exact: true }).selectOption('pending');
    const entry = a.getByRole('link', { name: 'Open conversation with Requester for Local coordination desk', exact: true });
    await expect(entry).toHaveAttribute('href', '/app/pickups/' + request.id + '#conversation');
    await entry.click(); await expect(a.getByRole('heading', { name: 'Pickup conversation', exact: true })).toBeFocused();
    await expect(a.getByText('Conversation loaded.', { exact: true })).toBeVisible(); await expect(a.getByText('Applicant: Requester', { exact: true })).toBeVisible();
    await a.getByRole('link', { name: 'Back to requests', exact: true }).click(); await expect(a.getByLabel('Request status', { exact: true })).toHaveValue('pending');
    expect(new URL(a.url()).searchParams.get('status')).toBe('pending');
    await a.getByRole('link', { name: 'View request from Requester for Local coordination desk', exact: true }).click();
    await expect(a.getByText('Conversation loaded.', { exact: true })).toBeVisible(); await a.getByLabel('Message', { exact: true }).fill('Keep this private draft while accepting.');
    await a.getByRole('button', { name: 'Accept pickup', exact: true }).click(); await expect(a.getByText('Accepted', { exact: true })).toBeVisible();
    await expect(a.getByLabel('Message', { exact: true })).toHaveValue('Keep this private draft while accepting.');
    await expect(a.getByText('Confirmed pickup:', { exact: true })).toBeVisible(); await expect(a.getByText('Picked Up', { exact: true })).toHaveCount(0);
    await a.getByRole('link', { name: 'Open conversation', exact: true }).click(); await expect(a.getByRole('heading', { name: 'Pickup conversation', exact: true })).toBeFocused();
    await expect(a.getByLabel('Message', { exact: true })).toHaveValue('Keep this private draft while accepting.');
    await a.getByRole('button', { name: 'Send message', exact: true }).click(); await expect(a.getByText('Message sent.', { exact: true })).toBeVisible();
    await b.goto('/app/pickups'); await b.getByRole('link', { name: 'Open conversation with Giver for Local coordination desk', exact: true }).click();
    await expect(b.getByRole('heading', { name: 'Pickup conversation', exact: true })).toBeFocused(); await expect(b.getByText('Keep this private draft while accepting.', { exact: true })).toBeVisible();
    await expect(b.getByRole('button', { name: 'Accept pickup', exact: true })).toHaveCount(0); await expect(b.getByRole('button', { name: 'Confirm handoff', exact: true })).toHaveCount(0);
    await audit(a, 'giver accepted'); await audit(b, 'requester accepted');
    const root = '/api/pickup-requests/' + request.id;
    for (const suffix of ['', '/conversation', '/conversation/messages']) expect((await outsider.request.get(root + suffix)).status()).toBe(404);
    await stranger.goto('/app/pickups/' + request.id + '#conversation'); await expect(stranger.getByRole('alert')).toBeVisible();
    await expect(stranger.getByLabel('Message', { exact: true })).toHaveCount(0); await expect(stranger.getByText('Keep this private draft while accepting.', { exact: true })).toHaveCount(0);
    await b.getByRole('button', { name: 'Cancel request', exact: true }).click(); await expect(b.getByText('Cancelled', { exact: true })).toBeVisible();
    await expect(b.getByText(/This request is closed. You can read/)).toBeVisible(); await expect(b.getByRole('button', { name: 'Send message', exact: true })).toHaveCount(0);
    await a.getByRole('button', { name: 'Reload request', exact: true }).click(); await expect(a.getByText(/This request is closed. You can read/)).toBeVisible();
    await expect(a.getByRole('region', { name: 'Message history' }).getByText('Keep this private draft while accepting.', { exact: true })).toBeVisible();
    await audit(b, 'closed history'); expect(deployment.serverErrors).toEqual([]);
  } finally { for (const c of contexts) await c.close(); }
});
