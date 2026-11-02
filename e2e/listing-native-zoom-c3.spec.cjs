// Native Chromium profile zoom, verified by CSS width, devicePixelRatio and
// unchanged outer window width. No CSS/pinch zoom or viewport emulation.
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { randomUUID } = require('node:crypto');
const { test, expect, chromium } = require('@playwright/test');
const AxeBuilder = require('@axe-core/playwright').default;
const { localEnvironment } = require('./local.cjs');
test('C3 native Chromium 200% zoom retains publication controls and reflow', async () => {
  if (process.env.E2E_APP_ORIGIN) throw Error('C3 native zoom is local only');
  let local, context;
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'moveout-native-zoom-'));
  try {
    // Chromium's native default storage-partition zoom preference. The "x"
    // key is its empty relative partition path (ChromeZoomLevelPrefs).
    // No extension, CSS zoom, device metrics override or pinch emulation.
    const profile = path.join(directory, 'profile'); fs.mkdirSync(path.join(profile, 'Default'), { recursive: true });
    fs.writeFileSync(path.join(profile, 'Default', 'Preferences'), JSON.stringify({ partition: { default_zoom_level: { x: Math.log(2) / Math.log(1.2) } } }));
    local = await localEnvironment({ ownerListings: true, ownerListingPickups: true, ownerListingPublication: true });
    context = await chromium.launchPersistentContext(profile, { headless: true, ignoreHTTPSErrors: true, viewport: null,
      ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } : { channel: 'chromium' }),
      args: ['--window-size=1280,1000'] });
    const response = await context.request.post(local.origin + '/api/auth/register', { headers: { Origin: local.origin, 'X-CSRF-Protection': '1' }, data: { firstName: 'Synthetic', lastName: 'Zoom', email: randomUUID() + '@example.test', password: randomUUID() + '!' } }); expect(response.status()).toBe(201);
    const page = await context.newPage(); await page.goto(local.origin + '/app/listings/new'); await page.getByLabel('Item name').fill('Synthetic zoom listing');
    const metrics = await page.evaluate(() => ({ cssWidth: innerWidth, devicePixelRatio, outerWidth }));
    expect(metrics.outerWidth).toBe(1280); expect(metrics.devicePixelRatio).toBe(2); expect(metrics.cssWidth).toBe(640);
    expect(await page.evaluate(() => matchMedia('(max-width: 700px)').matches)).toBe(true);
    await page.getByRole('button', { name: 'Save Draft', exact: true }).last().focus(); await expect(page.getByRole('button', { name: 'Save Draft', exact: true }).last()).toBeFocused();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    const violations = (await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations.map(row=>row.id); expect(violations).toEqual([]);
    if (process.env.C3_EVIDENCE_DIR) { fs.mkdirSync(process.env.C3_EVIDENCE_DIR, {recursive:true}); const session = await context.newCDPSession(page); const capture = await session.send('Page.captureScreenshot', { format:'png', captureBeyondViewport:false, fromSurface:true }); fs.writeFileSync(path.join(process.env.C3_EVIDENCE_DIR,'native-200-percent-form.png'), Buffer.from(capture.data,'base64'));
      // Playwright fullPage temporarily overrides viewport metrics; use the
      // browser's viewport capture so native zoom/reflow is preserved.
      expect(await page.evaluate(() => ({width:innerWidth,dpr:devicePixelRatio}))).toEqual({width:640,dpr:2}); }
  } finally { if (context) await context.close(); if (local) await local.close(); fs.rmSync(directory,{recursive:true,force:true}); }
});
