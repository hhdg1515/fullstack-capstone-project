const { randomUUID } = require('node:crypto');
const { test, expect } = require('./fixtures.cjs');
test.skip(Boolean(process.env.E2E_APP_ORIGIN), 'Request review fixtures use only disposable local data');
test('giver distinguishes requests for the same item and reviews the selected applicant', async ({ browser, deployment }, testInfo) => {
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
  try {
    const giver = await account('Giver'); const alex = await account('Alex'); const sam = await account('Sam');
    const { plan } = await post(giver, '/api/move-out-plans', { city: 'Oakland', neighborhood: 'Temescal', pickupTimeZone: 'UTC', moveOutDeadline: new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10) });
    const { item } = await post(giver, '/api/move-out-plans/' + plan.id + '/items', { categoryId: "other-household", itemTypeId: "other", description: "A household item for local pickup.", name: 'Shared desk', publish: true });
    const date = new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10);
    const requests = [];
    for (const [context, time, note] of [[alex, '11:00', 'Library entrance'], [sam, '12:00', 'Cafe entrance']]) {
      const { request } = await post(context, '/api/pickup-requests', { itemId: item.id, localDateTime: date + 'T' + time, timeZone: 'UTC', note }); requests.push(request);
    }
    const page = await giver.newPage(); await page.goto('/app/pickups/incoming');
    for (const [index, name] of ['Alex', 'Sam'].entries()) {
      const card = page.locator('li.plan-panel').filter({ has: page.getByText('Applicant: ' + name, { exact: true }) });
      await expect(card.getByRole('link', { name: 'Shared desk', exact: true })).toHaveAttribute('href', '/app/items/' + item.id);
      await expect(card.getByText('Awaiting giver decision', { exact: true })).toBeVisible();
      await expect(card.locator('time')).toHaveAttribute('datetime', requests[index].proposedAt);
      await card.getByText('Note and request reference', { exact: true }).click();
      await expect(card.getByText(requests[index].note, { exact: true })).toBeVisible(); await expect(card.locator('code')).toHaveText(requests[index].id);
      await expect(card.getByRole('link', { name: 'Review request from ' + name + ' for Shared desk', exact: true })).toHaveAttribute('href', '/app/pickups/' + requests[index].id);
    }
    await page.getByRole('link', { name: 'Review request from Sam for Shared desk', exact: true }).click();
    await expect(page.getByText('Applicant: Sam', { exact: true })).toBeVisible();
    await expect(page.getByText('Cafe entrance', { exact: true })).toBeVisible(); await expect(page.getByText('Library entrance', { exact: true })).toHaveCount(0);
    await page.getByRole('link', { name: 'Back to requests', exact: true }).click();
    await page.getByLabel('Request status', { exact: true }).selectOption('accepted');
    await expect(page.getByText('No requests match this status.', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Clear status filter', exact: true }).click(); await expect(page.getByText('Applicant: Alex', { exact: true })).toBeVisible();
  } finally { for (const context of contexts) await context.close(); }
});
