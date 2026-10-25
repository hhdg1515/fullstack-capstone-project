const { test } = require('node:test');
const assert = require('node:assert/strict');
const { staging } = require('../deployment/staging-target.cjs');
const { bypassRequest, bootstrapBypassCookie, AutomationBypassError, assertPrivateAutomation, withoutBypassSecret } = require('./vercel-bypass.cjs');
const { inspectHttps, health } = require('./https-preflight.cjs');
const origin = staging.frontendOrigin, secret = 'synthetic-private-bypass';
const host = new URL(origin).hostname;
const issued = { name: '_vercel_jwt', value: 'synthetic-provider-jwt', domain: host, path: '/', secure: true, httpOnly: true, sameSite: 'Lax', expires: -1 };
const html = '<div id="root"></div><script src="/static/js/main.test.js"></script>';

test('missing/malformed secrets, production/API/foreign origins and unapproved request targets are refused before sending credentials', async () => {
  for (const [target, credential, category] of [[origin, '', 'bypass_secret_missing'], [origin, 'private\nsecret', 'bypass_secret_invalid_format'],
    [staging.productionFrontendOrigin, secret, 'bypass_target_refused'], [staging.apiOrigin, secret, 'bypass_target_refused'],
    ['https://foreign.vercel.app', secret, 'bypass_target_refused']]) {
    assert.throws(() => bypassRequest(target, credential), error => error.category === category && !error.message.includes(credential || 'absent-value'));
  }
  let calls = 0; const request = bypassRequest(origin, secret, async () => { calls++; });
  for (const [url, options] of [[staging.productionFrontendOrigin + '/', {}], [staging.apiOrigin + '/api/health', {}],
    [origin + ':444/', {}], [origin + '/?secret=private', {}], [origin + '/api/auth/login', { method: 'POST', body: '{}' }],
    [origin + '/', { headers: { Cookie: 'private' } }], [origin + '/', { headers: { Authorization: 'private' } }]]) await assert.rejects(request(url, options));
  assert.equal(calls, 0);
});

test('preflight sends only a scoped bypass header, preserves target/Origin, and cannot follow redirects or set cookies', async () => {
  const response = new Response(null, { status: 302, headers: { location: 'https://vercel.com/sso-api?private=secret' } });
  let calls = 0;
  const request = bypassRequest(origin, secret, async (url, options) => {
    calls++; assert.equal(url, origin + '/api/me'); assert.equal(options.method, 'GET');
    assert.equal(options.redirect, 'manual'); assert.equal(options.credentials, 'omit');
    assert.equal(options.headers.get('x-vercel-protection-bypass'), secret);
    assert.equal(options.headers.get('x-deployment-target'), staging.fingerprint); assert.equal(options.headers.get('origin'), origin);
    assert.equal(options.headers.get('x-vercel-set-bypass-cookie'), null); return response;
  });
  assert.equal(await request(origin + '/api/me', { redirect: 'follow', headers: { Origin: origin, 'X-Deployment-Target': staging.fingerprint } }), response);
  assert.equal(calls, 1);
});

test('invalid credentials remain a precise sanitized preflight failure without relaxing JSON/fingerprint/auth checks', async () => {
  const rejected = bypassRequest(origin, secret, async () => new Response(null, { status: 302, headers: { location: 'https://vercel.com/sso-api?private=secret' } }));
  const result = await inspectHttps(origin, staging.fingerprint, rejected);
  assert.ok(result.results.every(value => value.category === 'automation_bypass_rejected'));
  assert.ok(!/synthetic-private|sso-api|private=secret/.test(JSON.stringify(result)));
  await assert.rejects(health(origin, staging.fingerprint, rejected), error => error.diagnostic.category === 'automation_bypass_rejected' && !error.message.includes(secret));
  const htmlRejected = await inspectHttps(origin, staging.fingerprint, bypassRequest(origin, secret, async () =>
    new Response('Authentication Required private-token=' + secret, { status: 401, headers: { 'content-type': 'text/html' } })));
  assert.ok(htmlRejected.results.every(value => value.category === 'automation_bypass_rejected'));
  assert.ok(!JSON.stringify(htmlRejected).includes(secret));
  const accepted = bypassRequest(origin, secret, async (url, options) => {
    if (!url.includes('/api/')) return new Response(html, { headers: { 'content-type': 'text/html' } });
    const wrong = options.headers.get('x-deployment-target') !== staging.fingerprint;
    const body = url.endsWith('/api/me') ? { error: { code: 'UNAUTHENTICATED' } } : wrong ? { error: { code: 'DEPLOYMENT_CHANGED' } } :
      { status: 'ready', environment: 'staging', databaseFingerprint: staging.fingerprint };
    return new Response(JSON.stringify(body), { status: url.endsWith('/api/me') ? 401 : wrong ? 409 : 200,
      headers: { 'content-type': 'application/json', 'cache-control': 'private, no-store', 'access-control-allow-origin': origin, 'access-control-allow-credentials': 'true' } });
  });
  assert.equal((await health(origin, staging.fingerprint, accepted)).targetFence, true);
});

function cookieFixture({ cookie = issued, status = 200, location, verifiedStatus = 200, throws = false } = {}) {
  const calls = [], installed = []; let disposed = false, cleared = false;
  return { calls, installed, get disposed() { return disposed; }, get cleared() { return cleared; },
    context: { addCookies: async values => installed.push(...values), clearCookies: async () => { cleared = true; },
      request: { get: async (url, options) => { calls.push({ kind: 'cookie-only', url, options }); return { status: () => verifiedStatus, headers: () => ({ 'content-type': 'text/html' }), text: async () => html }; } } },
    create: async options => {
      assert.equal(options.ignoreHTTPSErrors, false);
      return { get: async (url, settings) => {
        calls.push({ kind: 'bootstrap', url, options: settings });
        if (throws) throw Error('private-token=' + secret);
        return { status: () => status, headers: () => ({ location }) };
      }, storageState: async (...args) => { assert.equal(args.length, 0); return { cookies: cookie ? [cookie] : [], origins: [] }; },
      dispose: async () => { disposed = true; } };
    } };
}

