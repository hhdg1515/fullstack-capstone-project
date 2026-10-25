const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { staging } = require('./staging-target.cjs');
const { settings, preparePreview, vercelApi, inspect, diagnosticReporter, deploy } = require('./staging-preview.cjs');
const origin = staging.frontendOrigin;
const env = { GITHUB_REPOSITORY: 'hhdg1515/fullstack-capstone-project', GITHUB_EVENT_NAME: 'workflow_dispatch',
  GITHUB_REF: 'refs/heads/main', GITHUB_SHA: 'a'.repeat(40), APPROVED_SHA: 'a'.repeat(40), STAGING_OPERATION: 'plan', STAGING_FRONTEND_ORIGIN: origin };
test('staging deployment planning needs no credentials; deployment requires an exact manual main approval and token', () => {
  assert.equal(settings(env).operation, 'plan');
  assert.equal(settings({ ...env, STAGING_OPERATION: 'deploy', VERCEL_TOKEN: 'synthetic-token', VERCEL_AUTOMATION_BYPASS_SECRET: 'synthetic-bypass' }).operation, 'deploy');
  for (const change of [{ STAGING_OPERATION: 'deploy' }, { STAGING_OPERATION: 'production' }, { GITHUB_REF: 'refs/heads/feature' },
    { GITHUB_EVENT_NAME: 'push' }, { GITHUB_REPOSITORY: 'other/repo' }, { APPROVED_SHA: 'b'.repeat(40) }, { APPROVED_SHA: '' },
    { STAGING_FRONTEND_ORIGIN: staging.productionFrontendOrigin }, { STAGING_FRONTEND_ORIGIN: staging.apiOrigin },
    { STAGING_FRONTEND_ORIGIN: 'https://custom.example.com' }, { STAGING_FRONTEND_ORIGIN: origin + '/path' }]) assert.throws(() => settings({ ...env, ...change }));
});
test('deployment requires scoped bypass credentials before it can reach any remote mutation', () => {
  const approved = { ...env, STAGING_OPERATION: 'deploy', VERCEL_TOKEN: 'synthetic-token', VERCEL_AUTOMATION_BYPASS_SECRET: 'synthetic-bypass' };
  for (const [changes, category] of [[{ VERCEL_AUTOMATION_BYPASS_SECRET: '' }, 'bypass_secret_missing'],
    [{ VERCEL_AUTOMATION_BYPASS_SECRET: 'private\nsecret' }, 'bypass_secret_invalid_format'], [{ DEBUG: 'pw:*' }, 'bypass_debug_logging_refused']]) {
    assert.throws(() => settings({ ...approved, ...changes }), error => error.category === category);
  }
  assert.throws(() => settings({ ...approved, STAGING_FRONTEND_ORIGIN: 'https://another-staging.vercel.app' }), /existing approved staging alias/);
});
test('prebuilt preview uses the reviewed host-conditional proxy and only compiled assets, without installing active production configuration', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'staging-output-'));
  try {
    fs.mkdirSync(path.join(directory, 'build')); fs.writeFileSync(path.join(directory, 'build/index.html'), '<div id="root"></div>');
    fs.writeFileSync(path.join(directory, '.env'), 'private-value');
    preparePreview(directory, origin);
    const config = JSON.parse(fs.readFileSync(path.join(directory, '.vercel/output/config.json'), 'utf8'));
    assert.equal(config.version, 3); assert.equal(config.routes[0].dest, staging.apiOrigin + '/api/$1');
    assert.deepEqual(config.routes[0].has, [{ type: 'host', value: new URL(origin).hostname }]);
    for (const hostname of [new URL(staging.productionFrontendOrigin).hostname, 'unrelated-preview.vercel.app']) assert.notEqual(config.routes[0].has[0].value, hostname);
    assert.equal(config.routes[1].status, 503); assert.equal(config.routes[2].handle, 'filesystem'); assert.equal(config.routes[3].dest, '/index.html');
    assert.ok(!fs.existsSync(path.join(directory, 'vercel.json'))); assert.ok(!fs.existsSync(path.join(directory, '.vercel/output/static/.env')));
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(directory, '.vercel/project.json'), 'utf8')), { projectId: staging.frontendProjectId, orgId: staging.teamId });
    fs.writeFileSync(path.join(directory, '.vercel/project.json'), JSON.stringify({ projectId: 'other', orgId: staging.teamId }));
    assert.throws(() => preparePreview(directory, origin), /different local project/);
    assert.throws(() => preparePreview(directory, staging.productionFrontendOrigin));
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});
function fixture(override = () => undefined) {
  const calls = [], phases = []; let cliCalls = 0, checks = 0, redeployed = false;
  const api = async (method, url, body) => {
    calls.push({ method, url, body }); const changed = override(method, url, body);
    if (changed !== undefined) return changed;
    if (url === '/v9/projects/' + staging.frontendProjectId) return { id: staging.frontendProjectId, accountId: staging.teamId, name: 'fullstack-capstone-project', rootDirectory: 'giftlink-frontend' };
    if (url === '/v9/projects/' + staging.backendProjectId) return { id: staging.backendProjectId, accountId: staging.teamId, name: 'fullstack-capstone-project-vkwm', rootDirectory: 'giftlink-backend', nodeVersion: '22.x' };
    if (url.endsWith(new URL(staging.productionFrontendOrigin).hostname)) return { projectId: staging.frontendProjectId, target: 'production', alias: [new URL(staging.productionFrontendOrigin).hostname] };
    if (url.endsWith(new URL(staging.apiOrigin).hostname)) return { id: redeployed ? 'dpl_new_api' : 'dpl_previous_api', projectId: staging.backendProjectId, target: 'production', readyState: 'READY' };
    if (url.startsWith('/v4/aliases/')) return null;
    if (url.endsWith('preview-example.vercel.app')) return { id: 'dpl_preview', projectId: staging.frontendProjectId, target: null, readyState: 'READY' };
    if (method === 'POST' && url.startsWith('/v13/deployments?')) { redeployed = true; return { id: 'dpl_new_api', projectId: staging.backendProjectId }; }
    if (url.endsWith('/dpl_new_api')) return { projectId: staging.backendProjectId, target: 'production', readyState: 'READY' };
    return {};
  };
  return { calls, phases, options: { origin, api, cli: async () => { cliCalls++; return 'https://preview-example.vercel.app'; },
    preflight: async (value, fingerprint) => { checks++; assert.equal(value, origin); assert.equal(fingerprint, staging.fingerprint); return { tls: true }; },
    record: value => phases.push(value.phase), pause: async () => {} }, get cliCalls() { return cliCalls; }, get checks() { return checks; } };
}
test('prebuilt monorepo output is available from the repo root and configured frontend root without changing provider root settings', () => {
  const repository = fs.mkdtempSync(path.join(os.tmpdir(), 'staging-monorepo-'));
  const frontend = path.join(repository, 'giftlink-frontend');
  try {
    fs.mkdirSync(path.join(frontend, 'build'), { recursive: true });
    fs.writeFileSync(path.join(frontend, 'build/index.html'), '<div id="root"></div>');
    preparePreview(frontend, origin);
    preparePreview(repository, origin, { assets: path.join(frontend, 'build') });
    for (const relative of ['.vercel/project.json', '.vercel/output/config.json', '.vercel/output/static/index.html']) {
      assert.equal(fs.readFileSync(path.join(repository, relative), 'utf8'), fs.readFileSync(path.join(frontend, relative), 'utf8'));
    }
    assert.ok(fs.existsSync(path.join(repository, 'giftlink-frontend')));
    assert.ok(!fs.existsSync(path.join(repository, 'vercel.json')));
  } finally { fs.rmSync(repository, { recursive: true, force: true }); }
});
test('deployment mutates only the test alias and dedicated staging API, after validating existing projects and public routing', async () => {
  const f = fixture(); const receipt = await deploy(f.options);
  assert.equal(f.cliCalls, 1); assert.equal(f.checks, 2); assert.equal(receipt.phase, 'ready');
  const writes = f.calls.filter(call => call.method === 'POST'); assert.equal(writes.length, 3);
  assert.deepEqual(writes[0], { method: 'POST', url: '/v2/deployments/dpl_preview/aliases', body: { alias: new URL(origin).hostname } });
  assert.equal(writes[1].url, '/v10/projects/' + staging.backendProjectId + '/env?upsert=true');
  assert.deepEqual(writes[1].body, [{ key: 'APP_ORIGIN', value: origin, type: 'plain', target: ['production'] }]);
  assert.equal(writes[2].body.deploymentId, 'dpl_previous_api'); assert.equal(writes[2].body.target, 'production');
  assert.ok(f.phases.indexOf('verify_public_preview') < f.phases.indexOf('update_staging_api_origin'));
  assert.ok(!JSON.stringify(receipt).includes('synthetic-token'));
});
test('wrong project configuration or aliases owned by another project/production refuse all remote mutations', async () => {
  const otherOrigin = fixture(); otherOrigin.options.origin = 'https://another-staging.vercel.app';
  await assert.rejects(deploy(otherOrigin.options), /existing approved staging alias/);
  assert.equal(otherOrigin.calls.length, 0); assert.equal(otherOrigin.cliCalls, 0);
  for (const override of [
    (method, url) => url === '/v9/projects/' + staging.backendProjectId ? { id: 'unrelated' } : undefined,
    (method, url) => url === '/v9/projects/' + staging.frontendProjectId ? { id: staging.frontendProjectId, accountId: 'other-team', name: 'fullstack-capstone-project', rootDirectory: 'giftlink-frontend' } : undefined,
    (method, url) => url.startsWith('/v4/aliases/') ? { projectId: 'unrelated', deploymentId: 'dpl_other' } : undefined,
    (method, url) => url.startsWith('/v4/aliases/') ? { projectId: staging.frontendProjectId, deploymentId: 'dpl_other' } : url.endsWith('/dpl_other') ? { projectId: staging.frontendProjectId, target: 'production' } : undefined,
    (method, url) => url.endsWith(new URL(staging.productionFrontendOrigin).hostname) ? { projectId: staging.frontendProjectId, target: 'production', alias: [new URL(origin).hostname] } : undefined
  ]) {
    const f = fixture(override); await assert.rejects(deploy(f.options));
    assert.equal(f.cliCalls, 0); assert.ok(f.calls.every(call => call.method === 'GET'));
  }
});
test('an unexpected deployment or provider login/protection failure never changes backend settings', async () => {
  const unexpected = fixture((method, url) => url.endsWith('preview-example.vercel.app') ? { projectId: 'unrelated', readyState: 'READY' } : undefined);
  await assert.rejects(deploy(unexpected.options)); assert.ok(unexpected.calls.every(call => call.method === 'GET'));
  const protectedPreview = fixture(); protectedPreview.options.preflight = async () => { throw Error('Protected deployment'); };
  await assert.rejects(deploy(protectedPreview.options));
  assert.equal(protectedPreview.calls.filter(call => call.method === 'POST').length, 1);
  assert.equal(protectedPreview.phases.at(-1), 'verify_public_preview');
});
test('a failed backend redeployment retains a sanitized phase receipt instead of hiding a partial staging change', async () => {
  const f = fixture((method, url) => url.endsWith('/dpl_new_api') ? { projectId: staging.backendProjectId, target: 'production', readyState: 'ERROR' } : undefined);
  await assert.rejects(deploy(f.options)); assert.equal(f.phases.at(-1), 'redeploy_staging_api');
});
test('READY on an immutable deployment is insufficient until the real API alias points to it', async () => {
  const f = fixture((method, url) => url.endsWith(new URL(staging.apiOrigin).hostname) ? { id: 'dpl_previous_api', projectId: staging.backendProjectId, target: 'production', readyState: 'READY' } : undefined);
  await assert.rejects(deploy(f.options), /did not become ready/);
  assert.equal(f.checks, 1); assert.equal(f.phases.at(-1), 'redeploy_staging_api');
});
test('Vercel API uses the fixed team, TLS and no redirects and suppresses raw provider failure details', async () => {
  const api = vercelApi('synthetic-token', async (url, options) => {
    assert.equal(url.origin, 'https://api.vercel.com'); assert.equal(url.searchParams.get('teamId'), staging.teamId);
    assert.equal(options.redirect, 'error'); assert.equal(options.headers.Authorization, 'Bearer synthetic-token');
    return { ok: false, status: 403, json: async () => ({ message: 'private-value' }) };
  });
  await assert.rejects(api('GET', '/v9/projects/' + staging.frontendProjectId), error => !/synthetic-token|private-value/.test(error.message));
});

