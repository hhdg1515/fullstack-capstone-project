const { test } = require('node:test');
const assert = require('node:assert/strict');
const { inspectHttps, health, HttpsPreflightError } = require('./https-preflight.cjs');
const origin = 'https://approved-staging.example.invalid', fingerprint = 'a'.repeat(64);
const json = (status, body, extra = {}) => new Response(JSON.stringify(body), { status, headers: {
  'content-type': 'application/json; charset=utf-8', 'cache-control': 'private, no-store',
  'access-control-allow-origin': origin, 'access-control-allow-credentials': 'true', ...extra } });
const html = text => new Response(text || '<div id="root"></div><script src="/static/js/main.test.js"></script>', { headers: { 'content-type': 'text/html; charset=utf-8' } });
function healthy(url, options) {
  if (url.endsWith('/api/health')) return options.headers['X-Deployment-Target'] !== fingerprint ? json(409, { error: { code: 'DEPLOYMENT_CHANGED' } }) :
    json(200, { status: 'ready', environment: 'staging', databaseFingerprint: fingerprint });
  if (url.endsWith('/api/me')) return json(401, { error: { code: 'UNAUTHENTICATED' } });
  return html();
}

test('all original GET checks pass before an APP_ORIGIN change; exact configured Origin is required only afterward', async () => {
  const calls = [];
  const request = async (url, options) => {
    calls.push({ url, options });
    assert.equal(options.method, 'GET'); assert.equal(options.credentials, 'omit'); assert.equal(options.redirect, 'manual');
    assert.ok(!Object.keys(options.headers).some(name => /authorization|cookie|bypass/i.test(name)));
    return url.endsWith('/api/me') ? json(401, { error: { code: 'UNAUTHENTICATED' } }, { 'access-control-allow-origin': 'https://old.example.invalid' }) : healthy(url, options);
  };
  assert.equal((await health(origin, fingerprint, request, { phase: 'before_origin' })).configuredOrigin, false);
  assert.equal(calls.length, 5); assert.ok(calls.every(call => !call.options.headers.Origin));
  await assert.rejects(health(origin, fingerprint, request), error => {
    assert.equal(error.diagnostic.check, 'anonymous_me.configured_origin'); assert.equal(error.diagnostic.category, 'app_origin_mismatch');
    assert.equal(error.results.length, 5); return true;
  });
  assert.equal(calls.at(-1).options.headers.Origin, origin);
});

test('each assertion is diagnosed despite Vercel protection redirects and no redirect or private body is followed/read', async () => {
  let calls = 0;
  const request = async () => {
    calls++;
    return { status: 302, headers: new Headers({ 'content-type': 'text/html', 'cache-control': 'private, no-store',
      location: 'https://vercel.com/sso-api?private-token=secret', 'set-cookie': 'private-session=secret', authorization: 'private-secret' }),
    text: () => { assert.fail('Do not read redirect bodies'); } };
  };
  const result = await inspectHttps(origin, fingerprint, request);
  assert.equal(calls, 5); assert.equal(result.passed, false);
  assert.ok(result.results.every(value => value.status === 302 && value.category === 'deployment_protection_redirect'));
  assert.ok(!/secret|set-cookie|sso-api|authorization/.test(JSON.stringify(result)));
  await assert.rejects(health(origin, fingerprint, request), error => error instanceof HttpsPreflightError &&
    error.diagnostic.check === 'react_homepage.redirect' && !/secret|sso-api/.test(error.message));
});

