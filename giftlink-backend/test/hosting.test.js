const assert = require('node:assert/strict');
const request = require('supertest');
const pino = require('pino');
const { createHostedApp } = require('../index');
const { createIsolatedMongo } = require('./helpers/isolated-mongo');
const { prepareDatabaseIndexes } = require('../services/database-indexes');

describe('Vercel Express runtime using verified isolated MongoDB', function () {
    this.timeout(180000);
    let isolated, env, applications;
    before(async function () {
        isolated = await createIsolatedMongo(); await prepareDatabaseIndexes(isolated.db);
        env = { NODE_ENV: 'production', DB_ENVIRONMENT: 'staging', MONGO_URL: isolated.mongoUrl, MONGO_DB_NAME: isolated.dbName, APP_ORIGIN: 'https://test.example.invalid' };
    });
    beforeEach(function () { applications = []; });
    afterEach(async function () { for (const app of applications) await app.close(); });
    after(async function () { if (isolated) await isolated.close(); });
    function hosted(options = {}) {
        const app = createHostedApp(Object.assign({ env, logger: pino({ level: 'silent' }),
            databaseFactory: () => ({ connect: async () => isolated.db, close: async () => {} }) }, options));
        applications.push(app); return app;
    }
    it('separates cheap liveness from readiness while keeping supplied fingerprint fences', async function () {
        let factories = 0;
        const invalid = hosted({ env: {}, databaseFactory: () => { factories++; throw new Error('No database for liveness'); } });
        const live = await request(invalid).get('/api/live').expect(200);
        assert.deepEqual(live.body, { status: 'alive' }); assert.equal(factories, 0);
        assert.match(live.headers['cache-control'], /no-store/);
        await request(invalid).get('/api/health').expect(503);
        const app = hosted();
        const ready = await request(app).get('/api/health').expect(200);
        await request(app).get('/api/live').set('X-Deployment-Target', '0'.repeat(64)).expect(409);
        await request(app).get('/api/live').set('X-Deployment-Target', ready.body.databaseFingerprint).expect(200);
        await request(app).post('/api/live').send({}).expect(403);
    });
    it('bounds hosted connection selection, socket establishment and pool waits without increasing pool count', async function () {
        let options;
        const app = hosted({ databaseFactory: target => { options = target.clientOptions; return { connect: async () => isolated.db, close: async () => {} }; } });
        await request(app).get('/api/health').expect(200);
        for (const key of ['serverSelectionTimeoutMS', 'connectTimeoutMS', 'waitQueueTimeoutMS']) assert.equal(options[key], 5000);
        assert.equal(options.maxPoolSize, 10); assert.equal(options.minPoolSize, 0); assert.equal(options.maxIdleTimeMS, 60000);
    });
    it('reports safe startup phase/categories with bounded logs and no driver messages or private fields', async function () {
        let clock = 0;
        const lines = [];
        const app = hosted({ now: () => clock, logger: pino({ level: 'info' }, { write: line => lines.push(line) }),
            databaseFactory: () => ({ connect: async () => { throw Object.assign(new Error('private-password@private-host'), { code: 18, keyValue: { email: 'private-email' } }); }, close: async () => {} }) });
        for (const at of [0, 5001, 10002, 31000]) {
            clock = at;
            const response = await request(app).get('/api/health').set('X-Request-Id', 'private-user-id').expect(503);
            assert.equal(response.headers['retry-after'], '5'); assert.match(response.headers['x-request-id'], /^[a-f0-9-]{36}$/);
        }
        const events = lines.map(line => JSON.parse(line)).filter(line => line.event === 'hosted_startup_failed');
        assert.equal(events.length, 2); assert.equal(events[0].phase, 'database_connect'); assert.equal(events[0].category, 'database_authentication');
        assert.ok(!lines.join('').includes('private-'));
    });
    it('logs readiness failure safely and recovers using the same native pool', async function () {
        let failing = false, factories = 0;
        const lines = [];
        const db = { databaseName: isolated.db.databaseName, collection: name => isolated.db.collection(name), command: async query => {
            if (query.ping && failing) throw Object.assign(new Error('private-provider-error'), { code: 13 });
            return isolated.db.command(query);
        } };
        const app = hosted({ logger: pino({ level: 'info' }, { write: line => lines.push(line) }), databaseFactory: () => {
            factories++; return { connect: async () => db, close: async () => {} };
        } });
        await request(app).get('/api/health').expect(200); failing = true;
        await request(app).get('/api/health').expect(503); await request(app).get('/api/health').expect(503);
        failing = false; await request(app).get('/api/health').expect(200); assert.equal(factories, 1);
        const events = lines.map(line => JSON.parse(line)).filter(line => line.event === 'hosted_readiness_failed');
        assert.equal(events.length, 1); assert.equal(events[0].phase, 'readiness_ping'); assert.equal(events[0].category, 'database_permissions');
        assert.ok(!lines.join('').includes('private-provider-error'));
    });
    it('shares cold initialization across requests and returns JSON readiness without database identifiers', async function () {
        let factories = 0;
        const app = hosted({ databaseFactory: () => { factories++; return { connect: async () => isolated.db, close: async () => {} }; } });
        const responses = await Promise.all([request(app).get('/api/health'), request(app).get('/api/health'), request(app).get('/api/items')]);
        responses.forEach(response => assert.equal(response.status, 200)); assert.equal(factories, 1);
        const body = responses[0].body;
        assert.deepEqual(Object.keys(body).sort(), ['databaseFingerprint', 'environment', 'status']);
        assert.match(body.databaseFingerprint, /^[a-f0-9]{64}$/); assert.equal(body.environment, 'staging');
        assert.ok(!JSON.stringify(body).includes(isolated.dbName)); assert.match(responses[0].headers['cache-control'], /no-store/);
        await request(app).get('/api/me').expect(401); assert.equal(factories, 1);
    });
    it('keeps original paths, auth, CSRF and JSON API 404s intact', async function () {
        const app = hosted();
        await request(app).get('/api/items').expect(200);
        await request(app).get('/api/move-out-plans').expect(401);
        await request(app).post('/api/auth/register').set('Origin', 'https://wrong.example.invalid').set('X-CSRF-Protection', '1').send({}).expect(403);
        const missing = await request(app).get('/api/missing').expect(404);
        assert.equal(missing.body.error.code, 'NOT_FOUND'); assert.match(missing.headers['cache-control'], /no-store/);
    });
    it('fences mismatched deployment fingerprints before any authenticated write', async function () {
        const app = hosted(); const before = await isolated.db.collection('users').countDocuments();
        await request(app).post('/api/auth/register').set('X-Deployment-Target', '0'.repeat(64)).send({}).expect(409);
        assert.equal(await isolated.db.collection('users').countDocuments(), before);
        const ready = await request(app).get('/api/health');
        await request(app).get('/api/health').set('X-Deployment-Target', ready.body.databaseFingerprint).expect(200);
        await request(app).get('/api/me').set('X-Deployment-Target', ready.body.databaseFingerprint).expect(401);
    });
    it('fails closed on missing hosted configuration without constructing a database client', async function () {
        async function check(changes) {
            let connected = false;
            const app = hosted({ env: Object.assign({}, env, changes), databaseFactory: () => { connected = true; throw new Error('Unexpected client'); } });
            const response = await request(app).get('/api/health').expect(503); assert.equal(response.body.error.code, 'SERVICE_UNAVAILABLE'); assert.equal(connected, false);
        }
        for (const changes of [{ NODE_ENV: 'development' }, { MONGO_DB_NAME: '' }, { DB_ENVIRONMENT: '' }, { APP_ORIGIN: 'http://test.example.invalid' }]) await check(changes);
    });
    it('sanitizes startup failures, closes failed clients, backs off and permits recovery', async function () {
        let clock = 0, factories = 0, closed = 0;
        const lines = [];
        const app = hosted({ now: () => clock, logger: pino({ level: 'info' }, { write: line => lines.push(line) }),
            databaseFactory: () => { factories++; return { connect: async () => { if (factories === 1) throw new Error('private-user:private-password@remote'); return isolated.db; }, close: async () => { closed++; } }; } });
        const failed = await request(app).get('/api/health').expect(503); await request(app).get('/api/health').expect(503);
        assert.equal(factories, 1); assert.equal(closed, 1); assert.ok(!JSON.stringify(failed.body).includes('private-password')); assert.ok(!lines.join('').includes('private-password'));
        clock = 5001; await request(app).get('/api/health').expect(200); assert.equal(factories, 2);
    });
    it('requires prepared indexes and never silently creates them', async function () {
        for (const [collection, index] of [['items', 'items_pickup_start'], ['pickupMessages', 'pickup_messages_request_time']]) {
            await isolated.db.collection(collection).dropIndex(index);
            try {
                const app = hosted(); await request(app).get('/api/health').expect(503);
                assert.ok(!(await isolated.db.collection(collection).indexes()).some(value => value.name === index));
            } finally { await prepareDatabaseIndexes(isolated.db); }
        }
    });
});
