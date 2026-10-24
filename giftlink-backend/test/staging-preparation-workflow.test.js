const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const sinon = require('sinon');
const { MongoClient } = require('mongodb');
const { validateStagingPreparation } = require('../../deployment/validate-staging-preparation');

describe('staging preparation workflow guards (no database connections)', function () {
    let env, connect;
    beforeEach(function () {
        env = {
            GITHUB_EVENT_NAME: 'workflow_dispatch', GITHUB_REF: 'refs/heads/main',
            GITHUB_REPOSITORY: 'hhdg1515/fullstack-capstone-project',
            GITHUB_SHA: 'a'.repeat(40), APPROVED_SHA: 'a'.repeat(40),
            MONGO_URL: 'mongodb+srv://operator:private-placeholder@cluster.example.invalid/',
            MONGO_DB_NAME: 'moveout_e2e_staging', DB_ENVIRONMENT: 'staging',
            PREPARATION_OPERATION: 'dry-run'
        };
        connect = sinon.stub(MongoClient.prototype, 'connect').throws(new Error('Must not connect'));
    });
    afterEach(function () { const calls = connect.callCount; sinon.restore(); assert.equal(calls, 0); });
    function applying() {
        return Object.assign({}, env, { PREPARATION_OPERATION: 'apply', CONFIRM_DB: 'moveout_e2e_staging',
            CONFIRM_ENVIRONMENT: 'staging', CONFIRM_TARGET: 'b'.repeat(64) });
    }
    it('accepts the existing secret/variable mapping without any frontend origin or NODE_ENV', async function () {
        assert.equal(env.E2E_APP_ORIGIN, undefined);
        assert.equal(env.APP_ORIGIN, undefined);
        await validateStagingPreparation(env);
    });
    it('accepts apply only with all explicit staging confirmations', async function () {
        await validateStagingPreparation(applying());
    });
    it('rejects automatic events, branches, forks and missing or changed commit approvals', async function () {
        for (const changes of [{ GITHUB_EVENT_NAME: 'push' }, { GITHUB_EVENT_NAME: 'pull_request' },
            { GITHUB_REF: 'refs/heads/feature' }, { GITHUB_REPOSITORY: 'other/repository' },
            { APPROVED_SHA: '' }, { APPROVED_SHA: 'main' }, { GITHUB_SHA: 'c'.repeat(40) }]) {
            await assert.rejects(validateStagingPreparation(Object.assign({}, env, changes)));
        }
    });
    it('refuses missing environment credentials and every other database or environment', async function () {
        for (const changes of [{ MONGO_URL: '' }, { MONGO_URL: ' ' }, { MONGO_DB_NAME: '' },
            { MONGO_DB_NAME: 'giftdb' }, { MONGO_DB_NAME: 'moveout_e2e_production' },
            { DB_ENVIRONMENT: 'production' }, { DB_ENVIRONMENT: '' }]) {
            await assert.rejects(validateStagingPreparation(Object.assign({}, env, changes)));
        }
    });
    it('refuses unsupported operations and every missing or incorrect apply confirmation', async function () {
        for (const operation of ['', 'preview', 'seed', 'cleanup']) {
            await assert.rejects(validateStagingPreparation(Object.assign({}, env, { PREPARATION_OPERATION: operation })));
        }
        for (const changes of [{ CONFIRM_DB: '' }, { CONFIRM_DB: 'other_database' },
            { CONFIRM_ENVIRONMENT: '' }, { CONFIRM_ENVIRONMENT: 'production' },
            { CONFIRM_TARGET: '' }, { CONFIRM_TARGET: 'short' }, { CONFIRM_TARGET: 'z'.repeat(64) }]) {
            await assert.rejects(validateStagingPreparation(Object.assign(applying(), changes)));
        }
    });
    it('rejects write confirmations attached to dry-run rather than guessing intent', async function () {
        for (const key of ['CONFIRM_DB', 'CONFIRM_ENVIRONMENT', 'CONFIRM_TARGET']) {
            await assert.rejects(validateStagingPreparation(Object.assign({}, env, { [key]: 'unexpected' })), /Leave all apply/);
        }
    });
    it('reuses the existing remote TLS policy and refuses a local target before connecting', async function () {
        for (const uri of ['mongodb://127.0.0.1/', 'mongodb://remote.example.invalid/',
            'mongodb+srv://cluster.example.invalid/?tls=false',
            'mongodb+srv://cluster.example.invalid/?tlsInsecure=true']) {
            await assert.rejects(validateStagingPreparation(Object.assign({}, env, { MONGO_URL: uri })));
        }
    });
    it('runs the preflight CLI without connecting or printing the stored credential', function () {
        const run = changes => spawnSync(process.execPath, [path.resolve(__dirname, '../../deployment/validate-staging-preparation.js')], {
            env: Object.assign({}, process.env, env, changes), encoding: 'utf8', timeout: 10000
        });
        const success = run({});
        assert.equal(success.status, 0);
        assert.match(success.stdout, /validated without connecting/);
        const failure = run({ MONGO_URL: 'mongodb://operator:private-placeholder@malformed[host/' });
        assert.equal(failure.status, 1);
        assert.match(failure.stderr, /Invalid MongoDB configuration/);
        assert.ok(!/private-placeholder|operator|mongodb:|mongodb\+srv:/.test(success.stdout + success.stderr + failure.stdout + failure.stderr));
    });
});
