// UX-2C1 browser acceptance: private photos for independent drafts through the
// real HTTPS app, MongoDB replica set, Sharp processing and private SeaweedFS.
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const sharp = require('../giftlink-backend/node_modules/sharp');
const { ObjectId } = require('../giftlink-backend/node_modules/mongodb');
const AxeBuilder = require('@axe-core/playwright').default;
const { test: base, expect } = require('@playwright/test');
const { localEnvironment } = require('./local.cjs');
const test = base.extend({ deployment: [async ({}, use) => {
  if (process.env.E2E_APP_ORIGIN) throw Error('C1 fixtures are isolated local only');
  const local = await localEnvironment({ photos: true, ownerListings: true, ownerListingPhotos: true }); try { await use(local); } finally { await local.close(); }
}, { timeout: 180000 }] });
test.skip(Boolean(process.env.E2E_APP_ORIGIN), 'C1 never activates hosted photos');
async function audit(page, name) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  const violations = (await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations.map(row => row.id);
  await test.step('C1 ' + name + ' WCAG: ' + (violations.join(', ') || 'none'), async () => expect(violations).toEqual([]));
  if (process.env.C1_EVIDENCE_DIR) {
    fs.mkdirSync(process.env.C1_EVIDENCE_DIR, { recursive: true });
    for (const img of await page.locator('main img').all()) await expect.poll(() => img.evaluate(node => node.complete && node.naturalWidth > 0)).toBe(true);
    await page.screenshot({ path: path.join(process.env.C1_EVIDENCE_DIR, page.viewportSize().width + '-' + name + '.png'), fullPage: true });
  }
}
const day = offset => new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10);
test('independent draft photos: one save, private owner delivery, no plan, recovery-safe deletion', async ({ browser, deployment }, info) => {
  const width = info.project.name === 'mobile' ? 375 : 1440;
  const options = { baseURL: deployment.origin, ignoreHTTPSErrors: true, viewport: { width, height: 1000 } };
  const owner = await browser.newContext(options), other = await browser.newContext(options);
  const headers = { Origin: deployment.origin, 'X-CSRF-Protection': '1' };
  const register = async context => {
    const r = await context.request.post('/api/auth/register', { headers, data: { firstName: 'Synthetic', lastName: 'Owner', email: randomUUID() + '@example.test', password: randomUUID() + '!' } });
    expect(r.status()).toBe(201); return (await r.json()).user;
  };
  try {
    const identity = await register(owner); await register(other);
    const files = [];
    for (const color of ['#387ab2', '#d4a242']) files.push({ name: 'synthetic-' + color.slice(1) + '.png', mimeType: 'image/png',
      buffer: await sharp({ create: { width: 900, height: 600, channels: 3, background: color } }).png().toBuffer() });
    const page = await owner.newPage(); page.on('dialog', dialog => dialog.accept());
    const posts = []; page.on('request', request => { if (request.method() === 'POST' && new URL(request.url()).pathname === '/api/items') posts.push(request.url()); });
    await page.goto('/app/listings/new');
    await page.getByLabel('Item name').fill('Synthetic photo lamp ' + width);
    await page.getByLabel('Choose photos').setInputFiles(files);
    await expect(page.getByAltText('Local preview of selected photo 2')).toBeVisible();
    // No confirmed deadline yet: the files stay staged and nothing is sent.
    await page.getByRole('button', { name: 'Save draft with 2 photos', exact: true }).first().click();
    await expect(page.getByRole('link', { name: 'Add a pickup deadline to save photos.' })).toBeVisible();
    expect(posts).toHaveLength(0); await audit(page, 'deadline-required');
    await page.getByLabel('State', { exact: true }).selectOption('06'); await page.getByLabel('Metro area', { exact: true }).selectOption('31080');
    await page.getByRole('button', { name: 'Use suggested timezone' }).click(); await page.getByLabel('Confirm this pickup timezone').check();
    await page.getByLabel('Pickup deadline', { exact: true }).fill(day(12)); await audit(page, 'staged');
    await page.getByRole('button', { name: 'Save draft with 2 photos', exact: true }).first().click();
    await expect(page).toHaveURL(/\/app\/listings\/[a-f0-9]{24}$/, { timeout: 60000 });
    const itemId = new URL(page.url()).pathname.split('/').pop(); expect(posts).toHaveLength(1);
    const saved = page.getByRole('list', { name: 'Saved photos' }).getByRole('img');
    await expect(saved).toHaveCount(2); await expect(page.getByAltText('Saved photo 1, cover')).toBeVisible();
    await expect.poll(() => page.getByAltText('Saved photo 1, cover').evaluate(node => node.complete && node.naturalWidth > 0)).toBe(true);
    await audit(page, 'saved-detail');
    const rows = await deployment.db.collection('itemImages').find({ itemId: new ObjectId(itemId) }).toArray();
    expect(rows).toHaveLength(2); expect(rows.every(row => row.schemaVersion === 2 && !('planId' in row) && row.state === 'ready')).toBe(true);
    expect(await deployment.db.collection('moveOutPlans').countDocuments({ ownerId: new ObjectId(identity.id) })).toBe(0);
    const imageId = rows.find(row => row.sortPosition === 0)._id.toHexString();
    expect((await other.request.get('/api/item-images/' + imageId + '/thumbnail')).status()).toBe(404);
    const anonymous = await browser.newContext(options);
    try { expect((await anonymous.request.get('/api/item-images/' + imageId + '/thumbnail')).status()).toBe(404);
      expect((await anonymous.request.get('/api/items/' + itemId)).status()).toBe(404); } finally { await anonymous.close(); }
    expect((await other.request.get('/api/items/' + itemId + '/images')).status()).toBe(404);
    // My Listings shows the private cover; editing manages saved photos.
    await page.getByRole('link', { name: 'My Listings', exact: true }).last().click();
    await expect(page.getByAltText('Synthetic photo lamp ' + width)).toBeVisible(); await audit(page, 'my-listings');
    await page.getByRole('link', { name: 'Edit Synthetic photo lamp ' + width, exact: true }).click();
    const manager = page.locator('#owner-photo-manager'); await expect(manager.getByAltText('Saved photo 2')).toBeVisible();
    await manager.getByRole('button', { name: 'Delete photo 2', exact: true }).click();
    await page.getByRole('button', { name: 'Delete photo', exact: true }).click();
    await expect(manager.getByText(/Photo deleted\./)).toBeVisible(); await expect(manager.getByAltText('Saved photo 2')).toHaveCount(0);
    await audit(page, 'edit-after-delete');
    const after = await deployment.db.collection('itemImages').find({ itemId: new ObjectId(itemId) }).toArray();
    expect(after.filter(row => row.state === 'ready')).toHaveLength(1); expect(after.filter(row => row.state === 'delete_pending')).toHaveLength(1);
    const visible = await page.locator('main').innerText();
    for (const secret of [identity.id, 'coordinationRevision', 'storageBinding', 'clientUploadId', rows[0].storageBinding.namespace]) expect(visible).not.toContain(secret);
  } finally { await owner.close(); await other.close(); }
});
