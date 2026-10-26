const { randomUUID } = require('node:crypto');
const AxeBuilder = require('@axe-core/playwright').default;
const { test, expect } = require('./fixtures.cjs');
test.skip(Boolean(process.env.E2E_APP_ORIGIN), 'Form validation uses only disposable local fixtures');
test('field errors are linked, focusable and recoverable in real forms', async ({ browser, deployment }, testInfo) => {
  const options = { ...testInfo.project.use, baseURL: deployment.origin, ignoreHTTPSErrors: true,
    extraHTTPHeaders: { 'X-Deployment-Target': deployment.fingerprint } };
  delete options.launchOptions; delete options.trace; delete options.screenshot; delete options.video;
  const context = await browser.newContext(options), page = await context.newPage();
  page.on('dialog', dialog => dialog.accept());
  const post = async (url, data) => { const result = await context.request.post(url, { maxRedirects: 0,
    headers: { Origin: deployment.origin, 'X-CSRF-Protection': '1' }, data }); expect(result.ok()).toBe(true); return result.json(); };
  try {
    await page.goto('/app/register'); await expect(page.getByRole('button', { name: 'Register', exact: true })).toBeEnabled();
    await page.getByRole('button', { name: 'Register', exact: true }).click();
    await expect(page.getByLabel('First name', { exact: true })).toBeFocused();
    await expect(page.getByLabel('First name', { exact: true })).toHaveAccessibleDescription('Enter a first name of 1 to 80 characters.');
    await post('/api/auth/register', { firstName: 'Local', lastName: 'Forms', email: randomUUID() + '@example.invalid', password: randomUUID() + '!' });
    await page.goto('/app/plans/new'); await page.getByRole('button', { name: 'Create plan', exact: true }).click();
    const deadline = page.getByLabel('Move-out deadline', { exact: true }); await expect(deadline).toBeFocused();
    await expect(deadline).toHaveAccessibleDescription(/Choose a valid move-out date/);
    const { plan } = await post('/api/move-out-plans', { city: 'Oakland', neighborhood: 'Temescal', pickupTimeZone: 'UTC', moveOutDeadline: new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10) });
    await page.goto('/app/plans/' + plan.id + '/items');
    await page.getByRole('button', { name: 'Save draft & add another', exact: true }).click();
    await expect(page.getByLabel('Item name', { exact: true })).toBeFocused();
    await page.getByLabel('Item name', { exact: true }).fill('Desk');
    await page.getByText('Optional description, condition and pickup dates', { exact: true }).click();
    await page.getByLabel('Available until (optional)', { exact: true }).fill('2099-01-01');
    await page.getByText('Optional description, condition and pickup dates', { exact: true }).click();
    await page.getByRole('button', { name: 'Save draft & add another', exact: true }).click();
    await expect(page.getByLabel('Available until (optional)', { exact: true })).toBeFocused();
    await expect(page.getByLabel('Available until (optional)', { exact: true })).toHaveAccessibleDescription('Choose an end date on or before the plan deadline.');
    await expect(page.getByLabel('Item name', { exact: true })).toHaveValue('Desk');
    const violations = (await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations;
    expect(violations.map(row => row.id)).toEqual([]);
    await page.goto('/app/profile'); await page.getByLabel('Last name', { exact: true }).fill('');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByLabel('Last name', { exact: true })).toBeFocused();
    const accountRules = (await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations.map(row => row.id);
    await test.step('Account accessibility rules: ' + (accountRules.join(', ') || 'none'), async () => expect(accountRules).toEqual([]));
    const width = await page.getByLabel('First name', { exact: true }).evaluate(el => el.getBoundingClientRect().height); expect(width).toBeGreaterThanOrEqual(44);
  } finally { await context.close(); }
});
