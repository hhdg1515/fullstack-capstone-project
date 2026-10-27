const { randomUUID } = require('node:crypto');
const AxeBuilder = require('@axe-core/playwright').default;
const { test: base, expect } = require('./fixtures.cjs');
const { localEnvironment } = require('./local.cjs');
const test = base.extend({ deployment: [async ({}, use) => {
  if (process.env.E2E_APP_ORIGIN) throw Error('Conversation recovery fixtures are local only');
  const local = await localEnvironment(); try { await use(local); } finally { await local.close(); }
}, { scope: 'worker', timeout: 180000 }] });
test.skip(Boolean(process.env.E2E_APP_ORIGIN), 'Conversation recovery never uses hosted resources');

test('an uncertain committed send requires review, preserves drafts and closes read-only across layouts', async ({ browser, deployment }, testInfo) => {
  const options = { ...testInfo.project.use, baseURL: deployment.origin, ignoreHTTPSErrors: true, extraHTTPHeaders: { 'X-Deployment-Target': deployment.fingerprint } };
  delete options.launchOptions; delete options.trace; delete options.screenshot; delete options.video;
  const contexts = [];
  const post = async (c, url, data) => { const res = await c.request.post(url, { headers: { Origin: deployment.origin, 'X-CSRF-Protection': '1' }, data }); expect(res.ok()).toBe(true); return res.json(); };
  const account = async name => { const c = await browser.newContext(options); contexts.push(c); await post(c, '/api/auth/register', { firstName: name, lastName: 'Local', email: randomUUID() + '@example.invalid', password: randomUUID() + '!' }); return c; };
  const day = n => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
  try {
    const giver = await account('Giver'), receiver = await account('Requester');
    const { plan } = await post(giver, '/api/move-out-plans', { city: 'Oakland', neighborhood: 'Temescal', pickupTimeZone: 'UTC', moveOutDeadline: day(10) });
    const { item } = await post(giver, '/api/move-out-plans/' + plan.id + '/items', { name: 'Recovery desk', categoryId: 'office-lighting', itemTypeId: 'desk', description: 'A local household item.', publish: true });
    const { request } = await post(receiver, '/api/pickup-requests', { itemId: item.id, localDateTime: day(2) + 'T12:00', timeZone: 'UTC' });
    const endpoint = '/api/pickup-requests/' + request.id + '/conversation/messages';
    const page = await giver.newPage(); page.on('dialog', d => d.accept());
    if (testInfo.project.name === 'mobile') await page.setViewportSize({ width: 320, height: 1000 });
    await page.goto('/app/pickups/' + request.id + '#conversation'); await expect(page.getByText('Conversation loaded.', { exact: true })).toBeVisible();
    let sends = 0; page.on('request', r => { if (r.method() === 'POST' && new URL(r.url()).pathname === endpoint) sends++; });
    await page.route('**/conversation/messages', async route => {
      if (route.request().method() !== 'POST') return route.continue();
      const committed = await route.fetch(); expect(committed.status()).toBe(201);
      await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: { code: 'SERVICE_UNAVAILABLE', message: 'Local interrupted response' } }) });
    });
    const text = 'Saved once, but not confirmed in this browser.\n' + 'LongUnbrokenWord'.repeat(100);
    await page.getByLabel('Message', { exact: true }).fill(text); await page.getByRole('button', { name: 'Send message', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('Sending could not be confirmed');
    await expect(page.getByLabel('Unsent message', { exact: true })).toHaveValue(text); await expect(page.getByRole('button', { name: 'Send message', exact: true })).toBeDisabled();
    await expect(page.getByText('Message sent.', { exact: true })).toHaveCount(0); expect(sends).toBe(1);
    expect((await (await receiver.request.get(endpoint)).json()).messages).toHaveLength(1);
    await page.unroute('**/conversation/messages'); await post(receiver, endpoint, { text: 'I can see your pickup message.' });
    await page.getByRole('button', { name: 'Refresh conversation', exact: true }).click();
    await expect(page.getByRole('region', { name: 'Message history' }).locator('.chat-message')).toHaveCount(2);
    await expect(page.getByLabel('Message', { exact: true })).toHaveValue(text); await expect(page.getByRole('button', { name: 'Send message', exact: true })).toBeEnabled(); expect(sends).toBe(1);
    await page.getByLabel('Message', { exact: true }).fill('Keep this independent unsent draft.');
    for (const width of testInfo.project.name === 'mobile' ? [375, 390, 320] : [1440, 768, 640]) {
      await page.setViewportSize({ width, height: 1000 }); await page.evaluate(zoom => { document.documentElement.style.fontSize = zoom ? '200%' : ''; }, width === 640);
      await page.mouse.move(0, 0); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
      const violations = (await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations.map(x => x.id);
      await test.step('Conversation recovery ' + width + ' WCAG: ' + (violations.join(', ') || 'none'), async () => expect(violations).toEqual([]));
      for (const c of await page.locator('.pickup-conversation button:visible, .pickup-conversation textarea:visible').all()) expect((await c.boundingBox()).height).toBeGreaterThanOrEqual(44);
      await expect(page.getByLabel('Message', { exact: true })).toHaveValue('Keep this independent unsent draft.');
    }
    await page.evaluate(() => { document.documentElement.style.fontSize = ''; });
    await post(receiver, '/api/pickup-requests/' + request.id + '/actions', { action: 'cancel', version: request.version });
    await page.getByRole('button', { name: 'Reload request', exact: true }).click(); await expect(page.getByText(/This request is closed. You can read/)).toBeVisible();
    await expect(page.getByLabel('Unsent message', { exact: true })).toHaveValue('Keep this independent unsent draft.'); await expect(page.getByLabel('Unsent message', { exact: true })).toHaveAttribute('readonly');
    await expect(page.getByRole('button', { name: 'Send message', exact: true })).toBeDisabled();
    await page.getByRole('button', { name: 'Discard draft', exact: true }).click(); await expect(page.getByRole('button', { name: 'Send message', exact: true })).toHaveCount(0);
    const other = await receiver.newPage(); await other.goto('/app/pickups/' + request.id + '#conversation');
    await expect(other.getByText(/This request is closed. You can read/)).toBeVisible(); await expect(other.getByRole('region', { name: 'Message history' }).locator('.chat-message')).toHaveCount(2);
    await expect(other.getByRole('button', { name: 'Send message', exact: true })).toHaveCount(0); expect(sends).toBe(1); expect(deployment.serverErrors).toEqual([]);
  } finally { for (const c of contexts) await c.close(); }
});
