const fs = require('node:fs'), path = require('node:path');
const { randomUUID } = require('node:crypto');
const { ObjectId } = require('../giftlink-backend/node_modules/mongodb');
const { Temporal } = require('../giftlink-backend/node_modules/@js-temporal/polyfill');
const sharp = require('../giftlink-backend/node_modules/sharp');
const AxeBuilder = require('@axe-core/playwright').default;
const { test: base, expect } = require('./local-browser.cjs');
const { localEnvironment } = require('./local.cjs');
const { selectItemType } = require('./item-type.cjs');
const test = base.extend({ deployment: [async ({}, use) => {
  if (process.env.E2E_APP_ORIGIN) throw Error('C3 is isolated local only');
  const local = await localEnvironment({ photos: true, ownerListings: true, ownerListingPhotos: true, ownerListingPickups: true, ownerListingPublication: true });
  try { await use(local); } finally { await local.close(); }
}, { timeout: 180000 }] });
test.skip(Boolean(process.env.E2E_APP_ORIGIN), 'C3 never activates hosted resources');
const zone = 'America/Los_Angeles';
const day = n => Temporal.Now.zonedDateTimeISO(zone).toPlainDate().add({ days: n }).toString();
async function audit(page, name) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  const violations = (await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations.map(v => v.id);
  await test.step('C3 ' + page.viewportSize().width + ' ' + name + ' axe: ' + (violations.join(', ') || 'none'), async () => expect(violations).toEqual([]));
  if (process.env.C3_EVIDENCE_DIR) {
    fs.mkdirSync(process.env.C3_EVIDENCE_DIR, { recursive: true });
    await page.screenshot({ path: path.join(process.env.C3_EVIDENCE_DIR, page.viewportSize().width + '-' + name + '.png'), fullPage: true });
  }
}
test('C3 real two-account create/photos/publish/discover/chat/schedule/handoff and withdrawal', async ({ isolatedBrowser: browser, deployment }, info) => {
  const width = info.project.name === 'mobile' ? 375 : 1440;
  const options = { baseURL: deployment.origin, ignoreHTTPSErrors: true, viewport: { width, height: 1000 } };
  const owner = await browser.newContext(options), requester = await browser.newContext(options), anon = await browser.newContext(options), third = await browser.newContext(options);
  const headers = { Origin: deployment.origin, 'X-CSRF-Protection': '1' };
  const call = async (context, method, url, data, status = 200) => {
    const response = await context.request[method](url, { headers, ...(data === undefined ? {} : { data }) }); expect(response.status()).toBe(status); return response.json();
  };
  const register = (context, firstName) => call(context, 'post', '/api/auth/register', { firstName, lastName: 'Synthetic', email: randomUUID() + '@example.test', password: randomUUID() + '!' }, 201);
  try {
    const identity = (await register(owner, 'Giver')).user; await register(requester, 'Reader'); await register(third, 'Outsider');
    const a = await owner.newPage(); a.on('dialog', dialog => dialog.accept());
    await a.goto('/app/listings/new'); await a.getByLabel('Item name').fill('C3 synthetic bookshelf ' + width);
    await a.getByLabel('Description', { exact: true }).fill('Synthetic shelf for the isolated acceptance journey.');
    await selectItemType(a, 'bookshelf'); await a.getByLabel('State', { exact: true }).selectOption('06'); await a.getByLabel('Metro area', { exact: true }).selectOption('31080');
    await a.getByRole('button', { name: 'Use suggested timezone' }).click(); await a.getByLabel('Confirm this pickup timezone').check(); await a.getByLabel('Pickup deadline', { exact: true }).fill(day(12));
    await expect(a.getByRole('button', { name: 'Add photos', exact: true })).toBeEnabled();
    const photos = [];
    for (const color of ['#387ab2', '#d4a242']) photos.push({ name: 'synthetic.png', mimeType: 'image/png', buffer: await sharp({ create: { width: 900, height: 600, channels: 3, background: color } }).png().toBuffer() });
    await a.getByLabel('Choose photos').setInputFiles(photos);
    await expect(a.getByAltText('Local preview of selected photo 2')).toBeVisible(); await audit(a, 'create-photos');
    await a.getByRole('button', { name: 'Save draft with 2 photos', exact: true }).first().click();
    await expect(a).toHaveURL(/\/app\/listings\/[a-f0-9]{24}$/, { timeout: 60000 });
    const id = new URL(a.url()).pathname.split('/').pop();
    await expect(a.getByAltText('Saved photo 1, cover')).toBeVisible();
    const initial = await deployment.db.collection('itemImages').find({ itemId: new ObjectId(id), state: 'ready' }).sort({ sortPosition: 1 }).toArray(); expect(initial).toHaveLength(2);
    expect((await anon.request.get('/api/item-images/' + initial[0]._id + '/thumbnail')).status()).toBe(404);
    await a.getByRole('link', { name: 'Edit listing', exact: true }).click();
    await a.getByRole('button', { name: 'Use photo 2 as cover', exact: true }).click(); await expect(a.getByText('Photo order saved.')).toBeVisible(); await audit(a, 'cover-order');
    await a.getByRole('button', { name: 'Save Draft', exact: true }).first().click(); await expect(a).toHaveURL(deployment.origin + '/app/listings/' + id);
    await a.getByRole('button', { name: 'Publish listing', exact: true }).click(); await expect(a.getByText('Published', { exact: true })).toBeVisible(); await expect(a.getByAltText('Saved photo 1, cover')).toBeVisible(); await audit(a, 'published-owner');
    await a.goto('/app/items/' + id + '/edit'); await expect(a).toHaveURL(deployment.origin + '/app/listings/' + id);
    await expect(a.getByRole('button', { name:'Save Draft',exact:true })).toHaveCount(0);
    const p = await anon.newPage(); await p.goto('/app/items?stateId=06&metroId=31080'); await expect(p.getByRole('link', { name: 'C3 synthetic bookshelf ' + width, exact: true })).toBeVisible();
    await expect.poll(() => p.locator('.public-item-cover img').evaluate(node => node.complete && node.naturalWidth > 0)).toBe(true); await audit(p, 'discovery');
    await p.getByRole('link', { name: 'C3 synthetic bookshelf ' + width, exact: true }).click(); await expect(p.getByRole('button', { name: 'Next photo', exact: true })).toBeEnabled(); await audit(p, 'public-gallery');
    const publicItem = (await call(anon, 'get', '/api/items/' + id)).item; expect(publicItem.images.map(row => row.id)).toEqual([initial[1]._id.toHexString(), initial[0]._id.toHexString()]);
    for (const context of [anon, third]) expect((await context.request.get('/api/me/items/' + id)).status()).toBe(context === anon ? 401 : 404);
    const b = await requester.newPage(); b.on('dialog', dialog => dialog.accept()); await b.goto('/app/items/' + id + '/request');
    const appointment = Temporal.Now.zonedDateTimeISO(zone).add({ minutes: 3 }).toPlainDateTime().toString({ smallestUnit: 'minute' });
    await b.getByLabel('Pickup date and time').fill(appointment); await b.getByRole('button', { name: 'Send pickup request', exact: true }).click(); await expect(b).toHaveURL(/\/app\/pickups\/[a-f0-9]{24}$/);
    const requestId = new URL(b.url()).pathname.split('/').pop(); await audit(b, 'request-pending');
    await a.goto('/app/pickups/' + requestId); await a.getByRole('button', { name: 'Accept pickup', exact: true }).click(); await b.reload();
    await b.getByLabel('Message', { exact: true }).fill('Synthetic requester message.'); await b.getByRole('button', { name: 'Send message', exact: true }).click(); await expect(b.getByText('Synthetic requester message.', { exact: true })).toBeVisible();
    await a.reload(); await expect(a.getByText('Synthetic requester message.', { exact: true })).toBeVisible();
    await a.getByLabel('Message', { exact: true }).fill('Synthetic giver reply.'); await a.getByRole('button', { name: 'Send message', exact: true }).click(); await expect(a.getByText('Synthetic giver reply.', { exact: true })).toBeVisible();
    // Real future appointment; no DB timestamp manipulation or fake handoff.
    const proposed = Temporal.Now.zonedDateTimeISO(zone).add({ seconds: 30 }).round({ smallestUnit: 'minute', roundingMode: 'ceil' }).toPlainDateTime().toString({ smallestUnit: 'minute' });
    await a.getByRole('button', { name: 'Propose new time', exact: true }).click(); await a.getByLabel('New pickup date and time', { exact: true }).fill(proposed); await a.getByRole('button', { name: 'Propose time change', exact: true }).click();
    await expect.poll(async () => (await deployment.db.collection('pickupRequests').findOne({ _id: new ObjectId(requestId) })).rescheduleProposal?.localDateTime).toBe(proposed);
    await b.reload(); await audit(b, 'proposal'); await expect(b.getByRole('button', { name: 'Accept proposed time', exact: true })).toBeEnabled(); await b.getByRole('button', { name: 'Accept proposed time', exact: true }).click();
    await expect.poll(async () => (await deployment.db.collection('pickupRequests').findOne({ _id: new ObjectId(requestId) })).localDateTime).toBe(proposed);
    await audit(b, 'conversation');
    await call(third, 'get', '/api/pickup-requests/' + requestId + '/conversation/messages', undefined, 404);
    const instant = Temporal.PlainDateTime.from(proposed).toZonedDateTime(zone).epochMilliseconds;
    await test.step('Wait for the real confirmed appointment before handoff', async () => {
      await expect.poll(async () => { const clock = await deployment.db.aggregate([{ $documents: [{}] }, { $project: { now: '$$NOW' } }]).next(); return clock.now.getTime() >= instant && Date.now() >= instant; }, { timeout: 90000, intervals: [500] }).toBe(true);
    });
    await a.reload(); await expect(a.getByRole('button', { name: 'Confirm handoff', exact: true })).toBeEnabled(); await a.getByRole('button', { name: 'Confirm handoff', exact: true }).click();
    await expect(a.getByText('Completed', { exact: true }).first()).toBeVisible(); await b.reload();
    await expect(b.getByText('Synthetic giver reply.', { exact: true })).toBeVisible(); await expect(b.getByRole('button', { name: 'Send message', exact: true })).toHaveCount(0); await audit(b, 'completed-history');
    expect((await anon.request.get('/api/item-images/' + initial[0]._id + '/thumbnail')).status()).toBe(404);
    expect((await call(anon, 'get', '/api/items?stateId=06&metroId=31080')).total).toBe(0);
    // A separate item, metro and deadline; explicit withdrawal leaves closed text intact.
    await a.goto('/app/listings/new'); await a.getByLabel('Item name').fill('Separate synthetic bookshelf');
    await a.getByLabel('Description', {exact:true}).fill('Independent second listing'); await selectItemType(a,'bookshelf');
    await a.getByLabel('State', {exact:true}).selectOption('36'); await a.getByLabel('Metro area', {exact:true}).selectOption('35620');
    await a.getByRole('button',{name:'Use suggested timezone'}).click(); await a.getByLabel('Confirm this pickup timezone').check();
    await a.getByLabel('Pickup deadline',{exact:true}).fill(day(8)); await expect(a.getByRole('button',{name:'Add photos',exact:true})).toBeEnabled();
    await a.getByLabel('Choose photos').setInputFiles([photos[0]]); await expect(a.getByAltText('Local preview of selected photo 1')).toBeVisible();
    await a.getByRole('button',{name:'Publish with 1 photo',exact:true}).first().click();
    await expect(a).toHaveURL(/\/app\/listings\/[a-f0-9]{24}$/, {timeout:60000}); await expect(a.getByAltText('Saved photo 1, cover')).toBeVisible();
    const secondId = new URL(a.url()).pathname.split('/').pop(); const second = (await call(owner,'get','/api/me/items/'+secondId)).item;
    expect(second.status).toBe('available'); expect(second.pickup.timeZone).toBe('America/New_York');
    const secondImage = second.photoPreview.images[0].id; await audit(a,'publish-with-photo');
    expect((await anon.request.get('/api/item-images/' + secondImage + '/thumbnail')).status()).toBe(200);
    const pending = (await call(requester, 'post', '/api/pickup-requests', { itemId: second.id, localDateTime: day(3) + 'T10:00', timeZone: 'America/New_York' }, 201)).request;
    await a.goto('/app/listings/' + second.id); await a.getByRole('button', { name: 'Withdraw listing', exact: true }).click();
    await expect(a.getByRole('button', { name: 'Withdraw and cancel requests', exact: true })).toBeVisible(); await audit(a, 'withdrawal-confirmation');
    await a.getByRole('button', { name: 'Withdraw and cancel requests', exact: true }).click();
    await expect(a.getByText('Withdrawn', { exact: true })).toBeVisible(); await expect(a.getByAltText('Saved photo 1, cover')).toBeVisible(); await audit(a, 'withdrawn');
    await call(anon, 'get', '/api/items/' + second.id, undefined, 404);
    expect((await anon.request.get('/api/item-images/' + secondImage + '/thumbnail')).status()).toBe(404);
    expect((await call(requester, 'get', '/api/pickup-requests/' + pending.id)).request.status).toBe('cancelled');
    await call(third, 'post', '/api/pickup-requests', { itemId: second.id, localDateTime: day(3) + 'T10:00', timeZone: 'America/New_York' }, 409);
    expect(await deployment.db.collection('moveOutPlans').countDocuments({ ownerId: new ObjectId(identity.id) })).toBe(0);
    for (const viewport of [{width:320,height:900},{width:375,height:900},{width:768,height:1000}]) {
      await b.setViewportSize(viewport); await b.goto('/app/pickups/' + requestId); await expect(b.getByRole('heading', { name: 'Pickup request' })).toBeVisible(); await audit(b, 'closed-reflow');
      await a.setViewportSize(viewport); await a.goto('/app/listings/new'); await a.getByLabel('Item name').focus(); await a.keyboard.type('Long synthetic item '.repeat(5)); await a.getByRole('button',{name:'Save Draft',exact:true}).last().focus(); await expect(a.getByRole('button',{name:'Save Draft',exact:true}).last()).toBeFocused(); await audit(a,'form-reflow');
      await a.goto('/app/listings/' + id);
    }
    expect(deployment.serverErrors).toEqual([]);
  } finally { await owner.close(); await requester.close(); await anon.close(); await third.close(); }
});
