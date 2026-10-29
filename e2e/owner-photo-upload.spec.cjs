const { randomUUID } = require('node:crypto');
const fs = require('node:fs'); const path = require('node:path');
const AxeBuilder = require('@axe-core/playwright').default;
const { root } = require('./policy.cjs');
const sharp = require(root + '/giftlink-backend/node_modules/sharp');
const { test: base, expect } = require('./fixtures.cjs');
const { localEnvironment } = require('./local.cjs');
const test = base.extend({ deployment: [async ({}, use) => {
  if (process.env.E2E_APP_ORIGIN) throw Error('Owner photo fixtures are isolated local only');
  const local = await localEnvironment({ photos: true }); try { await use(local); } finally { await local.close(); }
}, { scope: 'worker', timeout: 180000 }] });
test.skip(Boolean(process.env.E2E_APP_ORIGIN), 'C1 never activates hosted photos');

async function account(browser, deployment, testInfo, label) {
  const options = { ...testInfo.project.use, baseURL: deployment.origin, ignoreHTTPSErrors: true,
    viewport: { width: testInfo.project.name === 'mobile' ? 320 : 1440, height: 1000 }, deviceScaleFactor: 1,
    extraHTTPHeaders: { 'X-Deployment-Target': deployment.fingerprint } };
  for (const field of ['launchOptions', 'trace', 'screenshot', 'video', 'recordVideo', 'recordHar']) delete options[field];
  const context = await browser.newContext(options);
  const response = await context.request.post('/api/auth/register', { headers: { Origin: deployment.origin, 'X-CSRF-Protection': '1' },
    data: { firstName: label, lastName: 'Synthetic', email: randomUUID() + '@example.invalid', password: randomUUID() + '!' } });
  expect(response.status()).toBe(201); return context;
}
async function setup(context, deployment) {
  const headers = { Origin: deployment.origin, 'X-CSRF-Protection': '1' };
  const post = async (url, data) => { const response = await context.request.post(url, { headers, data }); expect(response.ok()).toBe(true); return response.json(); };
  const deadline = new Date(Date.now() + 20 * 86400000).toISOString().slice(0, 10);
  const { plan } = await post('/api/move-out-plans', { moveOutDeadline: deadline, city: 'Los Angeles', neighborhood: 'Local test area',
    stateId: '06', metroId: '31080', pickupTimeZone: 'America/Los_Angeles' });
  const { item } = await post('/api/move-out-plans/' + plan.id + '/items', { name: 'Synthetic photo chair' });
  return { plan, item, post, prefix: '/api/move-out-plans/' + plan.id + '/items/' + item.id + '/images' };
}
async function evidence(page, testInfo, state) {
  if (!process.env.PHOTO_UI_EVIDENCE_DIR) return;
  const directory = path.resolve(process.env.PHOTO_UI_EVIDENCE_DIR); fs.mkdirSync(directory, { recursive: true });
  // Actual panel capture: no injected styles, hidden controls or mocked UI.
  await page.locator('#owner-photo-manager').screenshot({ path: path.join(directory, testInfo.project.name + '-' + state + '.png') });
}
async function audit(page, state) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  const violations = (await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations.map(value => value.id);
  await test.step('Photo UI ' + state + ' WCAG: ' + (violations.join(', ') || 'none'), async () => expect(violations).toEqual([]));
}

