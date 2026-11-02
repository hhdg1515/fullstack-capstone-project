const { randomUUID } = require('node:crypto');
const { test: base, expect } = require('./local-browser.cjs');
const { localEnvironment } = require('./local.cjs');
const test = base.extend({ deployment: [async ({}, use) => {
  if (process.env.E2E_APP_ORIGIN) throw Error('F1 is disposable local only');
  const local = await localEnvironment({ ownerListings: true }); try { await use(local); } finally { await local.close(); }
}, { timeout: 180000 }] });
async function setup(browser, d) {
  const context = await browser.newContext({ baseURL: d.origin, ignoreHTTPSErrors: true, viewport: { width: test.info().project.name === 'mobile' ? 320 : 1440, height: 1000 } });
  const headers = { Origin: d.origin, 'X-CSRF-Protection': '1' };
  const post = async (path, data) => { const r = await context.request.post(path, { headers, data }); expect(r.ok()).toBe(true); return r.status() === 204 ? null : r.json(); };
  const a = { email: randomUUID() + '@example.test', password: randomUUID() + 'password', firstName: 'AccountA', lastName: 'Synthetic' };
  const b = { ...a, email: randomUUID() + '@example.test', firstName: 'AccountB' };
  await post('/api/auth/register', a); const one = (await post('/api/items', { name: 'Private A item' })).item;
  const { plan } = await post('/api/move-out-plans', { city: 'Local', neighborhood: 'Synthetic', moveOutDeadline: '2027-11-12' });
  const legacy = (await post('/api/move-out-plans/' + plan.id + '/items', { name: 'Legacy A item' })).item;
  await post('/api/auth/logout', {}); await post('/api/auth/register', b);
  const two = (await post('/api/items', { name: 'Private B item' })).item;
  await post('/api/auth/logout', {});
  const page = await context.newPage(); page.on('dialog', dialog => dialog.accept());
  const openNav = async () => { const menu = page.getByRole('button', { name: 'Menu', exact: true }); if (await menu.isVisible()) await menu.click(); };
  const logout = async () => { await openNav(); await page.getByRole('button', { name: 'Logout', exact: true }).click(); };
  const login = async account => { if (page.url() === 'about:blank') await page.goto('/app/login'); else { await openNav(); await page.getByRole('link', { name: 'Account', exact: true }).click(); } await page.getByLabel('Email', { exact: true }).fill(account.email); await page.getByLabel('Password', { exact: true }).fill(account.password); await page.getByRole('button', { name: 'Login', exact: true }).click(); await expect(page.getByText('Signed in as ' + account.firstName)).toHaveCount(1); };
  return { context, page, login, logout, openNav, a, b, one, two, legacy, plan, post };
}
for (const status of [200, 401]) test('late A response ' + status + ' cannot contaminate authenticated B; URLs and history retain ownership', async ({ isolatedBrowser: browser, deployment }) => {
  const s = await setup(browser, deployment); let release;
  try {
    await s.login(s.a); await s.page.goto('/app/listings'); await expect(s.page.getByRole('link', { name: 'Private A item', exact: true })).toBeVisible();
    await s.page.goto('/app/items/' + s.one.id + '/edit'); await s.page.getByLabel('Item name', { exact: true }).fill('Unsent A draft');
    await s.logout(); await s.login(s.b);
    await s.page.goto('/app/items/' + s.two.id + '/edit'); await expect(s.page.getByLabel('Item name', { exact: true })).toHaveValue('Private B item');
    await s.logout(); await s.login(s.a);
    await s.page.goto('/app/profile');
    let entered; const arrived = new Promise(resolve => { entered = resolve; });
    const gate = new Promise(resolve => { release = resolve; });
    await s.page.route('**/api/me/items', async route => {
      const response = await route.fetch(); const body = await response.body(); entered(); await gate;
      await route.fulfill({ status, contentType: 'application/json', body: status === 200 ? body : JSON.stringify({ error: { code: 'SESSION_EXPIRED', message: 'Expired A' } }) });
    }, { times: 1 });
    await s.openNav(); await s.page.getByRole('link', { name: 'My Listings', exact: true }).first().click(); await arrived;
    await s.logout(); await s.login(s.b);
    await s.openNav(); await s.page.getByRole('link', { name: 'My Listings', exact: true }).first().click(); await expect(s.page.getByRole('link', { name: 'Private B item', exact: true })).toBeVisible();
    await s.page.evaluate(() => { window.f1Leaks = []; window.f1Observer = new MutationObserver(() => { if (document.body.innerText.includes('Private A item') || document.body.innerText.includes('Unsent A draft')) window.f1Leaks.push('old-account-content'); }); window.f1Observer.observe(document.body, { childList: true, subtree: true, characterData: true }); });
    const finished = s.page.waitForResponse(r => r.url().endsWith('/api/me/items') && r.status() === status);
    release(); await finished;
    await s.page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    expect(await s.page.evaluate(() => { window.f1Observer.disconnect(); return window.f1Leaks; })).toEqual([]);
    await expect(s.page.getByText('Signed in as AccountB')).toHaveCount(1); await expect(s.page.getByText('Private A item', { exact: true })).toHaveCount(0);
    await expect(s.page.getByText('Unsent A draft', { exact: true })).toHaveCount(0);
    await s.page.goto('/app/listings/' + s.one.id); await expect(s.page.getByRole('alert')).toBeVisible(); await expect(s.page.getByText('Private A item', { exact: true })).toHaveCount(0);
    await s.page.goto('/app/listings/' + s.two.id); await expect(s.page.getByRole('heading', { name: 'Private B item', exact: true })).toBeVisible();
    await s.page.reload(); await expect(s.page.getByRole('heading', { name: 'Private B item', exact: true })).toBeVisible();
    await s.page.goBack(); await s.page.goForward(); await expect(s.page.getByRole('heading', { name: 'Private B item', exact: true })).toBeVisible();
    expect(await deployment.db.collection('moveOutPlans').countDocuments()).toBe(1);
  } finally { release?.(); await s.context.close(); }
});
test('legacy edits remain plan-scoped; v2 saves use the independent endpoint and foreign editors deny', async ({ isolatedBrowser: browser, deployment }) => {
  const s = await setup(browser, deployment); const patches = [];
  try {
    await s.login(s.a); s.page.on('request', r => { if (r.method() === 'PATCH') patches.push(new URL(r.url()).pathname); });
    await s.page.goto('/app/items/' + s.legacy.id + '/edit'); await expect(s.page.getByLabel('Item name', { exact: true })).toHaveValue('Legacy A item');
    await s.page.getByLabel('Item name', { exact: true }).fill('Updated legacy'); await s.page.getByRole('button', { name: 'Save Draft', exact: true }).first().click();
    await expect.poll(() => patches.length).toBe(1); expect(patches[0]).toBe('/api/move-out-plans/' + s.plan.id + '/items/' + s.legacy.id);
    await s.page.goto('/app/items/' + s.one.id + '/edit'); await s.page.getByLabel('Item name', { exact: true }).fill('Updated independent');
    await s.page.getByRole('button', { name: 'Save Draft', exact: true }).first().click(); await expect(s.page.getByRole('heading', { name: 'Updated independent', exact: true })).toBeVisible();
    expect(patches[1]).toBe('/api/items/' + s.one.id);
    await s.page.goto('/app/items/' + s.two.id + '/edit'); await expect(s.page.getByRole('alert')).toBeVisible(); await expect(s.page.getByLabel('Item name', { exact: true })).toHaveCount(0);
    await deployment.db.collection('sessions').updateMany({}, { $set: { expiresAt: new Date(0) } });
    await s.page.goto('/app/listings'); await expect(s.page.getByRole('heading', { name: 'Login', exact: true })).toBeVisible();
    await expect(s.page.getByText('Updated independent', { exact: true })).toHaveCount(0);
  } finally { await s.context.close(); }
});
