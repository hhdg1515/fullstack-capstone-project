const AxeBuilder = require('@axe-core/playwright').default;
const { test, expect } = require('./fixtures.cjs');
test.skip(Boolean(process.env.E2E_APP_ORIGIN), 'Readiness fault/accessibility checks use only the isolated local stack');

test('public/account pages have no automated WCAG A/AA violations and support keyboard navigation', async ({ browser, deployment }, testInfo) => {
  const options = { ...testInfo.project.use, ignoreHTTPSErrors: true };
  delete options.launchOptions; delete options.trace; delete options.screenshot; delete options.video;
  const context = await browser.newContext(options), page = await context.newPage();
  try {
    for (const route of ['/', '/app/items', '/app/login', '/app/register']) {
      await page.goto(deployment.origin + route);
      await expect(page.getByText('Checking session…', { exact: true })).toHaveCount(0);
      const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
      const rules = results.violations.map(value => value.id).join(', ') || 'none';
      await test.step('Accessibility ' + route + ' rules: ' + rules, async () => { expect(results.violations.length).toBe(0); });
      if (route === '/app/items') {
        await page.getByLabel('State', { exact: true }).selectOption('06');
        await page.getByLabel('Metro area', { exact: true }).selectOption('41860');
        const filters = page.getByRole('button', { name: /^Filters/ });
        await expect(filters).toHaveAttribute('aria-expanded', 'false'); await filters.click();
        const expanded = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
        const expandedRules = expanded.violations.map(value => value.id).join(', ') || 'none';
        await test.step('Accessibility expanded discovery filters rules: ' + expandedRules, async () => { expect(expanded.violations.length).toBe(0); });
        await filters.click();
      }
    }
    await page.goto(deployment.origin + '/');
    await page.keyboard.press('Tab');
    await expect(page.getByRole('link', { name: 'Skip to main content', exact: true })).toBeFocused();
    await page.keyboard.press('Enter'); await expect(page.locator('#main-content')).toBeFocused();
    const menu = page.getByRole('button', { name: /^(Menu|Close menu)$/ });
    if (await menu.isVisible()) {
      await menu.focus(); await page.keyboard.press('Enter'); await expect(menu).toHaveAttribute('aria-expanded', 'true');
      await page.keyboard.press('Escape'); await expect(menu).toHaveAttribute('aria-expanded', 'false'); await expect(menu).toBeFocused();
    }
  } finally { await context.close(); }
});