test('inspect permits an exact manual diagnostic branch SHA but never relaxes main-only deploy or plan', () => {
  const diagnostic = { ...env, GITHUB_REF: 'refs/heads/diagnostic', STAGING_OPERATION: 'inspect', VERCEL_TOKEN: 'synthetic-token' };
  assert.equal(settings(diagnostic).operation, 'inspect');
  for (const change of [{ STAGING_OPERATION: 'deploy' }, { STAGING_OPERATION: 'plan' }, { VERCEL_TOKEN: '' },
    { APPROVED_SHA: 'b'.repeat(40) }, { GITHUB_EVENT_NAME: 'pull_request' }, { GITHUB_REF: 'refs/tags/release' }]) {
    assert.throws(() => settings({ ...diagnostic, ...change }));
  }
});

test('every original validation 404 identifies its operation, category and endpoint without reading a private body', async () => {
  for (const [pathname, operation, resource, endpoint] of [
    ['/v9/projects/' + staging.frontendProjectId, 'get_frontend_project_by_id', 'frontend_project', '/v9/projects/{idOrName}'],
    ['/v9/projects/' + staging.backendProjectId, 'get_backend_project_by_id', 'backend_project', '/v9/projects/{idOrName}'],
    ['/v13/deployments/' + new URL(staging.productionFrontendOrigin).hostname, 'get_frontend_production_deployment_by_hostname', 'frontend_production_deployment', '/v13/deployments/{idOrUrl}'],
    ['/v13/deployments/' + new URL(staging.apiOrigin).hostname, 'get_staging_api_deployment_by_hostname', 'staging_api_deployment', '/v13/deployments/{idOrUrl}']
  ]) {
    const events = [];
    const api = vercelApi('synthetic-token', async () => ({ ok: false, status: 404,
      json: () => { assert.fail('Never read a private provider error body'); } }), { report: event => events.push(event) });
    await assert.rejects(api('GET', pathname), error => {
      assert.deepEqual(error.diagnostic, { operation, resource, endpoint, method: 'GET', status: 404, result: 'failed', classification: 'not_found_or_inaccessible' });
      assert.ok(error.message.includes(operation)); assert.ok(!error.message.includes('synthetic-token'));
      return true;
    });
    assert.equal(events.length, 1); assert.equal(events[0].operation, operation);
  }
});