test('cookie bootstrap uses supported header directives once, imports the issued JWT as a host-only cookie and verifies cookie-only access', async () => {
  const f = cookieFixture({ status: 307, location: '/' });
  await bootstrapBypassCookie(f.context, origin, secret, f.create);
  assert.equal(f.calls.length, 2); assert.equal(f.calls[0].url, origin + '/'); assert.equal(f.calls[0].options.maxRedirects, 0);
  assert.deepEqual(f.calls[0].options.headers, { 'x-vercel-protection-bypass': secret, 'x-vercel-set-bypass-cookie': 'true' });
  assert.equal(f.calls[1].options.headers, undefined); assert.equal(f.calls[1].options.maxRedirects, 0);
  assert.deepEqual(f.installed, [{ name: '_vercel_jwt', value: issued.value, url: origin + '/', secure: true, httpOnly: true, sameSite: 'Lax', expires: -1 }]);
  assert.equal(f.disposed, true); assert.equal(f.cleared, false);
});

test('cookie bootstrap rejects provider login redirects, unsafe/missing cookies and raw transport errors; rejected installed cookies are removed', async () => {
  for (const options of [{ status: 302, location: 'https://vercel.com/sso-api?token=private' }, { status: 401 }, { cookie: null },
    { cookie: { ...issued, domain: '.vercel.app' } }, { cookie: { ...issued, domain: new URL(staging.productionFrontendOrigin).hostname } },
    { cookie: { ...issued, secure: false } }, { cookie: { ...issued, httpOnly: false } }, { cookie: { ...issued, path: '/other' } },
    { cookie: { ...issued, expires: 1 } }, { throws: true }, { verifiedStatus: 302 }]) {
    const f = cookieFixture(options);
    await assert.rejects(bootstrapBypassCookie(f.context, origin, secret, f.create), error => error instanceof AutomationBypassError && !error.message.includes(secret));
    assert.equal(f.disposed, true); if (options.verifiedStatus) assert.equal(f.cleared, true);
  }
});

test('bypass credentials are removed from CLI subprocesses and debug logging cannot expose remote automation credentials', () => {
  const env = { VERCEL_AUTOMATION_BYPASS_SECRET: secret, VERCEL_TOKEN: 'synthetic-management', PATH: '/task/bin' };
  const clean = withoutBypassSecret(env);
  assert.equal(clean.VERCEL_AUTOMATION_BYPASS_SECRET, undefined); assert.equal(clean.VERCEL_TOKEN, env.VERCEL_TOKEN); assert.equal(env.VERCEL_AUTOMATION_BYPASS_SECRET, secret);
  assert.throws(() => assertPrivateAutomation({ DEBUG: 'pw:*' }), /bypass_debug_logging_refused/);
  assert.throws(() => assertPrivateAutomation({ PWDEBUG: '1' }), /bypass_debug_logging_refused/);
  assert.throws(() => assertPrivateAutomation({ NODE_DEBUG: 'http' }), /bypass_debug_logging_refused/);
  assertPrivateAutomation({});
});

test('the diagnostic CLI records missing/invalid credential categories without HTTP, secrets or unsafe artifacts', () => {
  const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
  const { spawnSync } = require('node:child_process');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'bypass-diagnostic-'));
  try {
    for (const relative of ['deployment/staging-https-diagnostics.cjs', 'deployment/staging-preview.cjs', 'deployment/staging-target.cjs',
      'deployment/frontend-config.cjs', 'deployment/vercel-api.cjs', 'e2e/https-preflight.cjs', 'e2e/vercel-bypass.cjs']) {
      const destination = path.join(directory, relative); fs.mkdirSync(path.dirname(destination), { recursive: true });
      fs.copyFileSync(path.join(__dirname, '..', relative), destination);
    }
    const marker = path.join(directory, 'http-attempted');
    const preload = path.join(directory, 'refuse-network.cjs');
    fs.writeFileSync(preload, 'global.fetch = async () => { require("node:fs").writeFileSync(' + JSON.stringify(marker) + ', "attempted"); throw Error("Network forbidden"); };');
    for (const [credential, category] of [['', 'bypass_secret_missing'], ['synthetic-private\ninvalid', 'bypass_secret_invalid_format']]) {
      const child = spawnSync(process.execPath, ['--require', preload, path.join(directory, 'deployment/staging-https-diagnostics.cjs')], {
        encoding: 'utf8', env: { GITHUB_REPOSITORY: 'hhdg1515/fullstack-capstone-project', GITHUB_EVENT_NAME: 'workflow_dispatch',
          GITHUB_REF: 'refs/heads/diagnostic', GITHUB_SHA: 'a'.repeat(40), APPROVED_SHA: 'a'.repeat(40), STAGING_OPERATION: 'diagnose-https',
          STAGING_FRONTEND_ORIGIN: origin, VERCEL_AUTOMATION_BYPASS_SECRET: credential } });
      assert.equal(child.status, 1); assert.equal(fs.existsSync(marker), false);
      const file = path.join(directory, 'deployment/generated/staging-https-diagnostics.json');
      const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
      assert.equal(saved.credentialFailure.category, category);
      assert.equal(fs.statSync(file).mode & 0o777, 0o600);
      assert.ok(!/synthetic-private|invalid\\n/.test(child.stdout + child.stderr + JSON.stringify(saved)));
    }
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});
