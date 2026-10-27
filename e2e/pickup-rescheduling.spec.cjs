const { randomUUID } = require('node:crypto');
const AxeBuilder = require('@axe-core/playwright').default;
const { test: base, expect } = require('./fixtures.cjs');
const { localEnvironment } = require('./local.cjs');
const test = base.extend({ deployment: [async ({}, use) => {
  if (process.env.E2E_APP_ORIGIN) throw Error('Rescheduling browser fixtures are local only');
  const local = await localEnvironment(); try { await use(local); } finally { await local.close(); }
}, { scope: 'worker', timeout: 180000 }] });
test.skip(Boolean(process.env.E2E_APP_ORIGIN), 'Scheduling fixtures never use hosted resources');

test('participants negotiate confirmed pickup times without losing chat or bypassing conflicts', async ({ browser, deployment }, testInfo) => {
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
  const confirmed = page => page.getByText('Confirmed pickup:', { exact: true }).locator('..').locator('time');
  const reload = async page => { await page.getByRole('button', { name: 'Reload request', exact: true }).click(); await expect(page.getByRole('button', { name: 'Reload request', exact: true })).toBeEnabled(); };
  const propose = async (page, time) => {
    await page.getByRole('button', { name: 'Propose new time', exact: true }).click();
    const field = page.getByLabel('New pickup date and time', { exact: true }); await expect(field).toBeFocused(); await field.fill(time);
    await page.getByRole('button', { name: 'Propose time change', exact: true }).click();
    await expect(page.getByRole('group', { name: 'Pending time change', exact: true })).toBeVisible();
  };
  const day = n => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
  try {
    const giver = await account('Giver'), receiver = await account('Requester'); const a = await giver.newPage(), b = await receiver.newPage();
    let accept = true; let dialogs = 0;
    a.on('dialog', dialog => { dialogs++; return accept ? dialog.accept() : dialog.dismiss(); }); b.on('dialog', dialog => dialog.accept());
    if (testInfo.project.name === 'mobile') { await a.setViewportSize({ width: 320, height: 800 }); await b.setViewportSize({ width: 320, height: 800 }); }
    const { plan } = await post(giver, '/api/move-out-plans', { city: 'Oakland', neighborhood: 'Temescal', pickupTimeZone: 'UTC', moveOutDeadline: day(14) });
    const { item } = await post(giver, '/api/move-out-plans/' + plan.id + '/items', { categoryId: "other-household", itemTypeId: "other", description: "A household item for local pickup.", name: 'Scheduling desk', publish: true });
    let { request } = await post(receiver, '/api/pickup-requests', { itemId: item.id, localDateTime: day(2) + 'T12:00', timeZone: 'UTC' });
    request = (await post(giver, '/api/pickup-requests/' + request.id + '/actions', { action: 'accept', version: request.version })).request;
    const initial = request.proposedAt, root = '/api/pickup-requests/' + request.id;
    await post(receiver, root + '/conversation/messages', { text: 'Keep this private discussion intact.' });
    await a.goto('/app/pickups/' + request.id); await b.goto('/app/pickups/' + request.id);
    await expect(a.getByText('Conversation loaded.', { exact: true })).toBeVisible(); await expect(b.getByText('Conversation loaded.', { exact: true })).toBeVisible();
    await a.getByLabel('Message', { exact: true }).fill('Keep this chat draft protected.');
    await a.getByRole('button', { name: 'Propose new time', exact: true }).click(); await a.getByLabel('New pickup date and time', { exact: true }).fill(day(4) + 'T15:00');
    await a.getByRole('button', { name: 'Cancel time edit', exact: true }).click(); const previousDialogs = dialogs;
    accept = false; await a.getByRole('link', { name: 'Back to requests', exact: true }).click();
    await expect(a.getByLabel('Message', { exact: true })).toHaveValue('Keep this chat draft protected.'); expect(dialogs).toBe(previousDialogs + 1); accept = true;
    await a.getByLabel('Message', { exact: true }).fill('');
    await propose(a, day(4) + 'T15:00'); await expect(confirmed(a)).toHaveAttribute('datetime', initial);
    await expect(a.getByRole('button', { name: 'Accept proposed time', exact: true })).toHaveCount(0);
    await reload(b); await expect(confirmed(b)).toHaveAttribute('datetime', initial);
    await b.getByRole('button', { name: 'Decline time change', exact: true }).click(); await expect(b.getByRole('button', { name: 'Propose new time', exact: true })).toBeEnabled();
    await expect(confirmed(b)).toHaveAttribute('datetime', initial);
    await propose(b, day(5) + 'T16:00'); await reload(a);
    await a.getByRole('button', { name: 'Accept proposed time', exact: true }).click();
    await expect(confirmed(a)).toHaveAttribute('datetime', day(5) + 'T16:00:00.000Z'); await expect(a.getByRole('button', { name: 'Propose new time', exact: true })).toBeEnabled();
    await propose(a, day(6) + 'T10:00'); await reload(b); await b.getByRole('button', { name: 'Accept proposed time', exact: true }).click();
    await expect(confirmed(b)).toHaveAttribute('datetime', day(6) + 'T10:00:00.000Z'); await reload(a);
    await expect(a.getByRole('region', { name: 'Message history', exact: true }).locator('.chat-message')).toHaveCount(1);
    await a.getByRole('button', { name: 'Propose new time', exact: true }).click(); await a.getByLabel('New pickup date and time', { exact: true }).fill(day(7) + 'T12:00');
    const response = await receiver.request.get(root, { headers: { 'X-Deployment-Target': deployment.fingerprint } }); expect(response.ok()).toBe(true); const live = (await response.json()).request;
    await post(receiver, root + '/reschedule-proposals', { version: live.version, localDateTime: day(8) + 'T14:00', timeZone: 'UTC' });
    await a.getByRole('button', { name: 'Propose time change', exact: true }).click(); await expect(a.getByRole('alert').filter({ hasText: 'This request or proposal changed' })).toBeVisible();
    await expect(a.getByLabel('New pickup date and time', { exact: true })).toHaveValue(day(7) + 'T12:00');
    await a.getByRole('button', { name: 'Reload current times', exact: true }).click();
    await expect(a.getByRole('group', { name: 'Pending time change', exact: true }).locator('time')).toHaveAttribute('datetime', day(8) + 'T14:00:00.000Z');
    await expect(confirmed(a)).toHaveAttribute('datetime', day(6) + 'T10:00:00.000Z');
    expect(await a.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    const rules = (await new AxeBuilder({ page: a }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations.map(row => row.id);
    await test.step('Scheduling WCAG rules: ' + (rules.join(', ') || 'none'), async () => expect(rules).toEqual([]));
    await a.getByRole('button', { name: 'Decline time change', exact: true }).click();
    await expect(a.getByRole('button', { name: 'Propose time change', exact: true })).toBeEnabled();
    await expect(a.getByLabel('New pickup date and time', { exact: true })).toHaveValue(day(7) + 'T12:00');
    await a.getByRole('button', { name: 'Cancel time edit', exact: true }).click();
    await a.getByLabel('Message', { exact: true }).fill('Confirmed time is clear.'); await a.getByRole('button', { name: 'Send message', exact: true }).click();
    await expect(a.getByText('Message sent.', { exact: true })).toBeVisible(); await expect(a.getByRole('region', { name: 'Message history', exact: true }).locator('.chat-message')).toHaveCount(2);
  } finally { for (const context of contexts) await context.close(); }
});
