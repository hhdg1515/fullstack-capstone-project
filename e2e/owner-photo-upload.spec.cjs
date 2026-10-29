const { randomUUID, randomBytes, createHash } = require('node:crypto');
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
async function setup(context, deployment, withItem = true) {
  const headers = { Origin: deployment.origin, 'X-CSRF-Protection': '1' };
  const post = async (url, data) => { const response = await context.request.post(url, { headers, data }); expect(response.ok()).toBe(true); return response.json(); };
  const deadline = new Date(Date.now() + 20 * 86400000).toISOString().slice(0, 10);
  const { plan } = await post('/api/move-out-plans', { moveOutDeadline: deadline, city: 'Los Angeles', neighborhood: 'Local test area',
    stateId: '06', metroId: '31080', pickupTimeZone: 'America/Los_Angeles' });
  if (!withItem) return { plan, post };
  const { item } = await post('/api/move-out-plans/' + plan.id + '/items', { name: 'Synthetic photo chair' });
  return { plan, item, post, prefix: '/api/move-out-plans/' + plan.id + '/items/' + item.id + '/images' };
}
async function evidence(page, testInfo, state) {
  if (!process.env.PHOTO_UI_EVIDENCE_DIR) return;
  const directory = path.resolve(process.env.PHOTO_UI_EVIDENCE_DIR); fs.mkdirSync(directory, { recursive: true });
  // Capture the actual item's form/card context, without injected styles.
  const panel = page.locator('#owner-photo-manager'), card = panel.locator('xpath=ancestor::li[contains(@class,"inventory-card")][1]');
  const target = state === 'leave-dialog' ? page.getByRole('dialog') : await card.count() ? card : panel.locator('xpath=ancestor::form[1]');
  const viewport = page.viewportSize(), bounds = await target.boundingBox();
  // A tall viewport captures the real form without Chromium painting offscreen
  // fixed skip links into an element capture. No app styles are changed.
  try {
    if (bounds.height > viewport.height - 100) await page.setViewportSize({ width: viewport.width, height: Math.ceil(bounds.height) + 1000 });
    await target.screenshot({ path: path.join(directory, testInfo.project.name + '-' + state + '.png') });
  } finally { await page.setViewportSize(viewport); }
}
async function upstream(gate, phase, page) {
  let observed = false; gate.arrived.then(() => { observed = true; });
  await test.step('Photo upstream ' + phase, async () => {
    await expect.poll(() => observed, { timeout: 30000 }).toBe(true);
  });
}

async function audit(page, state) {
  const fits = await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1);

  expect(fits).toBe(true);
  const violations = (await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations.map(value => value.id);
  await test.step('Photo UI ' + state + ' WCAG: ' + (violations.join(', ') || 'none'), async () => expect(violations).toEqual([]));
}

