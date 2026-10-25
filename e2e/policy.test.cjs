const { test } = require('node:test'); const assert = require('node:assert/strict');
const { remoteSettings, approve, expectedEmails } = require('./policy.cjs');
const { frontendConfig } = require('../deployment/frontend-config.cjs');
const env = { E2E_APP_ORIGIN: 'https://approved-test.example.invalid', E2E_DB_NAME: 'moveout_e2e', E2E_MONGO_URL: 'mongodb+srv://test.example.invalid/', E2E_EXPECTED_TARGET: 'a'.repeat(64) };
test('remote policy refuses default/production databases and non-exact HTTPS origins before connecting', () => {
  for (const changes of [{ E2E_DB_NAME: 'giftdb' }, { E2E_DB_NAME: 'production' }, { E2E_APP_ORIGIN: 'http://test.example.invalid' }, { E2E_APP_ORIGIN: env.E2E_APP_ORIGIN + '/path' }, { E2E_APP_ORIGIN: 'https://user:secret@test.example.invalid' }, { E2E_APP_ORIGIN: 'https://localhost' },
    { E2E_APP_ORIGIN: 'https://fullstack-capstone-project-flax.vercel.app' }, { E2E_APP_ORIGIN: 'https://fullstack-capstone-project-vkwm.vercel.app' },
    { E2E_EXPECTED_TARGET: '' }, { E2E_EXPECTED_TARGET: 'not-approved' }]) assert.throws(() => remoteSettings({ ...env, ...changes }));
});
test('write approval binds operation, origin, database, staging and full fingerprint', () => {
  const approved = { ...env, E2E_APPROVE_OPERATION: 'run', E2E_CONFIRM_ORIGIN: env.E2E_APP_ORIGIN, E2E_CONFIRM_DB: env.E2E_DB_NAME, E2E_CONFIRM_ENVIRONMENT: 'staging', E2E_CONFIRM_TARGET: 'a'.repeat(64) };
  assert.equal(approve(approved, 'run').origin, env.E2E_APP_ORIGIN);
  for (const field of ['E2E_APPROVE_OPERATION', 'E2E_CONFIRM_ORIGIN', 'E2E_CONFIRM_DB', 'E2E_CONFIRM_ENVIRONMENT', 'E2E_CONFIRM_TARGET']) assert.throws(() => approve({ ...approved, [field]: 'wrong' }, 'run'));
  assert.throws(() => approve(approved, 'cleanup'));
  assert.throws(() => approve({ ...approved, E2E_CONFIRM_TARGET: 'b'.repeat(64) }, 'run'));
});
test('run identities are bounded, synthetic and unique to a validated run', () => {
  const emails = expectedEmails('a'.repeat(32)); assert.equal(emails.length, 4); assert.equal(new Set(emails).size, 4); assert.ok(emails.every(email => email.endsWith('@example.test')));
  assert.throws(() => expectedEmails('.*'));
});
test('generated frontend config puts API before filesystem/SPA and preserves API paths', () => {
  const config = frontendConfig('https://api-test.example.invalid', env.E2E_APP_ORIGIN);
  assert.equal(config.routes[0].dest, 'https://api-test.example.invalid/api/$1');
  assert.equal('/api/items/123'.replace(new RegExp(config.routes[0].src), config.routes[0].dest), 'https://api-test.example.invalid/api/items/123');
  assert.equal(config.routes[0].has[0].type, 'host'); assert.equal(config.routes[0].has[0].value, 'approved-test.example.invalid');
  assert.equal(config.routes[1].status, 503); assert.equal(config.routes[2].handle, 'filesystem'); assert.equal(config.routes[3].dest, '/index.html');
  for (const origin of ['http://api.example.invalid', 'https://api.example.invalid/path', 'https://user:password@api.example.invalid', 'https://api.example.invalid/']) assert.throws(() => frontendConfig(origin, env.E2E_APP_ORIGIN));
});

