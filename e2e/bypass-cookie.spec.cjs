const { test, expect } = require('@playwright/test');
const { staging } = require('../deployment/staging-target.cjs');
const { bootstrapBypassCookie } = require('./vercel-bypass.cjs');

test('automation cookies are HttpOnly and confined to the staging host without global secret headers', async ({ browser }) => {
  // Provider transport is simulated; all browser URLs are fulfilled locally by
  // routing. This regression never contacts Vercel or needs a real credential.
  const origin = staging.frontendOrigin, host = new URL(origin).hostname;
  const secret = 'synthetic-bypass', jwt = 'synthetic-issued-provider-cookie';
  const contexts = [];
  try {
    for (let user = 0; user < 2; user++) {
      const context = await browser.newContext(); contexts.push(context);
      let bootstraps = 0;
      await bootstrapBypassCookie({ addCookies: values => context.addCookies(values), clearCookies: options => context.clearCookies(options),
        request: { get: async () => ({ status: () => 200, headers: () => ({ 'content-type': 'text/html' }),
          text: async () => '<div id="root"></div><script src="/static/js/main.test.js"></script>' }) } }, origin, secret, async () => ({
        get: async (url, options) => {
          bootstraps++;
          expect(url === origin + '/' && options.maxRedirects === 0).toBe(true);
          expect(options.headers['x-vercel-protection-bypass'] === secret && options.headers['x-vercel-set-bypass-cookie'] === 'true').toBe(true);
          return { status: () => 200 };
        },
        storageState: async () => ({ cookies: [{ name: '_vercel_jwt', value: jwt, domain: host, path: '/', secure: true, httpOnly: true, expires: -1 }] }),
        dispose: async () => {}
      }));
      expect(bootstraps).toBe(1);
      const observed = [];
      await context.route('**/*', async route => {
        const url = new URL(route.request().url()), headers = await route.request().allHeaders();
        const providerCookie = (headers.cookie || '').includes('_vercel_jwt=' + jwt);
        const bypassHeader = Object.keys(headers).some(name => name.startsWith('x-vercel-protection-bypass') || name === 'x-vercel-set-bypass-cookie');
        expect(bypassHeader).toBe(false);
        if (url.origin !== origin) expect(providerCookie).toBe(false);
        if (route.request().resourceType() === 'document') observed.push({ target: url.origin === origin ? 'staging' : 'other', providerCookie, bypassHeader });
        await route.fulfill({ status: 200, contentType: 'text/html', body: '<div id="root">Cookie scope regression</div>' });
      });
      const page = await context.newPage();
      await page.goto(origin + '/');
      expect(await page.evaluate(() => document.cookie.includes('_vercel_jwt'))).toBe(false);
      await page.goto(staging.productionFrontendOrigin + '/');
      await page.goto('https://unrelated.example.invalid/');
      expect(observed).toEqual([{ target: 'staging', providerCookie: true, bypassHeader: false },
        { target: 'other', providerCookie: false, bypassHeader: false }, { target: 'other', providerCookie: false, bypassHeader: false }]);
      const cookies = await context.cookies(origin);
      expect(cookies.some(cookie => cookie.name === '_vercel_jwt' && cookie.domain === host && cookie.secure && cookie.httpOnly)).toBe(true);
    }
  } finally { for (const context of contexts) await context.close(); }
});
