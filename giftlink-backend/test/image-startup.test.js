const assert = require('node:assert/strict');
const request = require('supertest');
const pino = require('pino');
const sinon = require('sinon');
const createApp = require('../app');
const { startServer } = require('../server');
const { createHostedApp } = require('../index');
const { readServerConfig } = require('../config');
const { createDatabase } = require('../models/db');
const { createIsolatedMongo } = require('./helpers/isolated-mongo');
const { inspectDatabaseIndexes, prepareDatabaseIndexes, assertDatabaseIndexes } = require('../services/database-indexes');

describe('feature-scoped startup indexes on verified isolated MongoDB', function () {
    this.timeout(180000);
    const logger = pino({ level: 'silent' });
    const origin = 'http://localhost:3000';
    let isolated, db, baseEnv, definitions, cookie, imagePath, clients, servers, hostedApps, observations;
    function environment(enabled) {
        const env = Object.assign({}, baseEnv);
        if (enabled !== undefined) env.ITEM_IMAGE_METADATA_ENABLED = enabled ? 'true' : 'false';
        if (enabled) Object.assign(env, { ITEM_IMAGE_STORAGE_TARGET: 'a'.repeat(64), ITEM_IMAGE_NAMESPACE: 'item-images-test-' + 'b'.repeat(32) });
        return env;
    }
    async function monitoredDatabase() {
        // Only the already verified owned fixture target is used; never process.env.
        const database = createDatabase({ mongoUrl: isolated.mongoUrl, dbName: isolated.dbName,
            clientOptions: { directConnection: true, monitorCommands: true, serverSelectionTimeoutMS: 1000 } });
        clients.push(database);
        const connected = await database.connect();
        const commands = [];
        connected.client.on('commandStarted', event => commands.push({ name: event.commandName, collection: event.command.listIndexes }));
        observations.push(commands);
        return { database, commands };
    }
    async function start(enabled) {
        const observed = await monitoredDatabase();
        const config = Object.assign(readServerConfig(environment(enabled)), { host: '127.0.0.1' });
        const runtime = await startServer(config, { database: observed.database, logger });
        servers.push(runtime);
        return { runtime, commands: observed.commands };
    }
    async function hosted(enabled) {
        const observed = await monitoredDatabase();
        const app = createHostedApp({ env: Object.assign(environment(enabled), { NODE_ENV: 'production', APP_ORIGIN: 'https://test.example.invalid' }),
            databaseFactory: () => observed.database, logger });
        hostedApps.push(app);
        return { app, commands: observed.commands };
    }
    async function snapshot() {
        const result = {};
        for (const { name } of await db.listCollections().toArray()) result[name] = {
            indexes: await db.collection(name).indexes(), rows: await db.collection(name).find({}).sort({ _id: 1 }).toArray()
        };
        return result;
    }
    async function restoreIndex(operation) {
        await db.collection(operation.collection).createIndex(operation.key, Object.assign({ name: operation.index }, operation.options));
    }
    before(async function () {
        isolated = await createIsolatedMongo(); db = isolated.db;
        await prepareDatabaseIndexes(db); definitions = (await inspectDatabaseIndexes(db)).operations;
        assert.equal(definitions.filter(o => o.collection !== 'itemImages').length, 12);
        assert.equal(definitions.filter(o => o.collection === 'itemImages').length, 4);
        baseEnv = { MONGO_URL: isolated.mongoUrl, MONGO_DB_NAME: isolated.dbName, DB_ENVIRONMENT: 'staging', APP_ORIGIN: origin, PORT: '0' };
        const app = createApp({ connectToDatabase: async () => db, logger });
        const post = (path, body) => request(app).post(path).set('Origin', origin).set('X-CSRF-Protection', '1').set('Cookie', cookie || '').send(body);
        const account = await post('/api/auth/register', { email: 'startup-owner@example.test', firstName: 'Synthetic', lastName: 'Owner', password: 'synthetic-startup-password' }).expect(201);
        cookie = account.headers['set-cookie'][0].split(';')[0];
        const plan = (await post('/api/move-out-plans', { moveOutDeadline: new Date(Date.now() + 864000000).toISOString().slice(0, 10), city: 'San Francisco', neighborhood: 'Sunset' }).expect(201)).body.plan;
        const item = (await post('/api/move-out-plans/' + plan.id + '/items', { name: 'Synthetic legacy chair' }).expect(201)).body.item;
        imagePath = '/api/move-out-plans/' + plan.id + '/items/' + item.id + '/images';
    });
    beforeEach(async function () {
        clients = []; servers = []; hostedApps = []; observations = [];
        try { await db.collection('itemImages').drop(); } catch (error) { if (error.code !== 26) throw error; }
        await prepareDatabaseIndexes(db);
    });
    afterEach(async function () {
        try {
            for (const app of hostedApps) await app.close();
            for (const runtime of servers) await runtime.stop();
            for (const client of clients) await client.close();
            // Native command monitoring covers success/failure and HTTP entry paths.
            for (const commands of observations) assert.deepEqual(commands.filter(command =>
                /^(create|createIndexes|drop|dropIndexes|dropDatabase|collMod|insert|update|delete|findAndModify)$/.test(command.name)), []);
        } finally { sinon.restore(); }
    });
    after(async function () { if (isolated) await isolated.close(); });

    it('starts with pre-B2 indexes when metadata is unset or false, without storage I/O or metadata routes', async function () {
        await db.collection('itemImages').drop(); const before = await snapshot();
        const storage = sinon.stub(require('@aws-sdk/client-s3').S3Client.prototype, 'send').throws(new Error('Storage must not be contacted'));
        for (const enabled of [undefined, false]) {
            const { runtime, commands } = await start(enabled);
            await request(runtime.server).get('/').expect(200, 'Inside the server');
            await request(runtime.server).get('/api/me').set('Cookie', cookie).expect(200);
            await request(runtime.server).get(imagePath).set('Cookie', cookie).expect(404);
            await request(runtime.server).post(imagePath + '/uploads').set('Cookie', cookie).set('Origin', origin).set('X-CSRF-Protection', '1').send({}).expect(404);
            assert.ok(!commands.some(command => command.collection === 'itemImages'));
        }
        assert.equal(storage.callCount, 0); assert.deepEqual(await snapshot(), before);
    });
    it('still refuses every missing legacy application index with metadata disabled', async function () {
        await db.collection('itemImages').drop();
        for (const definition of definitions.filter(o => o.collection !== 'itemImages')) {
            await db.collection(definition.collection).dropIndex(definition.index);
            const before = await snapshot();
            try { await assert.rejects(start(false), /Database indexes are required/); assert.deepEqual(await snapshot(), before); }
            finally { await restoreIndex(definition); }
        }
    });
    it('refuses each missing photo index when explicitly enabled and leaves the database untouched', async function () {
        for (const definition of definitions.filter(o => o.collection === 'itemImages')) {
            await db.collection('itemImages').dropIndex(definition.index); const before = await snapshot();
            try { await assert.rejects(start(true), /Database indexes are required/); assert.deepEqual(await snapshot(), before); }
            finally { await restoreIndex(definition); }
        }
    });
    it('starts enabled only with all compatible indexes and serves empty owner metadata without storage calls', async function () {
        const before = await snapshot();
        const storage = sinon.stub(require('@aws-sdk/client-s3').S3Client.prototype, 'send').throws(new Error('Storage must not be contacted'));
        const { runtime, commands } = await start(true);
        const result = await request(runtime.server).get(imagePath).set('Cookie', cookie).expect(200);
        assert.deepEqual(result.body.images, []); assert.deepEqual(result.body.uploads, []); assert.equal(result.body.binaryUploadsEnabled, false);
        assert.ok(commands.some(command => command.collection === 'itemImages'));
        assert.equal(storage.callCount, 0); assert.deepEqual(await snapshot(), before);
    });
    it('rejects incompatible photo uniqueness, partial filters, collation and sparse indexes when enabled', async function () {
        const photos = definitions.filter(o => o.collection === 'itemImages');
        for (const [name, changes] of [['images_item_upload_unique', { unique: false }], ['images_due_work', { partialFilterExpression: { needsMaintenance: false } }],
            ['images_item_state_order', { collation: { locale: 'en', strength: 2 } }], ['images_owner_state', { sparse: true }]]) {
            const definition = photos.find(o => o.index === name);
            await db.collection('itemImages').dropIndex(name);
            await db.collection('itemImages').createIndex(definition.key, Object.assign({ name }, definition.options, changes));
            const before = await snapshot();
            try {
                const disabled = await start(false); assert.ok(!disabled.commands.some(command => command.collection === 'itemImages'));
                await assert.rejects(start(true), /Database indexes are required/); assert.deepEqual(await snapshot(), before);
            }
            finally { await db.collection('itemImages').dropIndex(name); await restoreIndex(definition); }
        }
    });
    it('does not let a compatible duplicate mask an incompatible required photo definition', async function () {
        const definition = definitions.find(o => o.index === 'images_item_upload_unique');
        await db.collection('itemImages').dropIndex(definition.index);
        await db.collection('itemImages').createIndex(definition.key, { name: definition.index });
        await db.collection('itemImages').createIndex(definition.key, Object.assign({ name: 'equivalent_compatible_upload' }, definition.options));
        const before = await snapshot();
        await assert.rejects(start(true), /Database indexes are required/);
        assert.deepEqual(await snapshot(), before);
    });
    it('does not let optional photo indexes bypass incompatible legacy uniqueness', async function () {
        const definition = definitions.find(o => o.index === 'users_email_unique');
        await db.collection('users').dropIndex(definition.index);
        await db.collection('users').createIndex(definition.key, { name: definition.index });
        const before = await snapshot();
        try { await assert.rejects(start(false), /Database indexes are required/); assert.deepEqual(await snapshot(), before); }
        finally { await db.collection('users').dropIndex(definition.index); await restoreIndex(definition); }
    });
    it('keeps explicit full-registry verification and preparation independent of the disabled startup flag', async function () {
        await db.collection('itemImages').drop(); const before = await snapshot();
        await start(false);
        await assert.rejects(assertDatabaseIndexes(db), /Database indexes are required/);
        const preview = await inspectDatabaseIndexes(db);
        assert.deepEqual(preview.operations.filter(o => o.action === 'create').map(o => o.index),
            ['images_item_state_order', 'images_item_upload_unique', 'images_due_work', 'images_owner_state']);
        assert.deepEqual(await snapshot(), before);
    });
    it('keeps Vercel readiness available on pre-B2 indexes while refusing an enabled unprepared cold start', async function () {
        await db.collection('itemImages').drop(); const before = await snapshot();
        const disabled = await hosted(false); await request(disabled.app).get('/api/health').expect(200);
        await request(disabled.app).get('/api/me').expect(401);
        assert.ok(!disabled.commands.some(command => command.collection === 'itemImages'));
        const enabled = await hosted(true); await request(enabled.app).get('/api/health').expect(503);
        assert.deepEqual(await snapshot(), before);
    });
    it('passes Vercel readiness with enabled metadata only after compatible photo preparation', async function () {
        const before = await snapshot(); const { app } = await hosted(true);
        await request(app).get('/api/health').expect(200); assert.deepEqual(await snapshot(), before);
    });
});