const jsonResponse = (status, body, cache = 'private, no-store') => ({ status, headers: new Headers({ 'content-type': 'application/json', 'cache-control': cache,
  'access-control-allow-origin': env.E2E_APP_ORIGIN, 'access-control-allow-credentials': 'true' }), text: async () => JSON.stringify(body) });
const frontendResponse = () => ({ status: 200, headers: new Headers({ 'content-type': 'text/html' }), text: async () => '<!doctype html><div id="root"></div><script defer src="/static/js/main.example.js"></script>' });
function healthy(url, options) {
  if (url.endsWith('/api/health')) return options.headers['X-Deployment-Target'] !== env.E2E_EXPECTED_TARGET ?
    jsonResponse(409, { error: { code: 'DEPLOYMENT_CHANGED' } }) : jsonResponse(200, { status: 'ready', environment: 'staging', databaseFingerprint: env.E2E_EXPECTED_TARGET });
  if (url.endsWith('/api/me')) return jsonResponse(401, { error: { code: 'UNAUTHORIZED' } });
  return frontendResponse();
}
test('HTTPS preflight checks React/deep links, anonymous auth, no-store and both fingerprint requests using only GETs without redirects', async () => {
  const { health } = require('./policy.cjs'); const calls = [];
  const checks = await health(env.E2E_APP_ORIGIN, env.E2E_EXPECTED_TARGET, async (url, options) => {
    calls.push([url, options]); return healthy(url, options);
  });
  assert.equal(calls.length, 5); assert.equal(checks.frontend, true); assert.equal(checks.anonymousMe401, true);
  assert.ok(calls.every(([, options]) => options.redirect === 'manual' && options.method === 'GET' && options.credentials === 'omit' && !options.body));
  assert.notEqual(calls[2][1].headers['X-Deployment-Target'], env.E2E_EXPECTED_TARGET);
  assert.equal(calls[3][1].headers['X-Deployment-Target'], env.E2E_EXPECTED_TARGET);
});
test('HTTPS preflight refuses HTML APIs, redirects, missing fences, cached/private auth failures and a changed approved fingerprint', async () => {
  const { health } = require('./policy.cjs');
  for (const change of [
    (url, options) => url.endsWith('/api/health') ? frontendResponse() : healthy(url, options),
    (url, options) => url.endsWith('/api/health') ? jsonResponse(200, { status: 'ready' }) : healthy(url, options),
    (url, options) => url.endsWith('/api/me') ? jsonResponse(200, {}) : healthy(url, options),
    (url, options) => url.endsWith('/api/me') ? jsonResponse(401, {}, 'public, max-age=600') : healthy(url, options),
    (url, options) => url.endsWith('/api/health') && options.headers['X-Deployment-Target'] === env.E2E_EXPECTED_TARGET ? jsonResponse(200, { status: 'ready', environment: 'staging', databaseFingerprint: 'b'.repeat(64) }) : healthy(url, options),
    (url, options) => url.endsWith('/app/items') ? { ...frontendResponse(), status: 302 } : healthy(url, options),
    (url, options) => url.endsWith('/app/items') ? { ...frontendResponse(), text: async () => '<html>Provider sign in</html>' } : healthy(url, options)
  ]) await assert.rejects(health(env.E2E_APP_ORIGIN, env.E2E_EXPECTED_TARGET, async (url, options) => change(url, options)));
  await assert.rejects(health(env.E2E_APP_ORIGIN, env.E2E_EXPECTED_TARGET, async () => { throw Error('TLS/redirect/network failure'); }));
});
test('run receipts expose only a validated cleanup ID through Actions output and cannot overwrite another run', () => {
  const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
  const { recordRun } = require('./run-receipt.cjs');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-receipt-')); const output = path.join(directory, 'output');
  const receipt = { runId: 'c'.repeat(32), origin: env.E2E_APP_ORIGIN, database: env.E2E_DB_NAME, fingerprint: env.E2E_EXPECTED_TARGET };
  try {
    recordRun(receipt, { directory, output });
    assert.equal(fs.readFileSync(output, 'utf8'), 'run_id=' + receipt.runId + '\n');
    const saved = JSON.parse(fs.readFileSync(path.join(directory, receipt.runId + '.json'), 'utf8'));
    assert.equal(saved.maxAccounts, 4); assert.equal(saved.maxItems, 6); assert.equal(saved.maxRequests, 8);
    assert.equal(fs.statSync(path.join(directory, receipt.runId + '.json')).mode & 0o777, 0o600);
    assert.throws(() => recordRun(receipt, { directory, output }));
    assert.throws(() => recordRun({ ...receipt, runId: '../../escape' }, { directory, output }));
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test('scoped cleanup previews without writes, rejects outsiders, preserves unrelated records and all 16 gifts', async () => {
  const { root } = require('./policy.cjs');
  const { createIsolatedMongo } = require(root + '/giftlink-backend/test/helpers/isolated-mongo');
  const { prepareDatabaseIndexes } = require(root + '/giftlink-backend/services/database-indexes');
  const { ObjectId } = require(root + '/giftlink-backend/node_modules/mongodb');
  const { cleanup } = require('./cleanup.cjs');
  const isolated = await createIsolatedMongo();
  try {
    const db = isolated.db; await prepareDatabaseIndexes(db); const runId = 'b'.repeat(32); const emails = expectedEmails(runId);
    const a = new ObjectId(), b = new ObjectId(), outsider = new ObjectId();
    await db.collection('users').insertMany([{ _id: a, email: emails[0], firstName: 'E2E', lastName: runId }, { _id: b, email: emails[1], firstName: 'E2E', lastName: runId }, { _id: outsider, email: 'preserve@example.test', firstName: 'Unrelated' }]);
    await db.collection('gifts').insertMany(require(root + '/giftlink-backend/util/import-mongo/gifts.json').docs.map(g => ({ ...g })));
    await db.collection('moveOutPlans').insertMany([{ ownerId: a, title: 'E2E ' + runId + ' plan' }, { ownerId: outsider, title: 'Preserve plan' }]);
    await db.collection('items').insertOne({ ownerId: a, name: 'E2E ' + runId + ' desk' });
    const dangerous = await db.collection('pickupRequests').insertOne({ giverId: a, receiverId: outsider, status: 'cancelled', active: false });
    await assert.rejects(cleanup(db, runId, true), /ownership/); assert.equal(await db.collection('users').countDocuments(), 3);
    await db.collection('pickupRequests').deleteOne({ _id: dangerous.insertedId });
    await db.collection('pickupRequests').insertOne({ giverId: a, receiverId: b, status: 'cancelled', active: false });
    const preview = await cleanup(db, runId); assert.equal(preview.users, 2); assert.equal(preview.requests, 1);
    assert.equal(await db.collection('users').countDocuments(), 3); assert.equal(await db.collection('gifts').countDocuments(), 16);
    await cleanup(db, runId, true); assert.equal(await db.collection('users').countDocuments(), 1);
    assert.equal(await db.collection('moveOutPlans').countDocuments(), 1); assert.equal(await db.collection('gifts').countDocuments(), 16);
    assert.deepEqual(await cleanup(db, runId, true), { users: 0, plans: 0, items: 0, requests: 0, sessions: 0 });
  } finally { await isolated.close(); }
});

test('safe reporter suppresses secrets and raw Playwright error details', () => {
  const Reporter = require('./safe-reporter.cjs'); const output = []; const original = console.log, originalError = console.error;
  try {
    console.log = line => output.push(line); console.error = line => output.push(line);
    const reporter = new Reporter();
    reporter.onTestEnd({ titlePath: () => ['synthetic workflow'], location: { file: 'workflow.spec.cjs', line: 1 } }, { status: 'failed', error: { stack: 'private-password cookie-token\n at /workspace/e2e/workflow.spec.cjs:12:3', message: 'private-password' } });
    reporter.onError(new Error('private-connection-string'));
    const logged = output.join('\n'); assert.ok(!/private-password|cookie-token|private-connection-string/.test(logged)); assert.ok(logged.includes('workflow.spec.cjs:12:3'));
  } finally { console.log = original; console.error = originalError; }
});
