const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { staging } = require('./staging-target.cjs');
const { settings, preparePreview, vercelApi, deploy } = require('./staging-preview.cjs');
const origin = 'https://moveout-e2e-example.vercel.app';
const env = { GITHUB_REPOSITORY: 'hhdg1515/fullstack-capstone-project', GITHUB_EVENT_NAME: 'workflow_dispatch',
  GITHUB_REF: 'refs/heads/main', GITHUB_SHA: 'a'.repeat(40), APPROVED_SHA: 'a'.repeat(40), STAGING_OPERATION: 'plan', STAGING_FRONTEND_ORIGIN: origin };
test('staging deployment planning needs no credentials; deployment requires an exact manual main approval and token', () => {
  assert.equal(settings(env).operation, 'plan');
  assert.equal(settings({ ...env, STAGING_OPERATION: 'deploy', VERCEL_TOKEN: 'synthetic-token' }).operation, 'deploy');
  for (const change of [{ STAGING_OPERATION: 'deploy' }, { STAGING_OPERATION: 'production' }, { GITHUB_REF: 'refs/heads/feature' },
    { GITHUB_EVENT_NAME: 'push' }, { GITHUB_REPOSITORY: 'other/repo' }, { APPROVED_SHA: 'b'.repeat(40) }, { APPROVED_SHA: '' },
    { STAGING_FRONTEND_ORIGIN: staging.productionFrontendOrigin }, { STAGING_FRONTEND_ORIGIN: staging.apiOrigin },
    { STAGING_FRONTEND_ORIGIN: 'https://custom.example.com' }, { STAGING_FRONTEND_ORIGIN: origin + '/path' }]) assert.throws(() => settings({ ...env, ...change }));
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
    if (url === '/v9/projects/' + staging.frontendProjectId) return { id: staging.frontendProjectId, name: 'fullstack-capstone-project', rootDirectory: 'giftlink-frontend' };
    if (url === '/v9/projects/' + staging.backendProjectId) return { id: staging.backendProjectId, name: 'fullstack-capstone-project-vkwm', rootDirectory: 'giftlink-backend', nodeVersion: '22.x' };
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
  for (const override of [
    (method, url) => url === '/v9/projects/' + staging.backendProjectId ? { id: 'unrelated' } : undefined,
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