test('authentication, permissions, malformed endpoint responses and transport failures remain distinguishable and sanitized', async () => {
  for (const [status, classification] of [[400, 'invalid_request'], [401, 'unauthenticated'], [403, 'forbidden'],
    [404, 'not_found_or_inaccessible'], [405, 'method_not_allowed'], [429, 'rate_limited'], [500, 'provider_error']]) {
    const api = vercelApi('synthetic-token', async () => ({ ok: false, status }));
    await assert.rejects(api('GET', '/v9/projects/' + staging.frontendProjectId), error => error.diagnostic.classification === classification);
  }
  for (const [request, classification] of [
    [async () => { throw Error('synthetic-token https://private.example/credentials'); }, 'transport_error'],
    [async () => ({ ok: true, status: 200, json: () => { throw Error('private-response-body'); } }), 'invalid_json_response']
  ]) {
    const api = vercelApi('synthetic-token', request);
    await assert.rejects(api('GET', '/v9/projects/' + staging.frontendProjectId), error =>
      error.diagnostic.classification === classification && !/synthetic-token|private/.test(error.message));
  }
});

test('read-only inspection cannot send writes, follow redirects, change team or send credentials to an arbitrary endpoint', async () => {
  let calls = 0;
  const api = vercelApi('synthetic-token', async () => { calls++; }, { readOnly: true });
  for (const [method, url] of [['POST', '/v13/deployments?forceNew=1'], ['DELETE', '/v9/projects/' + staging.frontendProjectId],
    ['GET', 'https://unrelated.example/api'], ['GET', '//unrelated.example/api'], ['GET', '/v9/projects/unrelated'],
    ['GET', '/v9/projects/' + staging.frontendProjectId + '?teamId=other'], ['GET', '/v13/deployments/bad?teamId=other']]) {
    await assert.rejects(api(method, url));
  }
  await assert.rejects(api('GET', '/v9/projects/' + staging.frontendProjectId, undefined, true));
  assert.equal(calls, 0);
  const missing = vercelApi('synthetic-token', async (url, options) => {
    assert.equal(url.origin, 'https://api.vercel.com'); assert.equal(url.searchParams.get('teamId'), staging.teamId);
    assert.equal(options.method, 'GET'); assert.equal(options.redirect, 'error');
    return { ok: false, status: 404 };
  }, { readOnly: true });
  assert.equal(await missing('GET', '/v4/aliases/' + new URL(origin).hostname, undefined, true), null);
  await assert.rejects(missing('GET', '/v4/aliases/' + new URL(staging.productionFrontendOrigin).hostname, undefined, true));
});

