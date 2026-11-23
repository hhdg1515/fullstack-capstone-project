const { randomUUID, createHash } = require('node:crypto');
const fs = require('node:fs'), path = require('node:path');
const sharp = require('../giftlink-backend/node_modules/sharp');
const AxeBuilder = require('@axe-core/playwright').default;
const { test: base, expect } = require('./local-browser.cjs');
const { localEnvironment } = require('./local.cjs');
const test = base.extend({ deployment: [async ({}, use) => {
  if (process.env.E2E_APP_ORIGIN) throw Error('Chat handoff acceptance is disposable local only');
  const local = await localEnvironment({ photos: true, ownerListings: true, ownerListingPhotos: true, ownerListingPickups: true, ownerListingPublication: true });
  try { await use(local); } finally { await local.close(); }
}, { timeout: 180000 }] });
const day = n => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
async function audit(page, name, info) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  const errors = (await new AxeBuilder({ page }).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze()).violations.map(v => v.id);
  await test.step('Chat handoff ' + name + ' WCAG: ' + (errors.join(', ') || 'none'), async () => expect(errors).toEqual([]));
  if (process.env.CHAT_HANDOFF_EVIDENCE) {
    fs.mkdirSync(process.env.CHAT_HANDOFF_EVIDENCE, { recursive: true });
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: path.join(process.env.CHAT_HANDOFF_EVIDENCE, info.project.name + '-' + name + '.png'), fullPage: true });
  }
}
test('giver chats with multiple applicants then confirms the actual recipient once, without acceptance', async ({ isolatedBrowser: browser, deployment }, info) => {
  const contexts = [];
  const account = async firstName => {
    const context = await browser.newContext({ baseURL: deployment.origin, ignoreHTTPSErrors: true, viewport: { width: info.project.name === 'mobile' ? 320 : 1440, height: 1000 } });
    contexts.push(context);
    const r = await context.request.post('/api/auth/register', { headers: { Origin: deployment.origin, 'X-CSRF-Protection': '1' }, data: { firstName, lastName: 'Synthetic', email: randomUUID() + '@example.test', password: randomUUID() + '!' } });
    expect(r.status()).toBe(201); return context;
  };
  const headers = { Origin: deployment.origin, 'X-CSRF-Protection': '1' };
  const post = async (context, url, data, code = 200) => { const r = await context.request.post(url, { headers, data }); expect(r.status()).toBe(code); return r.json(); };
  try {
    const owner = await account('Giver'), alice = await account('Alice'), bob = await account('Bob'), outsider = await account('Outsider');
    const { item } = await post(owner, '/api/items', { name: 'Synthetic chat-first bookshelf', description: 'One synthetic bookshelf for local acceptance.', categoryId: 'living-room', itemTypeId: 'bookshelf', stateId: '06', metroId: '41860', pickupTimeZone: 'UTC', pickupTimeZoneConfirmed: true, availableUntil: day(20) }, 201);
    const prefix = '/api/items/' + item.id;
    const bytes = await sharp({ create: { width: 600, height: 400, channels: 3, background: '#387ab2' } }).png().toBuffer();
    const { upload } = await post(owner, prefix + '/images/uploads', { imageRevision: 0, clientUploadId: randomUUID(), byteLength: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') }, 201);
    expect((await owner.request.put(prefix + '/images/' + upload.id + '/content', { headers, multipart: { file: { name: 'synthetic.png', mimeType: 'image/png', buffer: bytes } } })).status()).toBe(201);
    await post(owner, prefix + '/actions', { action: 'publish', version: item.version });
    const createRequest = async context => (await post(context, '/api/pickup-requests', { itemId: item.id, localDateTime: day(3) + 'T12:00', timeZone: 'UTC' }, 201)).request;
    const a = await createRequest(alice), b = await createRequest(bob);
    for (const [context, row, text] of [[alice, a, 'Alice can collect it.'], [bob, b, 'Bob can collect it too.']]) await post(context, '/api/pickup-requests/' + row.id + '/conversation/messages', { text }, 201);
    const getPublic = await outsider.request.get('/api/items/' + item.id); expect(getPublic.status()).toBe(200); expect((await getPublic.json()).item.isReserved).toBe(false);
    expect((await outsider.request.get('/api/item-images/' + upload.id + '/thumbnail')).status()).toBe(200);
    const giver = await owner.newPage(), receiver = await alice.newPage(), other = await bob.newPage();
    const empty = await outsider.newPage();
    await empty.goto('/app/pickups?status=accepted&cursor=' + a.id);
    await expect(empty.getByRole('link', { name: 'Find items', exact: true })).toBeVisible();
    await expect(empty.getByRole('heading', { name: 'My pickup requests', exact: true })).toBeAttached();
    await expect(empty.getByRole('heading', { name: 'My pickup requests', exact: true })).toHaveCSS('clip', 'rect(0px, 0px, 0px, 0px)');
    await expect(empty.getByRole('navigation', { name: 'Find', exact: true })).toHaveCount(0);
    await expect(empty.getByRole('button', { name: 'Refresh requests' })).toHaveCount(0);
    await expect(empty.getByLabel('Request status', { exact: true })).toHaveCount(0);
    const emptyTitle = await empty.getByRole('heading', { name: 'No pickup requests here yet.' }).boundingBox();
    const findButton = await empty.getByRole('link', { name: 'Find items', exact: true }).boundingBox();
    expect(findButton.y - emptyTitle.y - emptyTitle.height).toBeGreaterThanOrEqual(16);
    await audit(empty, 'empty-requester', info);
    await receiver.goto('/app/pickups');
    await expect(receiver.getByRole('link', { name: 'View request to Giver for ' + item.name, exact: true })).toBeVisible();
    await expect(receiver.getByRole('navigation', { name: 'Find', exact: true })).toHaveCount(0);
    await audit(receiver, 'requester-list', info);
    let releaseDetail;
    const detailGate = new Promise(resolve => { releaseDetail = resolve; });
    const detailPath = '**/api/pickup-requests/' + b.id;
    await giver.route(detailPath, async route => { await detailGate; await route.continue(); });
    try {
      await giver.goto('/app/pickups/' + b.id);
      await expect(giver.getByText('Loading pickup requests…', { exact: true })).toBeAttached();
      await expect(giver.getByText('Loading pickup requests…', { exact: true })).toHaveCSS('clip', 'rect(0px, 0px, 0px, 0px)');
      await expect(giver.locator('.ui-feedback')).toHaveCount(0);
    } finally { releaseDetail(); }
    await expect(giver.getByText('Bob can collect it too.', { exact: true })).toBeVisible();
    await giver.unroute(detailPath);
    await giver.getByLabel('Message', { exact: true }).fill('Thanks, I will coordinate here.'); await giver.getByRole('button', { name: 'Send message', exact: true }).click();
    await expect(giver.getByText('Thanks, I will coordinate here.', { exact: true })).toBeVisible();
    await giver.goto('/app/pickups/' + a.id); await expect(giver.getByText('Alice can collect it.', { exact: true })).toBeVisible();
    await expect(giver.getByRole('button', { name: /Accept pickup|Decline request/ })).toHaveCount(0);
    await expect(giver.getByRole('link', { name: 'Back to requests', exact: true })).toHaveCount(1);
    await expect(giver.getByRole('link', { name: 'Incoming requests', exact: true })).toHaveCount(0);
    await expect(giver.locator('.chat-message-heading strong')).toHaveText(['Alice']);
    const composer = giver.getByLabel('Message', { exact: true });
    expect(await composer.evaluate(node => getComputedStyle(node).borderWidth)).toBe('0px');
    await composer.focus();
    expect(await composer.evaluate(node => getComputedStyle(node).outlineStyle)).toBe('none');
    expect(await composer.evaluate(node => getComputedStyle(node).boxShadow)).not.toBe('none');
    await composer.evaluate(node => node.blur());
    if (info.project.name === 'desktop') {
      const title = await giver.getByRole('heading', { name: item.name, exact: true }).boundingBox();
      const button = await giver.getByRole('button', { name: 'Mark as picked up', exact: true }).boundingBox();
      expect(button.x).toBeGreaterThan(title.x + title.width);
      expect(Math.abs(button.y - title.y)).toBeLessThan(5);
    }
    await receiver.goto('/app/pickups/' + a.id); await expect(receiver.getByRole('button', { name: 'Mark as picked up' })).toHaveCount(0);
    await other.goto('/app/pickups/' + b.id); await expect(other.getByText('Bob can collect it too.', { exact: true })).toBeVisible();
    await audit(giver, 'open', info);
    if (info.project.name === 'mobile') { await giver.setViewportSize({ width: 375, height: 1000 }); await audit(giver, 'open-375', info); await giver.setViewportSize({ width: 320, height: 1000 }); }
    let actions = 0; giver.on('request', r => { if (r.method() === 'POST' && new URL(r.url()).pathname.endsWith('/actions')) actions++; });
    giver.once('dialog', dialog => dialog.dismiss()); await giver.getByRole('button', { name: 'Mark as picked up' }).click();
    expect(actions).toBe(0); expect((await outsider.request.get('/api/items/' + item.id)).status()).toBe(200);
    await giver.getByLabel('Message', { exact: true }).fill('Keep this unsent text independent.');
    giver.once('dialog', dialog => dialog.accept());
    await giver.getByRole('button', { name: 'Mark as picked up' }).focus(); await giver.keyboard.press('Enter');
    await expect(giver.getByText('Picked up', { exact: true })).toBeVisible(); expect(actions).toBe(1);
    await expect(giver.getByRole('button', { name: 'Mark as picked up' })).toHaveCount(0);
    await expect(giver.getByLabel('Unsent message', { exact: true })).toHaveValue('Keep this unsent text independent.');
    await expect(giver.getByLabel('Unsent message', { exact: true })).toHaveAttribute('readonly');
    const completed = (await (await owner.request.get('/api/pickup-requests/' + a.id)).json()).request;
    expect(Date.parse(completed.completedAt)).toBeLessThan(Date.parse(completed.proposedAt));
    await expect(giver.locator('.pickup-arrangement time')).toHaveAttribute('datetime', completed.completedAt);
    await audit(giver, 'picked-up', info);
    await receiver.evaluate(() => window.dispatchEvent(new Event('focus'))); await expect(receiver.getByText('Picked up', { exact: true })).toBeVisible();
    await expect(receiver.getByText('Alice can collect it.', { exact: true })).toBeVisible(); await expect(receiver.getByRole('button', { name: 'Send message' })).toHaveCount(0);
    await other.evaluate(() => window.dispatchEvent(new Event('focus'))); await expect(other.getByText('Cancelled', { exact: true })).toBeVisible();
    await expect(other.getByText('Bob can collect it too.', { exact: true })).toBeVisible(); await expect(other.getByRole('button', { name: 'Send message' })).toHaveCount(0);
    expect((await outsider.request.get('/api/items/' + item.id)).status()).toBe(404);
    expect((await outsider.request.get('/api/item-images/' + upload.id + '/thumbnail')).status()).toBe(404);
    expect((await outsider.request.get('/api/pickup-requests/' + a.id + '/conversation/messages')).status()).toBe(404);
    const stored = await deployment.db.collection('pickupRequests').find({ itemId: new (require('../giftlink-backend/node_modules/mongodb').ObjectId)(item.id) }).toArray();
    expect(stored.filter(row => row.status === 'completed')).toHaveLength(1); expect(stored.some(row => row.active)).toBe(false);
    expect(await deployment.db.collection('moveOutPlans').countDocuments()).toBe(0);
    // The owner can inspect a closed item privately, then deliberately relist.
    // Use a second page so the independent unsent chat draft above stays intact.
    const manage = await owner.newPage();
    await manage.goto('/app/listings');
    await expect(manage.getByRole('link', { name: item.name, exact: true })).toHaveAttribute('href', '/app/listings/' + item.id);
    await audit(manage, 'completed-inventory', info);
    await manage.getByRole('link', { name: 'View ' + item.name, exact: true }).click();
    await expect(manage).toHaveURL(deployment.origin + '/app/listings/' + item.id);
    await expect(manage.getByRole('heading', { name: item.name, exact: true })).toBeVisible();
    await expect(manage.getByText('One synthetic bookshelf for local acceptance.', { exact: true })).toBeVisible();
    await expect(manage.getByRole('img')).toBeVisible();
    expect((await owner.request.get('/api/item-images/' + upload.id + '/thumbnail')).status()).toBe(200);
    await expect(manage.getByRole('textbox')).toHaveCount(0);
    await audit(manage, 'private-completed-detail', info);
    const denied = await outsider.newPage(); await denied.goto('/app/listings/' + item.id);
    await expect(denied.getByRole('alert')).toBeVisible(); await expect(denied.getByRole('heading', { name: item.name, exact: true })).toHaveCount(0);
    await expect(denied.getByRole('button', { name: 'Relist as draft' })).toHaveCount(0);
    const requestId = new (require('../giftlink-backend/node_modules/mongodb').ObjectId)(a.id);
    const closedBefore = await deployment.db.collection('pickupRequests').findOne({ _id: requestId });
    const messagesBefore = await deployment.db.collection('pickupMessages').find({ requestId }).sort({ _id: 1 }).toArray();
    expect(messagesBefore).toHaveLength(1);
    const quotaBefore = (await (await owner.request.get(prefix + '/images')).json()).allowance;
    let relists = 0; manage.on('request', r => { if (r.method() === 'POST' && new URL(r.url()).pathname === prefix + '/actions') relists++; });
    manage.once('dialog', d => d.dismiss()); await manage.getByRole('button', { name: 'Relist as draft' }).click(); expect(relists).toBe(0);
    manage.once('dialog', d => d.accept()); await manage.getByRole('button', { name: 'Relist as draft' }).focus(); await manage.keyboard.press('Enter');
    await expect(manage).toHaveURL(deployment.origin + '/app/items/' + item.id + '/edit');
    await expect(manage.getByLabel('Item name', { exact: true })).toHaveValue(item.name); expect(relists).toBe(1);
    await expect(manage.getByRole('img', { name: /^(Saved|Uploaded) photo 1$/ })).toBeVisible();
    expect((await outsider.request.get(prefix)).status()).toBe(404);
    expect((await outsider.request.get('/api/item-images/' + upload.id + '/thumbnail')).status()).toBe(404);
    expect(await deployment.db.collection('pickupRequests').findOne({ _id: requestId })).toEqual(closedBefore);
    expect(await deployment.db.collection('pickupMessages').find({ requestId }).sort({ _id: 1 }).toArray()).toEqual(messagesBefore);
    const historical = (await (await owner.request.get('/api/pickup-requests/' + a.id)).json()).request;
    expect(historical.status).toBe('completed'); expect(historical.item.status).toBe('draft');
    const quotaAfter = (await (await owner.request.get(prefix + '/images')).json()).allowance;
    const { newUploadsAllowed: oldAdmission, ...oldCounters } = quotaBefore;
    const { newUploadsAllowed: newAdmission, ...newCounters } = quotaAfter;
    expect(oldAdmission).toBe(false); expect(newAdmission).toBe(true); expect(newCounters).toEqual(oldCounters);
    await audit(manage, 'restored-draft', info);
    await manage.getByLabel('Item name', { exact: true }).fill('Relisted synthetic bookshelf');
    await manage.getByRole('button', { name: 'Save Draft', exact: true }).click();
    await expect(manage).toHaveURL(deployment.origin + '/app/listings');
    await manage.getByRole('link', { name: 'Manage Relisted synthetic bookshelf', exact: true }).click();
    manage.once('dialog', d => d.accept()); await manage.getByRole('button', { name: 'Publish', exact: true }).click();
    await expect(manage).toHaveURL(deployment.origin + '/app/listings'); expect((await outsider.request.get(prefix)).status()).toBe(200);
    expect((await outsider.request.get('/api/item-images/' + upload.id + '/thumbnail')).status()).toBe(200);
    for (const [context, row, status] of [[alice, a, 'completed'], [bob, b, 'cancelled']]) {
      const old = (await (await context.request.get('/api/pickup-requests/' + row.id)).json()).request; expect(old.status).toBe(status);
      const r = await context.request.post('/api/pickup-requests/' + row.id + '/conversation/messages', { headers, data: { text: 'Old requests must remain closed.' } }); expect(r.status()).toBe(404);
    }
    await expect(giver.getByLabel('Unsent message', { exact: true })).toHaveValue('Keep this unsent text independent.');

  } finally { for (const context of contexts) await context.close(); }
});
