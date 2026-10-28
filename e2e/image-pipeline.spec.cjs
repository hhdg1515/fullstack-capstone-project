const { randomUUID, createHash } = require('node:crypto');
const { root } = require('./policy.cjs');
const sharp = require(root + '/giftlink-backend/node_modules/sharp');
const { test: base, expect } = require('./fixtures.cjs');
const { localEnvironment } = require('./local.cjs');
const test = base.extend({ deployment: [async ({}, use) => {
  if (process.env.E2E_APP_ORIGIN) throw Error('Photo browser fixtures never use hosted resources');
  const local = await localEnvironment({ photos: true }); try { await use(local); } finally { await local.close(); }
}, { scope: 'worker', timeout: 180000 }] });
test.skip(Boolean(process.env.E2E_APP_ORIGIN), 'B3 photo fixtures are isolated local only; hosted media remains disabled');

test('isolated HTTPS photos preserve real browser account boundaries and current revocation without upload UI', async ({ browser, deployment }, testInfo) => {
  const options = { ...testInfo.project.use, baseURL: deployment.origin, ignoreHTTPSErrors: true,
    extraHTTPHeaders: { 'X-Deployment-Target': deployment.fingerprint } };
  delete options.launchOptions; delete options.trace; delete options.screenshot; delete options.video;
  const contexts = [];
  const post = async (context, url, data) => {
    const response = await context.request.post(url, { maxRedirects: 0, headers: { Origin: deployment.origin, 'X-CSRF-Protection': '1' }, data });
    expect(response.ok()).toBe(true); return response.json();
  };
  const account = async () => {
    const context = await browser.newContext(options); contexts.push(context);
    await post(context, '/api/auth/register', { firstName: 'Synthetic', lastName: 'Photo', email: randomUUID() + '@example.invalid', password: randomUUID() + '!' });
    return context;
  };
  try {
    const giver = await account(), other = await account();
    const deadline = new Date(deployment.now() + 20 * 86400000).toISOString().slice(0, 10);
    const { plan } = await post(giver, '/api/move-out-plans', { moveOutDeadline: deadline, city: 'San Francisco', neighborhood: 'Sunset', pickupTimeZone: 'UTC' });
    const { item } = await post(giver, '/api/move-out-plans/' + plan.id + '/items', { name: 'Synthetic photo chair' });
    const prefix = '/api/move-out-plans/' + plan.id + '/items/' + item.id + '/images';
    const bytes = await sharp({ create: { width: 800, height: 600, channels: 3, background: '#387ab2' } }).png().toBuffer();
    const { upload } = await post(giver, prefix + '/uploads', { imageRevision: 0, clientUploadId: randomUUID(), byteLength: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') });
    const uploaded = await giver.request.put(prefix + '/' + upload.id + '/content', { headers: { Origin: deployment.origin, 'X-CSRF-Protection': '1' },
      multipart: { file: { name: 'synthetic.png', mimeType: 'image/png', buffer: bytes } } });
    expect(uploaded.status()).toBe(201); expect((await uploaded.json()).image.state).toBe('ready');
    const path = '/api/item-images/' + upload.id + '/display';
    const a = await giver.newPage(), b = await other.newPage();
    await a.goto('/app/plans'); await b.goto('/app/plans');
    // The test-only img verifies actual browser cookie/resource policy behavior;
    // no photo manager, production UI or draft persistence is added.
    const image = (page, source) => page.evaluate(async url => {
      const img = document.createElement('img'); img.alt = 'Synthetic photo verification'; img.src = url; document.body.appendChild(img);
      return new Promise(resolve => { img.onload = () => resolve(img.naturalWidth); img.onerror = () => resolve(0); });
    }, source);
    expect(await image(a, path)).toBe(800); expect(await image(b, path)).toBe(0);
    expect((await other.request.get(path)).status()).toBe(404);
    await post(giver, prefix + '/' + upload.id + '/actions', { imageRevision: 1, action: 'delete' });
    await a.reload(); expect(await image(a, path)).toBe(0);
    expect((await giver.request.get(path)).status()).toBe(404);
    // B4 runs only through the receipt-verified local test capability, never
    // through an HTTP operator route or a hosted deployment.
    const cleanup = await deployment.reconcilePhotos();
    expect(cleanup.operations).toBe(1); expect(cleanup.results).toEqual([{ status: 'deleted', category: null }]);
    expect(await deployment.db.collection('itemImages').countDocuments({ state: 'deleted' })).toBe(1);
    expect((await giver.request.get(path)).status()).toBe(404);
    const account = await deployment.db.collection('users').findOne({ 'itemImageQuota.operationCount': 1 });
    expect(account.itemImageQuota.retainedBytes).toBe(0); expect(account.itemImageQuota.successful).toBe(1);
    expect(deployment.serverErrors).toEqual([]);
  } finally { await Promise.all(contexts.map(context => context.close())); }
});
