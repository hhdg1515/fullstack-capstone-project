const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const AxeBuilder = require('@axe-core/playwright').default;
const { test: base, expect } = require('@playwright/test');
const { localEnvironment } = require('./local.cjs');
const { selectItemType } = require('./item-type.cjs');
const test = base.extend({ deployment: [async ({}, use) => {
  if (process.env.E2E_APP_ORIGIN) throw Error('B3 acceptance is disposable local only');
  const d = await localEnvironment({ ownerListings: true }); try { await use(d); } finally { await d.close(); }
}, { timeout: 180000 }] });
async function evidence(page, width, state) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  const violations = (await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations.map(v => v.id);
  await test.step('B3 F4 ' + width + ' ' + state + ' WCAG: ' + (violations.join(', ') || 'none'), async () => expect(violations).toEqual([]));
  if (process.env.B3_EVIDENCE_DIR) {
    fs.mkdirSync(process.env.B3_EVIDENCE_DIR, { recursive: true });
    await page.evaluate(() => scrollTo(0, 0));
    await page.screenshot({ path: path.join(process.env.B3_EVIDENCE_DIR, width + '-' + state + '.png'), fullPage: true });
  }
}
test('integrated independent drafts, explicit local deadlines, legacy compatibility and private gates', async ({ browser, deployment }, info) => {
  for (const width of info.project.name === 'mobile' ? [375, 320] : [1440, 768]) {
    const options = { baseURL: deployment.origin, ignoreHTTPSErrors: true, viewport: { width, height: 1000 } };
    const owner = await browser.newContext(options), other = await browser.newContext(options), anonymous = await browser.newContext(options);
    const headers = { Origin: deployment.origin, 'X-CSRF-Protection': '1' };
    const call = async (context, method, url, data, status = 200) => {
      const r = await context.request[method](url, { headers, ...(data === undefined ? {} : { data }) }); expect(r.status()).toBe(status); return r.status() === 204 ? null : r.json();
    };
    try {
      const page = await owner.newPage(); page.on('dialog', dialog => dialog.accept());
      const email = randomUUID() + '@example.test', password = randomUUID() + 'synthetic';
      await page.goto('/'); await page.getByRole('link', { name: 'Start Giving', exact: true }).click();
      await page.getByRole('link', { name: 'Register Here', exact: true }).click();
      for (const [label, value] of [['First name', 'Acceptance'], ['Last name', 'Synthetic'], ['Email', email], ['Password', password]]) await page.getByLabel(label, { exact: true }).fill(value);
      await page.getByRole('button', { name: 'Register', exact: true }).click();
      await expect(page).toHaveURL(deployment.origin + '/app/listings'); await expect(page.getByText('No listings yet.')).toBeVisible();
      const identity = (await call(owner, 'get', '/api/me')).user;
      const plansBefore = await deployment.db.collection('moveOutPlans').countDocuments();
      const ownPlans = () => deployment.db.collection('moveOutPlans').countDocuments({ ownerId: new (require('../giftlink-backend/node_modules/mongodb').ObjectId)(identity.id) });
      expect(await ownPlans()).toBe(0); await evidence(page, width, 'listings-empty');
      await expect(page.getByRole('link', { name: 'Incoming requests', exact: true })).toHaveAttribute('href', '/app/pickups/incoming');
      await page.getByRole('link', { name: 'Create Listing', exact: true }).click(); await evidence(page, width, 'create-empty');
      const save = () => page.getByRole('button', { name: 'Save Draft', exact: true }).first().click();
      await save(); await expect(page.getByLabel('Item name')).toBeFocused(); await evidence(page, width, 'validation');
      const firstName = 'Acceptance desk ' + width, secondName = 'Acceptance lamp ' + width;
      await page.getByLabel('Item name').fill(firstName); await evidence(page, width, 'create-partial'); await save();
      await expect(page.getByRole('heading', { name: firstName, exact: true })).toBeVisible();
      const firstId = new URL(page.url()).pathname.split('/').pop();
      const first = (await call(owner, 'get', '/api/me/items/' + firstId)).item;
      expect(first.location.metroId).toBeNull(); expect(first.pickup.availableUntil).toBeNull(); expect(first.pickup.timeZoneConfirmed).toBe(false);
      expect(first.photoPreview.availability).toBe('disabled'); expect(first.capabilities.publish).toBe(false); expect(first.capabilities.photos).toBe(false);
      await page.getByRole('link', { name: 'Edit listing', exact: true }).click();
      await selectItemType(page, 'office-chair'); await page.getByLabel('Description', { exact: true }).fill('Synthetic household item for private draft acceptance.');
      await page.getByLabel('State', { exact: true }).selectOption('06'); await page.getByLabel('Metro area', { exact: true }).selectOption('31080');
      await page.getByRole('button', { name: 'Use suggested timezone' }).click(); await expect(page.getByLabel('Confirm this pickup timezone')).not.toBeChecked();
      await page.getByLabel('Confirm this pickup timezone').check(); await page.getByLabel('Pickup deadline', { exact: true }).fill('2027-11-12'); await save();
      await expect(page).toHaveURL(deployment.origin + '/app/listings/' + firstId); await expect(page.getByText('Pickup timezone: America/Los_Angeles · Confirmed')).toBeVisible();
      await evidence(page, width, 'private-detail');
      for (const label of [/publish/i, /upload/i, /withdraw/i, /request pickup/i, /send message/i]) await expect(page.getByRole('button', { name: label })).toHaveCount(0);
      const visibleText = await page.locator('main').innerText();
      for (const privateValue of [firstId, identity.id, email, 'imageRevision', 'storageKey', 'coordinationRevision']) expect(visibleText).not.toContain(privateValue);
      await page.getByRole('link', { name: 'My Listings', exact: true }).last().click(); await page.getByRole('link', { name: 'Create Listing', exact: true }).click();
      await page.getByLabel('Item name').fill(secondName); await page.getByLabel('State', { exact: true }).selectOption('36'); await page.getByLabel('Metro area', { exact: true }).selectOption('35620');
      await page.getByRole('button', { name: 'Use suggested timezone' }).click(); await expect(page.getByLabel('Pickup timezone', { exact: true })).toHaveValue('America/New_York');
      await expect(page.getByLabel('Confirm this pickup timezone')).not.toBeChecked(); await page.getByLabel('Confirm this pickup timezone').check();
      await page.getByLabel('Pickup deadline', { exact: true }).fill('2027-11-15'); await save(); await expect(page.getByRole('heading', { name: secondName, exact: true })).toBeVisible();
      const secondId = new URL(page.url()).pathname.split('/').pop(), secondBefore = (await call(owner, 'get', '/api/me/items/' + secondId)).item;
      expect(secondBefore.pickup.expiresAt).toBe('2027-11-16T05:00:00.000Z');
      const firstBefore = (await call(owner, 'get', '/api/me/items/' + firstId)).item; expect(firstBefore.pickup.expiresAt).toBe('2027-11-13T08:00:00.000Z');
      expect(await ownPlans()).toBe(0); expect(await deployment.db.collection('moveOutPlans').countDocuments()).toBe(plansBefore);
      await page.getByRole('link', { name: 'My Listings', exact: true }).last().click(); await expect(page.getByRole('link', { name: firstName, exact: true })).toBeVisible(); await expect(page.getByRole('link', { name: secondName, exact: true })).toBeVisible();
      await evidence(page, width, 'listings-populated');
      await page.getByRole('link', { name: 'Edit ' + firstName, exact: true }).click(); await page.getByLabel('Description', { exact: true }).fill('Updated only this independent item.'); await evidence(page, width, 'edit'); await save();
      await expect(page).toHaveURL(deployment.origin + '/app/listings/' + firstId); await expect(page.getByText('Updated only this independent item.', { exact: true })).toBeVisible();
      expect((await call(owner, 'get', '/api/me/items/' + secondId)).item).toEqual(secondBefore);
      await page.getByRole('link', { name: 'Edit listing', exact: true }).click(); await page.getByLabel('Description', { exact: true }).fill('Keep the conflicting local edit.');
      const fresh = (await call(owner, 'get', '/api/me/items/' + firstId)).item;
      await call(owner, 'patch', '/api/items/' + firstId, { version: fresh.version, description: 'Concurrent canonical description.' }); await save();
      await expect(page.getByRole('alert')).toContainText('This draft changed'); await expect(page.getByLabel('Description', { exact: true })).toHaveValue('Keep the conflicting local edit.'); await evidence(page, width, 'stale-conflict');
      await page.getByRole('button', { name: 'Cancel', exact: true }).click(); await expect(page).toHaveURL(deployment.origin + '/app/listings');
      await call(other, 'post', '/api/auth/register', { email: randomUUID() + '@example.test', password: randomUUID() + 'synthetic', firstName: 'Other', lastName: 'Synthetic' }, 201);
      await call(other, 'get', '/api/me/items/' + firstId, undefined, 404); await call(other, 'patch', '/api/items/' + firstId, { version: fresh.version + 1, name: 'Unauthorized change' }, 404);
      const foreignPage = await other.newPage(); await foreignPage.goto('/app/items/' + firstId + '/edit'); await expect(foreignPage.getByRole('alert')).toBeVisible(); await expect(foreignPage.getByLabel('Item name')).toHaveCount(0); await expect(foreignPage.getByText(firstName, { exact: true })).toHaveCount(0);
      const publicFeed = await call(anonymous, 'get', '/api/items?stateId=06&metroId=31080'); expect(publicFeed.total).toBe(0); expect(publicFeed.items).toEqual([]);
      await call(anonymous, 'get', '/api/items/' + firstId, undefined, 404);
      const anonPage = await anonymous.newPage(); await anonPage.goto('/app/items?stateId=06&metroId=31080'); await expect(anonPage.getByRole('heading', { name: 'No items here yet' })).toBeVisible(); await expect(anonPage.getByRole('link', { name: firstName, exact: true })).toHaveCount(0);
      const publicRefresh = anonPage.waitForResponse(response => new URL(response.url()).pathname === '/api/items' && response.status() === 200);
      const sessionCheck = anonPage.waitForResponse(response => new URL(response.url()).pathname === '/api/me' && response.status() === 401);
      await anonPage.evaluate(() => window.dispatchEvent(new Event('focus'))); await sessionCheck; await publicRefresh;
      await expect(anonPage.getByRole('heading', { name: 'No items here yet' })).toBeVisible(); await expect(anonPage.getByRole('alert')).toHaveCount(0);
      const latest = (await call(owner, 'get', '/api/me/items/' + firstId)).item;
      const publication = await call(owner, 'post', '/api/items/' + firstId + '/actions', { version: latest.version, action: 'publish' }, 409); expect(publication.error.code).toBe('V2_PUBLICATION_DISABLED');
      await call(other, 'post', '/api/pickup-requests', { itemId: firstId, localDateTime: '2027-11-10T12:00', timeZone: 'America/Los_Angeles' }, 409);
      const noCsrf = await owner.request.post('/api/items', { data: { name: 'Rejected missing origin' } }); expect(noCsrf.status()).toBe(403);
      expect(await ownPlans()).toBe(0);
      // Explicit legacy setup happens only after zero-hidden-plan acceptance.
      const { plan } = await call(owner, 'post', '/api/move-out-plans', { city: 'Local', neighborhood: 'Synthetic', moveOutDeadline: '2027-11-20' }, 201);
      const { item: legacy } = await call(owner, 'post', '/api/move-out-plans/' + plan.id + '/items', { name: 'Legacy acceptance ' + width }, 201);
      await page.reload(); await page.getByRole('link', { name: 'Edit ' + legacy.name, exact: true }).click(); await expect(page.getByLabel('Item name', { exact: true })).toHaveValue(legacy.name);
      const patches = []; page.on('request', request => { if (request.method() === 'PATCH') patches.push(new URL(request.url()).pathname); });
      await page.getByLabel('Item name', { exact: true }).fill('Edited legacy ' + width); await page.getByRole('button', { name: 'Save Draft', exact: true }).click();
      await expect.poll(() => patches.length).toBe(1); expect(patches[0]).toBe('/api/move-out-plans/' + plan.id + '/items/' + legacy.id);
      await expect.poll(async () => (await call(owner, 'get', '/api/me/items/' + legacy.id)).item.name).toBe('Edited legacy ' + width);
      expect((await call(owner, 'get', '/api/me/items/' + secondId)).item).toEqual(secondBefore); expect(await ownPlans()).toBe(1);
      await page.route('**/api/me/items', route => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: { code: 'OWNER_LISTINGS_DISABLED', message: 'Unavailable' } }) }), { times: 1 });
      await page.goto('/app/listings'); await expect(page.getByRole('alert')).toContainText('temporarily unavailable'); await expect(page.getByRole('link', { name: 'Create Listing', exact: true })).toHaveCount(0); await evidence(page, width, 'feature-disabled');
    } finally { await owner.close(); await other.close(); await anonymous.close(); }
  }
});
