const fs = require('node:fs'), path = require('node:path');
const { randomUUID, createHash } = require('node:crypto');
const sharp = require('../giftlink-backend/node_modules/sharp');
const AxeBuilder = require('@axe-core/playwright').default;
const { test: base, expect } = require('@playwright/test');
const { localEnvironment } = require('./local.cjs');
const test = base.extend({ deployment: [async ({}, use) => {
  if (process.env.E2E_APP_ORIGIN) throw Error('UX-1 is local only');
  const local = await localEnvironment({ photos: true }); try { await use(local); } finally { await local.close(); }
}, { timeout: 180000 }] });
test.skip(Boolean(process.env.E2E_APP_ORIGIN), 'UX-1 uses disposable local data only');
const before = process.env.UX1_EVIDENCE_STAGE === 'before';
const stage = before ? 'before' : 'after';
async function capture(page, width, name, target) {
  if (!process.env.UX1_EVIDENCE_STAGE) return;
  const directory = path.join(__dirname, '../docs/assets/milestone-6.6-ux1', stage); fs.mkdirSync(directory, { recursive: true });
  const originalScroll = await page.evaluate(() => scrollY);
  // Exercise natural lazy-loading before evidence; do not mistake an unpainted image for the ready UI.
  for (const img of await (target || page).locator('img').all()) {
    await img.scrollIntoViewIfNeeded(); await expect.poll(() => img.evaluate(node => node.complete && node.naturalWidth > 0)).toBe(true);
  }
  if (await page.locator('.public-gallery-primary').count()) await expect(page.locator('.public-gallery-primary')).toHaveAttribute('aria-busy', 'false');
  if (!target) await page.evaluate(() => scrollTo(0, 0));
  await page.mouse.move(0, 0);
  await (target || page).screenshot({ path: path.join(directory, width + '-' + name + '.png'), ...(target ? {} : { fullPage: true }) });
  await page.evaluate(value => scrollTo(0, value), originalScroll);
}
async function audit(page, label) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  const violations = (await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations.map(v => v.id);
  await test.step('UX1 ' + label + ' WCAG: ' + (violations.join(', ') || 'none'), async () => expect(violations).toEqual([]));
}
test('item-centered creation, owner editing, visible filters and private request context', async ({ browser, deployment }, info) => {
  for (const width of info.project.name === 'mobile' ? [320, 375] : [1440]) {
    const context = await browser.newContext({ baseURL: deployment.origin, ignoreHTTPSErrors: true, viewport: { width, height: 950 }, deviceScaleFactor: 1,
      extraHTTPHeaders: { 'X-Deployment-Target': deployment.fingerprint } });
    const requester = await browser.newContext({ baseURL: deployment.origin, ignoreHTTPSErrors: true, viewport: { width, height: 950 }, extraHTTPHeaders: { 'X-Deployment-Target': deployment.fingerprint } });
    const headers = { Origin: deployment.origin, 'X-CSRF-Protection': '1' };
    const post = async (client, url, data) => { const r = await client.post(url, { headers, data }); expect(r.ok()).toBe(true); return r.json(); };
    const day = n => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
    try {
      for (const c of [context, requester]) await post(c.request, '/api/auth/register', { firstName: c === context ? 'Synthetic giver' : 'Synthetic requester', lastName: 'Local', email: randomUUID() + '@example.invalid', password: randomUUID() + '!local' });
      const { plan } = await post(context.request, '/api/move-out-plans', { title: 'Local household giveaway', city: 'Oakland', neighborhood: 'Temescal', pickupTimeZone: 'UTC', moveOutDeadline: day(20), stateId: '06', metroId: '41860' });
      const root = '/api/move-out-plans/' + plan.id + '/items';
      const { item } = await post(context.request, root, { name: 'Synthetic blue chair', description: 'Comfortable household chair. Local pickup.', categoryId: 'other-household', itemTypeId: 'other', publish: true });
      const prefix = root + '/' + item.id + '/images'; const photos = []; let revision = 0;
      for (const color of ['#3b6790', '#ddbd72']) {
        const buffer = await sharp({ create: { width: 600, height: 400, channels: 3, background: color } }).png().toBuffer();
        const { upload } = await post(context.request, prefix + '/uploads', { imageRevision: revision, clientUploadId: randomUUID(), byteLength: buffer.length, sha256: createHash('sha256').update(buffer).digest('hex') });
        const response = await context.request.put(prefix + '/' + upload.id + '/content', { headers, multipart: { file: { name: 'synthetic.png', mimeType: 'image/png', buffer } } });
        expect(response.status()).toBe(201); revision = (await response.json()).imageRevision; photos.push(upload.id);
      }
      for (let n = 1; n <= 5; n++) await post(context.request, root, { name: 'Synthetic household item ' + n });
      const { request: pickup } = await post(requester.request, '/api/pickup-requests', { itemId: item.id, localDateTime: day(1) + 'T12:00', timeZone: 'UTC', note: '' });
      const page = await context.newPage(); await page.goto('/app/plans/' + plan.id + '/items');
      await expect(page.getByRole('button', { name: 'Add item', exact: true })).toBeEnabled();
      const scrollBefore = await page.evaluate(() => scrollY); await page.getByRole('button', { name: 'Add item', exact: true }).click();
      await expect(page.getByLabel('Item name', { exact: true })).toBeFocused();
      await capture(page, width, 'add-item');
      if (!before) {
        expect(await page.evaluate(() => scrollY)).toBeLessThanOrEqual(scrollBefore + 2);
        const firstCard = await page.locator('.inventory-card').first().boundingBox(), form = await page.locator('.inventory-form').boundingBox(); expect(form.y).toBeLessThan(firstCard.y);
      }
      await page.getByRole('combobox', { name: 'Item type', exact: true }).fill('tv');
      await capture(page, width, 'type-search', page.locator('.inventory-form'));
      if (!before) await expect(page.getByRole('option').first()).toHaveText(/Television/);
      await page.getByRole('button', { name: 'Clear item type' }).click(); await page.getByLabel('Item name', { exact: true }).focus();
      await page.getByRole('button', { name: 'Cancel', exact: true }).click();
      // Typed type-search is cleared before cancellation, so no draft is silently discarded.
      await page.getByRole('button', { name: 'Edit ' + item.name, exact: true }).click();
      const panel = page.locator('#owner-photo-manager'); await expect(panel.getByRole('img', { name: 'Saved photo 1', exact: true })).toBeVisible();
      await capture(page, width, 'photos', panel);
      if (!before) {
        await expect(panel.getByRole('button', { name: /Move photo|Make photo/ })).toHaveCount(0);
        const remove = panel.getByRole('button', { name: 'Delete photo 1', exact: true }); await expect(remove).toHaveText('×');
        const target = await remove.boundingBox(); expect(target.width).toBeGreaterThanOrEqual(44); expect(target.height).toBeGreaterThanOrEqual(44);
        await remove.focus(); await page.keyboard.press('Enter'); await expect(page.getByRole('dialog')).toBeVisible();
        await page.getByRole('button', { name: 'Delete photo', exact: true }).click();
        await expect(panel.getByRole('listitem', { name: 'Saved photo 1, Cover', exact: true }).getByRole('img')).toHaveAttribute('src', '/api/item-images/' + photos[1] + '/thumbnail');
        await audit(page, width + ' photos');
      }
      await page.goto('/app/items/' + item.id); await expect(page.getByRole('heading', { name: item.name, exact: true })).toBeVisible(); await capture(page, width, 'owner-detail');
      if (!before) {
        await audit(page, width + ' owner detail');
        await page.getByRole('link', { name: 'Edit item', exact: true }).click(); await expect(page.getByLabel('Item name', { exact: true })).toBeFocused();
        await expect(page.locator('.inventory-form')).toHaveCount(1); await expect(page.getByRole('button', { name: 'Add item', exact: true })).toHaveCount(0);
        await expect(page.locator('#owner-photo-manager').getByRole('img', { name: 'Saved photo 1', exact: true })).toBeVisible();
        await capture(page, width, 'focused-edit');
        await page.getByLabel('Item name', { exact: true }).fill(''); await page.getByRole('button', { name: 'Save Changes', exact: true }).click();
        await expect(page.getByLabel('Item name', { exact: true })).toBeFocused(); await expect(page.locator('#name-error')).toBeVisible();
        await page.getByLabel('Item name', { exact: true }).fill(item.name); await audit(page, width + ' editor');
      }
      await page.goto('/app/items?stateId=06&metroId=41860'); await expect(page.getByLabel('Search items', { exact: true })).toBeVisible(); await capture(page, width, 'discovery');
      if (!before) {
        await expect(page.getByRole('button', { name: /^Filters/ })).toHaveCount(0);
        for (const label of ['Category', 'Item type', 'Pickup availability', 'Sort items', 'Condition', 'City', 'Neighborhood']) await expect(page.getByLabel(label, { exact: true })).toBeVisible();
        await audit(page, width + ' discovery');
      }
      await page.goto('/app/pickups/incoming'); await expect(page.getByRole('link', { name: /View request from/ })).toBeVisible();
      if (before) await page.getByText('Note and request reference', { exact: true }).click();
      await capture(page, width, 'requests');
      if (!before) { await expect(page.getByText(pickup.id, { exact: true })).toHaveCount(0); await expect(page.getByText('No note provided.')).toHaveCount(0); await audit(page, width + ' requests'); }
      await page.goto('/app/pickups/' + pickup.id); await expect(page.getByRole('heading', { name: 'Pickup request', exact: true })).toBeVisible();
      if (!before) { await expect(page.getByText(pickup.id, { exact: true })).toHaveCount(0); await audit(page, width + ' request detail'); }
      const visitor = await requester.newPage(); await visitor.goto('/app/items/' + item.id);
      if (!before) { await expect(visitor.getByRole('link', { name: 'Edit item', exact: true })).toHaveCount(0); await visitor.goto('/app/items/' + item.id + '/edit'); await expect(visitor.getByText('This item is unavailable.', { exact: true })).toBeVisible(); await expect(visitor.locator('.inventory-form')).toHaveCount(0); }
    } finally { await context.close(); await requester.close(); }
  }
});
