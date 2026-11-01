// UX-2C2 browser acceptance: Account A owns an independent (v2) listing,
// Account B requests, coordinates, reschedules and the pickup is decided,
// all on a real HTTPS app and MongoDB replica set. V2 publication is UX-2C3, so
// the listing is made eligible by a documented local fixture step only.
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { ObjectId } = require('../giftlink-backend/node_modules/mongodb');
const AxeBuilder = require('@axe-core/playwright').default;
const { test: base, expect } = require('@playwright/test');
const { localEnvironment } = require('./local.cjs');
const test = base.extend({ deployment: [async ({}, use) => {
  if (process.env.E2E_APP_ORIGIN) throw Error('C2 fixtures are isolated local only');
  const local = await localEnvironment({ ownerListings: true, ownerListingPickups: true }); try { await use(local); } finally { await local.close(); }
}, { timeout: 180000 }] });
test.skip(Boolean(process.env.E2E_APP_ORIGIN), 'C2 never activates hosted v2 pickups');
const zone = 'America/Los_Angeles';
const localDay = offset => new Date(Date.now() + offset * 86400000).toLocaleDateString('en-CA', { timeZone: zone });
async function audit(page, name) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  const violations = (await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations.map(row => row.id);
  await test.step('C2 ' + page.viewportSize().width + ' ' + name + ' WCAG: ' + (violations.join(', ') || 'none'), async () => expect(violations).toEqual([]));
  if (process.env.C2_EVIDENCE_DIR) {
    fs.mkdirSync(process.env.C2_EVIDENCE_DIR, { recursive: true });
    await page.screenshot({ path: path.join(process.env.C2_EVIDENCE_DIR, page.viewportSize().width + '-' + name + '.png'), fullPage: true });
  }
}
test('two accounts request, accept, chat, reschedule and close a pickup for an independent listing', async ({ browser, deployment }, info) => {
  const width = info.project.name === 'mobile' ? 375 : 1440;
  const options = { baseURL: deployment.origin, ignoreHTTPSErrors: true, viewport: { width, height: 1000 } };
  const owner = await browser.newContext(options), requester = await browser.newContext(options), outsider = await browser.newContext(options);
  const headers = { Origin: deployment.origin, 'X-CSRF-Protection': '1' };
  const call = async (context, method, url, data, status = 200) => {
    const r = await context.request[method](url, { headers, ...(data === undefined ? {} : { data }) }); expect(r.status()).toBe(status); return r.json();
  };
  const register = (context, firstName) => call(context, 'post', '/api/auth/register', { firstName, lastName: 'Synthetic', email: randomUUID() + '@example.test', password: randomUUID() + '!' }, 201);
  try {
    const giver = (await register(owner, 'Giver')).user; await register(requester, 'Reader'); await register(outsider, 'Outsider');
    // Account A creates an independent draft through the real owner API: no plan exists.
    const { item } = await call(owner, 'post', '/api/items', { name: 'Independent bookshelf ' + width, description: 'Synthetic bookshelf for the C2 acceptance run.',
      categoryId: 'living-room', itemTypeId: 'bookshelf', stateId: '06', metroId: '31080', pickupTimeZone: zone, pickupTimeZoneConfirmed: true, availableUntil: localDay(20) }, 201);
    expect(await deployment.db.collection('moveOutPlans').countDocuments({ ownerId: new ObjectId(giver.id) })).toBe(0);
    // Requests are refused while it is a private draft.
    const refused = await call(requester, 'post', '/api/pickup-requests', { itemId: item.id, localDateTime: localDay(3) + 'T10:00', timeZone: zone }, 409);
    expect(refused.error.code).toBe('LISTING_UNAVAILABLE');
    // Documented C3 activation dependency: publication is still disabled in the API, so
    // this local fixture step sets the exact published state a C3 publish will write.
    await deployment.db.collection('items').updateOne({ _id: new ObjectId(item.id), listingSchemaVersion: 2 }, { $set: { status: 'available', publishedAt: new Date(Date.now() - 60000) }, $inc: { version: 1 } });

    const b = await requester.newPage(); b.on('dialog', dialog => dialog.accept());
    await b.goto('/app/items/' + item.id); await expect(b.getByRole('heading', { name: item.name, exact: true })).toBeVisible();
    await expect(b.getByText('Pickup dates are local to ' + zone + '.')).toBeVisible(); await audit(b, 'listing');
    await b.getByRole('link', { name: 'Request pickup', exact: true }).click();
    await expect(b.getByText(new RegExp('in ' + zone.replace('/', '\\/') + '\\. The listing ends at the end of that local date\\.'))).toBeVisible();
    await b.getByLabel('Pickup date and time').fill(localDay(3) + 'T10:00'); await b.getByLabel('Coordination note (optional, private)').fill('Synthetic meeting point near the library.');
    await audit(b, 'request-form');
    await b.getByRole('button', { name: 'Send pickup request', exact: true }).click();
    await expect(b).toHaveURL(/\/app\/pickups\/[a-f0-9]{24}$/); const requestId = new URL(b.url()).pathname.split('/').pop();
    await expect(b.getByText('Not reserved. Waiting for the giver to accept a pickup time.')).toBeVisible();
    await expect(b.getByRole('link', { name: 'View item', exact: true })).toHaveAttribute('href', '/app/items/' + item.id);
    await audit(b, 'requester-pending');
    const stored = await deployment.db.collection('pickupRequests').findOne({ _id: new ObjectId(requestId) });
    expect(stored.referenceVersion).toBe(2); expect('planId' in stored).toBe(false); expect(stored.timeZone).toBe(zone);

    // Account A sees it in Incoming requests and accepts.
    const a = await owner.newPage(); a.on('dialog', dialog => dialog.accept());
    await a.goto('/app/pickups/incoming'); await a.getByRole('link', { name: 'View request from Reader for ' + item.name, exact: true }).click();
    await expect(a).toHaveURL(deployment.origin + '/app/pickups/' + requestId);
    await expect(a.getByRole('link', { name: 'View item', exact: true })).toHaveAttribute('href', '/app/listings/' + item.id);
    await expect(a.getByText(new RegExp('\\(local dates in ' + zone.replace('/', '\\/') + '\\)'))).toBeVisible();
    await a.getByRole('button', { name: 'Accept pickup', exact: true }).click();
    await expect(a.getByText('Pickup arranged. The item is reserved; handoff has not been recorded.')).toBeVisible(); await audit(a, 'owner-accepted');

    // Private conversation in both directions.
    await b.reload(); await expect(b.getByText('Conversation loaded.', { exact: true })).toBeVisible();
    await b.getByLabel('Message', { exact: true }).fill('Synthetic hello from the requester.'); await b.getByRole('button', { name: 'Send message', exact: true }).click();
    await expect(b.getByText('Synthetic hello from the requester.')).toBeVisible();
    await a.reload(); await expect(a.getByText('Synthetic hello from the requester.')).toBeVisible();
    await a.getByLabel('Message', { exact: true }).fill('Synthetic reply from the giver.'); await a.getByRole('button', { name: 'Send message', exact: true }).click();
    await expect(a.getByText('Synthetic reply from the giver.')).toBeVisible(); await audit(a, 'conversation');

    // Rescheduling in the item's confirmed zone.
    await a.getByRole('button', { name: 'Propose new time', exact: true }).click();
    await a.getByLabel('New pickup date and time', { exact: true }).fill(localDay(4) + 'T15:30');
    await a.getByRole('button', { name: 'Propose time change', exact: true }).click();
    await b.reload(); await expect(b.getByRole('button', { name: 'Accept proposed time', exact: true })).toBeVisible(); await audit(b, 'proposal');
    await b.getByRole('button', { name: 'Accept proposed time', exact: true }).click();
    await expect.poll(async () => (await deployment.db.collection('pickupRequests').findOne({ _id: new ObjectId(requestId) })).localDateTime).toBe(localDay(4) + 'T15:30');

    // Outsiders and anonymous users see nothing private.
    const c = await outsider.newPage(); await c.goto('/app/pickups/' + requestId);
    await expect(c.getByText(/unavailable/i).first()).toBeVisible(); await expect(c.getByText('Synthetic hello from the requester.')).toHaveCount(0);
    await call(outsider, 'get', '/api/pickup-requests/' + requestId + '/conversation/messages', undefined, 404);
    const listing = await call(outsider, 'get', '/api/items/' + item.id);
    expect(JSON.stringify(listing)).not.toMatch(/Synthetic hello|ownerId|receiverId|coordinationRevision/);
    expect(listing.item.isReserved).toBe(true);

    // The requester cancels; the conversation becomes read-only history.
    await b.reload(); await b.getByRole('button', { name: 'Cancel request', exact: true }).click();
    await expect(b.getByText(/Cancellation reason: cancelled by receiver/)).toBeVisible();
    await expect(b.getByRole('button', { name: 'Send message', exact: true })).toHaveCount(0);
    await expect(b.getByText('Synthetic reply from the giver.')).toBeVisible(); await audit(b, 'cancelled');
    const after = await deployment.db.collection('items').findOne({ _id: new ObjectId(item.id) });
    expect(after.status).toBe('available'); expect(after.listingSchemaVersion).toBe(2); expect('planId' in after).toBe(false);
    expect(await deployment.db.collection('moveOutPlans').countDocuments({ ownerId: new ObjectId(giver.id) })).toBe(0);
    if (width === 375) {
      // Narrow reflow check for the request and detail screens.
      await b.setViewportSize({ width: 320, height: 900 }); await b.goto('/app/pickups/' + requestId); await expect(b.getByRole('heading', { name: 'Pickup request' })).toBeVisible();
      await audit(b, 'detail-narrow'); await b.goto('/app/items/' + item.id + '/request'); await audit(b, 'request-form-narrow');
    }
  } finally { await owner.close(); await requester.close(); await outsider.close(); }
});
