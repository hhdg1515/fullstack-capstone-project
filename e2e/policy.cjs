const { randomUUID } = require('node:crypto');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const { readPreparationTarget, inspectTarget } = require(root + '/giftlink-backend/util/database-target');
const { createDatabase } = require(root + '/giftlink-backend/models/db');
const { assertDatabaseIndexes } = require(root + '/giftlink-backend/services/database-indexes');
const { testOrigin } = require(root + '/deployment/staging-target.cjs');
const { health } = require('./https-preflight.cjs');
const runPattern = /^[a-f0-9]{32}$/;
function remoteSettings(env) {
  const origin = testOrigin(env.E2E_APP_ORIGIN);
  if (!/^moveout_e2e(?:_[a-z0-9_]+)?$/.test(env.E2E_DB_NAME || '')) throw Error('Use a dedicated moveout_e2e test database, never a production/default database');
  if (!env.E2E_MONGO_URL) throw Error('Configure E2E_MONGO_URL securely');
  if (!/^[a-f0-9]{64}$/.test(env.E2E_EXPECTED_TARGET || '')) throw Error('Set the full previously approved E2E_EXPECTED_TARGET fingerprint');
  return { origin, expectedFingerprint: env.E2E_EXPECTED_TARGET,
    env: { MONGO_URL: env.E2E_MONGO_URL, MONGO_DB_NAME: env.E2E_DB_NAME, DB_ENVIRONMENT: 'staging' } };
}
function approve(env, operation) {
  const settings = remoteSettings(env);
  if (!['run', 'cleanup'].includes(operation) || env.E2E_APPROVE_OPERATION !== operation || env.E2E_CONFIRM_ORIGIN !== settings.origin ||
      env.E2E_CONFIRM_DB !== settings.env.MONGO_DB_NAME || env.E2E_CONFIRM_ENVIRONMENT !== 'staging' || env.E2E_CONFIRM_TARGET !== settings.expectedFingerprint) throw Error('Remote writes require explicit operation/origin/database/staging/fingerprint confirmation');
  return settings;
}
async function inspectRemote(env) {
  const settings = remoteSettings(env); let database;
  try {
    const target = await readPreparationTarget(settings.env, true);
    if (!target.remote) throw Error('Remote mode requires a remote TLS target');
    database = createDatabase(target); const db = await database.connect(); const inspected = await inspectTarget(db, target);
    if (inspected.fingerprint !== settings.expectedFingerprint) throw Error('The inspected database is not the previously approved staging target');
    if (inspected.deployment !== 'replica-set' && inspected.deployment !== 'sharded') throw Error('Transactions require a replica set');
    await assertDatabaseIndexes(db); const checks = await health(settings.origin, inspected.fingerprint);
    return { ...settings, database, db, inspected, checks };
  } catch { if (database) await database.close().catch(() => {}); throw Error('Remote preflight failed. Verify approved origin, Atlas project/cluster/database, TLS, prepared indexes and API fingerprint securely.'); }
}
function expectedEmails(runId) {
  if (!runPattern.test(runId)) throw Error('Invalid run identifier');
  return ['desktop', 'mobile'].flatMap(project => ['giver', 'receiver'].map(role => `e2e+${runId}.${project}.${role}@example.test`));
}
async function assertBudget(db) {
  const count = await db.collection('users').countDocuments({ email: /^e2e\+[a-f0-9]{32}\./ });
  if (count) throw Error('Previous synthetic E2E accounts remain. Preview and explicitly approve their scoped cleanup before registering more users.');
}
function newRunId() { return randomUUID().replace(/-/g, ''); }
module.exports = { root, runPattern, remoteSettings, approve, health, inspectRemote, expectedEmails, assertBudget, newRunId };
