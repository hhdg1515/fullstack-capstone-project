const { randomUUID } = require('node:crypto');
const AxeBuilder = require('@axe-core/playwright').default;
const { test: base, expect } = require('./fixtures.cjs');
const { localEnvironment } = require('./local.cjs');

// Additional visual/form fixtures are strictly local; hosted budgets do not grow.
const test = base.extend({ deployment: [async ({}, use) => {
  if (process.env.E2E_APP_ORIGIN) throw Error('Design foundation fixtures are local only');
  const local = await localEnvironment(); try { await use(local); } finally { await local.close(); }
}, { scope: 'worker', timeout: 180000 }] });
test.skip(Boolean(process.env.E2E_APP_ORIGIN), 'Design evidence uses disposable local data only');

test('shared Login and My Plans preserve keyboard, authoritative states and recovery', async ({ browser, deployment }, testInfo) => {
  const options = { baseURL: deployment.origin, ignoreHTTPSErrors: true,
    viewport: { width: testInfo.project.name === 'mobile' ? 320 : 1440, height: 1000 },
    extraHTTPHeaders: { 'X-Deployment-Target': deployment.fingerprint } };
  const account = await browser.newContext(options), context = await browser.newContext(options);
  const credentials = { firstName: 'Local', lastName: 'Design', email: randomUUID() + '@example.invalid', password: randomUUID() + '!' };
  const headers = { Origin: deployment.origin, 'X-CSRF-Protection': '1' };
  const accessible = async (page, state) => {
    await page.mouse.move(0, 0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    const rules = (await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations.map(v => v.id);
    await test.step(state + ' WCAG rules: ' + (rules.join(', ') || 'none'), async () => expect(rules).toEqual([]));
  };
  try {
    expect((await account.request.post('/api/auth/register', { headers, data: credentials })).ok()).toBe(true);
    const page = await context.newPage();
    await page.goto('/app/plans'); await expect(page.getByRole('heading', { name: 'Login', exact: true })).toBeVisible();
    const email = page.getByLabel('Email', { exact: true }), password = page.getByLabel('Password', { exact: true });
    const formWidth = (await page.locator('form.login-card').boundingBox()).width;
    expect(formWidth).toBeGreaterThan(testInfo.project.name === 'mobile' ? 280 : 400);
    await page.getByRole('button', { name: 'Login', exact: true }).click();
    await expect(email).toBeFocused(); await expect(email).toHaveAttribute('aria-invalid', 'true');
    await expect(email).toHaveAttribute('aria-describedby', /email-error/);
    await accessible(page, 'Login validation');
    await email.fill(credentials.email); await password.fill('incorrect-password'); await password.press('Enter');
    await expect(page.getByRole('alert')).toContainText(/incorrect/i); await expect(password).toHaveValue('');
    await accessible(page, 'Login rejected');
    await password.fill(credentials.password); await password.press('Enter');
    await expect(page.getByRole('heading', { name: 'No plans yet', exact: true })).toBeVisible();
    expect(new URL(page.url()).pathname).toBe('/app/plans');
    const create = page.locator('main a[href="/app/plans/new"]'); await expect(create).toHaveCount(1);
    expect(await create.evaluate(node => getComputedStyle(node).backgroundColor)).toBe('rgb(36, 87, 70)');
    expect((await create.boundingBox()).height).toBeGreaterThanOrEqual(44);
    await accessible(page, 'Empty plans');
    // Keyboard activation keeps the same creation route and existing form behavior.
    await create.focus(); await page.keyboard.press('Enter');
    await expect(page.getByRole('heading', { name: 'Create move-out plan', exact: true })).toBeVisible();
    const day = new Date(Date.now() + 10 * 86400000).toISOString().slice(0, 10);
    const title = ('Local review plan ' + 'with a long title '.repeat(5)).trim();
    for (const [label, value] of [['Move-out deadline', day], ['City', 'Oakland'], ['Neighborhood', 'Temescal'], ['Plan title (optional)', title]]) await page.getByLabel(label, { exact: true }).fill(value);
    await page.getByRole('button', { name: 'Create plan', exact: true }).click();
    await expect(page.getByRole('link', { name: 'Manage items', exact: true })).toBeVisible();
    const planId = new URL(page.url()).pathname.split('/').pop();
    const created = await (await account.request.get('/api/move-out-plans/' + planId)).json();
    expect(created.plan.status).toBe('active');
    await page.goto('/app/plans'); await expect(page.getByRole('link', { name: title, exact: true })).toBeVisible();
    const plans = page.getByRole('list', { name: 'Move-out plans', exact: true });
    await expect(plans.getByText('Active', { exact: true })).toBeVisible();
    await expect(plans.getByRole('link', { name: 'Manage items & clearance progress', exact: true })).toHaveAttribute('href', '/app/plans/' + planId + '/items');
    await accessible(page, 'Populated plans');
    // 200% browser-zoom equivalent layout reflow on desktop, narrowest mobile on mobile.
    if (testInfo.project.name === 'desktop') {
      await page.setViewportSize({ width: 720, height: 500 }); await accessible(page, '200 percent layout reflow');
      await page.setViewportSize(options.viewport);
    }
    let failure = true;
    await page.route('**/api/move-out-plans', route => failure ? route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: { code: 'SERVICE_UNAVAILABLE', message: 'Plans are temporarily unavailable.' } }) }) : route.continue());
    await page.reload(); await expect(page.getByRole('alert')).toContainText('Plans are temporarily unavailable.');
    await expect(page.getByRole('heading', { name: 'No plans yet', exact: true })).toHaveCount(0);
    await expect(page.getByRole('link', { name: title, exact: true })).toHaveCount(0); await accessible(page, 'Plan service error');
    failure = false; await page.getByRole('button', { name: 'Retry', exact: true }).click();
    await expect(page.getByRole('link', { name: title, exact: true })).toBeVisible();
    // Expired private reads must remove the dashboard and return to the same Login.
    await page.route('**/api/move-out-plans', route => route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ error: { code: 'SESSION_EXPIRED', message: 'Session ended.' } }) }));
    await page.reload(); await expect(page.getByText('Your session ended. Please log in again.', { exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'My move-out plans', exact: true })).toHaveCount(0);
    await accessible(page, 'Expired session');
    expect(deployment.serverErrors).toEqual([]);
  } finally { await context.close(); await account.close(); }
});
