const { staging } = require('../deployment/staging-target.cjs');

class AutomationBypassError extends Error {
  constructor(category) {
    super('Vercel automation access failed (' + category + '). Check the isolated-e2e secret and frontend project scope privately.');
    this.category = category;
  }
}
function assertBypass(origin, secret) {
  if (origin !== staging.frontendOrigin) throw new AutomationBypassError('bypass_target_refused');
  if (!secret) throw new AutomationBypassError('bypass_secret_missing');
  if (typeof secret !== 'string' || !/^[\x21-\x7e]{1,1024}$/.test(secret)) throw new AutomationBypassError('bypass_secret_invalid_format');
}
function assertPrivateAutomation(env) {
  if (env.DEBUG || env.PWDEBUG || env.NODE_DEBUG || env.NODE_DEBUG_NATIVE) throw new AutomationBypassError('bypass_debug_logging_refused');
}
function withoutBypassSecret(env) {
  const clean = { ...env }; delete clean.VERCEL_AUTOMATION_BYPASS_SECRET; return clean;
}

function bypassRequest(origin, secret, request = fetch) {
  assertBypass(origin, secret);
  const scoped = async (value, options = {}) => {
    let url;
    try { url = new URL(value); } catch { throw new AutomationBypassError('bypass_target_refused'); }
    if (url.origin !== origin || url.username || url.password || url.search || url.hash ||
        !['/', '/app/items', '/api/health', '/api/me'].includes(url.pathname) ||
        (options.method && options.method !== 'GET') || options.body !== undefined) throw new AutomationBypassError('bypass_target_refused');
    const headers = new Headers(options.headers);
    if ([...headers.keys()].some(name => !['origin', 'x-deployment-target'].includes(name))) throw new AutomationBypassError('bypass_headers_refused');
    headers.set('x-vercel-protection-bypass', secret);
    // Never follow a redirect with a project-scoped credential, even to another
    // URL in this project. The secret is never a URL or global browser header.
    return request(url.href, { ...options, method: 'GET', credentials: 'omit', redirect: 'manual', headers });
  };
  Object.defineProperty(scoped, 'usesVercelBypass', { value: true });
  return scoped;
}

async function bootstrapBypassCookie(context, origin, secret, newRequestContext) {
  assertBypass(origin, secret);
  let transport, installed = false;
  try {
    const create = newRequestContext || (options => require('@playwright/test').request.newContext(options));
    transport = await create({ ignoreHTTPSErrors: false, timeout: 15000 });
    const response = await transport.get(origin + '/', { maxRedirects: 0, failOnStatusCode: false,
      headers: { 'x-vercel-protection-bypass': secret, 'x-vercel-set-bypass-cookie': 'true' } });
    const status = response.status();
    if (status !== 200 && ![301, 302, 303, 307, 308].includes(status)) throw new AutomationBypassError('bypass_cookie_bootstrap_rejected');
    if (status !== 200) {
      const location = response.headers().location;
      if (!location || new URL(location, origin).origin !== origin) throw new AutomationBypassError('bypass_cookie_bootstrap_rejected');
    }
    // In-memory API storage only; never pass a path to storageState or retain
    // provider response bodies/headers. Import only the server-issued JWT.
    const state = await transport.storageState();
    const host = new URL(origin).hostname;
    const cookie = state.cookies.find(value => value.name === '_vercel_jwt' && value.value &&
      [host, '.' + host].includes(value.domain) && value.path === '/' && value.secure && value.httpOnly &&
      (value.expires === -1 || value.expires > Date.now() / 1000));
    if (!cookie) throw new AutomationBypassError('bypass_cookie_missing_or_unsafe');
    await context.addCookies([{ name: '_vercel_jwt', value: cookie.value, url: origin + '/',
      httpOnly: true, secure: true, sameSite: 'Lax', expires: cookie.expires }]);
    installed = true;
    // Verify the cookie itself works, with no bypass header and no redirect.
    const page = await context.request.get(origin + '/', { maxRedirects: 0, failOnStatusCode: false, timeout: 15000 });
    if (page.status() !== 200 || !page.headers()['content-type']?.includes('text/html')) throw new AutomationBypassError('bypass_cookie_rejected');
    const html = await page.text();
    if (!/<div\s+id=["']root["']/.test(html) || !/<script\b[^>]*\bsrc=["'][^"']*\/static\/js\//.test(html)) throw new AutomationBypassError('bypass_cookie_rejected');
  } catch (error) {
    if (installed) await context.clearCookies({ name: '_vercel_jwt' }).catch(() => {});
    throw error instanceof AutomationBypassError ? error : new AutomationBypassError('bypass_cookie_transport_failed');
  } finally { if (transport) await transport.dispose().catch(() => {}); }
}
module.exports = { AutomationBypassError, assertBypass, assertPrivateAutomation, withoutBypassSecret, bypassRequest, bootstrapBypassCookie };
