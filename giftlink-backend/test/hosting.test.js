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
        await isolated.db.collection('items').dropIndex('items_pickup_start');
        try {
            const app = hosted(); await request(app).get('/api/health').expect(503);
            assert.ok(!(await isolated.db.collection('items').indexes()).some(index => index.name === 'items_pickup_start'));
        } finally { await prepareDatabaseIndexes(isolated.db); }
    });
});
