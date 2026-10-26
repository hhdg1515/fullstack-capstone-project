const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const path = require('node:path');
const sinon = require('sinon');
const { MongoClient, ObjectId } = require('mongodb');
const bcrypt = require('bcryptjs');
const { createIsolatedMongo } = require('./helpers/isolated-mongo');
const { main, parseArguments } = require('../util/prepare-database');
const { readPreparationTarget, inspectTarget } = require('../util/database-target');
const { inspectDatabaseIndexes, assertDatabaseIndexes } = require('../services/database-indexes');
const { createIdentityService } = require('../services/identity');

const remoteEnv = { MONGO_URL: 'mongodb+srv://operator:secret@cluster.example.invalid/',
    MONGO_DB_NAME: 'marketplace', DB_ENVIRONMENT: 'staging' };

describe('database preparation target policy (no database connections)', function () {
    afterEach(function () { sinon.restore(); });
    it('parses SRV and multiple remote endpoints without connecting or revealing credentials', async function () {
        const connect = sinon.stub(MongoClient.prototype, 'connect').throws(new Error('Unexpected connection'));
        const target = await readPreparationTarget(remoteEnv, true);
        assert.equal(target.remote, true);
        assert.deepEqual(target.endpoints, ['cluster.example.invalid']);
        const multiple = await readPreparationTarget(Object.assign({}, remoteEnv, {
            MONGO_URL: 'mongodb://b.example.invalid:27018,a.example.invalid:27017/?tls=true&replicaSet=rs'
        }), true);
        assert.deepEqual(multiple.endpoints, ['a.example.invalid:27017', 'b.example.invalid:27018']);
        assert.equal(multiple.replicaSet, 'rs');
        assert.equal(connect.callCount, 0);
    });
    it('requires explicit database and environment, including production', async function () {
        for (const env of [Object.assign({}, remoteEnv, { MONGO_DB_NAME: '' }),
            Object.assign({}, remoteEnv, { DB_ENVIRONMENT: '' }), Object.assign({}, remoteEnv, { DB_ENVIRONMENT: 'test' }),
            Object.assign({}, remoteEnv, { MONGO_DB_NAME: 'admin' })]) {
            await assert.rejects(readPreparationTarget(env, true));
        }
        assert.equal((await readPreparationTarget(Object.assign({}, remoteEnv, { DB_ENVIRONMENT: 'production' }), true)).environment, 'production');
    });
    it('blocks remote and discovery-enabled targets before connecting without explicit authorization', async function () {
        const factory = sinon.stub().throws(new Error('Must not create a connection'));
        for (const uri of [remoteEnv.MONGO_URL, 'mongodb://remote.example.invalid/?tls=true',
            'mongodb://127.0.0.1/?replicaSet=rs&tls=true', 'mongodb://127.0.0.1,localhost/?tls=true']) {
            await assert.rejects(main({ env: Object.assign({}, remoteEnv, { MONGO_URL: uri }), argv: [], databaseFactory: factory }), /--allow-remote/);
        }
        assert.equal(factory.callCount, 0);
    });
    it('requires verified TLS remotely and refuses proxy/TLS bypass options regardless of casing', async function () {
        const uris = ['mongodb://remote.example.invalid/', 'mongodb+srv://cluster.example.invalid/?tls=false',
            'mongodb://remote.example.invalid/?TLS=true&tlsAllowInvalidCertificates=true',
            'mongodb://remote.example.invalid/?tls=true&TLSALLOWINVALIDHOSTNAMES=true',
            'mongodb://remote.example.invalid/?tls=true&tlsInsecure=true',
            'mongodb://127.0.0.1/?proxyHost=remote.example.invalid'];
        for (const uri of uris) await assert.rejects(readPreparationTarget(Object.assign({}, remoteEnv, { MONGO_URL: uri }), true));
    });
    it('forces direct connections for loopback while keeping deployment tier independent of NODE_ENV', async function () {
        const target = await readPreparationTarget({ MONGO_URL: 'mongodb://127.0.0.1/?DIRECTCONNECTION=false',
            MONGO_DB_NAME: 'giftdb', DB_ENVIRONMENT: 'development', NODE_ENV: 'production' });
        assert.equal(target.remote, false);
        const client = new MongoClient(target.mongoUrl, target.clientOptions);
        assert.equal(client.options.directConnection, true);
        assert.equal(client.options.readPreference.mode, 'primary');
        assert.equal(client.options.writeConcern.w, 'majority');
    });
    it('rejects ambiguous/malformed CLI flags instead of guessing intent', function () {
        for (const args of [['--apply', '--dry-run'], ['--apply', '--apply'], ['--confirm-host', 'localhost:27017'],
            ['--confirm-db'], ['--confirm-db', 'giftdb'], ['--unknown']]) assert.throws(() => parseArguments(args));
    });
    it('sanitizes CLI configuration errors', function () {
        assert.throws(() => execFileSync(process.execPath, ['util/prepare-database.js', '--allow-remote'], {
            cwd: path.resolve(__dirname, '..'), timeout: 5000, stdio: 'pipe',
            env: { MONGO_URL: 'mongodb://private-user:private-password@/bad', MONGO_DB_NAME: 'safe_db', DB_ENVIRONMENT: 'production' }
        }), error => error.status === 1 && !/private-user|private-password/.test(error.stderr.toString()) && /Invalid MongoDB configuration/.test(error.stderr.toString()));
    });
});