test('owner explicitly uploads real private photos, preserves text drafts and recovers lost responses without duplicate writes', async ({ browser, deployment }, testInfo) => {
  const giver = await account(browser, deployment, testInfo, 'Photo owner'), other = await account(browser, deployment, testInfo, 'Other user');
  let gate;
  try {
    const { plan, item, prefix } = await setup(giver, deployment), page = await giver.newPage();
    const bytes = await sharp({ create: { width: 800, height: 600, channels: 3, background: '#387ab2' } }).png().toBuffer();
    const file = { name: 'private-address-do-not-display.png', mimeType: 'image/png', buffer: bytes };
    let reservations = 0, contents = 0;
    page.on('request', request => {
      const pathname = new URL(request.url()).pathname;
      if (request.method() === 'POST' && pathname === prefix + '/uploads') reservations++;
      if (request.method() === 'PUT' && pathname.startsWith(prefix) && pathname.endsWith('/content')) contents++;
    });
    await page.goto('/app/plans/' + plan.id + '/items');
    await page.getByRole('button', { name: 'Edit ' + item.name, exact: true }).click();
    const description = page.getByLabel('Description', { exact: true }); await description.fill('Unsaved item text stays independent.');
    await page.getByRole('button', { name: 'Photos for ' + item.name, exact: true }).click();
    const picker = page.getByLabel('Choose photos', { exact: true }); await expect(picker).toBeEnabled();
    const panel = page.locator('#owner-photo-manager');
    await expect(panel.getByText('0 / 5')).toBeVisible();
    await expect(panel.getByRole('button', { name: 'Add photos', exact: true })).toBeEnabled();
    await expect(panel.getByText(/Remove visible addresses/)).toBeHidden();
    await expect(panel.getByRole('progressbar')).toHaveCount(0);
    await evidence(page, testInfo, 'empty'); await audit(page, 'empty');
    const chooser = page.waitForEvent('filechooser'); await panel.getByRole('button', { name: 'Add photos', exact: true }).click();
    await (await chooser).setFiles([file, file]);
    await expect(page.getByAltText('Local preview of selected photo 2')).toBeVisible();
    await expect(panel.getByText('2 / 5')).toBeVisible();
    expect(reservations).toBe(0); expect(contents).toBe(0); await evidence(page, testInfo, 'selected'); await audit(page, 'selected');
    if (testInfo.project.name === 'mobile') {
      const first = await page.getByAltText('Local preview of selected photo 1').boundingBox(), second = await page.getByAltText('Local preview of selected photo 2').boundingBox();
      expect(first.y).toBe(second.y); expect(second.x).toBeGreaterThan(first.x + first.width);
      await page.setViewportSize({ width: 375, height: 1000 }); await audit(page, 'selected-375');
      await page.setViewportSize({ width: 320, height: 1000 });
    }
    await page.getByRole('button', { name: 'Remove selection 2', exact: true }).click();
    await expect(panel.getByText('1 / 5')).toBeVisible();
    gate = deployment.deferNextPhotoResponse();
    await page.getByRole('button', { name: 'Upload photo 1', exact: true }).click(); await gate.arrived;
    await expect(page.getByRole('progressbar', { name: 'Processing photo 1', exact: true })).toBeVisible();
    await expect(page.getByText('Bytes transferred; not ready yet.')).toHaveCount(1);
    await expect(page.getByText('Photo ready.', { exact: true })).toHaveCount(0);
    expect(await deployment.db.collection('itemImages').countDocuments({ state: 'ready' })).toBe(1);
    await evidence(page, testInfo, 'processing'); await audit(page, 'processing'); gate.release(); gate = undefined;
    const image = page.getByAltText('Uploaded photo 1', { exact: true }); await expect(image).toBeVisible();
    await expect.poll(() => image.evaluate(element => element.naturalWidth)).toBe(400);
    await expect(description).toHaveValue('Unsaved item text stays independent.');
    const saved = await deployment.db.collection('items').findOne({ name: item.name }); expect(saved.description).toBe(''); expect(saved.version).toBe(1);
    expect(reservations).toBe(1); expect(contents).toBe(1);
    const metadata = await (await giver.request.get(prefix)).json();
    expect((await other.request.get(prefix)).status()).toBe(404);
    expect((await other.request.get('/api/item-images/' + metadata.images[0].id + '/thumbnail')).status()).toBe(404);
    await evidence(page, testInfo, 'ready'); await audit(page, 'ready');
    await expect(page.locator('#owner-photo-manager').getByRole('button', { name: /delete|cover|reorder/i })).toHaveCount(0);
    for (const width of (testInfo.project.name === 'desktop' ? [320, 375, 390, 768, 1440] : [320])) {
      await page.setViewportSize({ width, height: 1000 }); await audit(page, 'reflow-' + width);
    }
    // The proxy delays/discards actual local API responses after real DB/S3 work.
    // A lost success is replaced with a sanitized gateway 503: abrupt socket
    // closure can make Chromium transparently replay an idempotent HTTP PUT.
    // It never fabricates upload success, metadata, capability or stored objects.
    await picker.setInputFiles(file); gate = deployment.deferNextPhotoResponse();
    await page.getByRole('button', { name: 'Upload photo 1', exact: true }).click(); await gate.arrived; gate.discard(); gate = undefined;
    await expect(page.getByText(/Upload not confirmed/)).toBeVisible();
    await expect(page.getByAltText('Local preview of selected photo 1')).toBeVisible();
    expect(reservations).toBe(2); expect(contents).toBe(2);
    await evidence(page, testInfo, 'uncertain'); await audit(page, 'uncertain');
    await page.getByRole('button', { name: 'Check upload 1 status', exact: true }).click();
    await expect(page.getByAltText('Uploaded photo 2')).toBeVisible(); expect(reservations).toBe(2); expect(contents).toBe(2);
    await picker.setInputFiles(file); gate = deployment.deferNextPhotoResponse('reservation');
    await page.getByRole('button', { name: 'Upload photo 1', exact: true }).click(); await gate.arrived; gate.discard(); gate = undefined;
    await expect(page.getByText(/Upload not confirmed/)).toBeVisible(); expect(reservations).toBe(3); expect(contents).toBe(2);
    await page.getByRole('button', { name: 'Check upload 1 status', exact: true }).click();
    const upload = page.getByRole('button', { name: 'Upload photo 1', exact: true }); await expect(upload).toBeEnabled(); await upload.click();
    await expect(page.getByAltText('Uploaded photo 3')).toBeVisible(); expect(reservations).toBe(3); expect(contents).toBe(3);
    await picker.setInputFiles({ name: 'invalid.png', mimeType: 'image/png', buffer: Buffer.from('not an image') });
    await upload.click(); await expect(page.getByRole('alert')).toContainText(/Couldn't upload this photo/);
    await expect(page.getByRole('alert')).toHaveCount(1); await evidence(page, testInfo, 'failed');
    await page.getByRole('button', { name: 'Check upload 1 status', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText("Couldn't upload. Choose another photo."); await audit(page, 'invalid-image');
    await page.getByRole('button', { name: 'Remove selection 1', exact: true }).click(); await expect(description).toHaveValue('Unsaved item text stays independent.');
    expect(await page.evaluate(() => !/blob:|data:image|private-address/.test(JSON.stringify(localStorage)))).toBe(true);
    let dialogs = 0; page.on('dialog', async dialog => { dialogs++; await dialog.dismiss(); });
    await page.getByRole('button', { name: 'Close photos', exact: true }).click(); expect(dialogs).toBe(0); // No file draft; text draft stays.
    await page.getByRole('link', { name: 'Back to plan', exact: true }).click(); await expect(description).toHaveValue('Unsaved item text stays independent.');
    expect(dialogs).toBe(1);
    // The unchanged B4 browser/native tests verify physical reconciliation.
    // This fixture's receipt-owned teardown removes its synthetic local objects.
    const accountRow = await deployment.db.collection('users').findOne({ 'itemImageQuota.operationCount': 4 });
    expect(accountRow.itemImageQuota.successful).toBe(3); expect(accountRow.itemImageQuota.attempts).toBe(4);
    expect(accountRow.itemImageQuota.retainedBytes).toBeGreaterThan(0); expect(accountRow.itemImageQuota.activeUploads).toBe(0);
    expect(accountRow.itemImageQuota.reservedBytes).toBe(0); expect(await deployment.db.collection('itemImages').countDocuments({ state: 'ready' })).toBe(3);
    expect(deployment.serverErrors).toEqual([]);
  } finally { gate?.discard(); await giver.close(); await other.close(); }
});

test('default deployed gates show disabled photo controls while text-only inventory remains usable', async ({ browser }, testInfo) => {
  const local = await localEnvironment(); let context;
  try {
    context = await account(browser, local, testInfo, 'Disabled photo owner'); const { plan, item } = await setup(context, local);
    const page = await context.newPage(); await page.goto('/app/plans/' + plan.id + '/items');
    await page.getByRole('button', { name: 'Photos for ' + item.name, exact: true }).click();
    await expect(page.getByText(/Photo uploads are unavailable/)).toBeVisible(); await expect(page.getByRole('button', { name: 'Add photos', exact: true })).toBeDisabled();
    await expect(page.getByText(/No ready photos/)).toHaveCount(0); expect(await local.db.collection('itemImages').countDocuments()).toBe(0);
    await evidence(page, testInfo, 'disabled'); await audit(page, 'disabled');
    await page.getByRole('button', { name: 'Close photos', exact: true }).click();
    await page.getByRole('button', { name: 'Edit ' + item.name, exact: true }).click();
    await expect(page.getByLabel('Item name', { exact: true })).toHaveValue(item.name);
    expect(local.serverErrors).toEqual([]);
  } finally { if (context) await context.close(); await local.close(); }
});