test('one explicit item submit sequences the real photo batch and preserves correctly associated ready cards', async ({ browser, deployment }, testInfo) => {
  const giver = await account(browser, deployment, testInfo, 'Photo owner'), other = await account(browser, deployment, testInfo, 'Other user');
  let gate;
  try {
    const { plan, post } = await setup(giver, deployment, false), page = await giver.newPage(), root = '/api/move-out-plans/' + plan.id + '/items';
    const bytes = await sharp({ create: { width: 800, height: 600, channels: 3, background: '#387ab2' } }).png().toBuffer();
    const file = { name: 'private-address-do-not-display.png', mimeType: 'image/png', buffer: bytes };
    let creations = 0, reservations = 0, contents = 0;
    page.on('request', request => {
      const pathname = new URL(request.url()).pathname;
      if (request.method() === 'POST' && pathname === root) creations++;
      if (request.method() === 'POST' && pathname.startsWith(root + '/') && pathname.endsWith('/images/uploads')) reservations++;
      if (request.method() === 'PUT' && pathname.startsWith(root + '/') && pathname.endsWith('/content')) contents++;
    });
    await page.goto('/app/plans/' + plan.id + '/items');
    await page.getByLabel('Item name', { exact: true }).fill('Synthetic photo chair');
    const picker = page.getByLabel('Choose photos', { exact: true }); await expect(picker).toBeEnabled();
    await evidence(page, testInfo, 'empty'); await audit(page, 'empty');
    const chooser = page.waitForEvent('filechooser'); await page.getByRole('button', { name: 'Add photos', exact: true }).click(); await (await chooser).setFiles([file, file]);
    await expect(page.getByAltText('Local preview of selected photo 2')).toBeVisible();
    expect(creations).toBe(0); expect(reservations).toBe(0); expect(contents).toBe(0);
    expect(await deployment.db.collection('items').countDocuments()).toBe(0);
    await evidence(page, testInfo, 'selected'); await audit(page, 'selected');
    if (testInfo.project.name === 'mobile') {
      const first = await page.getByAltText('Local preview of selected photo 1').boundingBox(), second = await page.getByAltText('Local preview of selected photo 2').boundingBox();
      expect(first.y).toBe(second.y); expect(second.x).toBeGreaterThan(first.x + first.width);
      await page.setViewportSize({ width: 375, height: 1000 }); await audit(page, 'selected-375'); await page.setViewportSize({ width: 320, height: 1000 });
    }
    gate = deployment.deferNextPhotoResponse();
    const savePhotos = page.getByRole('button', { name: 'Save draft with 2 photos', exact: true });
    await savePhotos.focus(); await expect(savePhotos).toBeFocused(); await page.keyboard.press('Enter');
    await upstream(gate, 'save then content', page);
    await expect(page.getByLabel('Item name', { exact: true })).toBeHidden();
    const saved = await deployment.db.collection('items').findOne({ name: 'Synthetic photo chair' });
    const prefix = root + '/' + saved._id + '/images';
    const card = page.getByRole('heading', { name: saved.name, exact: true }).locator('xpath=ancestor::li[1]');
    await expect(card.getByAltText('Local preview of selected photo 1')).toBeVisible();
    await expect(page.getByRole('button', { name: /^Upload/ })).toHaveCount(0);
    expect(creations).toBe(1); expect(reservations).toBe(1); expect(contents).toBe(1);
    await expect(page.getByRole('progressbar', { name: 'Processing photo 1', exact: true })).toBeVisible();
    await expect(card.getByAltText('Uploaded photo 1', { exact: true })).toHaveCount(0);
    await evidence(page, testInfo, 'processing'); await audit(page, 'processing'); gate.release(); gate = undefined;
    await expect(card.getByAltText('Uploaded photo 2', { exact: true })).toBeVisible();
    const image = card.getByAltText('Uploaded photo 1', { exact: true }); await expect.poll(() => image.evaluate(element => element.naturalWidth)).toBe(400);
    await expect(page.getByLabel('Item name', { exact: true })).toHaveCount(0);
    expect(creations).toBe(1); expect(reservations).toBe(2); expect(contents).toBe(2);
    const ready = await deployment.db.collection('itemImages').find({ state: 'ready' }).toArray();
    expect(ready.every(row => row.itemId.equals(saved._id))).toBe(true);
    expect((await other.request.get(prefix)).status()).toBe(404);
    expect((await other.request.get('/api/item-images/' + ready[0]._id + '/thumbnail')).status()).toBe(404);
    const { item: second } = await post(root, { name: 'Second synthetic item' });
    await page.getByRole('button', { name: 'Refresh inventory', exact: true }).click();
    const secondCard = page.getByRole('heading', { name: second.name, exact: true }).locator('xpath=ancestor::li[1]');
    await expect(secondCard).toBeVisible(); await expect(secondCard.getByRole('img')).toHaveCount(0); await expect(card.getByRole('img', { name: /Uploaded photo/ })).toHaveCount(2);
    if (process.env.PHOTO_UI_EVIDENCE_DIR) await card.screenshot({ path: path.join(path.resolve(process.env.PHOTO_UI_EVIDENCE_DIR), testInfo.project.name + '-ready.png') });
    await audit(page, 'ready');
    await page.getByRole('button', { name: 'Edit ' + saved.name, exact: true }).click();
    await page.getByLabel('Description', { exact: true }).fill('Saved item text stays independent.');
    await expect(page.getByLabel('Choose photos')).toBeEnabled();
    for (const width of (testInfo.project.name === 'desktop' ? [320, 375, 390, 768, 1440] : [320])) { await page.setViewportSize({ width, height: 1000 }); await audit(page, 'reflow-' + width); }
    await picker.setInputFiles(file); gate = deployment.deferNextPhotoResponse();
    await page.getByRole('button', { name: 'Save draft with 1 photo', exact: true }).click(); await upstream(gate, 'content result', page); gate.discard(); gate = undefined;
    await expect(page.getByText('Upload not confirmed. Check status.', { exact: true })).toBeVisible();
    await evidence(page, testInfo, 'uncertain'); await audit(page, 'uncertain');
    await page.getByRole('button', { name: 'Check upload 1 status', exact: true }).click();
    await expect(card.getByAltText('Uploaded photo 3', { exact: true })).toBeVisible(); expect(reservations).toBe(3); expect(contents).toBe(3);
    await expect(page.locator('#owner-photo-manager')).toHaveCount(0);
    await page.getByRole('button', { name: 'Edit ' + saved.name, exact: true }).click();
    await expect(picker).toBeEnabled(); await picker.setInputFiles(file); gate = deployment.deferNextPhotoResponse('reservation');
    await page.getByRole('button', { name: 'Save draft with 1 photo', exact: true }).click(); await upstream(gate, 'reservation result', page); gate.discard(); gate = undefined;
    await expect(page.getByText('Upload not confirmed. Check status.', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Check upload 1 status', exact: true }).click();
    await page.getByRole('button', { name: 'Upload remaining 1 photo', exact: true }).click();
    await expect(card.getByAltText('Uploaded photo 4', { exact: true })).toBeVisible(); expect(reservations).toBe(4); expect(contents).toBe(4);
    await expect(page.locator('#owner-photo-manager')).toHaveCount(0);
    await page.getByRole('button', { name: 'Edit ' + saved.name, exact: true }).click();
    const description = page.getByLabel('Description', { exact: true }); await description.fill('Unsaved item text stays independent.');
    await expect(picker).toBeEnabled(); await picker.setInputFiles({ name: 'invalid.png', mimeType: 'image/png', buffer: Buffer.from('not an image') });
    await expect(page.getByRole('alert')).toContainText(/Couldn't (read|prepare)/); await expect(page.getByRole('alert')).toHaveCount(1);
    await evidence(page, testInfo, 'failed'); await audit(page, 'invalid-image');
    await page.getByRole('button', { name: 'Remove selection 1', exact: true }).click();
    await expect(description).toHaveValue('Unsaved item text stays independent.');
    expect(await page.evaluate(() => !/blob:|data:image|private-address/.test(JSON.stringify(localStorage)))).toBe(true);
    let dialogs = 0; page.on('dialog', async dialog => { dialogs++; await dialog.dismiss(); });
    await page.getByRole('button', { name: 'Cancel edit', exact: true }).click(); await expect(description).toHaveValue('Unsaved item text stays independent.');
    await page.getByRole('link', { name: 'Back to plan', exact: true }).click(); await expect(description).toHaveValue('Unsaved item text stays independent.'); expect(dialogs).toBe(2);
    const owner = await deployment.db.collection('users').findOne({ 'itemImageQuota.operationCount': 4 });
    expect(owner.itemImageQuota.attempts).toBe(4); expect(owner.itemImageQuota.successful).toBe(4); expect(owner.itemImageQuota.activeUploads).toBe(0); expect(owner.itemImageQuota.reservedBytes).toBe(0);
    expect((await deployment.db.collection('items').findOne({ _id: saved._id })).description).toBe('Saved item text stays independent.');
    expect((await deployment.db.collection('items').findOne({ _id: saved._id })).version).toBe(3);
    expect(deployment.serverErrors).toEqual([]);
  } finally { gate?.discard(); await giver.close(); await other.close(); }
});

test('a lost item save preserves staged photos, prevents another create and binds only after explicit owner review', async ({ browser }, testInfo) => {
  const local = await localEnvironment({ photos: true }); let context, gate;
  try {
    context = await account(browser, local, testInfo, 'Save recovery owner'); const { plan } = await setup(context, local, false);
    const page = await context.newPage(); page.on('dialog', async dialog => dialog.accept());
    const root = '/api/move-out-plans/' + plan.id + '/items'; let creations = 0, reservations = 0, contents = 0;
    page.on('request', request => { const pathname = new URL(request.url()).pathname;
      if (request.method() === 'POST' && pathname === root) creations++;
      if (request.method() === 'POST' && pathname.endsWith('/images/uploads')) reservations++;
      if (request.method() === 'PUT' && pathname.endsWith('/content')) contents++;
    });
    await page.goto('/app/plans/' + plan.id + '/items'); await page.getByLabel('Item name', { exact: true }).fill('Lost response synthetic item');
    const bytes = await sharp(randomBytes(1300 * 1000 * 3), { raw: { width: 1300, height: 1000, channels: 3 } }).png().toBuffer();
    expect(bytes.length).toBeGreaterThan(3 * 1024 * 1024);
    await page.getByLabel('Choose photos').setInputFiles({ name: 'synthetic.png', mimeType: 'image/png', buffer: bytes });
    await expect(page.getByText(/Reloading will lose them/)).toBeVisible();
    gate = local.deferNextPhotoResponse('item-save'); await page.getByRole('button', { name: 'Save draft with 1 photo', exact: true }).click(); await upstream(gate, 'response', page); gate.discard(); gate = undefined;
    await expect(page.getByRole('alert')).toContainText('Save not confirmed'); await expect(page.getByRole('button', { name: 'Save draft with 1 photo', exact: true })).toBeDisabled();
    expect(creations).toBe(1); expect(reservations).toBe(0); expect(contents).toBe(0); expect(await local.db.collection('items').countDocuments()).toBe(1);
    await page.getByRole('button', { name: 'Refresh inventory', exact: true }).click();
    await page.getByRole('button', { name: 'Edit Lost response synthetic item', exact: true }).click();
    await expect(page.getByAltText('Local preview of selected photo 1')).toBeVisible();
    const upload = page.getByRole('button', { name: 'Save draft with 1 photo', exact: true }); await expect(upload).toBeEnabled();
    expect(creations).toBe(1); expect(reservations).toBe(0); expect(contents).toBe(0);
    await evidence(page, testInfo, 'save-recovery'); await audit(page, 'save-recovery');
    await upload.click();
    const card = page.getByRole('heading', { name: 'Lost response synthetic item', exact: true }).locator('xpath=ancestor::li[1]');
    await expect(card.getByAltText('Uploaded photo 1')).toBeVisible(); expect(creations).toBe(1); expect(reservations).toBe(1); expect(contents).toBe(1);
    expect(await local.db.collection('items').countDocuments()).toBe(1);
    const operation = await local.db.collection('itemImages').findOne({ state: 'ready' });
    expect(operation.intent.byteLength).toBeLessThanOrEqual(3 * 1024 * 1024);
    expect(operation.intent.sha256).not.toBe(createHash('sha256').update(bytes).digest('hex')); expect(local.serverErrors).toEqual([]);
  } finally { gate?.discard(); if (context) await context.close(); await local.close(); }
});

test('session expiry after the first batch upload clears private drafts and never sends later files', async ({ browser }, testInfo) => {
  const local = await localEnvironment({ photos: true }); let context, gate;
  try {
    context = await account(browser, local, testInfo, 'Expired batch owner'); const { plan } = await setup(context, local, false);
    const page = await context.newPage(); let contents = 0, reservations = 0;
    page.on('request', request => { const pathname = new URL(request.url()).pathname;
      if (request.method() === 'POST' && pathname.endsWith('/images/uploads')) reservations++;
      if (request.method() === 'PUT' && pathname.endsWith('/content')) contents++;
    });
    await page.goto('/app/plans/' + plan.id + '/items'); await page.getByLabel('Item name', { exact: true }).fill('Session expiry synthetic item');
    const bytes = await sharp({ create: { width: 400, height: 300, channels: 3, background: '#387ab2' } }).png().toBuffer();
    const file = { name: 'synthetic.png', mimeType: 'image/png', buffer: bytes };
    await page.getByLabel('Choose photos').setInputFiles([file, file, file]); await expect(page.getByAltText('Local preview of selected photo 3')).toBeVisible();
    gate = local.deferNextPhotoResponse();
    await page.getByRole('button', { name: 'Save draft with 3 photos', exact: true }).click(); await upstream(gate, 'one-click batch', page);
    // This native connection belongs to the receipt-verified disposable fixture.
    expect(local.local).toBe(true); await local.db.collection('sessions').updateMany({}, { $set: { expiresAt: new Date(0) } });
    gate.release(); gate = undefined;
    await expect(page.getByRole('heading', { name: 'Login', exact: true })).toBeVisible();
    await expect(page.getByAltText(/Local preview|Uploaded photo/)).toHaveCount(0);
    expect(contents).toBe(1); expect(reservations).toBe(1); expect(await local.db.collection('itemImages').countDocuments({ state: 'ready' })).toBe(1);
    expect(local.serverErrors).toEqual([]);
  } finally { gate?.discard(); if (context) await context.close(); await local.close(); }
});

test('public partial success and accessible navigation preserve the single submit and safe recovery across remounts', async ({ browser }, testInfo) => {
  const local = await localEnvironment({ photos: true }); let context, firstGate, secondGate;
  try {
    context = await account(browser, local, testInfo, 'Public batch owner'); const { plan } = await setup(context, local, false);
    const page = await context.newPage(); let creations = 0, contents = 0, nativeDialogs = 0;
    const root = '/api/move-out-plans/' + plan.id + '/items';
    page.on('dialog', async dialog => { nativeDialogs++; await dialog.dismiss(); });
    page.on('request', request => {
      const pathname = new URL(request.url()).pathname;
      if (request.method() === 'POST' && pathname === root) creations++;
      if (request.method() === 'PUT' && pathname.endsWith('/content')) contents++;
    });
    await page.goto('/app/plans/' + plan.id + '/items'); await page.getByLabel('Item name', { exact: true }).fill('Published synthetic chair');
    for (const [label, value] of [['Category', 'office-lighting'], ['Item type', 'office-chair'], ['Description', 'Synthetic household chair for local testing.']]) {
      const field = page.getByLabel(label, { exact: true }); if (label === 'Description') await field.fill(value); else await field.selectOption(value);
    }
    const bytes = await sharp({ create: { width: 500, height: 400, channels: 3, background: '#387ab2' } }).png().toBuffer();
    const file = { name: 'synthetic.png', mimeType: 'image/png', buffer: bytes };
    const picker = page.getByLabel('Choose photos'); await picker.setInputFiles([file, file, file]);
    await expect(page.getByAltText('Local preview of selected photo 3')).toBeVisible();
    expect(creations).toBe(0); expect(contents).toBe(0);
    firstGate = local.deferNextPhotoResponse();
    await page.getByRole('button', { name: 'Publish with 3 photos', exact: true }).click(); await upstream(firstGate, 'published first photo', page);
    await expect(page.getByText('Item published.', { exact: true })).toBeVisible();
    await page.getByRole('link', { name: 'Back to plan', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Leave photos behind?', exact: true }); await expect(dialog).toBeVisible();
    const stay = dialog.getByRole('button', { name: 'Stay and keep photos', exact: true }), leave = dialog.getByRole('button', { name: 'Leave and discard photos', exact: true });
    await expect(stay).toBeFocused(); await page.keyboard.press('Shift+Tab'); await expect(leave).toBeFocused();
    await page.keyboard.press('Tab'); await expect(stay).toBeFocused();
    await evidence(page, testInfo, 'leave-dialog'); await audit(page, 'leave-dialog');
    await page.keyboard.press('Escape'); await expect(dialog).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Back to plan', exact: true })).toBeFocused();
    expect(nativeDialogs).toBe(0); expect(contents).toBe(1); expect(creations).toBe(1);
    secondGate = local.deferNextPhotoResponse(); firstGate.release(); firstGate = undefined;
    await upstream(secondGate, 'published second photo', page); secondGate.discard(); secondGate = undefined;
    await expect(page.getByText('Upload not confirmed. Check status.', { exact: true })).toBeVisible();
    const card = page.getByRole('heading', { name: 'Published synthetic chair', exact: true }).locator('xpath=ancestor::li[1]');
    await expect(card.getByAltText('Uploaded photo 1')).toBeVisible(); await expect(card.getByAltText(/Local preview/)).toHaveCount(2);
    await expect(page.getByText('Item published.', { exact: true })).toBeVisible();
    await evidence(page, testInfo, 'published-partial'); await audit(page, 'published-partial');
    const saved = await local.db.collection('items').findOne({ name: 'Published synthetic chair' }); expect(saved.status).toBe('available'); expect(saved.version).toBe(1);
    await page.getByRole('button', { name: 'Refresh inventory', exact: true }).click();
    const check = page.getByRole('button', { name: 'Check upload 1 status', exact: true }); await expect(check).toBeEnabled();
    expect(contents).toBe(2); expect(creations).toBe(1);
    await check.click(); await expect(page.getByRole('button', { name: 'Upload remaining 1 photo', exact: true })).toBeEnabled();
    expect(contents).toBe(2); await page.getByRole('button', { name: 'Upload remaining 1 photo', exact: true }).click();
    await expect(card.getByAltText('Uploaded photo 3')).toBeVisible(); await expect(page.locator('#owner-photo-manager')).toHaveCount(0);
    expect(creations).toBe(1); expect(contents).toBe(3); expect(nativeDialogs).toBe(0);
    expect(await local.db.collection('items').countDocuments()).toBe(1); expect(await local.db.collection('itemImages').countDocuments({ state: 'ready' })).toBe(3);
    await page.getByRole('button', { name: 'Edit Published synthetic chair', exact: true }).click(); await expect(picker).toBeEnabled(); await picker.setInputFiles(file);
    await expect(page.getByRole('button', { name: 'Save changes with 1 photo', exact: true })).toBeEnabled();
    await page.getByRole('link', { name: 'Back to plan', exact: true }).click(); await expect(dialog).toBeVisible();
    await leave.click(); await expect(page).toHaveURL(new RegExp('/app/plans/' + plan.id + '$'));
    await page.getByRole('link', { name: 'Manage items', exact: true }).click(); await expect(card.getByAltText('Uploaded photo 3')).toBeVisible();
    await expect(page.getByAltText(/Local preview/)).toHaveCount(0); expect(contents).toBe(3); expect(nativeDialogs).toBe(0);
    const unloadBlocked = await page.evaluate(() => { const event = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(event); return event.defaultPrevented; });
    expect(unloadBlocked).toBe(false); expect(local.serverErrors).toEqual([]);
  } finally { firstGate?.discard(); secondGate?.discard(); if (context) await context.close(); await local.close(); }
});

test('default deployed gates show disabled photo controls while text-only inventory remains usable', async ({ browser }, testInfo) => {
  const local = await localEnvironment(); let context;
  try {
    context = await account(browser, local, testInfo, 'Disabled photo owner'); const { plan, item } = await setup(context, local);
    const page = await context.newPage(); await page.goto('/app/plans/' + plan.id + '/items');
    await page.getByRole('button', { name: 'Edit ' + item.name, exact: true }).click();
    await expect(page.getByText(/Photo uploads are unavailable/)).toBeVisible(); await expect(page.getByRole('button', { name: 'Add photos', exact: true })).toBeDisabled();
    await expect(page.getByText(/No ready photos/)).toHaveCount(0); expect(await local.db.collection('itemImages').countDocuments()).toBe(0);
    await evidence(page, testInfo, 'disabled'); await audit(page, 'disabled');
    await expect(page.getByRole('button', { name: 'Photos for ' + item.name })).toHaveCount(0);
    await expect(page.getByLabel('Item name', { exact: true })).toHaveValue(item.name);
    expect(local.serverErrors).toEqual([]);
  } finally { if (context) await context.close(); await local.close(); }
});