// Only this helper's verified disposable MongoDB receives writes. Remote policy
// tests inject this connection explicitly; example.invalid is never contacted.
describe('database index preparation on verified isolated MongoDB', function () {
    this.timeout(180000);
    let isolated;
    let db;
    let env;
    let output;
    const log = text => output.push(text);
    const approve = (preview, environment = env) => ['--apply', '--confirm-db', environment.MONGO_DB_NAME,
        '--confirm-environment', environment.DB_ENVIRONMENT, '--confirm-target', preview.target.fingerprint];
    const preview = () => main({ env, argv: ['--dry-run'], log });
    const apply = result => main({ env, argv: approve(result), log });
    const snapshot = async () => ({ collections: await db.listCollections().toArray(),
        users: await db.collection('users').find({}).toArray(), sessions: await db.collection('sessions').find({}).toArray(),
        gifts: await db.collection('gifts').find({}).toArray(), plans: await db.collection('moveOutPlans').find({}).toArray(),
        items: await db.collection('items').find({}).toArray(), pickups: await db.collection('pickupRequests').find({}).toArray(),
        messages: await db.collection('pickupMessages').find({}).toArray() });
    before(async function () { isolated = await createIsolatedMongo(); db = isolated.db; });
    after(async function () { if (isolated) await isolated.close(); });
    beforeEach(async function () {
        for (const name of ['users', 'sessions', 'gifts', 'moveOutPlans', 'items', 'pickupRequests', 'pickupMessages']) {
            try { await db.collection(name).drop(); } catch (error) { if (error.code !== 26) throw error; }
        }
        env = { MONGO_URL: isolated.mongoUrl, MONGO_DB_NAME: isolated.dbName, DB_ENVIRONMENT: 'development' };
        output = [];
    });
    afterEach(function () { sinon.restore(); });
    it('defaults to dry-run and leaves a fresh database completely empty', async function () {
        const before = await snapshot();
        const result = await main({ env, argv: [], log });
        assert.equal(result.plan.ready, true);
        assert.deepEqual(result.plan.operations.map(operation => operation.action), Array(12).fill('create'));
        assert.deepEqual(await snapshot(), before);
        assert.match(output.join('\n'), /dry-run/);
        assert.equal((await preview()).target.fingerprint, result.target.fingerprint);
    });
    it('runs the documented npm preview and approval commands against only the isolated target', async function () {
        const run = args => execFileSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'db:prepare', '--'].concat(args), {
            cwd: path.resolve(__dirname, '..'), timeout: 15000, encoding: 'utf8',
            env: Object.assign({}, process.env, env)
        });
        const report = run(['--dry-run']);
        const target = JSON.parse(report.split('\n').find(line => line.startsWith('{"target":'))).target;
        assert.deepEqual(await db.listCollections().toArray(), []);
        const result = run(approve({ target }));
        assert.match(result, /Required database indexes are ready/);
        await assertDatabaseIndexes(db);
        assert.equal(await db.collection('gifts').countDocuments(), 0);
    });
    it('requires matching database/environment before opening a connection', async function () {
        const factory = sinon.stub().throws(new Error('Must not connect'));
        const correct = approve(await preview());
        for (const args of [['--apply'], correct.map((value, index) => index === 2 ? 'wrong_db' : value),
            correct.map((value, index) => index === 4 ? 'production' : value)]) {
            await assert.rejects(main({ env, argv: args, log, databaseFactory: factory }), /Apply requires matching/);
        }
        assert.equal(factory.callCount, 0);
        assert.deepEqual(await db.listCollections().toArray(), []);
    });
    it('rejects wrong target fingerprints and mismatched connected databases without creating indexes', async function () {
        const correct = approve(await preview());
        correct[6] = '0'.repeat(64);
        await assert.rejects(main({ env, argv: correct, log }), /fingerprint does not match/);
        await assert.rejects(inspectTarget({ databaseName: 'wrong' }, await readPreparationTarget(env)), /Connected database/);
        assert.deepEqual(await db.listCollections().toArray(), []);
    });
    it('creates only the required indexes, preserves accounts, never imports gifts, and repeats safely', async function () {
        await db.collection('users').insertOne({ email: 'private@example.test', password: 'unchanged-hash', firstName: 'Existing' });
        await db.collection('moveOutPlans').insertOne({ ownerId: 'existing-owner', title: 'Existing private plan', moveOutDeadline: '2028-01-01' });
        const before = await snapshot();
        const result = await preview();
        assert.deepEqual(await snapshot(), before);
        await apply(result);
        await assertDatabaseIndexes(db);
        const firstIndexes = { users: await db.collection('users').indexes(), sessions: await db.collection('sessions').indexes() };
        await apply(await preview());
        assert.deepEqual({ users: await db.collection('users').indexes(), sessions: await db.collection('sessions').indexes() }, firstIndexes);
        assert.deepEqual(await db.collection('users').find({}).toArray(), before.users);
        assert.deepEqual(await db.collection('moveOutPlans').find({}).toArray(), before.plans);
        assert.equal(await db.collection('gifts').countDocuments(), 0);
        assert.ok(!(await db.listCollections().toArray()).some(collection => collection.name === 'gifts'));
        assert.ok(!output.join('\n').includes('private@example.test'));
        assert.deepEqual((await preview()).plan.operations.map(operation => operation.action), ['keep', 'keep', 'keep', 'keep', 'keep', 'keep', 'keep', 'keep', 'keep', 'keep', 'keep', 'keep']);
    });
    it('previews and adds the plan index to a Milestone 1 database without rewriting its collections', async function () {
        await db.collection('users').createIndex({ email: 1 }, { name: 'users_email_unique', unique: true });
        await db.collection('sessions').createIndex({ expiresAt: 1 }, { name: 'sessions_expiry', expireAfterSeconds: 0 });
        const before = await snapshot();
        const result = await preview();
        assert.deepEqual(result.plan.operations.map(operation => operation.action), ['keep', 'keep', 'create', 'create', 'create', 'create', 'create', 'create', 'create', 'create', 'create', 'create']);
        assert.deepEqual(await snapshot(), before);
        assert.equal((await db.listCollections().toArray()).length, 2);
        await apply(result);
        await assertDatabaseIndexes(db);
        assert.deepEqual(await db.collection('users').indexes(), [{ v: 2, key: { _id: 1 }, name: '_id_' },
            { v: 2, key: { email: 1 }, name: 'users_email_unique', unique: true }]);
        assert.deepEqual(await db.collection('moveOutPlans').find({}).toArray(), []);
    });
    it('reports duplicate normalized identities, invalid and non-normalized emails using counts only', async function () {
        await db.collection('users').insertMany([{ email: 'private@example.test', firstName: 'One' },
            { email: ' PRIVATE@EXAMPLE.TEST ', firstName: 'Two' }, { email: 'private@example.test', firstName: 'Three' },
            { email: null }, { firstName: 'Missing email' }]);
        const before = await snapshot();
        const target = await inspectTarget(db, await readPreparationTarget(env));
        await assert.rejects(preview(), /Preparation blocked/);
        const plan = JSON.parse(output.find(line => line.includes('"plan"'))).plan;
        assert.deepEqual(plan.accounts, { invalidEmail: 2, nonNormalizedEmail: 1, duplicateGroups: 1, duplicateAccounts: 3 });
        await assert.rejects(apply({ target }), /Preparation blocked/);
        assert.deepEqual(await snapshot(), before);
        assert.equal((await db.collection('users').indexes()).length, 1);
        assert.ok(!/private@example|PRIVATE@EXAMPLE|Missing email/.test(output.join('\n')));
    });
    it('prepares only inventory indexes for a Milestone 2 database and preserves existing item records', async function () {
        await db.collection('users').createIndex({ email: 1 }, { name: 'users_email_unique', unique: true });
        await db.collection('sessions').createIndex({ expiresAt: 1 }, { name: 'sessions_expiry', expireAfterSeconds: 0 });
        await db.collection('moveOutPlans').createIndex({ ownerId: 1, moveOutDeadline: 1, _id: 1 }, { name: 'move_out_plans_owner_deadline' });
        await db.collection('items').insertOne({ name: 'Existing private item', status: 'draft' });
        const before = await snapshot();
        const result = await preview();
        assert.deepEqual(result.plan.operations.map(operation => operation.action), ['keep', 'keep', 'keep', 'create', 'create', 'create', 'create', 'create', 'create', 'create', 'create', 'create']);
        assert.deepEqual(await snapshot(), before);
        await apply(result); await apply(await preview());
        assert.deepEqual(await db.collection('items').find({}).toArray(), before.items);
        assert.equal((await db.collection('items').indexes()).length, 4);
    });
    it('blocks exact duplicate emails even when all values are normalized', async function () {
        await db.collection('users').insertMany([{ email: 'duplicate@example.test' }, { email: 'duplicate@example.test' }]);
        const before = await snapshot();
        const plan = await inspectDatabaseIndexes(db);
        assert.equal(plan.accounts.duplicateGroups, 1);
        assert.equal(plan.accounts.nonNormalizedEmail, 0);
        await assert.rejects(apply({ target: await inspectTarget(db, await readPreparationTarget(env)) }), /Preparation blocked/);
        assert.deepEqual(await snapshot(), before);
    });
    it('previews and adds only the discovery index to a Milestone 3 database', async function () {
        await apply(await preview());
        await db.collection('items').insertOne({ name: 'Preserved inventory', status: 'draft' });
        await db.collection('items').dropIndex('items_pickup_start');
        const before = await snapshot();
        const result = await preview();
        assert.deepEqual(result.plan.operations.map(operation => operation.action), ['keep', 'keep', 'keep', 'keep', 'keep', 'create', 'keep', 'keep', 'keep', 'keep', 'keep', 'keep']);
        assert.deepEqual(await snapshot(), before);
        await apply(result); await apply(await preview());
        assert.deepEqual(await db.collection('items').find({}).toArray(), before.items);
        await assertDatabaseIndexes(db);
    });
    it('blocks incompatible index names, uniqueness and TTL settings before any creation', async function () {
        for (const incompatible of [
            { collection: 'users', key: { other: 1 }, options: { name: 'users_email_unique' } },
            { collection: 'users', key: { email: 1 }, options: { name: 'legacy_email', unique: false } },
            { collection: 'users', key: { email: 1 }, options: { name: 'legacy_email', unique: true, sparse: true } },
            { collection: 'users', key: { email: 1 }, options: { name: 'legacy_email', unique: true,
                partialFilterExpression: { email: 'private-filter@example.test' } } },
            { collection: 'users', key: { email: 1 }, options: { name: 'legacy_email', unique: true, collation: { locale: 'en', strength: 2 } } },
            { collection: 'sessions', key: { expiresAt: 1 }, options: { name: 'sessions_expiry', expireAfterSeconds: 0, unique: true } },
            { collection: 'sessions', key: { expiresAt: 1 }, options: { name: 'sessions_expiry', expireAfterSeconds: 60 } },
            { collection: 'moveOutPlans', key: { ownerId: 1, moveOutDeadline: 1, _id: 1 }, options: { name: 'legacy_plan', unique: true } },
            { collection: 'moveOutPlans', key: { ownerId: 1 }, options: { name: 'move_out_plans_owner_deadline' } },
            { collection: 'items', key: { status: 1, availableFrom: 1, publishedAt: -1, _id: -1 }, options: { name: 'items_pickup_start', unique: true } },
            { collection: 'pickupRequests', key: { itemId: 1 }, options: { name: 'pickup_one_accepted', unique: true, partialFilterExpression: { status: 'pending' } } },
            { collection: 'pickupRequests', key: { itemId: 1, receiverId: 1 }, options: { name: 'pickup_active_receiver', unique: false, partialFilterExpression: { active: true } } },
            { collection: 'pickupMessages', key: { requestId: 1, createdAt: -1, _id: -1 }, options: { name: 'pickup_messages_request_time', unique: true } }
        ]) {
            await db.collection(incompatible.collection).createIndex(incompatible.key, incompatible.options);
            const before = await snapshot();
            const indexes = await db.collection(incompatible.collection).indexes();
            await assert.rejects(preview(), /Preparation blocked/);
            await assert.rejects(apply({ target: await inspectTarget(db, await readPreparationTarget(env)) }), /Preparation blocked/);
            assert.deepEqual(await snapshot(), before);
            assert.deepEqual(await db.collection(incompatible.collection).indexes(), indexes);
            assert.equal((await db.listCollections().toArray()).length, 1);
            assert.ok(!output.join('\n').includes('private-filter@example.test'));
            await db.collection(incompatible.collection).drop();
            output = [];
        }
    });
    it('previews and adds only pickup indexes to a Milestone 4 database, preserving all documents on repeat initialization', async function () {
        await apply(await preview()); await db.collection('pickupRequests').drop();
        await db.collection('items').insertOne({ name: 'Preserved inventory', status: 'draft' });
        const before = await snapshot(); const result = await preview();
        assert.deepEqual(result.plan.operations.map(operation => operation.action), ['keep', 'keep', 'keep', 'keep', 'keep', 'keep', 'create', 'create', 'create', 'create', 'keep', 'keep']);
        assert.deepEqual(await snapshot(), before);
        await apply(result); await apply(await preview()); await assertDatabaseIndexes(db);
        assert.deepEqual((await snapshot()).items, before.items); assert.deepEqual((await snapshot()).pickups, []);
        const indexes = await db.collection('pickupRequests').indexes();
        assert.equal(indexes.length, 5);
        assert.deepEqual(indexes.find(index => index.name === 'pickup_one_accepted').partialFilterExpression, { status: 'accepted' });
    });
    it('previews only the new message index, requires preparation for readiness, and preserves history on repeats', async function () {
        await apply(await preview()); await db.collection('pickupMessages').dropIndex('pickup_messages_request_time');
        await db.collection('pickupMessages').insertOne({ requestId: new ObjectId(), senderId: new ObjectId(), text: 'Private preserved history', createdAt: new Date() });
        const before = await snapshot(); const result = await preview();
        assert.deepEqual(result.plan.operations.filter(operation => operation.action === 'create').map(operation => operation.index), ['pickup_messages_request_time']);
        assert.deepEqual(await snapshot(), before); await assert.rejects(assertDatabaseIndexes(db), /Database indexes are required/);
        await apply(result); await apply(await preview()); await assertDatabaseIndexes(db);
        assert.deepEqual((await snapshot()).messages, before.messages);
        assert.ok(!output.join('\n').includes('Private preserved history'));
    });
    it('previews only the regional plan index without assigning regions or rewriting records', async function () {
        await apply(await preview()); await db.collection('moveOutPlans').dropIndex('plan_metro_discovery');
        await db.collection('moveOutPlans').insertOne({ city: 'Existing city', neighborhood: 'Private legacy label', ownerId: new ObjectId() });
        const before = await snapshot(); const result = await preview();
        assert.deepEqual(result.plan.operations.filter(operation => operation.action === 'create').map(operation => operation.index), ['plan_metro_discovery']);
        assert.deepEqual(await snapshot(), before); await assert.rejects(assertDatabaseIndexes(db), /Database indexes are required/);
        await apply(result); await apply(await preview()); await assertDatabaseIndexes(db);
        assert.deepEqual((await snapshot()).plans, before.plans); assert.ok(!output.join('\n').includes('Private legacy label'));
    });
    it('reports pickup uniqueness conflicts using counts, refuses repairs, and preserves private request documents', async function () {
        const itemId = new ObjectId(); const receiverId = new ObjectId();
        await db.collection('pickupRequests').insertMany([0, 1].map(() => ({ itemId, receiverId, active: true, status: 'accepted', note: 'Private appointment note' })));
        const before = await snapshot();
        const plan = await inspectDatabaseIndexes(db);
        assert.deepEqual(plan.pickups, { duplicateAcceptedGroups: 1, duplicateActiveReceiverGroups: 1 });
        assert.equal(plan.ready, false); await assert.rejects(preview(), /Preparation blocked/);
        assert.deepEqual(await snapshot(), before);
        assert.ok(!output.join('\n').includes('Private appointment note'));
        assert.ok(!output.join('\n').includes(itemId.toString()));
    });
    it('creates binary email indexes even when the collection has a non-simple default collation', async function () {
        await db.createCollection('users', { collation: { locale: 'en', strength: 1 } });
        await apply(await preview());
        await assertDatabaseIndexes(db);
        const index = (await db.collection('users').indexes()).find(index => index.name === 'users_email_unique');
        assert.ok(!index.collation || index.collation.locale === 'simple');
    });
    it('accepts equivalent indexes with different names and uses binary email uniqueness with non-simple collection defaults', async function () {
        await db.createCollection('users', { collation: { locale: 'en', strength: 1 } });
        await db.collection('users').createIndex({ email: 1 }, { name: 'custom_email', unique: true, collation: { locale: 'simple' } });
        await db.collection('sessions').createIndex({ expiresAt: 1 }, { name: 'custom_expiry', expireAfterSeconds: 0 });
        await db.collection('moveOutPlans').createIndex({ ownerId: 1, moveOutDeadline: 1, _id: 1 }, { name: 'custom_plan_owner' });
        await db.collection('items').createIndex({ planId: 1, ownerId: 1, createdAt: 1, _id: 1 }, { name: 'custom_item_owner' });
        await db.collection('items').createIndex({ status: 1, publishedAt: -1, _id: -1 }, { name: 'custom_publication' });
        await db.collection('items').createIndex({ status: 1, availableFrom: 1, publishedAt: -1, _id: -1 }, { name: 'custom_pickup_start' });
        const result = await preview();
        assert.deepEqual(result.plan.operations.map(operation => operation.action), ['keep', 'keep', 'keep', 'keep', 'keep', 'keep', 'create', 'create', 'create', 'create', 'create', 'create']);
        await apply(result);
        await assertDatabaseIndexes(db);
        assert.equal((await db.collection('users').indexes()).length, 2);
        const password = 'test-password';
        await db.collection('users').insertMany([{ email: 'user@example.test', password: await bcrypt.hash(password, 4) },
            { email: 'usér@example.test', password: await bcrypt.hash(password, 4) }]);
        const service = createIdentityService({ connectToDatabase: async () => db });
        assert.equal((await service.login('usér@example.test', password)).email, 'usér@example.test');
    });
    it('keeps authorized remote previews read-only and requires fresh scoped approval to apply (isolated connection injection)', async function () {
        const stagedEnv = Object.assign({}, remoteEnv, { MONGO_DB_NAME: isolated.dbName });
        const factory = sinon.stub().returns({ connect: async () => db, close: sinon.stub().resolves() });
        const before = await snapshot();
        const result = await main({ env: stagedEnv, argv: ['--allow-remote'], log, databaseFactory: factory });
        assert.deepEqual(await snapshot(), before);
        assert.equal(result.target.remote, true);
        assert.equal(result.target.environment, 'staging');
        await assert.rejects(main({ env: stagedEnv, argv: approve(result, stagedEnv), log, databaseFactory: factory }), /--allow-remote/);
        const prodEnv = Object.assign({}, stagedEnv, { DB_ENVIRONMENT: 'production' });
        await assert.rejects(main({ env: prodEnv, argv: ['--allow-remote'].concat(approve(result, stagedEnv)), log, databaseFactory: factory }), /Apply requires matching/);
        await assert.rejects(main({ env: prodEnv, argv: ['--allow-remote'].concat(approve(result, prodEnv)), log, databaseFactory: factory }), /fingerprint does not match/);
        assert.deepEqual(await snapshot(), before);
        await main({ env: stagedEnv, argv: ['--allow-remote'].concat(approve(result, stagedEnv)), log, databaseFactory: factory });
        await assertDatabaseIndexes(db);
        const prodPreview = await main({ env: prodEnv, argv: ['--allow-remote', '--dry-run'], log, databaseFactory: factory });
        await main({ env: prodEnv, argv: ['--allow-remote'].concat(approve(prodPreview, prodEnv)), log, databaseFactory: factory });
        assert.ok(!/operator|secret|mongodb\+srv:\/\//.test(output.join('\n')));
    });
    it('refuses a target changed between inspection and apply', async function () {
        const result = await preview();
        const hello = await db.command({ hello: 1 });
        let calls = 0;
        const changedDb = { databaseName: db.databaseName, collection: name => db.collection(name),
            command: async () => ++calls === 1 ? hello : Object.assign({}, hello, { setName: 'different-cluster' }) };
        await assert.rejects(main({ env, argv: approve(result), log,
            databaseFactory: () => ({ connect: async () => changedDb, close: async () => {} }) }), /Target changed/);
        assert.deepEqual(await db.listCollections().toArray(), []);
    });
    it('sanitizes raw server errors and always closes its client', async function () {
        const close = sinon.stub().resolves();
        await assert.rejects(main({ env, argv: [], log, databaseFactory: () => ({
            connect: async () => { throw new Error('private@example.test mongodb://secret'); }, close
        }) }), error => !/private@example|mongodb:\/\//.test(error.message));
        assert.equal(close.callCount, 1);
    });
});
