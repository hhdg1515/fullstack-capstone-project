const { test, expect } = require('./fixtures.cjs');
const { root, expectedEmails } = require('./policy.cjs');
const bcrypt = require(root + '/giftlink-backend/node_modules/bcryptjs');
const { tokenHash } = require(root + '/giftlink-backend/services/identity');
const { Temporal } = require(root + '/giftlink-backend/node_modules/@js-temporal/polyfill');
const { randomUUID } = require('node:crypto');
const { cleanup } = require('./cleanup.cjs');
const { health: httpsPreflight } = require('./https-preflight.cjs');
const { bootstrapBypassCookie } = require('./vercel-bypass.cjs');
const day = value => new Date(value).toISOString().slice(0, 10);

test('two real accounts complete discovery, pickup coordination and secure sessions', async ({ browser, deployment }, testInfo) => {
  const project = testInfo.project.name; const runId = deployment.runId; const prefix = `E2E ${runId} ${project}`;
  const password = randomUUID() + '-E2e!'; const emails = expectedEmails(runId).filter(email => email.includes('.' + project + '.'));
  const emailA = emails.find(email => email.includes('.giver@')); const emailB = emails.find(email => email.includes('.receiver@'));
  const options = { ...testInfo.project.use, baseURL: deployment.origin, ignoreHTTPSErrors: deployment.local,
    extraHTTPHeaders: { 'X-Deployment-Target': deployment.fingerprint } };
  delete options.launchOptions; delete options.trace; delete options.screenshot; delete options.video;
  const giver = await browser.newContext(options); const receiver = await browser.newContext(options);
  const failures = [];
  for (const context of [giver, receiver]) {
    await context.route('**/*', route => {
      const request = route.request(); const url = new URL(request.url());
      if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method()) && (url.origin !== deployment.origin || !url.pathname.startsWith('/api/'))) return route.abort();
      return route.continue();
    });
    context.setDefaultTimeout(20000);
    context.on('page', page => {
      page.on('response', response => { if (response.url().startsWith(deployment.origin + '/api/') && response.status() >= 500) failures.push('Unexpected API server error'); });
      page.on('pageerror', () => failures.push('Browser JavaScript error'));
      page.on('console', message => { if (message.type() === 'error' && /CORS|Uncaught|Unexpected token|Cannot read/.test(message.text())) failures.push('Unexpected browser console error'); });
    });
  }
  const a = await giver.newPage(), b = await receiver.newPage();
  a.on('dialog', dialog => dialog.accept()); b.on('dialog', dialog => dialog.accept());
  const write = (context, path, data, extra = {}) => context.request.post(deployment.origin + path, {
    maxRedirects: 0, headers: { Origin: deployment.origin, 'X-CSRF-Protection': '1' }, data, ...extra });
  const read = (context, url) => context.request.get(url, { maxRedirects: 0 });
  const must = (condition, label) => { if (!condition) throw Error(label); };
  async function primary(page, label) {
    const menu = page.getByRole('button', { name: 'Menu', exact: true }); if (await menu.isVisible()) await menu.click();
    await page.getByRole('navigation', { name: 'Primary', exact: true }).getByRole('link', { name: label, exact: true }).click();
  }
  async function filters(page) {
    const toggle = page.getByRole('button', { name: /^Filters(?: \(\d+\))?$/ });
    if (await toggle.getAttribute('aria-expanded') === 'false') await toggle.click();
  }
  async function register(page, email) {
    await page.goto('/app/register');
    for (const [label, value] of [['First name', 'E2E'], ['Last name', runId], ['Email', email], ['Password', password]]) await page.getByLabel(label, { exact: true }).fill(value);
    await page.getByRole('button', { name: 'Register', exact: true }).click(); await page.waitForURL(deployment.origin + '/');
  }
  async function logout(page, context) {
    const saved = (await context.cookies()).find(cookie => cookie.name === '__Host-giftlink_session'); must(Boolean(saved), 'Secure session cookie missing');
    const menu = page.getByRole('button', { name: 'Menu', exact: true }); if (await menu.isVisible()) await menu.click();
    await page.getByRole('button', { name: 'Logout', exact: true }).click(); await page.waitForURL(deployment.origin + '/');
    // Replay only the revoked application session; retain the independent
    // provider cookie so Deployment Protection cannot mask the auth assertion.
    await context.addCookies([saved]);
    const old = await context.request.get(deployment.origin + '/api/me', { maxRedirects: 0 });
    must(old.status() === 401, 'Logged-out session remained usable');
    must(await deployment.db.collection('sessions').countDocuments({ _id: tokenHash(saved.value) }) === 0, 'Logout did not revoke database session');
  }
  async function login(page, email, intended = '/app/profile') {
    await page.goto(intended); await page.getByRole('heading', { name: 'Login', exact: true }).waitFor();
    await page.getByLabel('Email', { exact: true }).fill(email); await page.getByLabel('Password', { exact: true }).fill(password);
    await page.getByRole('button', { name: 'Login', exact: true }).click();
  }
  let userA, userB;
  try {
    if (!deployment.local) {
      for (const context of [giver, receiver]) await bootstrapBypassCookie(context, deployment.origin, process.env.VERCEL_AUTOMATION_BYPASS_SECRET);
    }
    await httpsPreflight(deployment.origin, deployment.fingerprint, async (url, options) => {
      const response = await giver.request.get(url, { maxRedirects: 0, headers: options.headers });
      return { status: response.status(), headers: new Headers(response.headers()), json: () => response.json(), text: () => response.text() };
    });
    await test.step('HTTPS frontend/deep-link/JSON/anonymous-auth/fingerprint preflight verified', async () => {});
    const health = await read(giver, deployment.origin + '/api/health'); must(health.status() === 200, 'JSON readiness failed');
    must((await health.json()).databaseFingerprint === deployment.fingerprint, 'Deployment target mismatch');
    must((await read(receiver, deployment.origin + '/api/me')).status() === 401, 'Anonymous account access accepted');
    await register(a, emailA);
    userA = await deployment.db.collection('users').findOne({ email: emailA }); must(Boolean(userA), 'Registered giver not in approved database');
    must(await bcrypt.compare(password, userA.password), 'Password is not stored as a bcrypt hash');
    const cookie = (await giver.cookies()).find(value => value.name === '__Host-giftlink_session');
    must(Boolean(cookie && cookie.httpOnly && cookie.secure && cookie.sameSite === 'Lax' && cookie.path === '/'), 'Session cookie security attributes changed');
    await primary(a, 'Account'); await a.reload(); await expect(a.getByRole('heading', { name: 'Your account', exact: true })).toBeVisible();
    await expect(a.getByText(emailA, { exact: false })).toBeVisible();
    must(!JSON.stringify(await (await read(giver, deployment.origin + '/api/me')).json()).includes(userA.password), 'Password hash exposed by API');
    await test.step('Giver account, password hash and secure cookie verified', async () => {});
    await logout(a, giver);
    const wrong = await write(giver, '/api/auth/login', { email: emailA, password: password + '-wrong' }); must(wrong.status() === 401, 'Incorrect password accepted');
    const csrf = await giver.request.post(deployment.origin + '/api/auth/login', { maxRedirects: 0, data: { email: emailA, password } }); must(csrf.status() === 403, 'Missing CSRF/Origin accepted');
    const wrongOrigin = await write(giver, '/api/auth/login', { email: emailA, password }, { headers: { Origin: 'https://wrong.example.test', 'X-CSRF-Protection': '1' } }); must(wrongOrigin.status() === 403, 'Wrong Origin accepted');
    await login(a, emailA); await expect(a.getByRole('heading', { name: 'Your account', exact: true })).toBeVisible();
    await primary(a, 'Give Away'); await a.getByRole('link', { name: 'Create your first plan', exact: true }).click();
    for (const [label, value] of [['Move-out deadline', day(deployment.now() + 7 * 86400000)], ['City', 'E2E City'], ['Neighborhood', 'E2E Neighborhood'], ['Plan title (optional)', prefix + ' move'], ['Pickup timezone (needed to receive requests)', 'America/Los_Angeles']]) await a.getByLabel(label, { exact: true }).fill(value);
    await a.getByRole('button', { name: 'Create plan', exact: true }).click(); await a.getByRole('link', { name: 'Manage items', exact: true }).click();
    await test.step('Giver login and plan creation verified', async () => {});
    const itemIds = [];
    for (const [label, days] of [['desk', 3], ['chair', 5], ['lamp', 4]]) {
      await a.getByLabel('Item name', { exact: true }).fill(prefix + ' ' + label);
      await a.getByText('Optional description, condition and pickup dates', { exact: true }).click();
      await a.getByLabel('Available until (optional)', { exact: true }).fill(day(deployment.now() + days * 86400000));
      await a.getByRole('button', { name: 'Publish & add another', exact: true }).click();
      const card = a.getByRole('heading', { name: prefix + ' ' + label, exact: true }).locator('..'); await card.getByRole('link', { name: 'Public listing', exact: true }).waitFor();
      itemIds.push((await card.getByRole('link', { name: 'Public listing', exact: true }).getAttribute('href')).split('/').pop());
    }
    await expect(a.getByText('0 of 3 items cleared', { exact: true })).toBeVisible();
    // Existing public limit/cursor parameters exercise real UI pagination with
    // the same three records, keeping the approved remote data budget intact.
    await b.goto('/app/items?q=' + encodeURIComponent(prefix) + '&limit=1');
    const results = b.getByRole('list', { name: 'Available items', exact: true });
    await expect(results.getByRole('listitem')).toHaveCount(1);
    await expect(results.getByRole('listitem').first()).toBeInViewport();
    await expect(results.getByRole('link').first()).toHaveText(prefix + ' lamp');
    for (const count of [2, 3]) {
      await b.getByRole('button', { name: 'Load more', exact: true }).click();
      await expect(results.getByRole('listitem')).toHaveCount(count);
    }
    await expect(b.getByRole('button', { name: 'Load more', exact: true })).toHaveCount(0);
    await filters(b);
    await b.getByRole('option', { name: 'E2E City', exact: true }).waitFor({ state: 'attached' });
    await b.getByLabel('City', { exact: true }).selectOption('E2E City');
    await b.getByLabel('Neighborhood', { exact: true }).selectOption('E2E Neighborhood');
    await b.getByLabel('Pickup availability', { exact: true }).selectOption('now');
    await b.getByLabel('Sort items', { exact: true }).selectOption('deadline');
    await b.getByRole('button', { name: 'Find free items', exact: true }).click();
    await expect(results.getByRole('listitem')).toHaveCount(3);
    await expect(results.getByRole('link').first()).toHaveText(prefix + ' desk');
    await b.reload(); await expect(results.getByRole('listitem')).toHaveCount(3);
    await expect(b.getByLabel('Neighborhood', { exact: true })).toHaveValue('E2E Neighborhood');
    await expect(b.getByLabel('Sort items', { exact: true })).toHaveValue('deadline');
    await filters(b);
    await b.getByLabel('Pickup availability', { exact: true }).selectOption('later');
    await b.getByRole('button', { name: 'Find free items', exact: true }).click();
    await expect(b.getByText('No available items match. Try another search or clear filters.', { exact: true })).toBeVisible();
    await filters(b);
    await b.getByLabel('Pickup availability', { exact: true }).selectOption('now');
    await b.getByLabel('Search items', { exact: true }).fill(prefix + ' desk');
    await b.getByRole('button', { name: 'Find free items', exact: true }).click();
    await expect(results.getByRole('listitem')).toHaveCount(1);
    await test.step('Anonymous search, city/neighborhood/availability filters, sorting, pagination and reload verified', async () => {});
    const appointment = Math.ceil((deployment.now() + (deployment.local ? 120000 : 90000)) / 60000) * 60000;
    const localTime = Temporal.Instant.fromEpochMilliseconds(appointment).toZonedDateTimeISO('America/Los_Angeles').toPlainDateTime().toString({ smallestUnit: 'minute' });
    await b.getByRole('link', { name: prefix + ' desk', exact: true }).click();
    await expect(b.getByRole('heading', { name: prefix + ' desk', exact: true })).toBeVisible(); const shared = b.url();
    await b.reload(); await expect(b.getByRole('heading', { name: prefix + ' desk', exact: true })).toBeVisible();
    await b.getByRole('link', { name: 'Request pickup', exact: true }).click(); await b.getByRole('heading', { name: 'Login', exact: true }).waitFor();
    await b.getByRole('link', { name: 'Register Here', exact: true }).click();
    for (const [label, value] of [['First name', 'E2E'], ['Last name', runId], ['Email', emailB], ['Password', password]]) await b.getByLabel(label, { exact: true }).fill(value);
    await b.getByRole('button', { name: 'Register', exact: true }).click(); await b.getByLabel('Pickup date and time', { exact: true }).waitFor();
    must(b.url().endsWith('/request'), 'Receiver did not return to intended pickup action');
    userB = await deployment.db.collection('users').findOne({ email: emailB }); must(Boolean(userB), 'Receiver account not in approved database'); must(await bcrypt.compare(password, userB.password), 'Receiver bcrypt hashing failed');
    await test.step('Receiver registration returned to intended request form', async () => {});
    const requestIds = [];
    for (let i = 0; i < itemIds.length; i++) {
      if (i) await b.goto('/app/items/' + itemIds[i] + '/request');
      await b.getByLabel('Pickup date and time', { exact: true }).fill(localTime); await b.getByRole('button', { name: 'Send pickup request', exact: true }).click();
      await b.getByText('Awaiting giver decision', { exact: true }).first().waitFor(); requestIds.push(b.url().split('/').pop());
      const privateResponse = await read(receiver, deployment.origin + '/api/pickup-requests/' + requestIds[i]);
      must((await privateResponse.json()).request.status === 'pending', 'Request was automatically reserved');
    }
    const unauthorized = await read(receiver, deployment.origin + '/api/move-out-plans/' + (await deployment.db.collection('moveOutPlans').findOne({ ownerId: userA._id }))._id); must(unauthorized.status() === 404, 'Receiver accessed private giver plan');
    const publicText = JSON.stringify(await (await read(receiver, deployment.origin + '/api/items/' + itemIds[0])).json());
    must(![emailA, emailB, 'giverId', 'receiverId', 'password', 'note'].some(secret => publicText.includes(secret)), 'Public item disclosed private data');
    for (let i = 0; i < requestIds.length; i++) {
      await primary(a, 'Give Away'); await a.getByRole('navigation', { name: 'Give Away', exact: true }).getByRole('link', { name: 'Incoming requests', exact: true }).click();
      await a.locator(`a[href="/app/pickups/${requestIds[i]}"]`).click(); await a.getByRole('button', { name: 'Accept pickup', exact: true }).click();
      await a.getByText('Accepted appointment', { exact: true }).first().waitFor();
    }
    await test.step('Three pending requests explicitly accepted by giver', async () => {});
    await b.goto('/app/items/' + itemIds[0]);
    await expect(b.getByText('Pickup arranged', { exact: true })).toBeVisible();
    await expect(b.getByRole('link', { name: 'Request pickup', exact: true })).toHaveCount(0);
    await b.goto('/app/items/' + itemIds[0] + '/request');
    await expect(b.getByRole('button', { name: 'Check availability', exact: true })).toBeVisible();
    await expect(b.getByLabel('Pickup date and time', { exact: true })).toHaveCount(0);
    const duplicate = await write(receiver, '/api/pickup-requests', { itemId: itemIds[0], localDateTime: localTime, timeZone: 'America/Los_Angeles' }); must(duplicate.status() === 409, 'Accepted item allowed another active reservation');
    for (const id of itemIds) must(await deployment.db.collection('pickupRequests').countDocuments({ itemId: new (require(root + '/giftlink-backend/node_modules/mongodb').ObjectId)(id), status: 'accepted' }) === 1, 'Reservation uniqueness violated');
    const unauthorizedAction = await write(receiver, '/api/pickup-requests/' + requestIds[0] + '/actions', { action: 'complete', version: 2 }); must(unauthorizedAction.status() === 409, 'Receiver completed giver handoff');
    await b.goto('/app/pickups/' + requestIds[1]); await b.getByRole('button', { name: 'Cancel request', exact: true }).click(); await b.getByText('Cancelled', { exact: true }).first().waitFor();
    await b.goto('/app/items/' + itemIds[1]);
    await expect(b.getByRole('link', { name: 'Request pickup', exact: true })).toBeVisible();
    const early = await write(giver, '/api/pickup-requests/' + requestIds[2] + '/actions', { action: 'no_show', version: 2 }); must(early.status() === 409, 'No-show allowed before appointment');
    await test.step('Reservation constraints, authorization, cancellation and early no-show rejection verified', async () => {});
    if (deployment.local) {
      deployment.advance(appointment + 1000);
      for (const page of [a, b]) await page.clock.setFixedTime(new Date(appointment + 1000));
    } else {
      while (Date.now() <= appointment + 1000) await new Promise(resolve => setTimeout(resolve, Math.min(1000, appointment + 1001 - Date.now())));
    }
    await a.goto('/app/pickups/' + requestIds[0]); await a.getByRole('button', { name: 'Confirm handoff', exact: true }).click(); await a.getByText('Handed over', { exact: true }).first().waitFor();
    await b.goto('/app/pickups/' + requestIds[0]); await b.getByText('Handed over', { exact: true }).first().waitFor();
    must((await read(receiver, deployment.origin + '/api/items/' + itemIds[0])).status() === 404, 'Cleared item remained public');
    const planRow = await deployment.db.collection('moveOutPlans').findOne({ ownerId: userA._id }); await a.goto('/app/plans/' + planRow._id + '/items'); await expect(a.getByText('1 of 3 items cleared', { exact: true })).toBeVisible();
    await a.goto('/app/pickups/' + requestIds[2]); await a.getByRole('button', { name: 'Record no-show', exact: true }).click(); await a.getByText('Receiver did not arrive', { exact: true }).first().waitFor();
    const noShowListing = await read(receiver, deployment.origin + '/api/items/' + itemIds[2]);
    must(noShowListing.status() === 200 && (await noShowListing.json()).item.isReserved === false, 'No-show did not release public availability');
    const laterTime = Temporal.Instant.fromEpochMilliseconds(deployment.now() + 86400000).toZonedDateTimeISO('America/Los_Angeles').toPlainDateTime().toString({ smallestUnit: 'minute' });
    const released = await write(receiver, '/api/pickup-requests', { itemId: itemIds[2], localDateTime: laterTime, timeZone: 'America/Los_Angeles' });
    must(released.status() === 201, 'No-show did not release the reservation');
    const releasedRequest = (await released.json()).request;
    must((await write(receiver, '/api/pickup-requests/' + releasedRequest.id + '/actions', { action: 'cancel', version: releasedRequest.version })).status() === 200, 'Follow-up request cancellation failed');
    await primary(b, 'Find Free Items'); await b.getByRole('navigation', { name: 'Find Free Items', exact: true }).getByRole('link', { name: 'My pickup requests', exact: true }).click(); await expect(b.getByRole('heading', { name: 'My pickup requests', exact: true })).toBeVisible();
    await test.step('Completed handoff, cleared progress and no-show release verified', async () => {});
    const currentCookie = (await receiver.cookies()).find(cookie => cookie.name === '__Host-giftlink_session'); must(Boolean(currentCookie), 'Receiver session missing');
    await deployment.db.collection('sessions').updateOne({ _id: tokenHash(currentCookie.value), userId: userB._id }, { $set: { expiresAt: new Date(Date.now() - 1000) } });
    must((await read(receiver, deployment.origin + '/api/me')).status() === 401, 'Expired session accepted');
    await receiver.addCookies([{ name: '__Host-giftlink_session', value: 'f'.repeat(64), url: deployment.origin, secure: true, httpOnly: true, sameSite: 'Lax' }]);
    must((await read(receiver, deployment.origin + '/api/me')).status() === 401, 'Invalid session accepted');
    await login(b, emailB); await expect(b.getByRole('heading', { name: 'Your account', exact: true })).toBeVisible();
    await logout(b, receiver); await a.goto('/app/profile'); await expect(a.getByRole('heading', { name: 'Your account', exact: true })).toBeVisible(); await logout(a, giver);
    for (const page of [a, b]) must(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Horizontal overflow');
    expect(failures).toEqual([]); if (deployment.local) expect(deployment.serverErrors).toEqual([]);
  } finally {
    await giver.close(); await receiver.close();
    // Remote cleanup is a separate explicitly approved operation. Local fixtures
    // are owned disposable data and are removed before their container is closed.
    if (deployment.local) await cleanup(deployment.db, runId, true);
  }
});