function inspectionFixture(overrides = {}) {
  const frontend = { id: staging.frontendProjectId, accountId: staging.teamId, name: 'fullstack-capstone-project', rootDirectory: 'giftlink-frontend' };
  const backend = { id: staging.backendProjectId, accountId: staging.teamId, name: 'fullstack-capstone-project-vkwm', rootDirectory: 'giftlink-backend', nodeVersion: '22.x' };
  const calls = [], events = [];
  const responses = {
    ['/v9/projects/' + staging.frontendProjectId]: frontend,
    ['/v9/projects/' + staging.backendProjectId]: backend,
    '/v9/projects/fullstack-capstone-project': frontend, '/v9/projects/fullstack-capstone-project-vkwm': backend,
    ['/v2/teams/' + staging.teamId]: { id: staging.teamId },
    ['/v13/deployments/' + new URL(staging.productionFrontendOrigin).hostname]: 404,
    ['/v13/deployments/' + new URL(staging.apiOrigin).hostname]: 404,
    ['/v4/aliases/' + new URL(staging.productionFrontendOrigin).hostname]: { projectId: staging.frontendProjectId, deploymentId: 'dpl_frontend' },
    ['/v4/aliases/' + new URL(staging.apiOrigin).hostname]: { projectId: staging.backendProjectId, deploymentId: 'dpl_backend' },
    '/v13/deployments/dpl_frontend': { id: 'dpl_frontend', projectId: staging.frontendProjectId, target: 'production', readyState: 'READY' },
    '/v13/deployments/dpl_backend': { id: 'dpl_backend', projectId: staging.backendProjectId, target: 'production', readyState: 'READY' },
    ...overrides
  };
  return { calls, events, api: vercelApi('synthetic-token', async (url, options) => {
    calls.push({ url: url.pathname, method: options.method, teamId: url.searchParams.get('teamId') });
    assert.ok(Object.hasOwn(responses, url.pathname), 'Unexpected endpoint: ' + url.pathname);
    const result = responses[url.pathname];
    return { ok: typeof result !== 'number', status: typeof result === 'number' ? result : 200, json: async () => result };
  }, { readOnly: true, report: event => events.push(event) }) };
}

