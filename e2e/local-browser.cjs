const { test: base, expect, chromium } = require('@playwright/test');

// Docker changes host interfaces while provisioning disposable services. A
// worker-wide browser may retain the old network generation. Start each local
// browser after its actual deployment is ready, and close it before teardown.
async function withLocalBrowser(deployment, browserType, options, use) {
  const target = new URL(deployment.origin);
  if (deployment.local !== true || target.protocol !== 'https:' ||
      !['127.0.0.1', 'localhost', '[::1]'].includes(target.hostname) ||
      target.username || target.password || target.pathname !== '/' || target.search || target.hash) {
    throw Error('Local browser requires a verified loopback HTTPS deployment');
  }
  const browser = await browserType.launch(options);
  try { await use(browser); } finally { await browser.close(); }
}

const test = base.extend({
  // Hosted runs retain the stock browser and all existing authorization/bypass
  // fixtures. This helper never provisions or connects to a remote target.
  isolatedBrowser: process.env.E2E_APP_ORIGIN ? async ({ browser }, use) => use(browser) :
    async ({ deployment, playwright, browserName, launchOptions, headless, channel }, use) => {
      await withLocalBrowser(deployment, playwright[browserName], { ...launchOptions, headless, ...(channel ? { channel } : {}) }, use);
    }
});
module.exports = { test, expect, chromium, withLocalBrowser };
