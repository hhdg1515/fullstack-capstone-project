const { defineConfig, devices } = require('@playwright/test');
if (process.env.E2E_APP_ORIGIN) require('./vercel-bypass.cjs').assertPrivateAutomation(process.env);
module.exports = defineConfig({
  testDir: '.', testMatch: '*.spec.cjs', timeout: 300000, expect: { timeout: 15000 }, workers: 1, retries: 0,
  reporter: [['./safe-reporter.cjs']], outputDir: 'test-results',
  use: { trace: 'off', screenshot: 'off', video: 'off',
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } : {} },
  projects: [
    { name: 'desktop', use: { viewport: { width: 1440, height: 1000 } } },
    // Dedicated B3 F2/F3 reflow checks run at 1440/320/375 in desktop Chromium.
    // F1/F4 and every baseline spec also retain independent mobile emulation.
    { name: 'mobile', testIgnore: ['listing-form-f2.spec.cjs', 'listing-lifecycle-f3.spec.cjs'], use: { ...devices['Pixel 7'] } }
  ]
});