test('inspection locates the first legacy 404 and independently verifies both project IDs, team and canonical alias bindings using GETs only', async () => {
  const f = inspectionFixture(); const result = await inspect({ origin, api: f.api });
  assert.deepEqual(result, { operation: 'inspect', remoteChanges: false, firstLegacyValidationFailure: 'get_frontend_production_deployment_by_hostname',
    teamReadAccess: true, frontendProjectAccess: true, backendProjectAccess: true, frontendNameMatchesId: true, backendNameMatchesId: true,
    frontendTeamMatches: true, backendTeamMatches: true, frontendConfigurationMatches: true, backendConfigurationMatches: true,
    frontendAliasResolved: true, backendAliasResolved: true });
  assert.ok(f.calls.every(call => call.method === 'GET' && call.teamId === staging.teamId));
  assert.ok(!/synthetic-token|Authorization|accountId/.test(JSON.stringify(f.events)));
});

test('one inaccessible project never hides the second project check; wrong IDs and team ownership remain explicit', async () => {
  const denied = inspectionFixture({ ['/v9/projects/' + staging.frontendProjectId]: 404 });
  const result = await inspect({ origin, api: denied.api });
  assert.equal(result.firstLegacyValidationFailure, 'get_frontend_project_by_id');
  assert.equal(result.frontendProjectAccess, false); assert.equal(result.frontendNameMatchesId, true); assert.equal(result.backendProjectAccess, true);
  const wrong = inspectionFixture({ ['/v9/projects/' + staging.backendProjectId]: { id: staging.backendProjectId, accountId: 'other-team' },
    '/v9/projects/fullstack-capstone-project-vkwm': { id: 'other-project' } });
  const mismatch = await inspect({ origin, api: wrong.api });
  assert.equal(mismatch.backendProjectAccess, true); assert.equal(mismatch.backendTeamMatches, false);
  assert.equal(mismatch.backendConfigurationMatches, false); assert.equal(mismatch.backendNameMatchesId, false);
});

