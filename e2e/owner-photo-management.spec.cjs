const { randomUUID, createHash } = require('node:crypto');
const fs = require('node:fs'); const path = require('node:path');
const sharp = require('../giftlink-backend/node_modules/sharp');
const AxeBuilder = require('@axe-core/playwright').default;
const { test: base, expect } = require('./local-browser.cjs');
const { localEnvironment } = require('./local.cjs');
// A fresh app per case preserves the real 20/minute metadata limit, without
// raising it, spoofing client IPs or sharing accounting with another case.
const test = base.extend({ deployment: [async ({}, use) => {
  if (process.env.E2E_APP_ORIGIN) throw Error('C2 fixtures are isolated local only');
  const local = await localEnvironment({ photos: true }); try { await use(local); } finally { await local.close(); }
}, { timeout: 180000 }] });
test.skip(Boolean(process.env.E2E_APP_ORIGIN), 'C2 never activates hosted photos');
async function scene(browser, deployment, info, count) {
  const context = await browser.newContext({ baseURL: deployment.origin, ignoreHTTPSErrors: true,
    viewport: { width: info.project.name === 'mobile' ? 320 : 1440, height: 1000 }, deviceScaleFactor: 1,
    extraHTTPHeaders: { 'X-Deployment-Target': deployment.fingerprint } });
  const headers = { Origin: deployment.origin, 'X-CSRF-Protection': '1' };
  const post = async (url, data) => { const result = await context.request.post(url, { headers, data }); expect(result.ok()).toBe(true); return result.json(); };
  try {
    const { user } = await post('/api/auth/register', { firstName: 'Photo owner', lastName: 'Local', email: randomUUID() + '@example.invalid', password: randomUUID() + '!' });
    const { plan } = await post('/api/move-out-plans', { city: 'Oakland', neighborhood: 'Local area', pickupTimeZone: 'America/Los_Angeles', moveOutDeadline: new Date(Date.now() + 20 * 86400000).toISOString().slice(0, 10) });
    const { item } = await post('/api/move-out-plans/' + plan.id + '/items', { name: 'Local photo chair' });
    const prefix = '/api/move-out-plans/' + plan.id + '/items/' + item.id + '/images';
    const photos = []; let revision = 0;
    const bytes = async color => sharp({ create: { width: 600, height: 400, channels: 3, background: color } }).png().toBuffer();
    for (const color of ['#387ab2', '#d4a242', '#54875c'].slice(0, count)) {
      const buffer = await bytes(color);
      const { upload } = await post(prefix + '/uploads', { imageRevision: revision, clientUploadId: randomUUID(), byteLength: buffer.length, sha256: createHash('sha256').update(buffer).digest('hex') });
      const sent = await context.request.put(prefix + '/' + upload.id + '/content', { headers, multipart: { file: { name: 'synthetic.png', mimeType: 'image/png', buffer } } });
      expect(sent.status()).toBe(201); const result = await sent.json(); revision = result.imageRevision; photos.push(upload.id);
    }
    const page = await context.newPage(), inventory = '/app/plans/' + plan.id + '/items'; await page.goto(inventory);
    const card = page.getByRole('heading', { name: item.name, exact: true }).locator('xpath=ancestor::li[1]');
    await expect(card.getByAltText('Uploaded photo ' + count, { exact: true })).toBeVisible();
    await card.getByRole('button', { name: 'Edit ' + item.name, exact: true }).click();
    const panel = page.locator('#owner-photo-manager'); await expect(panel.getByRole('button', { name: 'Add photos', exact: true })).toBeEnabled();
    return { context, page, panel, card, user, plan, item, prefix, inventory, photos, post, headers, bytes };
  } catch (error) { await context.close(); throw error; }
}
async function audit(page, name) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  const errors = (await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations.map(row => row.id);
  await test.step('C2 ' + name + ' WCAG rules: ' + (errors.join(', ') || 'none'), async () => expect(errors).toEqual([]));
}
async function evidence(page, info, name, target = page.locator('#owner-photo-manager')) {
  if (!process.env.PHOTO_MANAGEMENT_EVIDENCE) return;
  const directory = path.join(__dirname, '../docs/verification/m65c2'); fs.mkdirSync(directory, { recursive: true });
  const viewport = page.viewportSize(), bounds = await target.boundingBox();
  try {
    await page.setViewportSize({ width: viewport.width, height: Math.max(viewport.height, Math.ceil(bounds.height) + 1000) });
    await target.scrollIntoViewIfNeeded();
    for (const img of await target.locator('img').all()) await expect.poll(() => img.evaluate(node => node.complete && node.naturalWidth > 0)).toBe(true);
    await target.screenshot({ path: path.join(directory, info.project.name + '-' + name + '.png') });
  } finally { await page.setViewportSize(viewport); }
}
const ids = panel => panel.getByRole('img', { name: /Saved photo/ }).evaluateAll(images => images.map(image => image.getAttribute('src').split('/')[3]));
async function deleted(panel, position) {
  await panel.getByRole('button', { name: 'Delete photo ' + position, exact: true }).click();
  await panel.getByRole('button', { name: 'Delete photo', exact: true }).click();
  await expect(panel.getByRole('button', { name: 'Check photo changes', exact: true })).toHaveCount(0);
  await expect(panel.getByText(/Photo deleted\./)).toBeVisible();
}
test('legacy order compatibility, ordinary delete and cover fallback persist across reload', async ({ isolatedBrowser: browser, deployment }, info) => {
  const s = await scene(browser, deployment, info, 3); const { page, panel, card, context, photos } = s;
  try {
    await evidence(page, info, 'initial', card); await audit(page, 'initial');
    // Legacy ordering remains API-compatible; UX-1 intentionally removes its visible controls.
    await expect(panel.getByRole('button', { name: /Make photo|Move photo/ })).toHaveCount(0);
    for (const [imageRevision, imageIds] of [[3, [photos[2], photos[0], photos[1]]], [4, [photos[2], photos[1], photos[0]]], [5, [photos[2], photos[0], photos[1]]]]) {
      await s.post(s.prefix + '/order', { imageRevision, imageIds });
    }
    await panel.getByText('Photo tips', { exact: true }).click(); await panel.getByRole('button', { name: 'Refresh photos', exact: true }).click();
    await expect.poll(() => ids(panel)).toEqual([photos[2], photos[0], photos[1]]);
    await expect(card.getByAltText('Uploaded photo 1', { exact: true })).toHaveAttribute('src', '/api/item-images/' + photos[2] + '/thumbnail');
    await evidence(page, info, 'reordered', card); await audit(page, 'reordered');
    await deleted(panel, 2); await expect.poll(() => ids(panel)).toEqual([photos[2], photos[1]]); await evidence(page, info, 'ordinary-deleted', card);
    await page.reload(); await card.getByRole('button', { name: 'Edit ' + s.item.name, exact: true }).click();
    await expect.poll(() => ids(panel)).toEqual([photos[2], photos[1]]);
    await panel.getByRole('button', { name: 'Delete photo 1', exact: true }).click();
    const dialog = page.getByRole('dialog'); await expect(dialog).toHaveAccessibleDescription(/next photo will become the cover/);
    await expect(dialog.getByRole('button', { name: 'Keep photo' })).toBeFocused();
    await page.keyboard.press('Shift+Tab'); await expect(dialog.getByRole('button', { name: 'Delete photo', exact: true })).toBeFocused();
    await evidence(page, info, 'delete-confirmation', dialog); await audit(page, 'delete-confirmation');
    await page.keyboard.press('Escape'); await expect(panel.getByRole('button', { name: 'Delete photo 1', exact: true })).toBeFocused();
    await deleted(panel, 1); await expect.poll(() => ids(panel)).toEqual([photos[1]]);
    await expect(card.getByAltText('Uploaded photo 1', { exact: true })).toHaveAttribute('src', '/api/item-images/' + photos[1] + '/thumbnail');
    await evidence(page, info, 'cover-deleted', card); await audit(page, 'cover-deleted');
    if (info.project.name === 'mobile') { await page.setViewportSize({ width: 375, height: 1000 }); await audit(page, '375-reflow'); }
    expect(await deployment.db.collection('itemImages').countDocuments({ state: 'delete_pending' })).toBe(2);
    expect((await deployment.db.collection('items').findOne({ name: s.item.name })).version).toBe(1);
  } finally { await context.close(); }
});
test('stale and uncertain changes preserve independent text/files and require reads without replay', async ({ isolatedBrowser: browser, deployment }, info) => {
  const s = await scene(browser, deployment, info, 2); const { page, panel, context, photos } = s; let gate;
  try {
    const description = page.getByLabel('Description', { exact: true }); await description.fill('Keep this unsaved text.');
    const file = { name: 'local.png', mimeType: 'image/png', buffer: await s.bytes('#a06a9c') };
    await page.getByLabel('Choose photos').setInputFiles(file); await expect(panel.getByAltText('Local preview of selected photo 1')).toBeVisible();
    await s.post(s.prefix + '/order', { imageRevision: 2, imageIds: photos.slice().reverse() });
    let orders = 0, deletes = 0, uploads = 0;
    page.on('request', request => { const url = new URL(request.url()).pathname;
      if (request.method() === 'POST' && url.endsWith('/images/order')) orders++;
      if (request.method() === 'POST' && /\/images\/[a-f0-9]{24}\/actions$/.test(url)) deletes++;
      if (request.method() === 'PUT') uploads++;
    });
    await panel.getByRole('button', { name: 'Delete photo 1', exact: true }).click();
    await panel.getByRole('button', { name: 'Delete photo', exact: true }).click();
    await expect(panel.getByRole('alert')).toHaveText(/Photo change not confirmed/); await panel.getByRole('button', { name: 'Check photo changes' }).click();
    await expect.poll(() => ids(panel)).toEqual(photos.slice().reverse()); expect(orders).toBe(0); expect(deletes).toBe(1);
    gate = deployment.deferNextPhotoResponse('photo-delete'); await panel.getByRole('button', { name: 'Delete photo 1', exact: true }).click();
    await panel.getByRole('button', { name: 'Delete photo', exact: true }).click(); await gate.arrived; gate.discard(); gate = undefined;
    await expect(panel.getByRole('alert')).toHaveText(/Photo change not confirmed/); expect(deletes).toBe(2);
    await evidence(page, info, 'uncertain'); await audit(page, 'uncertain');
    await expect.poll(() => ids(panel)).toEqual(photos.slice().reverse());
    await panel.getByRole('button', { name: 'Check photo changes' }).click(); await expect.poll(() => ids(panel)).toEqual([photos[0]]); expect(deletes).toBe(2); expect(orders).toBe(0);
    await expect(description).toHaveValue('Keep this unsaved text.'); await expect(panel.getByAltText('Local preview of selected photo 1')).toBeVisible(); expect(uploads).toBe(0);
    await page.getByRole('button', { name: 'Cancel edit', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Stay and keep photos' })).toBeFocused(); await page.keyboard.press('Escape');
    await expect(description).toHaveValue('Keep this unsaved text.'); await expect(panel.getByAltText('Local preview of selected photo 1')).toBeVisible();
  } finally { gate?.release(); await context.close(); }
});
test('upload races, expired sessions and nonparticipant denials never cross item or account scope', async ({ isolatedBrowser: browser, deployment }, info) => {
  const s = await scene(browser, deployment, info, 1); const { page, panel, context, photos } = s; let gate;
  try {
    const file = { name: 'local.png', mimeType: 'image/png', buffer: await s.bytes('#54875c') };
    await page.getByLabel('Choose photos').setInputFiles(file); await expect(panel.getByAltText('Local preview of selected photo 1')).toBeVisible();
    gate = deployment.deferNextPhotoResponse(); await page.getByRole('button', { name: 'Save draft with 1 photo', exact: true }).click(); await gate.arrived;
    await expect(panel.getByRole('button', { name: /^Delete photo \d/ })).toHaveCount(0);
    await s.post(s.prefix + '/' + photos[0] + '/actions', { imageRevision: 2, action: 'delete' }); gate.release(); gate = undefined;
    await expect(panel).toHaveCount(0); const retained = await deployment.db.collection('itemImages').findOne({ state: 'ready' });
    await expect(s.card.getByAltText('Uploaded photo 1', { exact: true })).toHaveAttribute('src', '/api/item-images/' + retained._id + '/thumbnail');
    const outsider = await browser.newContext({ baseURL: deployment.origin, ignoreHTTPSErrors: true });
    try {
      const registered = await outsider.request.post('/api/auth/register', { headers: s.headers, data: { firstName: 'Other', lastName: 'Local', email: randomUUID() + '@example.invalid', password: randomUUID() + '!' } }); expect(registered.status()).toBe(201);
      expect((await outsider.request.post(s.prefix + '/order', { headers: s.headers, data: { imageRevision: 3, imageIds: [retained._id.toString()] } })).status()).toBe(404);
      expect((await outsider.request.post(s.prefix + '/' + retained._id + '/actions', { headers: s.headers, data: { imageRevision: 3, action: 'delete' } })).status()).toBe(404);
      expect((await outsider.request.get('/api/item-images/' + retained._id + '/thumbnail')).status()).toBe(404);
    } finally { await outsider.close(); }
    await s.card.getByRole('button', { name: 'Edit ' + s.item.name, exact: true }).click(); await expect(panel.getByRole('button', { name: 'Delete photo 1' })).toBeEnabled();
    await page.getByLabel('Choose photos').setInputFiles(file); await expect(panel.getByAltText('Local preview of selected photo 1')).toBeVisible();
    await deployment.db.collection('sessions').updateMany({}, { $set: { expiresAt: new Date(0) } });
    await panel.getByRole('button', { name: 'Delete photo 1', exact: true }).click(); await panel.getByRole('button', { name: 'Delete photo', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Login', exact: true })).toBeVisible(); await expect(page.getByRole('img', { name: /photo/ })).toHaveCount(0);
    expect(await deployment.db.collection('itemImages').countDocuments({ state: 'ready' })).toBe(1);
  } finally { gate?.release(); await context.close(); }
});
test('logical deletion leaves quota held until receipt-verified physical cleanup and history remains truthful', async ({ isolatedBrowser: browser, deployment }, info) => {
  const s = await scene(browser, deployment, info, 1); const { page, panel, context } = s;
  try {
    // Real browser network failure: a cover badge must not obscure its fallback text.
    await page.route('**/api/item-images/' + s.photos[0] + '/thumbnail', route => route.abort());
    await page.reload(); await s.card.getByRole('button', { name: 'Edit ' + s.item.name, exact: true }).click();
    await panel.scrollIntoViewIfNeeded();
    const unavailable = panel.getByText('Photo unavailable. Refresh to check again.', { exact: true });
    await expect(unavailable).toBeVisible();
    const textBounds = await unavailable.boundingBox(), coverBounds = await panel.getByText('Cover', { exact: true }).boundingBox();
    expect(coverBounds.y).toBeGreaterThanOrEqual(textBounds.y + textBounds.height);
    await evidence(page, info, 'thumbnail-unavailable'); await audit(page, 'thumbnail-failure');
    const before = (await deployment.db.collection('users').findOne({ 'itemImageQuota.operationCount': 1 })).itemImageQuota;
    await deleted(panel, 1); await expect(s.card.getByAltText('Uploaded photo 1', { exact: true })).toHaveCount(0);
    await expect(panel.getByText('Photo deleted. Cleanup pending.')).toBeVisible();
    const held = (await deployment.db.collection('users').findOne({ 'itemImageQuota.operationCount': 1 })).itemImageQuota;
    expect(held.retainedBytes).toBe(before.retainedBytes); expect(held.successful).toBe(before.successful); expect(held.operationCount).toBe(before.operationCount);
    const cleanup = await deployment.reconcilePhotos(); expect(cleanup.results).toEqual([{ status: 'deleted', category: null }]);
    await panel.getByRole('button', { name: 'Refresh photos' }).click(); await expect(panel.getByText('Photo deleted.', { exact: true })).toBeVisible(); await panel.getByText('Upload history', { exact: true }).click();
    await expect(panel.getByText(/^Removed ·/)).toBeVisible(); await audit(page, 'cleaned');
    const after = (await deployment.db.collection('users').findOne({ 'itemImageQuota.operationCount': 1 })).itemImageQuota;
    expect(after.retainedBytes).toBe(0); expect(after.successful).toBe(before.successful); expect(after.attempts).toBe(before.attempts); expect(after.operationCount).toBe(before.operationCount);
    expect((await context.request.get('/api/item-images/' + s.photos[0] + '/thumbnail')).status()).toBe(404);
  } finally { await context.close(); }
});
