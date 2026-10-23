const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const path = require('node:path');
const pino = require('pino');
const { MongoClient } = require('mongodb');
const request = require('supertest');
const { seedDemoGifts, validateSeedTarget, main } = require('../util/import-mongo');
const { startServer } = require('../server');
const { prepareIdentityIndexes } = require('../services/identity');
const fixtures = require('../util/import-mongo/gifts.json').docs;
const { createIsolatedMongo } = require('./helpers/isolated-mongo');

describe('explicit demo seed safety', function () {
    this.timeout(180000);
    let isolated;
    let db;

    before(async function () {
        isolated = await createIsolatedMongo();
        db = isolated.db;
        await prepareIdentityIndexes(db);
    });

    after(async function () { if (isolated) await isolated.close(); });

    beforeEach(async function () {
        // The helper verified this suite's fresh container and server identity.
        await db.collection('gifts').deleteMany({});
        await db.collection('users').deleteMany({});
    });

    function env() {
        return { MONGO_URL: isolated.mongoUrl, MONGO_DB_NAME: isolated.dbName, NODE_ENV: 'test' };
    }

    it('starts the actual HTTP server without automatically seeding', async function () {
        const runtime = await startServer({
            mongoUrl: isolated.mongoUrl, dbName: isolated.dbName,
            port: 0, host: '127.0.0.1'
        }, { logger: pino({ level: 'silent' }) });
        try {
            const response = await request(runtime.server).get('/api/gifts').expect(200);
            assert.deepEqual(response.body, []);
            assert.equal(await db.collection('gifts').countDocuments(), 0);
        } finally { await runtime.stop(); }
    });

    it('inserts exactly the original 16 records and is repeatable', async function () {
        assert.deepEqual(await seedDemoGifts(db), { insertedCount: 16, existingCount: 0 });
        const first = await db.collection('gifts').find({}).sort({ id: 1 }).toArray();
        assert.equal(first.length, 16);
        for (const gift of first) {
            const fields = Object.assign({}, gift);
            delete fields._id;
            assert.deepEqual(fields, fixtures.find(fixture => fixture.id === gift.id));
        }
        assert.deepEqual(await seedDemoGifts(db), { insertedCount: 0, existingCount: 16 });
        assert.deepEqual(await db.collection('gifts').find({}).sort({ id: 1 }).toArray(), first);
        assert.deepEqual(await db.collection('gifts').indexes(), [{ v: 2, key: { _id: 1 }, name: '_id_' }]);
    });

    it('preserves matching gifts, unrelated gifts, and users', async function () {
        await db.collection('gifts').insertMany([
            { id: '875', name: 'Locally edited lamp', privateNote: 'must remain unchanged' },
            { id: 'unrelated-local-gift', name: 'Unrelated' }
        ]);
        await db.collection('users').insertOne({ email: 'isolated@example.test' });
        const existing = await db.collection('gifts').find({}).toArray();
        const users = await db.collection('users').find({}).toArray();
        assert.deepEqual(await seedDemoGifts(db), { insertedCount: 15, existingCount: 1 });
        for (const gift of existing) {
            assert.deepEqual(await db.collection('gifts').findOne({ _id: gift._id }), gift);
        }
        assert.equal(await db.collection('gifts').countDocuments(), 17);
        assert.deepEqual(await db.collection('users').find({}).toArray(), users);
    });

    it('runs the explicit command after confirmation and reports its sanitized target', async function () {
        const output = [];
        const result = await main({ argv: ['--confirm-db', isolated.dbName], env: env(), log: text => output.push(text) });
        assert.equal(result.insertedCount, 16);
        assert.match(output[0], new RegExp('127\\.0\\.0\\.1:[0-9]+ / ' + isolated.dbName));
        assert.equal(await db.collection('gifts').countDocuments(), 16);
    });

    it('runs the documented npm seed script twice against only its isolated target', function () {
        for (const expected of ['inserted: 16', 'inserted: 0']) {
            const output = execFileSync(process.platform === 'win32' ? 'npm.cmd' : 'npm',
                ['run', 'seed', '--', '--confirm-db', isolated.dbName], {
                    cwd: path.resolve(__dirname, '..'), timeout: 15000, encoding: 'utf8',
                    env: Object.assign({}, process.env, env())
                });
            assert.ok(output.includes(expected));
        }
    });

    it('refuses absent or mismatched confirmation before any writes', async function () {
        await assert.rejects(main({ env: env(), argv: [] }), /Usage/);
        await assert.rejects(main({ env: env(), argv: ['--confirm-db', 'different_db'] }), /confirmation/);
        assert.equal(await db.collection('gifts').countDocuments(), 0);
    });

    it('refuses production mode and production-marked names before any writes', async function () {
        await assert.rejects(main({ env: Object.assign(env(), { NODE_ENV: 'production' }),
            argv: ['--confirm-db', isolated.dbName] }), /production/);
        await assert.rejects(validateSeedTarget({ mongoUrl: isolated.mongoUrl,
            dbName: 'giftdb_production', confirmDb: 'giftdb_production' }), /production/);
        assert.equal(await db.collection('gifts').countDocuments(), 0);
    });

    it('refuses remote, SRV, and cluster-discovery seed targets', async function () {
        for (const mongoUrl of ['mongodb://example.invalid:27017', 'mongodb+srv://example.invalid',
            'mongodb://127.0.0.1:27017/?replicaSet=remote', 'mongodb://127.0.0.1:27017/?loadBalanced=true',
            'mongodb://127.0.0.1:27017/?REPLICASET=remote',
            'mongodb://127.0.0.1:27017/?proxyHost=example.invalid&proxyPort=1080']) {
            await assert.rejects(validateSeedTarget({ mongoUrl, dbName: 'giftdb_test_safety',
                confirmDb: 'giftdb_test_safety' }));
        }
        assert.equal(await db.collection('gifts').countDocuments(), 0);
    });

    it('forces direct loopback connections and does not put credentials in its target label', async function () {
        const target = await validateSeedTarget({
            mongoUrl: 'mongodb://example:dummy-password@127.0.0.1:27017',
            dbName: 'giftdb_test_safety', confirmDb: 'giftdb_test_safety'
        });
        assert.equal(new URL(target.mongoUrl).searchParams.get('directConnection'), 'true');
        assert.equal(target.host, '127.0.0.1:27017');
        assert.ok(!target.host.includes('dummy-password'));
    });

    it('forces the driver to use direct connections even with mixed-case duplicate options', async function () {
        const target = await validateSeedTarget({
            mongoUrl: 'mongodb://example:dummy-password@LOCALHOST:27017/?DIRECTCONNECTION=false&directConnection=false&authSource=admin',
            dbName: 'giftdb_test_safety', confirmDb: 'giftdb_test_safety'
        });
        const client = new MongoClient(target.mongoUrl);
        try {
            assert.equal(client.options.directConnection, true);
            assert.equal(client.options.credentials.source, 'admin');
        } finally { await client.close(); }
    });
});