test('observed frontend success/backend 404 and team/API 403 report the backend lookup as the first failure without weakening deploy guards', async () => {
  const f = inspectionFixture({ ['/v9/projects/' + staging.backendProjectId]: 404,
    '/v9/projects/fullstack-capstone-project-vkwm': 404, ['/v2/teams/' + staging.teamId]: 403,
    ['/v13/deployments/' + new URL(staging.productionFrontendOrigin).hostname]: { projectId: staging.frontendProjectId, target: 'production' },
    ['/v13/deployments/' + new URL(staging.apiOrigin).hostname]: 403,
    ['/v4/aliases/' + new URL(staging.apiOrigin).hostname]: 404 });
  const result = await inspect({ origin, api: f.api });
  assert.equal(result.firstLegacyValidationFailure, 'get_backend_project_by_id');
  assert.equal(result.frontendProjectAccess, true); assert.equal(result.frontendTeamMatches, true); assert.equal(result.frontendConfigurationMatches, true);
  assert.equal(result.backendProjectAccess, false); assert.equal(result.backendNameMatchesId, false);
  assert.equal(result.backendAliasResolved, false); assert.equal(result.teamReadAccess, false);
  let cliCalls = 0;
  await assert.rejects(deploy({ origin, api: f.api, cli: () => { cliCalls++; } }), error => error.diagnostic.operation === 'get_backend_project_by_id');
  assert.equal(cliCalls, 0); assert.ok(f.calls.every(call => call.method === 'GET'));
});

