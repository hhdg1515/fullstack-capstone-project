const { randomUUID, randomBytes, createHash } = require('node:crypto');
const fs = require('node:fs'); const path = require('node:path');
const sharp = require('../giftlink-backend/node_modules/sharp');
const AxeBuilder = require('@axe-core/playwright').default;
const { test: base, expect } = require('@playwright/test');
const { localEnvironment } = require('./local.cjs');
const { selectItemType } = require('./item-type.cjs');
const test = base.extend({ deployment: [async ({}, use) => {
  if (process.env.E2E_APP_ORIGIN) throw Error('E1 acceptance is isolated local only');
  const local = await localEnvironment({ photos: true }); try { await use(local); } finally { await local.close(); }
}, { timeout: 180000 }] });
test.skip(Boolean(process.env.E2E_APP_ORIGIN), 'E1 never activates hosted storage');
const day = n => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
async function audit(page, state) {
  await page.mouse.move(0, 0); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  const errors = (await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations.map(row => row.id);
  await test.step('E1 ' + state + ' WCAG rules: ' + (errors.join(', ') || 'none'), async () => expect(errors).toEqual([]));
}
async function pixels(target) { for (const image of await target.locator('img').all()) await expect.poll(() => image.evaluate(node => node.complete && node.naturalWidth > 0)).toBe(true); }
async function evidence(page, info, state, target = page.locator('main')) {
  if (!process.env.PHOTO_ACCEPTANCE_EVIDENCE) return;
  const directory = path.join(__dirname, '../docs/verification/m65e1'); fs.mkdirSync(directory, { recursive: true });
  const viewport = page.viewportSize(), bounds = await target.boundingBox();
  try {
    await page.setViewportSize({ width: viewport.width, height: Math.max(viewport.height, Math.ceil(bounds.height) + 1000) });
    await target.scrollIntoViewIfNeeded(); await pixels(target); await target.screenshot({ path: path.join(directory, info.project.name + '-' + state + '.png') });
  } finally { await page.setViewportSize(viewport); }
}
test('the same real photo batch survives compression, uncertain publish, management, discovery, pickup and cleanup', async ({ browser, deployment }, info) => {
  const contexts = []; let firstGate, secondGate;
  const actor = async firstName => {
    const context = await browser.newContext({ baseURL: deployment.origin, ignoreHTTPSErrors: true,
      viewport: { width: info.project.name === 'mobile' ? 320 : 1440, height: 1000 }, deviceScaleFactor: 1,
      extraHTTPHeaders: { 'X-Deployment-Target': deployment.fingerprint } }); contexts.push(context);
    await post(context, '/api/auth/register', { firstName, lastName: 'Synthetic', email: randomUUID() + '@example.invalid', password: randomUUID() + '!' }); return context;
  };
  const post = async (context, url, data) => { const r = await context.request.post(url, { headers: { Origin: deployment.origin, 'X-CSRF-Protection': '1' }, data }); expect(r.ok()).toBe(true); return r.status() === 204 ? {} : r.json(); };
  const get = async (context, url) => { const r = await context.request.get(url); expect(r.ok()).toBe(true); return r.json(); };
  try {
    const owner = await actor('Acceptance giver'), requester = await actor('Acceptance requester');
    const { plan } = await post(owner, '/api/move-out-plans', { stateId: '06', metroId: '41860', city: 'Oakland', neighborhood: 'Local acceptance area', pickupTimeZone: 'UTC', moveOutDeadline: day(20) });
    const page = await owner.newPage(), receiver = await requester.newPage(); const root = '/api/move-out-plans/' + plan.id + '/items';
    const name = 'Synthetic acceptance chair'; let creates = 0, puts = 0;
    page.on('request', request => { const pathname = new URL(request.url()).pathname;
      if (request.method() === 'POST' && pathname === root) creates++;
      if (request.method() === 'PUT' && pathname.endsWith('/content')) puts++;
    });
    await page.goto('/app/plans/' + plan.id + '/items'); await page.getByLabel('Item name', { exact: true }).fill(name);
    await selectItemType(page, 'office-chair'); await page.getByLabel('Description', { exact: true }).fill('Synthetic local acceptance item; no real household data.');
    const large = await sharp(randomBytes(1300 * 1000 * 3), { raw: { width: 1300, height: 1000, channels: 3 } }).png().toBuffer();
    expect(large.length).toBeGreaterThan(3 * 1024 * 1024);
    const small = await sharp({ create: { width: 600, height: 400, channels: 3, background: '#54875c' } }).png().toBuffer();
    await page.getByLabel('Choose photos', { exact: true }).setInputFiles([
      { name: 'private-source-name.png', mimeType: 'image/png', buffer: large },
      { name: 'second-source.png', mimeType: 'image/png', buffer: small }, { name: 'third-source.png', mimeType: 'image/png', buffer: small }
    ]);
    await expect(page.getByAltText('Local preview of selected photo 3')).toBeVisible(); expect(puts).toBe(0); expect(creates).toBe(0);
    expect(await deployment.db.collection('itemImages').countDocuments()).toBe(0);
    await audit(page, 'selected'); await evidence(page, info, 'selected');
    firstGate = deployment.deferNextPhotoResponse(); await page.getByRole('button', { name: 'Publish with 3 photos', exact: true }).click(); await firstGate.arrived;
    secondGate = deployment.deferNextPhotoResponse(); firstGate.release(); firstGate = undefined; await secondGate.arrived; secondGate.discard(); secondGate = undefined;
    await expect(page.getByText('Upload not confirmed. Check status.', { exact: true })).toBeVisible();
    await expect(page.getByText('Item published.', { exact: true })).toBeVisible(); expect(creates).toBe(1); expect(puts).toBe(2);
    const saved = await deployment.db.collection('items').findOne({ name }), itemRoot = root + '/' + saved._id;
    const card = page.getByRole('heading', { name, exact: true }).locator('xpath=ancestor::li[1]');
    await expect(card.getByAltText('Uploaded photo 1', { exact: true })).toBeVisible(); await audit(page, 'partial publish'); await evidence(page, info, 'partial', card);
    await page.getByRole('button', { name: 'Refresh inventory', exact: true }).click(); await page.getByRole('button', { name: 'Check upload 1 status', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Upload remaining 1 photo', exact: true })).toBeEnabled(); expect(puts).toBe(2);
    await page.getByRole('button', { name: 'Upload remaining 1 photo', exact: true }).click(); await expect(card.getByAltText('Uploaded photo 3', { exact: true })).toBeVisible();
    expect(creates).toBe(1); expect(puts).toBe(3); expect(await deployment.db.collection('items').countDocuments()).toBe(1);
    const ready = await deployment.db.collection('itemImages').find({ state: 'ready' }).sort({ sortPosition: 1 }).toArray();
    expect(ready).toHaveLength(3); expect(ready[0].intent.byteLength).toBeLessThanOrEqual(3 * 1024 * 1024);
    expect(ready[0].intent.sha256).not.toBe(createHash('sha256').update(large).digest('hex'));
    const originalQuota = (await deployment.db.collection('users').findOne({ _id: saved.ownerId })).itemImageQuota;
    for (const variant of ['thumbnail', 'display']) {
      const r = await owner.request.get('/api/item-images/' + ready[0]._id + '/' + variant); expect(r.status()).toBe(200);
      expect(r.headers()['cache-control']).toBe('private, no-store'); const meta = await sharp(await r.body()).metadata();
      expect(meta.format).toBe('webp'); for (const key of ['exif', 'xmp', 'iptc', 'icc']) expect(meta[key]).toBeUndefined();
    }
    await page.getByRole('button', { name: 'Edit ' + name, exact: true }).click(); const panel = page.locator('#owner-photo-manager');
    const text = page.getByLabel('Description', { exact: true }); await text.fill('Independent unsaved acceptance text.');
    await panel.getByRole('button', { name: 'Make photo 3 cover', exact: true }).focus(); await page.keyboard.press('Enter');
    await expect(panel.getByRole('listitem', { name: 'Saved photo 1, Cover', exact: true })).toBeFocused();
    await panel.getByRole('button', { name: 'Move photo 3 up', exact: true }).click();
    await panel.getByRole('button', { name: 'Delete photo 1', exact: true }).click(); await page.getByRole('dialog').getByRole('button', { name: 'Delete photo', exact: true }).click();
    await expect(panel.getByText('Photo deleted. Cleanup pending.', { exact: true })).toBeVisible(); await expect(text).toHaveValue('Independent unsaved acceptance text.');
    const expected = [ready[1]._id.toString(), ready[0]._id.toString()];
    await expect(card.getByAltText('Uploaded photo 1', { exact: true })).toHaveAttribute('src', '/api/item-images/' + expected[0] + '/thumbnail');
    await audit(page, 'owner management'); await evidence(page, info, 'managed', card);
    expect((await deployment.db.collection('users').findOne({ _id: saved.ownerId })).itemImageQuota.retainedBytes).toBe(originalQuota.retainedBytes);
    const browse = '/app/items?stateId=06&metroId=41860'; await receiver.goto(browse);
    await expect(receiver.getByRole('heading', { name: '1 available item', exact: true })).toBeVisible();
    await expect(receiver.locator('.public-item-cover img')).toHaveAttribute('src', '/api/item-images/' + expected[0] + '/thumbnail');
    await audit(receiver, 'discovery'); await evidence(receiver, info, 'discovery');
    await receiver.getByRole('link', { name, exact: true }).click(); const gallery = receiver.getByRole('region', { name: 'Item photos' });
    await expect(gallery.locator('.public-gallery-primary img')).toHaveAttribute('src', '/api/item-images/' + expected[0] + '/display');
    await gallery.getByRole('button', { name: 'Show photo 1 of 2', exact: true }).focus(); await receiver.keyboard.press('End');
    await expect(gallery.locator('.public-gallery-primary img')).toHaveAttribute('src', '/api/item-images/' + expected[1] + '/display');
    await audit(receiver, 'gallery'); await evidence(receiver, info, 'gallery');
    if (info.project.name === 'mobile') { await receiver.setViewportSize({ width: 375, height: 1000 }); await audit(receiver, 'gallery 375'); await receiver.setViewportSize({ width: 320, height: 1000 }); }
    // Expiration is injected only into this owned local database, not a claim of a scheduler or real elapsed days.
    await deployment.db.collection('items').updateOne({ _id: saved._id }, { $set: { availableUntil: '2000-01-01' } });
    expect((await requester.request.get('/api/items/' + saved._id)).status()).toBe(404);
    expect((await requester.request.get('/api/item-images/' + expected[0] + '/thumbnail')).status()).toBe(404);
    expect((await owner.request.get('/api/item-images/' + expected[0] + '/thumbnail')).status()).toBe(200);
    await deployment.db.collection('items').updateOne({ _id: saved._id }, { $set: { availableUntil: saved.availableUntil } });
    await receiver.getByRole('link', { name: 'Request pickup', exact: true }).click();
    await receiver.getByLabel('Pickup date and time', { exact: true }).fill(day(2) + 'T12:00'); await receiver.getByRole('button', { name: 'Send pickup request', exact: true }).click();
    await expect(receiver.getByRole('heading', { name: 'Pickup request', exact: true })).toBeVisible();
    const requestId = new URL(receiver.url()).pathname.split('/').pop(), requestRoot = '/api/pickup-requests/' + requestId;
    await receiver.getByLabel('Message', { exact: true }).fill('Synthetic integrated coordination.'); await receiver.getByRole('button', { name: 'Send message', exact: true }).click(); await expect(receiver.getByText('Message sent.', { exact: true })).toBeVisible();
    await post(owner, itemRoot + '/actions', { action: 'unlist', version: saved.version, confirmCancelRequests: true });
    await receiver.getByRole('button', { name: 'Reload request', exact: true }).click(); await expect(receiver.getByText('Cancelled', { exact: true })).toBeVisible();
    await expect(receiver.getByRole('article', { name: 'Request summary' }).getByRole('img')).toHaveCount(0);
    await receiver.getByRole('button', { name: 'Refresh conversation', exact: true }).click(); await expect(receiver.getByText('Synthetic integrated coordination.', { exact: true })).toBeVisible();
    await expect(receiver.getByRole('button', { name: 'Send message', exact: true })).toHaveCount(0); await audit(receiver, 'closed private photos'); await evidence(receiver, info, 'closed');
    const version = (await deployment.db.collection('items').findOne({ _id: saved._id })).version;
    await post(owner, itemRoot + '/actions', { action: 'publish', version });
    let { request } = await post(requester, '/api/pickup-requests', { itemId: saved._id.toString(), localDateTime: day(2) + 'T12:00', timeZone: 'UTC' });
    const giverRequest = await owner.newPage(); giverRequest.on('dialog', dialog => dialog.accept());
    await giverRequest.goto('/app/pickups/' + request.id); await giverRequest.getByRole('button', { name: 'Accept pickup', exact: true }).click(); await expect(giverRequest.getByText('Accepted', { exact: true })).toBeVisible();
    await receiver.goto('/app/pickups/' + request.id); await receiver.getByRole('button', { name: 'Propose new time', exact: true }).click();
    await receiver.getByLabel('New pickup date and time', { exact: true }).fill(day(3) + 'T13:00'); await receiver.getByRole('button', { name: 'Propose time change', exact: true }).click();
    await expect(receiver.getByRole('group', { name: 'Pending time change' })).toBeVisible();
    await giverRequest.getByRole('button', { name: 'Reload request', exact: true }).click(); await giverRequest.getByRole('button', { name: 'Accept proposed time', exact: true }).click();
    await expect(giverRequest.getByRole('button', { name: 'Propose new time', exact: true })).toBeVisible();
    ({ request } = await get(owner, '/api/pickup-requests/' + request.id));
    await audit(giverRequest, 'accepted pickup'); await evidence(giverRequest, info, 'pickup');
    const after = Date.parse(request.proposedAt) + 1000; deployment.advance(after); await giverRequest.clock.install({ time: new Date(after) });
    await giverRequest.getByRole('button', { name: 'Reload request', exact: true }).click(); await giverRequest.getByRole('button', { name: 'Confirm handoff', exact: true }).click(); await expect(giverRequest.getByText('Completed', { exact: true })).toBeVisible();
    await receiver.getByRole('button', { name: 'Reload request', exact: true }).click(); await expect(receiver.getByText('Completed', { exact: true })).toBeVisible();
    await expect(receiver.getByRole('article', { name: 'Request summary' }).getByRole('img')).toHaveCount(0);
    expect((await requester.request.get('/api/item-images/' + expected[0] + '/thumbnail')).status()).toBe(404); expect((await owner.request.get('/api/item-images/' + expected[0] + '/thumbnail')).status()).toBe(200);
    await audit(receiver, 'completed'); await evidence(receiver, info, 'completed');
    const cleanup = await deployment.reconcilePhotos(); expect(cleanup.results).toEqual([{ status: 'deleted', category: null }]);
    expect((await deployment.db.collection('itemImages').findOne({ _id: ready[2]._id })).state).toBe('deleted');
    const quota = (await deployment.db.collection('users').findOne({ _id: saved.ownerId })).itemImageQuota;
    expect(quota.retainedBytes).toBeLessThan(originalQuota.retainedBytes); expect(quota.operationCount).toBe(3); expect(quota.successful).toBe(3); expect(quota.attempts).toBe(3);
    expect(await deployment.db.collection('itemImages').countDocuments({ state: 'ready' })).toBe(2);
    expect((await owner.request.get('/api/item-images/' + ready[2]._id + '/thumbnail')).status()).toBe(404);
    expect(await page.evaluate(() => !/blob:|data:image|private-source-name/.test(JSON.stringify(localStorage)))).toBe(true);
    await post(requester, '/api/auth/logout', {}); await receiver.evaluate(() => window.dispatchEvent(new Event('focus'))); await expect(receiver.getByRole('heading', { name: 'Login', exact: true })).toBeVisible();
    expect(deployment.serverErrors).toEqual([]);
  } finally { firstGate?.discard(); secondGate?.discard(); for (const context of contexts) await context.close(); }
});
