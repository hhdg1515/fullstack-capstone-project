const { test, expect } = require('./fixtures.cjs');
test('frontend remains usable when the backend returns HTML', async ({ browser, deployment }) => {
  test.skip(!deployment.local, 'Fault injection is confined to the local proxy, never a deployed backend');
  const context = await browser.newContext({ ignoreHTTPSErrors: true }); const page = await context.newPage(); const errors = [];
  page.on('pageerror', error => errors.push(error.message)); deployment.setOnline(false);
  try {
    await page.goto(deployment.origin); await expect(page.getByRole('link', { name: 'Start Giving', exact: true })).toBeVisible();
    await page.getByRole('link', { name: 'Start Giving', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Unable to open this private page' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Retry connection' })).toBeVisible();
    deployment.setOnline(true); await page.getByRole('button', { name: 'Retry connection' }).click();
    await expect(page.getByRole('heading', { name: 'Login', exact: true })).toBeVisible(); expect(errors).toEqual([]);
  } finally { deployment.setOnline(true); await context.close(); }
});