test('the complete inspection summary remains accessible as one notice after more than ten successful probes', () => {
  const output = [], report = diagnosticReporter({ GITHUB_ACTIONS: 'true' }, value => output.push(value));
  for (let i = 0; i < 12; i++) report({ operation: 'get_deployment', result: 'ok', status: 200 });
  report({ operation: 'get_backend_project_by_id', result: 'failed', status: 404 });
  report({ operation: 'inspect', remoteChanges: false, backendProjectAccess: false });
  const notices = output.filter(line => line.startsWith('::notice'));
  assert.equal(notices.length, 1); assert.ok(notices[0].includes('"operation":"inspect"'));
  assert.equal(output.filter(line => line.startsWith('::warning')).length, 1);
  const local = []; diagnosticReporter({}, value => local.push(value))({ operation: 'inspect' });
  assert.deepEqual(local, ['{"operation":"inspect"}']);
  const https = [];
  diagnosticReporter({ GITHUB_ACTIONS: 'true' }, value => https.push(value))({ check: 'react_homepage.redirect', status: 302,
    category: 'deployment_protection_redirect', privateBody: 'must-not-be-logged', cookie: 'private-secret' });
  assert.equal(https.length, 2); assert.ok(https[1].startsWith('::error title=Sanitized staging HTTPS assertion::'));
  assert.ok(!/must-not-be-logged|private-secret/.test(https.join('\n')));
});

test('the diagnostic allowlist preserves documented staging mutation endpoints and rejects other project administration', async () => {
  for (const [pathname, body, operation] of [
    ['/v2/deployments/dpl_preview/aliases', { alias: new URL(origin).hostname }, 'assign_test_alias'],
    ['/v10/projects/' + staging.backendProjectId + '/env?upsert=true', [{ key: 'APP_ORIGIN', value: origin, type: 'plain', target: ['production'] }], 'update_staging_api_origin'],
    ['/v13/deployments?forceNew=1', { deploymentId: 'dpl_previousApi', name: 'fullstack-capstone-project-vkwm', target: 'production' }, 'redeploy_staging_api']
  ]) {
    const events = [];
    const api = vercelApi('synthetic-token', async (url, options) => {
      const expected = new URL(pathname, 'https://api.vercel.com'); expected.searchParams.set('teamId', staging.teamId);
      assert.equal(url.href, expected.href); assert.equal(options.method, 'POST'); assert.equal(options.redirect, 'error');
      assert.deepEqual(JSON.parse(options.body), body);
      return { ok: true, status: 200, json: async () => ({ privateEnvironment: 'must-not-be-logged' }) };
    }, { report: event => events.push(event) });
    await api('POST', pathname, body);
    assert.equal(events[0].operation, operation); assert.ok(!/synthetic-token|must-not-be-logged|APP_ORIGIN/.test(JSON.stringify(events)));
  }
  let calls = 0;
  const api = vercelApi('synthetic-token', async () => { calls++; });
  for (const pathname of ['/v10/projects/' + staging.frontendProjectId + '/env?upsert=true', '/v10/projects', '/v2/teams/other']) {
    await assert.rejects(api('POST', pathname, {}));
  }
  assert.equal(calls, 0);
});

test('HTTPS diagnostics need no credentials and preserve exact commit, production origin and main-only mutation guards', () => {
  const diagnostic = { ...env, STAGING_OPERATION: 'diagnose-https', GITHUB_REF: 'refs/heads/diagnostic', STAGING_FAILED_RUN_ID: '123456' };
  assert.equal(settings(diagnostic).operation, 'diagnose-https');
  for (const change of [{ STAGING_OPERATION: 'deploy', VERCEL_TOKEN: 'synthetic' }, { STAGING_OPERATION: 'plan' },
    { APPROVED_SHA: 'b'.repeat(40) }, { STAGING_FRONTEND_ORIGIN: staging.productionFrontendOrigin },
    { STAGING_FRONTEND_ORIGIN: staging.apiOrigin }, { STAGING_FAILED_RUN_ID: 'private-invalid-id' }]) assert.throws(() => settings({ ...diagnostic, ...change }));
});

