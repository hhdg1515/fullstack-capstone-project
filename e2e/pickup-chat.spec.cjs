const { randomUUID } = require('node:crypto');
const fs = require('node:fs'); const path = require('node:path');
const AxeBuilder = require('@axe-core/playwright').default;
const { test: base, expect } = require('./fixtures.cjs');
const { localEnvironment } = require('./local.cjs');
// A dedicated local worker keeps this message-heavy case within real rate limits.
// It cannot use remote targets or enlarge the hosted synthetic-data budget.
const test = base.extend({ deployment: [async ({}, use) => {
  if (process.env.E2E_APP_ORIGIN) throw Error('Chat browser fixtures are local only');
  const local = await localEnvironment(); try { await use(local); } finally { await local.close(); }
}, { scope: 'worker', timeout: 180000 }] });
test.skip(Boolean(process.env.E2E_APP_ORIGIN), 'Chat fixtures and evidence use only disposable local data');

test('participants exchange private text, retain reading position and drafts, then read closed history', async ({ browser, deployment }, testInfo) => {
  const options = { ...testInfo.project.use, baseURL: deployment.origin, ignoreHTTPSErrors: true,
    extraHTTPHeaders: { 'X-Deployment-Target': deployment.fingerprint } };
  delete options.launchOptions; delete options.trace; delete options.screenshot; delete options.video;
  const contexts = [];
  const post = async (context, url, data) => {
    const result = await context.request.post(url, { maxRedirects: 0, headers: { Origin: deployment.origin, 'X-CSRF-Protection': '1' }, data });
    expect(result.ok()).toBe(true); return result.json();
  };
  const account = async firstName => {
    const context = await browser.newContext(options); contexts.push(context);
    await post(context, '/api/auth/register', { firstName, lastName: 'Local', email: randomUUID() + '@example.invalid', password: randomUUID() + '!' }); return context;
  };
  const relativeTop = async (page, label) => {
    const box = await page.getByRole('region', { name: 'Message history', exact: true }).boundingBox();
    return (await page.getByText(label, { exact: true }).boundingBox()).y - box.y;
  };
  try {
    const giver = await account('Giver'), receiver = await account('Requester');
    const a = await giver.newPage(), b = await receiver.newPage();
    let accept = true; a.on('dialog', dialog => accept ? dialog.accept() : dialog.dismiss());
    b.on('dialog', dialog => dialog.accept());
    const { plan } = await post(giver, '/api/move-out-plans', { city: 'Oakland', neighborhood: 'Temescal', pickupTimeZone: 'UTC', moveOutDeadline: new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10) });
    const { item } = await post(giver, '/api/move-out-plans/' + plan.id + '/items', { name: 'Local desk', publish: true });
    const { request } = await post(receiver, '/api/pickup-requests', { itemId: item.id, localDateTime: new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10) + 'T12:00', timeZone: 'UTC' });
    const endpoint = '/api/pickup-requests/' + request.id + '/conversation/messages';
    for (let i = 1; i <= 23; i++) await post(i % 2 ? giver : receiver, endpoint, {
      text: 'Local history message ' + String(i).padStart(2, '0') + (i === 23 ? '\n' + 'https://example.invalid/longword'.repeat(25) + '\nCafé 😀' : '') });
    await a.goto('/app/pickups/' + request.id); await b.goto('/app/pickups/' + request.id);
    await expect(a.getByText('Conversation loaded.', { exact: true })).toBeVisible(); await expect(b.getByText('Conversation loaded.', { exact: true })).toBeVisible();
    const history = a.getByRole('region', { name: 'Message history', exact: true });
    await expect(history.locator('.chat-message')).toHaveCount(20); await expect(a.getByText('Local history message 01', { exact: true })).toHaveCount(0);
    await a.getByRole('button', { name: 'Load earlier messages', exact: true }).scrollIntoViewIfNeeded();
    await history.evaluate(element => { element.scrollTop = 160; });
    const before = await relativeTop(a, 'Local history message 08');
    await a.getByRole('button', { name: 'Load earlier messages', exact: true }).click(); await expect(history.locator('.chat-message')).toHaveCount(23);
    expect(Math.abs(await relativeTop(a, 'Local history message 08') - before)).toBeLessThan(3);
    await a.getByLabel('Message', { exact: true }).fill('Unsent giver draft');
    accept = false; await a.getByRole('link', { name: 'Back to requests', exact: true }).click();
    await expect(a.getByLabel('Message', { exact: true })).toHaveValue('Unsent giver draft'); accept = true;
    let posts = 0; b.on('request', value => { if (value.method() === 'POST' && value.url().endsWith(endpoint)) posts++; });
    const receiverText = b.getByLabel('Message', { exact: true }); await receiverText.fill('Ready to collect.\nSee you by the library.');
    await receiverText.evaluate(element => { element.form.requestSubmit(); element.form.requestSubmit(); });
    await expect(b.getByText('Message sent.', { exact: true })).toBeVisible(); expect(posts).toBe(1); await expect(receiverText).toHaveValue('');
    await a.getByRole('button', { name: 'Refresh conversation', exact: true }).scrollIntoViewIfNeeded();
    await history.evaluate(element => { element.scrollTop = 160; }); const anchor = await relativeTop(a, 'Local history message 08');
    await a.getByRole('button', { name: 'Refresh conversation', exact: true }).click(); await expect(history.locator('.chat-message')).toHaveCount(24);
    expect(Math.abs(await relativeTop(a, 'Local history message 08') - anchor)).toBeLessThan(3);
    await expect(a.getByLabel('Message', { exact: true })).toHaveValue('Unsent giver draft');
    const input = a.getByLabel('Message', { exact: true }); await input.fill('😀'.repeat(2001));
    await a.getByRole('button', { name: 'Send message', exact: true }).click(); await expect(input).toBeFocused(); await expect(input).toHaveAttribute('aria-invalid', 'true');
    await input.fill('Thanks, see you there.'); await input.press('Enter'); await expect(input).toHaveValue('Thanks, see you there.\n');
    await input.press('Tab'); await expect(a.getByRole('button', { name: 'Send message', exact: true })).toBeFocused(); await a.keyboard.press('Enter');
    await expect(a.getByText('Message sent.', { exact: true })).toBeVisible(); await expect(history.locator('.chat-message')).toHaveCount(25);
    if (testInfo.project.name === 'mobile') await a.setViewportSize({ width: 320, height: 740 });
    expect(await a.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    const rules = (await new AxeBuilder({ page: a }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations.map(row => row.id);
    await test.step('Authenticated conversation WCAG rules: ' + (rules.join(', ') || 'none'), async () => expect(rules).toEqual([]));
    if (process.env.M62_CAPTURE_DOCS === '1') {
      await a.getByRole('heading', { name: 'Pickup conversation', exact: true }).click();
      await expect(a.getByRole('link', { name: 'Skip to main content', exact: true })).not.toBeInViewport();
      const directory = path.resolve(__dirname, '../docs/assets/milestone-6.2'); fs.mkdirSync(directory, { recursive: true });
      await a.locator('.pickup-conversation').screenshot({ path: path.join(directory, 'conversation-' + testInfo.project.name + '.png') });
    }
    let fail = true;
    await a.route('**/conversation/messages', route => route.request().method() === 'POST' && fail ?
      route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: { code: 'SERVICE_UNAVAILABLE', message: 'Unavailable' } }) }) : route.continue());
    await input.fill('Do not lose this draft.'); await a.getByRole('button', { name: 'Send message', exact: true }).click();
    await expect(a.getByRole('alert').filter({ hasText: 'Sending could not be confirmed' })).toBeVisible();
    await expect(a.getByLabel('Unsent message', { exact: true })).toHaveAttribute('readonly'); await expect(a.getByRole('button', { name: 'Send message', exact: true })).toBeDisabled();
    fail = false; await a.getByRole('button', { name: 'Refresh conversation', exact: true }).click(); await expect(a.getByRole('button', { name: 'Send message', exact: true })).toBeEnabled();
    await expect(a.getByLabel('Message', { exact: true })).toHaveValue('Do not lose this draft.'); await expect(history.locator('.chat-message')).toHaveCount(25);
    await a.getByRole('button', { name: 'Cancel request', exact: true }).click(); await expect(a.getByText(/This request is closed/)).toBeVisible();
    await expect(a.getByLabel('Unsent message', { exact: true })).toHaveAttribute('readonly'); await expect(a.getByRole('button', { name: 'Send message', exact: true })).toBeDisabled();
    await a.getByRole('button', { name: 'Discard draft', exact: true }).click(); await expect(a.getByRole('button', { name: 'Send message', exact: true })).toHaveCount(0);
    await b.getByRole('button', { name: 'Refresh conversation', exact: true }).click(); await expect(b.getByText(/This request is closed/)).toBeVisible();
    await expect(b.getByRole('region', { name: 'Message history', exact: true }).locator('.chat-message')).toHaveCount(22);
    await b.getByRole('button', { name: 'Load earlier messages', exact: true }).click();
    await expect(b.getByRole('region', { name: 'Message history', exact: true }).locator('.chat-message')).toHaveCount(25);
    await expect(b.getByRole('button', { name: 'Send message', exact: true })).toHaveCount(0);
  } finally { for (const context of contexts) await context.close(); }
});