test('status, content type, no-store, cached API, fingerprint, readiness, anonymous auth and React markup have precise failure names', async () => {
  for (const [path, replacement, check, category] of [
    ['/', () => new Response('private', { status: 503 }), 'react_homepage.status', 'unexpected_status'],
    ['/app/items', () => html('<html>private-login-page</html>'), 'react_deep_link.react_markup', 'unexpected_html_application'],
    ['/api/health', () => html('private-html-body'), 'health_wrong_fingerprint.content_type', 'html_instead_of_json'],
    ['/api/health', () => json(409, { error: { code: 'WRONG' } }), 'health_wrong_fingerprint.target_fence', 'deployment_fence_mismatch'],
    ['/api/health', () => json(409, { error: { code: 'DEPLOYMENT_CHANGED' } }, { 'cache-control': 'public, max-age=600' }), 'health_wrong_fingerprint.cache_control', 'missing_no_store'],
    ['/api/health', () => json(409, { error: { code: 'DEPLOYMENT_CHANGED' } }, { 'x-vercel-cache': 'HIT' }), 'health_wrong_fingerprint.edge_cache', 'cached_api_response'],
    ['/api/health', () => new Response('private-malformed-json', { status: 409, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } }), 'health_wrong_fingerprint.json_body', 'invalid_json'],
    ['/api/me', () => json(401, { error: { code: 'WRONG' } }), 'anonymous_me.anonymous_auth', 'anonymous_auth_response_mismatch']
  ]) {
    const inspected = await inspectHttps(origin, fingerprint, async (url, options) => new URL(url).pathname === path ? replacement() : healthy(url, options));
    assert.ok(inspected.results.flatMap(result => result.failures).some(failure => failure.check === check && failure.category === category), check);
    assert.ok(!/private-html-body|private-malformed-json|private-login-page/.test(JSON.stringify(inspected)));
  }
  const changed = await inspectHttps(origin, fingerprint, async (url, options) => url.endsWith('/api/health') && options.headers['X-Deployment-Target'] === fingerprint ?
    json(200, { status: 'ready', environment: 'production', databaseFingerprint: 'b'.repeat(64) }) : healthy(url, options));
  assert.equal(changed.results[3].failures[0].check, 'health_approved_fingerprint.staging_readiness');
});

test('TLS, DNS, timeouts and network exceptions never expose raw errors and do not hide remaining GET diagnostics', async () => {
  for (const [details, category] of [[{ cause: { code: 'CERT_HAS_EXPIRED' } }, 'tls_error'], [{ cause: { code: 'ENOTFOUND' } }, 'dns_error'],
    [{ name: 'TimeoutError' }, 'timeout'], [{ cause: { code: 'ECONNREFUSED' } }, 'network_error']]) {
    let calls = 0;
    const result = await inspectHttps(origin, fingerprint, async () => { calls++; throw Object.assign(new Error('private-token-cookie-url'), details); });
    assert.equal(calls, 5); assert.ok(result.results.every(value => value.status === null && value.category === category));
    assert.ok(!JSON.stringify(result).includes('private-token-cookie-url'));
  }
});

test('generic redirects, protection HTML and a deliberately wrong zero fingerprint remain distinguishable', async () => {
  const redirect = await inspectHttps(origin, fingerprint, async () => new Response(null, { status: 307, headers: { location: 'https://other.example.invalid/?private=secret' } }));
  assert.ok(redirect.results.every(result => result.category === 'http_redirect'));
  const protectedHtml = await inspectHttps(origin, fingerprint, async () => new Response('Authentication Required private-secret', { status: 401, headers: { 'content-type': 'text/html' } }));
  assert.ok(protectedHtml.results.every(result => result.category === 'deployment_protection_html'));
  const zero = '0'.repeat(64); let fence;
  await inspectHttps(origin, zero, async (url, options) => {
    if (url.endsWith('/api/health') && !fence) fence = options.headers['X-Deployment-Target'];
    return healthy(url, options);
  });
  assert.notEqual(fence, zero); assert.match(fence, /^[a-f0-9]{64}$/);
  let calls = 0;
  for (const [value, target, phase] of [['http://insecure.example.invalid', fingerprint, 'before_origin'], [origin, 'private-secret', 'before_origin'], [origin, fingerprint, 'unknown']]) {
    await assert.rejects(inspectHttps(value, target, async () => { calls++; }, { phase }));
  }
  assert.equal(calls, 0);
});