test('pre-origin HTTPS failures preserve the assigned preview and precise receipt while preventing all backend mutations', async () => {
  const { HttpsPreflightError } = require('../e2e/https-preflight.cjs');
  const f = fixture(), receipts = [];
  f.options.record = value => receipts.push({ ...value });
  f.options.preflight = async (value, target, request, options) => {
    assert.equal(options.phase, 'before_origin');
    throw new HttpsPreflightError([{ check: 'health_wrong_fingerprint', status: 302, category: 'deployment_protection_redirect',
      failures: [{ check: 'health_wrong_fingerprint.redirect', status: 302, category: 'deployment_protection_redirect' }] }]);
  };
  await assert.rejects(deploy(f.options), /health_wrong_fingerprint.redirect/);
  assert.equal(f.calls.filter(call => call.method === 'POST').length, 1);
  const receipt = receipts.at(-1);
  assert.equal(receipt.phase, 'verify_public_preview'); assert.equal(receipt.frontendDeployment, 'dpl_preview');
  assert.equal(receipt.previousBackendDeployment, 'dpl_previous_api');
  assert.equal(receipt.httpsFailure.check, 'health_wrong_fingerprint.redirect');
  assert.equal(receipt.backendDeployment, undefined);
});

test('configured-Origin checks run only after the dedicated API redeployment and retain its partial state if they fail', async () => {
  const { HttpsPreflightError } = require('../e2e/https-preflight.cjs');
  const f = fixture(), phases = [], receipts = [];
  f.options.record = value => receipts.push({ ...value });
  f.options.preflight = async (value, target, request, options) => {
    phases.push(options.phase);
    if (options.phase === 'after_origin') throw new HttpsPreflightError([{ failures: [{ check: 'anonymous_me.configured_origin', status: 401, category: 'app_origin_mismatch' }] }]);
  };
  await assert.rejects(deploy(f.options), /anonymous_me.configured_origin/);
  assert.deepEqual(phases, ['before_origin', 'after_origin']);
  assert.equal(receipts.at(-1).phase, 'verify_staging_proxy');
  assert.equal(receipts.at(-1).backendDeployment, 'dpl_new_api');
});

test('partial-state receipts preserve only validated target-bound deployment IDs, never provider or private response properties', () => {
  const { partialState } = require('./staging-https-diagnostics.cjs');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'partial-staging-')), filename = path.join(directory, 'staging-deployment.json');
  const receipt = { origin, apiOrigin: staging.apiOrigin, fingerprint: staging.fingerprint, phase: 'verify_public_preview',
    frontendDeployment: 'dpl_preview', previousFrontendAliasDeployment: null, previousBackendDeployment: 'dpl_previousApi',
    privateResponse: 'private-secret', frontendDeploymentUrl: 'https://private-secret.example.invalid' };
  try {
    fs.writeFileSync(filename, JSON.stringify(receipt));
    const result = partialState(filename, origin, '12345');
    assert.deepEqual(result, { sourceRunId: '12345', phase: 'verify_public_preview', frontendDeployment: 'dpl_preview',
      previousFrontendAliasDeployment: null, previousBackendDeployment: 'dpl_previousApi', backendDeployment: null });
    assert.ok(!JSON.stringify(result).includes('private-secret'));
    assert.deepEqual(JSON.parse(fs.readFileSync(filename, 'utf8')), receipt);
    for (const change of [{ origin: staging.productionFrontendOrigin }, { fingerprint: 'b'.repeat(64) }, { apiOrigin: 'https://other.example.invalid' },
      { phase: 'private-secret' }, { frontendDeployment: 'https://private-secret.example.invalid' }]) {
      fs.writeFileSync(filename, JSON.stringify({ ...receipt, ...change })); assert.throws(() => partialState(filename, origin, '12345'));
    }
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});
