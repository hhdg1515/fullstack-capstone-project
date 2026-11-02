const { randomUUID, createHash } = require('node:crypto');
const fs = require('node:fs'); const path = require('node:path');
const sharp = require('../giftlink-backend/node_modules/sharp');
const AxeBuilder = require('@axe-core/playwright').default;
const { test: base, expect } = require('./local-browser.cjs');
const { localEnvironment } = require('./local.cjs');
const test = base.extend({ deployment: [async ({}, use) => {
  if (process.env.E2E_APP_ORIGIN) throw Error('D2 fixtures are isolated local only');
  const local = await localEnvironment({ photos: true }); try { await use(local); } finally { await local.close(); }
}, { timeout: 180000 }] });
test.skip(Boolean(process.env.E2E_APP_ORIGIN), 'D2 never enables hosted photos');
const day = n => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
async function scene(browser, deployment, info) {
  const contexts = [];
  const context = async () => { const value = await browser.newContext({ baseURL: deployment.origin, ignoreHTTPSErrors: true,
    viewport: { width: info.project.name === 'mobile' ? 320 : 1440, height: 1000 }, deviceScaleFactor: 1,
    extraHTTPHeaders: { 'X-Deployment-Target': deployment.fingerprint } }); contexts.push(value); return value; };
  const owner = await context(), requester = await context(), outsider = await context();
  const headers = { Origin: deployment.origin, 'X-CSRF-Protection': '1' };
  const post = async (actor, url, data) => { const response = await actor.request.post(url, { headers, data }); expect(response.ok()).toBe(true); return response.status() === 204 ? {} : response.json(); };
  try {
    for (const actor of [owner, requester, outsider]) await post(actor, '/api/auth/register', { firstName: actor === owner ? 'Local giver' : 'Local requester', lastName: 'Synthetic', email: randomUUID() + '@example.invalid', password: randomUUID() + '!' });
    const { plan } = await post(owner, '/api/move-out-plans', { stateId: '06', metroId: '41860', city: 'Oakland', neighborhood: 'Local area', pickupTimeZone: 'UTC', moveOutDeadline: day(20) });
    const root = '/api/move-out-plans/' + plan.id + '/items';
    const create = async (name, count) => {
      let { item } = await post(owner, root, { name, categoryId: 'dining-kitchen', itemTypeId: 'dining-chair', description: 'Synthetic household item for isolated pickup verification.', condition: 'good' });
      const prefix = root + '/' + item.id, photos = []; let revision = 0;
      for (const color of ['#387ab2', '#d4a242'].slice(0, count)) {
        const buffer = await sharp({ create: { width: 600, height: 400, channels: 3, background: color } }).png().toBuffer();
        const { upload } = await post(owner, prefix + '/images/uploads', { imageRevision: revision, clientUploadId: randomUUID(), byteLength: buffer.length, sha256: createHash('sha256').update(buffer).digest('hex') });
        const response = await owner.request.put(prefix + '/images/' + upload.id + '/content', { headers, multipart: { file: { name: 'synthetic.png', mimeType: 'image/png', buffer } } });
        expect(response.status()).toBe(201); revision = (await response.json()).imageRevision; photos.push(upload.id);
      }
      ({ item } = await post(owner, prefix + '/actions', { action: 'publish', version: item.version }));
      const { request } = await post(requester, '/api/pickup-requests', { itemId: item.id, localDateTime: day(2) + 'T12:00', timeZone: 'UTC', note: 'Synthetic coordination note.' });
      return { item, photos, prefix, request, revision };
    };
    return { owner, requester, outsider, create, post, close: async () => { for (const actor of contexts) await actor.close(); } };
  } catch (error) { for (const actor of contexts) await actor.close(); throw error; }
}
const summary = page => page.getByRole('article', { name: 'Request summary', exact: true });
const thumb = page => summary(page).getByRole('img');
async function loaded(image) { await expect(image).toBeVisible(); await expect.poll(() => image.evaluate(node => node.complete && node.naturalWidth > 0)).toBe(true); }
async function audit(page, name) {
  await page.mouse.move(0, 0); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  const errors = (await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations.map(row => row.id);
  await test.step('D2 ' + name + ' WCAG rules: ' + (errors.join(', ') || 'none'), async () => expect(errors).toEqual([]));
}
async function evidence(page, info, name) {
  if (!process.env.PICKUP_PHOTO_EVIDENCE) return;
  const target = page.locator('main'), viewport = page.viewportSize(), bounds = await target.boundingBox();
  const directory = path.join(__dirname, '../docs/verification/m65d2'); fs.mkdirSync(directory, { recursive: true });
  try {
    await page.setViewportSize({ width: viewport.width, height: Math.max(viewport.height, Math.ceil(bounds.height) + 1000) });
    await target.scrollIntoViewIfNeeded(); await target.screenshot({ path: path.join(directory, info.project.name + '-' + name + '.png') });
  } finally { await page.setViewportSize(viewport); }
}
test('participants recognize current covers through acceptance, scheduling, cover changes and closed history', async ({ isolatedBrowser: browser, deployment }, info) => {
  const s = await scene(browser, deployment, info);
  try {
    const fixture = await s.create('Reading chair for local pickup', 2), empty = await s.create('No-photo local chair', 0);
    const page = await s.requester.newPage(), ownerPage = await s.owner.newPage(), images = [];
    page.on('request', request => { if (new URL(request.url()).pathname.startsWith('/api/item-images/')) images.push(new URL(request.url()).pathname); });
    await s.post(s.requester, '/api/pickup-requests/' + fixture.request.id + '/conversation/messages', { text: 'Synthetic pickup history remains readable.' });
    await page.goto('/app/items/' + fixture.item.id + '/request'); await loaded(page.getByRole('img'));
    await expect(page.getByLabel('Pickup date and time', { exact: true })).toBeVisible(); await audit(page, 'request form'); await evidence(page, info, 'request-form');
    await page.goto('/app/pickups/' + fixture.request.id); await loaded(thumb(page));
    await expect(thumb(page)).toHaveAccessibleName(fixture.item.name + ' (current cover)');
    await expect(summary(page).getByText('Pending', { exact: true })).toBeVisible(); await expect(page.getByRole('button', { name: 'Cancel request', exact: true })).toBeEnabled();
    await expect(page.getByText('Synthetic pickup history remains readable.', { exact: true })).toBeVisible();
    await audit(page, 'requester pending'); await evidence(page, info, 'requester-pending');
    await ownerPage.goto('/app/pickups/' + fixture.request.id); await loaded(thumb(ownerPage));
    await ownerPage.getByRole('button', { name: 'Accept pickup', exact: true }).focus(); await expect(ownerPage.getByRole('button', { name: 'Accept pickup', exact: true })).toBeFocused();
    await audit(ownerPage, 'giver pending'); await evidence(ownerPage, info, 'giver-pending');
    ownerPage.once('dialog', dialog => dialog.accept()); await ownerPage.keyboard.press('Enter');
    await expect(summary(ownerPage).getByText('Accepted', { exact: true })).toBeVisible(); await loaded(thumb(ownerPage));
    await page.getByRole('button', { name: 'Reload request', exact: true }).click(); await expect(summary(page).getByText('Accepted', { exact: true })).toBeVisible(); await loaded(thumb(page));
    await expect(page.getByRole('button', { name: 'Propose new time', exact: true })).toBeEnabled();
    const current = (await (await s.requester.request.get('/api/pickup-requests/' + fixture.request.id)).json()).request;
    await s.post(s.requester, '/api/pickup-requests/' + fixture.request.id + '/reschedule-proposals', { version: current.version, localDateTime: day(3) + 'T13:00', timeZone: 'UTC' });
    await page.getByRole('button', { name: 'Reload request', exact: true }).click(); await expect(page.getByRole('group', { name: 'Pending time change' })).toBeVisible(); await loaded(thumb(page));
    await audit(page, 'accepted proposal'); await evidence(page, info, 'accepted-proposal');
    await s.post(s.owner, fixture.prefix + '/images/order', { imageRevision: fixture.revision, imageIds: fixture.photos.slice().reverse() });
    await page.getByRole('button', { name: 'Reload request', exact: true }).click(); await expect(thumb(page)).toHaveAttribute('src', '/api/item-images/' + fixture.photos[1] + '/thumbnail');
    await s.post(s.owner, fixture.prefix + '/images/' + fixture.photos[1] + '/actions', { action: 'delete', imageRevision: fixture.revision + 1 });
    await page.getByRole('button', { name: 'Reload request', exact: true }).click(); await loaded(thumb(page)); await expect(thumb(page)).toHaveAttribute('src', '/api/item-images/' + fixture.photos[0] + '/thumbnail');
    expect((await s.requester.request.get('/api/item-images/' + fixture.photos[1] + '/thumbnail')).status()).toBe(404);
    await s.post(s.owner, fixture.prefix + '/actions', { action: 'unlist', version: fixture.item.version, confirmCancelRequests: true });
    await page.getByRole('button', { name: 'Reload request', exact: true }).click(); await expect(summary(page).getByText('Cancelled', { exact: true })).toBeVisible();
    await expect(thumb(page)).toHaveCount(0); await expect(summary(page).getByText('Photo unavailable', { exact: true })).toBeVisible();
    await expect(page.getByText('Synthetic pickup history remains readable.', { exact: true })).toBeVisible(); await expect(page.getByText('This request is closed. You can read its messages, but cannot send new ones.', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Send message', exact: true })).toHaveCount(0);
    await audit(page, 'closed text without photos'); await evidence(page, info, 'closed-history');
    await ownerPage.getByRole('button', { name: 'Reload request', exact: true }).click(); await loaded(thumb(ownerPage));
    expect((await s.requester.request.get('/api/item-images/' + fixture.photos[0] + '/thumbnail')).status()).toBe(404);
    expect((await s.owner.request.get('/api/item-images/' + fixture.photos[0] + '/thumbnail')).status()).toBe(200);
    const stranger = await s.outsider.request.get('/api/pickup-requests/' + fixture.request.id); expect(stranger.status()).toBe(404);
    await page.goto('/app/pickups/' + empty.request.id); await expect(summary(page).getByText('No photo', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Cancel request', exact: true })).toBeEnabled(); await audit(page, 'no photo'); await evidence(page, info, 'no-photo');
    if (info.project.name === 'mobile') { await page.setViewportSize({ width: 375, height: 1000 }); await audit(page, '375 no photo'); }
    expect(images.every(url => url.endsWith('/thumbnail'))).toBe(true); expect(deployment.serverErrors).toEqual([]);
  } finally { await s.close(); }
});
test('image and request refresh failures preserve actions, text, independent drafts and safe session recovery', async ({ isolatedBrowser: browser, deployment }, info) => {
  const s = await scene(browser, deployment, info); let release;
  try {
    const fixture = await s.create('Recoverable local pickup chair', 1), page = await s.requester.newPage();
    const imagePath = '/api/item-images/' + fixture.photos[0] + '/thumbnail';
    await page.route('**' + imagePath, route => route.abort()); await page.goto('/app/pickups/' + fixture.request.id);
    await expect(summary(page).getByText('Photo unavailable', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Cancel request', exact: true })).toBeEnabled(); await audit(page, 'thumbnail failure'); await evidence(page, info, 'thumbnail-error');
    const draft = page.getByLabel('Message', { exact: true }); await draft.fill('Keep this independent synthetic chat draft.');
    await page.unroute('**' + imagePath); await page.getByRole('button', { name: 'Reload request', exact: true }).click(); await loaded(thumb(page)); await expect(draft).toHaveValue('Keep this independent synthetic chat draft.');
    const requestUrl = '**/api/pickup-requests/' + fixture.request.id;
    const gate = new Promise(resolve => { release = resolve; });
    await page.route(requestUrl, async route => { await gate; await route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":{"code":"PICKUP_BUSY","message":"Local request temporarily unavailable"}}' }); });
    await page.getByRole('button', { name: 'Reload request', exact: true }).click(); await expect(thumb(page)).toHaveCount(0); await expect(page.getByRole('heading', { name: fixture.item.name, exact: true })).toBeVisible();
    release(); release = undefined; await expect(page.getByRole('alert')).toContainText('Local request temporarily unavailable');
    await expect(thumb(page)).toHaveCount(0); await expect(page.getByRole('button', { name: 'Cancel request', exact: true })).toBeDisabled(); await expect(draft).toHaveValue('Keep this independent synthetic chat draft.'); await audit(page, 'stale refresh');
    await page.unroute(requestUrl); await page.getByRole('button', { name: 'Reload request', exact: true }).click(); await loaded(thumb(page));
    await expect(page.getByRole('button', { name: 'Cancel request', exact: true })).toBeEnabled();
    await s.post(s.requester, '/api/auth/logout', {}); await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await expect(page.getByRole('heading', { name: 'Login', exact: true })).toBeVisible(); await expect(page.getByRole('img', { name: /current cover/ })).toHaveCount(0);
  } finally { release?.(); await s.close(); }
});
