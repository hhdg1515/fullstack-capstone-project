const { randomUUID, createHash } = require('node:crypto');
const fs = require('node:fs'); const path = require('node:path');
const sharp = require('../giftlink-backend/node_modules/sharp');
const AxeBuilder = require('@axe-core/playwright').default;
const { test: base, expect } = require('@playwright/test');
const { localEnvironment } = require('./local.cjs');
const test = base.extend({ deployment: [async ({}, use) => {
  if (process.env.E2E_APP_ORIGIN) throw Error('D1 fixtures are isolated local only');
  const local = await localEnvironment({ photos: true }); try { await use(local); } finally { await local.close(); }
}, { timeout: 180000 }] });
test.skip(Boolean(process.env.E2E_APP_ORIGIN), 'D1 never enables hosted photos');
const day = n => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
async function scene(browser, deployment, info) {
  const contexts = [];
  const context = async () => { const value = await browser.newContext({ baseURL: deployment.origin, ignoreHTTPSErrors: true,
    viewport: { width: info.project.name === 'mobile' ? 320 : 1440, height: 1000 }, deviceScaleFactor: 1,
    extraHTTPHeaders: { 'X-Deployment-Target': deployment.fingerprint } }); contexts.push(value); return value; };
  const owner = await context(), anonymous = await context(), requester = await context();
  const headers = { Origin: deployment.origin, 'X-CSRF-Protection': '1' };
  const post = async (url, data, actor = owner) => { const response = await actor.request.post(url, { headers, data }); expect(response.ok()).toBe(true); return response.json(); };
  try {
    for (const actor of [owner, requester]) await post('/api/auth/register', { firstName: 'Local', lastName: 'Gallery', email: randomUUID() + '@example.invalid', password: randomUUID() + '!' }, actor);
    const { plan } = await post('/api/move-out-plans', { stateId: '06', metroId: '41860', city: 'Oakland', neighborhood: 'Local area', pickupTimeZone: 'UTC', moveOutDeadline: day(20) });
    const root = '/api/move-out-plans/' + plan.id + '/items';
    const create = async (name, count) => {
      let { item } = await post(root, { name, categoryId: 'dining-kitchen', itemTypeId: 'dining-chair', description: 'Synthetic household item for local photo verification.', condition: 'good' });
      const prefix = root + '/' + item.id, photos = []; let revision = 0;
      for (const color of ['#387ab2', '#d4a242', '#54875c', '#a06a9c', '#bb5a43'].slice(0, count)) {
        // Real decoded/sanitized synthetic fixtures, never public stock photographs.
        const buffer = await sharp({ create: { width: 600, height: 400, channels: 3, background: color } }).png().toBuffer();
        const { upload } = await post(prefix + '/images/uploads', { imageRevision: revision, clientUploadId: randomUUID(), byteLength: buffer.length, sha256: createHash('sha256').update(buffer).digest('hex') });
        const response = await owner.request.put(prefix + '/images/' + upload.id + '/content', { headers, multipart: { file: { name: 'synthetic.png', mimeType: 'image/png', buffer } } });
        expect(response.status()).toBe(201); revision = (await response.json()).imageRevision; photos.push(upload.id);
      }
      ({ item } = await post(prefix + '/actions', { action: 'publish', version: item.version }));
      return { item, photos, prefix, revision };
    };
    return { owner, anonymous, requester, post, create, close: async () => { for (const actor of contexts) await actor.close(); } };
  } catch (error) { for (const actor of contexts) await actor.close(); throw error; }
}
async function audit(page, name) {
  await page.mouse.move(0, 0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  const errors = (await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations.map(row => row.id);
  await test.step('D1 ' + name + ' WCAG rules: ' + (errors.join(', ') || 'none'), async () => expect(errors).toEqual([]));
}
async function loaded(images) { for (const image of await images.all()) { await image.scrollIntoViewIfNeeded(); await expect.poll(() => image.evaluate(node => node.complete && node.naturalWidth > 0)).toBe(true); } }
async function evidence(page, info, name, target = page.locator('main')) {
  if (!process.env.PUBLIC_PHOTO_EVIDENCE) return;
  const directory = path.join(__dirname, '../docs/verification/m65d1'); fs.mkdirSync(directory, { recursive: true });
  const viewport = page.viewportSize(), bounds = await target.boundingBox();
  try {
    await page.setViewportSize({ width: viewport.width, height: Math.max(viewport.height, Math.ceil(bounds.height) + 1000) });
    await target.scrollIntoViewIfNeeded(); await target.screenshot({ path: path.join(directory, info.project.name + '-' + name + '.png') });
  } finally { await page.setViewportSize(viewport); }
}
const list = '/app/items?stateId=06&metroId=41860';
const gallery = page => page.getByRole('region', { name: 'Item photos' });
test('bounded covers and ordered galleries retain regional counts, owner actions and keyboard/mobile access', async ({ browser, deployment }, info) => {
  const s = await scene(browser, deployment, info);
  try {
    const five = await s.create('Reading chair with five synthetic photos', 5), one = await s.create('Small chair with one synthetic photo', 1), none = await s.create('No-photo legacy-style chair', 0);
    const page = await s.anonymous.newPage(), requests = [];
    page.on('request', request => requests.push(new URL(request.url()).pathname));
    await page.goto(list);
    await expect(page.getByRole('heading', { name: '3 available items', exact: true })).toBeVisible();
    const cards = page.getByRole('list', { name: 'Available items' }); await loaded(cards.locator('img'));
    expect(requests.filter(url => url.endsWith('/display'))).toEqual([]);
    expect(requests.some(url => /\/items\/[^/]+\/images/.test(url))).toBe(false);
    expect(await cards.locator('img').count()).toBe(2); await expect(cards.getByText('No photo', { exact: true })).toBeVisible();
    await expect(cards.getByRole('link', { name: five.item.name, exact: true }).locator('img')).toHaveAttribute('src', '/api/item-images/' + five.photos[0] + '/thumbnail');
    await audit(page, 'discovery'); await evidence(page, info, 'discovery-covers');
    const ownerPage = await s.owner.newPage(); await ownerPage.goto(list); await expect(ownerPage.getByText('Your listing', { exact: true })).toHaveCount(3);
    await expect(ownerPage.getByRole('link', { name: 'Request pickup', exact: true })).toHaveCount(0);
    await page.getByRole('link', { name: five.item.name, exact: true }).click();
    const photos = gallery(page); await loaded(photos.locator('img'));
    await expect(photos.locator('.public-gallery-primary img')).toHaveCount(1);
    await expect(page.getByRole('link', { name: 'Request pickup', exact: true })).toBeVisible();
    await expect(photos.getByRole('button', { name: 'Show photo 1 of 5', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await audit(page, 'five-photo gallery'); await evidence(page, info, 'gallery-five');
    await photos.getByRole('button', { name: 'Show photo 1 of 5', exact: true }).focus(); await page.keyboard.press('End');
    await expect(photos.getByRole('button', { name: 'Show photo 5 of 5', exact: true })).toBeFocused();
    await expect(photos.locator('.public-gallery-primary img')).toHaveAttribute('src', '/api/item-images/' + five.photos[4] + '/display');
    await page.keyboard.press('ArrowLeft'); await expect(photos.getByRole('button', { name: 'Show photo 4 of 5', exact: true })).toBeFocused();
    await photos.getByRole('button', { name: 'Previous photo', exact: true }).click(); await expect(photos.getByText('Photo 3 of 5', { exact: true })).toBeVisible();
    if (info.project.name === 'mobile') { await page.setViewportSize({ width: 375, height: 1000 }); await audit(page, '375 gallery'); }
    else { await page.setViewportSize({ width: 640, height: 1000 }); await page.evaluate(() => document.documentElement.style.fontSize = '200%'); await audit(page, 'zoom reflow'); }
    await page.evaluate(() => document.documentElement.style.fontSize = ''); await page.setViewportSize({ width: info.project.name === 'mobile' ? 320 : 1440, height: 1000 });
    await page.goto('/app/items/' + one.item.id); await loaded(gallery(page).locator('img')); await expect(gallery(page).getByRole('button')).toHaveCount(0); await audit(page, 'single photo'); await evidence(page, info, 'gallery-one');
    await page.goto('/app/items/' + none.item.id); await expect(gallery(page).getByText('No photos yet.', { exact: true })).toBeVisible(); await expect(page.getByRole('heading', { name: none.item.name, exact: true })).toBeVisible(); await audit(page, 'no photo'); await evidence(page, info, 'gallery-none');
    await page.goto(list + '&categoryId=dining-kitchen&itemTypeId=dining-chair&limit=1'); await expect(page.getByRole('heading', { name: '3 available items', exact: true })).toBeVisible();
    await expect(page.getByRole('list', { name: 'Available items' }).getByRole('listitem')).toHaveCount(1);
    await page.getByRole('button', { name: 'Load more', exact: true }).click(); await expect(page.getByRole('list', { name: 'Available items' }).getByRole('listitem')).toHaveCount(2);
    const response = await s.anonymous.request.get('/api/items?stateId=06&metroId=41860&limit=1'); const body = await response.json(); expect(body.total).toBe(3);
    expect(Object.keys(body.items[0]).some(key => /ownerId|planId|storage|quota|revision/i.test(key))).toBe(false);
    expect(deployment.serverErrors).toEqual([]);
  } finally { await s.close(); }
});
test('authoritative cover changes, variant errors and stale URLs preserve item information and revocation', async ({ browser, deployment }, info) => {
  const s = await scene(browser, deployment, info);
  try {
    const item = await s.create('Gallery recovery chair', 5), page = await s.anonymous.newPage();
    const reversed = item.photos.slice().reverse();
    await page.goto('/app/items/' + item.item.id); await loaded(gallery(page).locator('img'));
    await s.post(item.prefix + '/images/order', { imageRevision: item.revision, imageIds: reversed });
    await page.getByRole('button', { name: 'Refresh listings', exact: true }).click();
    await expect(gallery(page).locator('.public-gallery-primary img')).toHaveAttribute('src', '/api/item-images/' + reversed[0] + '/display');
    // Verify this batch has loaded before issuing another gallery refresh;
    // overlapping batches may legitimately hit the unchanged eight-read budget.
    await loaded(gallery(page).locator('img'));
    await s.post(item.prefix + '/images/' + reversed[0] + '/actions', { imageRevision: item.revision + 1, action: 'delete' });
    await page.getByRole('button', { name: 'Refresh listings', exact: true }).click();
    await expect(gallery(page).getByRole('button', { name: 'Show photo 1 of 4', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect(gallery(page).locator('.public-gallery-primary img')).toHaveAttribute('src', '/api/item-images/' + reversed[1] + '/display');
    await loaded(gallery(page).locator('img'));
    expect((await s.anonymous.request.get('/api/item-images/' + reversed[0] + '/thumbnail')).status()).toBe(404);
    await page.goto(list); await loaded(page.locator('.public-item-cover img'));
    await expect(page.locator('.public-item-cover img')).toHaveAttribute('src', '/api/item-images/' + reversed[1] + '/thumbnail');
    // A real browser network failure; backend contracts separately delete/corrupt real fixture variants.
    await page.route('**/api/item-images/' + reversed[1] + '/thumbnail', route => route.abort());
    await page.reload(); await expect(page.getByText('Photo unavailable', { exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: '1 available item', exact: true })).toBeVisible(); await audit(page, 'cover failure'); await evidence(page, info, 'cover-unavailable');
    await page.route('**/api/item-images/' + reversed[1] + '/display', route => route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":{"code":"IMAGE_READ_UNAVAILABLE"}}' }));
    await page.getByRole('link', { name: item.item.name, exact: true }).click();
    await expect(gallery(page).getByText('Photo unavailable. Choose another photo or refresh the listing.', { exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: item.item.name, exact: true })).toBeVisible(); await audit(page, 'display failure'); await evidence(page, info, 'gallery-unavailable');
    await gallery(page).getByRole('button', { name: 'Next photo', exact: true }).click(); await loaded(gallery(page).locator('.public-gallery-primary img'));
    await s.post(item.prefix + '/actions', { action: 'unlist', version: item.item.version });
    for (const actor of [s.anonymous, s.requester]) for (const variant of ['thumbnail', 'display']) expect((await actor.request.get('/api/item-images/' + reversed[1] + '/' + variant)).status()).toBe(404);
    expect((await s.owner.request.get('/api/item-images/' + reversed[1] + '/thumbnail')).status()).toBe(200);
    await page.getByRole('button', { name: 'Refresh listings', exact: true }).click();
    await expect(gallery(page)).toHaveCount(0); await expect(page.getByRole('link', { name: 'Request pickup', exact: true })).toHaveCount(0); await expect(page.getByRole('alert')).toBeVisible(); await audit(page, 'revoked listing');
    await page.goto(list); await expect(page.getByRole('heading', { name: '0 available items', exact: true })).toBeVisible(); await expect(page.locator('.public-item-cover img')).toHaveCount(0);
  } finally { await s.close(); }
});
