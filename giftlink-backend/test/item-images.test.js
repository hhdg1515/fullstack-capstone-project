/* jshint loopfunc: true */
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { ObjectId, MongoServerError } = require('mongodb');
const request = require('supertest');
const pino = require('pino');
const sinon = require('sinon');
const createApp = require('../app');
const { createIsolatedMongo } = require('./helpers/isolated-mongo');
const { prepareDatabaseIndexes, inspectDatabaseIndexes, assertDatabaseIndexes } = require('../services/database-indexes');
const { createItemImagesService } = require('../services/item-images');
const { ceiling, validOperation, quotaFor, readImageMetadataConfig } = require('../services/item-image-policy');
const { privateUser, publicUser } = require('../services/identity');
const { readServerConfig } = require('../config');

const origin = 'http://localhost:3000';
const binding = { fingerprint: 'a'.repeat(64), namespace: 'item-images-test-' + 'b'.repeat(32) };
const defaults = { attempts: 50, successes: 20, accountBytes: 100 * 1024 * 1024, concurrent: 2, records: 1000 };
const configuration = changes => ({ storageBinding: binding, limits: Object.assign({}, defaults, changes) });
const intent = () => ({ imageRevision: 0, clientUploadId: randomUUID(), byteLength: 128, sha256: 'c'.repeat(64) });
const day = offset => new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10);
const write = call => call.set('Origin', origin).set('X-CSRF-Protection', '1');

describe('image metadata configuration', function () {
    it('defaults off independently of binary media, storage credentials and malformed unused caps', function () {
        assert.equal(readImageMetadataConfig({ ITEM_IMAGES_ENABLED: 'true', ITEM_IMAGE_QUOTA_CONCURRENT: 'bad',
            ITEM_IMAGE_S3_ENDPOINT: 'https://must-not-contact.invalid' }), null);
        assert.equal(readImageMetadataConfig({ ITEM_IMAGE_METADATA_ENABLED: 'false' }), null);
    });
    it('requires an explicit target and validates lower-only provisional quota caps', function () {
        const env = { ITEM_IMAGE_METADATA_ENABLED: 'true', ITEM_IMAGE_STORAGE_TARGET: binding.fingerprint, ITEM_IMAGE_NAMESPACE: binding.namespace };
        assert.deepEqual(readImageMetadataConfig(env), configuration());
        assert.equal(readImageMetadataConfig(Object.assign({}, env, { ITEM_IMAGE_QUOTA_CONCURRENT: '1' })).limits.concurrent, 1);
        for (const change of [{ ITEM_IMAGE_METADATA_ENABLED: '1' }, { ITEM_IMAGE_STORAGE_TARGET: '' }, { ITEM_IMAGE_NAMESPACE: '../escape' },
            { ITEM_IMAGE_QUOTA_CONCURRENT: '3' }, { ITEM_IMAGE_QUOTA_DAILY_ATTEMPTS: '51' }, { ITEM_IMAGE_QUOTA_DAILY_SUCCESSES: '21' },
            { ITEM_IMAGE_QUOTA_ACCOUNT_BYTES: '104857601' }, { ITEM_IMAGE_QUOTA_RECORDS: '1001' }, { ITEM_IMAGE_QUOTA_RECORDS: '0' },
            { ITEM_IMAGE_QUOTA_RECORDS: '-1' }, { ITEM_IMAGE_QUOTA_RECORDS: '1.5' }, { ITEM_IMAGE_QUOTA_RECORDS: 'Infinity' }]) {
            assert.throws(() => readImageMetadataConfig(Object.assign({}, env, change)));
        }
        const server = readServerConfig(Object.assign({ MONGO_URL: 'mongodb://127.0.0.1:1' }, env));
        assert.deepEqual(server.imageMetadata, configuration());
    });
});

describe('owner image metadata and quota transactions on verified isolated MongoDB', function () {
    this.timeout(180000);
    let isolated, db, app, app2, owner, other, ownerRecord, otherRecord, plan, item, otherPlan, otherItem;
    const makeApp = (changes, database = db) => createApp({ connectToDatabase: async () => database,
        imageMetadata: configuration(changes), imageControlLimit: 10000, authLimit: 10000, logger: pino({ level: 'silent' }) });
    const root = (parent = plan, object = item) => '/api/move-out-plans/' + parent._id + '/items/' + object._id + '/images';
    const post = (path, data, user = owner, server = app) => write(request(server).post(path)).set('Cookie', user.cookie).send(data);
    const reserve = (data = intent(), parent = plan, object = item, user = owner, server = app) => post(root(parent, object) + '/uploads', data, user, server);
    const read = (parent = plan, object = item, user = owner, server = app) => request(server).get(root(parent, object)).set('Cookie', user.cookie);
    const remove = (id, revision = 0, server = app) => post(root() + '/' + id + '/actions', { action: 'delete', imageRevision: revision }, owner, server);
    const quota = () => db.collection('users').findOne({ _id: owner.id }).then(row => row.itemImageQuota);
    const currentItem = () => db.collection('items').findOne({ _id: item._id });
    const revision = async () => (await currentItem()).imageRevision || 0;
    const op = id => db.collection('itemImages').findOne({ _id: new ObjectId(id) });
    async function parentAndItem(user = owner) {
        const now = new Date();
        const p = { _id: new ObjectId(), ownerId: user.id, title: 'Synthetic plan', city: 'San Francisco', neighborhood: 'Sunset',
            stateId: '06', metroId: '41860', pickupTimeZone: 'UTC', moveOutDeadline: day(20), status: 'active', createdAt: now, updatedAt: now, inventoryRevision: 0 };
        const i = { _id: new ObjectId(), ownerId: user.id, planId: p._id, name: 'Synthetic chair', description: 'Synthetic household listing.',
            category: '', categoryId: 'other-household', itemTypeId: 'other', status: 'draft', version: 1,
            availableFrom: null, availableUntil: null, publishedAt: null, createdAt: now, updatedAt: now };
        await db.collection('moveOutPlans').insertOne(p); await db.collection('items').insertOne(i);
        return { p, i };
    }
    async function setQuota(changes) {
        let q = await quota();
        if (!q) {
            const clock = await db.collection('users').aggregate([{ $match: { _id: owner.id } }, { $project: { now: '$$NOW' } }]).next();
            q = quotaFor(undefined, clock.now);
        }
        q = Object.assign(q, changes);
        await db.collection('users').updateOne({ _id: owner.id }, { $set: { itemImageQuota: q } });
        return q;
    }
    // Controlled fixture only: model a future verified B3 transition with real
    // transaction accounting. No production API/service can produce ready/processing.
    async function stage(id, state = 'ready', position = 0) {
        const session = db.client.startSession();
        try { return await session.withTransaction(async () => {
            const row = await db.collection('itemImages').findOne({ _id: new ObjectId(id) }, { session });
            const account = await db.collection('users').findOne({ _id: owner.id }, { session });
            const q = account.itemImageQuota;
            row.state = state; row.lease.claimedAt = new Date(); row.lease.fenceToken = randomUUID();
            if (state === 'ready') {
                row.sortPosition = position; row.readyAt = new Date(); row.needsMaintenance = false; row.maintenanceDueAt = null;
                row.charge = Object.assign({}, row.charge, { reservedBytes: 0, retainedBytes: 48,
                    heldSuccess: false, concurrencyHeld: false, dailySuccessCharged: true, holdsSettled: true });
                q.reservedBytes -= ceiling.reservedBytes; q.retainedBytes += 48; q.activeUploads--; q.heldSuccess--; q.successful++;
            }
            for (const [name, size] of [['thumbnail', 16], ['display', 32]]) {
                if (state !== 'ready' && name === 'display') continue;
                Object.assign(row.variants[name], { outcome: state === 'ready' ? 'stored' : 'unknown', byteLength: size,
                    sha256: 'd'.repeat(64), width: 100, height: 100 });
            }
            assert.equal(validOperation(row), true);
            await db.collection('itemImages').replaceOne({ _id: row._id }, row, { session });
            await db.collection('users').updateOne({ _id: owner.id }, { $set: { itemImageQuota: q } }, { session });
            return row;
        }); } finally { await session.endSession(); }
    }
    async function ready(count) {
        const rows = [];
        for (let n = 0; n < count; n++) rows.push(await stage((await reserve().expect(201)).body.upload.id, 'ready', n));
        return rows;
    }
    before(async function () {
        isolated = await createIsolatedMongo(); db = isolated.db; await prepareDatabaseIndexes(db); app = makeApp(); app2 = makeApp();
        async function account(email) {
            const response = await write(request(app).post('/api/auth/register')).send({ email, firstName: 'Synthetic', lastName: 'Owner', password: 'synthetic-image-password' }).expect(201);
            return { id: new ObjectId(response.body.user.id), cookie: response.headers['set-cookie'][0].split(';')[0], email };
        }
        owner = await account('images-owner@example.test'); other = await account('images-other@example.test');
        ownerRecord = await db.collection('users').findOne({ _id: owner.id }); otherRecord = await db.collection('users').findOne({ _id: other.id });
    });
    after(async function () { if (isolated) await isolated.close(); });
    beforeEach(async function () {
        for (const name of ['itemImages', 'items', 'moveOutPlans', 'pickupRequests', 'pickupMessages', 'users']) await db.collection(name).deleteMany({});
        await db.collection('users').insertMany([Object.assign({}, ownerRecord), Object.assign({}, otherRecord)]);
        await prepareDatabaseIndexes(db);
        const a = await parentAndItem(); plan = a.p; item = a.i;
        const b = await parentAndItem(other); otherPlan = b.p; otherItem = b.i;
    });
    afterEach(function () { sinon.restore(); });

    it('creates only server-controlled reservations using MongoDB time, with no storage call or ready image', async function () {
        const spy = sinon.stub(require('@aws-sdk/client-s3').S3Client.prototype, 'send').throws(new Error('Storage must not be contacted'));
        sinon.stub(Date, 'now').returns(0);
        const input = intent(); const result = await reserve(input).expect(201);
        assert.equal(result.body.binaryUploadsEnabled, false); assert.equal(result.body.imageRevision, 0);
        assert.equal(result.body.upload.state, 'reserved'); assert.equal((await read()).body.images.length, 0);
        const row = await op(result.body.upload.id); assert.equal(validOperation(row), true);
        assert.ok(row.ownerId.equals(owner.id)); assert.ok(row.planId.equals(plan._id)); assert.ok(row.itemId.equals(item._id));
        assert.ok(row.createdAt.getUTCFullYear() > 2020); assert.ok(row.lease.expiresAt > row.createdAt);
        assert.ok(row.lease.expiresAt - row.createdAt <= 120000);
        assert.equal(row.charge.quotaDay, row.createdAt.toISOString().slice(0, 10));
        assert.equal(row.lease.claimedAt, null); assert.equal(row.readyAt, null); assert.equal(spy.callCount, 0);
        assert.equal((await currentItem()).version, 1); assert.equal((await currentItem()).imageRevision, undefined);
        const q = await quota(); assert.equal(q.attempts, 1); assert.equal(q.heldSuccess, 1); assert.equal(q.activeUploads, 1);
        assert.equal(q.reservedBytes, ceiling.reservedBytes); assert.equal(q.operationCount, 1); assert.equal(q.successful, 0);
    });
    it('keeps metadata routes disabled by default and never exposes multipart or binary image paths', async function () {
        const disabled = createApp({ connectToDatabase: async () => db, logger: pino({ level: 'silent' }) });
        await request(disabled).get(root()).set('Cookie', owner.cookie).expect(404);
        await post(root() + '/uploads', intent(), owner, disabled).expect(404);
        await write(request(app).put(root() + '/' + new ObjectId() + '/content')).set('Cookie', owner.cookie).type('multipart/form-data').send('synthetic').expect(415);
        await request(app).get('/api/item-images/' + new ObjectId() + '/display').expect(404);
        assert.equal(await db.collection('itemImages').countDocuments(), 0); assert.equal(await quota(), undefined);
    });
    it('reports owner-only admission allowance and unavailable binary capability without creating quota or storage', async function () {
        const result = await read().expect(200);
        assert.deepEqual(result.body.capabilities, { metadata: true, binaryUpload: false, imageRead: false });
        assert.deepEqual(result.body.allowance, { itemSlots: 5, attempts: 50, successes: 20, storageBytes: defaults.accountBytes,
            concurrent: 2, records: 1000, newUploadsAllowed: true });
        assert.equal(result.body.binaryUploadsEnabled, false); assert.equal(await quota(), undefined);
        assert.equal(await db.collection('itemImages').countDocuments(), 0);
        await db.collection('items').updateOne({ _id: item._id }, { $set: { status: 'cleared' } });
        assert.equal((await read().expect(200)).body.allowance.newUploadsAllowed, false);
    });
    it('previews only safe never-claimed expiry for admission without persisting reaping or refunding unknown holds', async function () {
        const a = (await reserve().expect(201)).body.upload.id, b = (await reserve().expect(201)).body.upload.id;
        await stage(b, 'processing');
        const past = new Date(Date.now() - 10000);
        await db.collection('itemImages').updateMany({}, { $set: { 'lease.expiresAt': past, maintenanceDueAt: past } });
        const before = await quota(), rowBefore = await op(a);
        const result = await read().expect(200);
        assert.equal(result.body.allowance.itemSlots, 4); assert.equal(result.body.allowance.concurrent, 1);
        assert.equal(result.body.allowance.successes, 19); assert.equal(result.body.allowance.attempts, 48);
        assert.deepEqual(await quota(), before); assert.deepEqual(await op(a), rowBefore);
        assert.equal((await op(b)).variants.thumbnail.outcome, 'unknown');
    });
    it('recovers a lost reservation response by stable UUID without another write or exposing private internals', async function () {
        const input = intent(); const created = await reserve(input).expect(201); const before = await quota();
        const response = await request(app2).get(root() + '/uploads/' + input.clientUploadId).set('Cookie', owner.cookie).expect(200);
        assert.equal(response.body.upload.id, created.body.upload.id); assert.equal(response.body.upload.state, 'reserved');
        assert.deepEqual(await quota(), before); assert.equal(await db.collection('itemImages').countDocuments(), 1);
        const text = JSON.stringify(response.body);
        for (const privateValue of [input.sha256, owner.email, owner.id.toHexString(), binding.fingerprint, binding.namespace]) assert.ok(!text.includes(privateValue));
        await remove(created.body.upload.id).expect(202);
        const closed = await request(app).get(root() + '/uploads/' + input.clientUploadId).set('Cookie', owner.cookie).expect(200);
        assert.equal(closed.body.upload.state, 'delete_pending'); assert.equal((await quota()).attempts, 1);
    });
    it('protects UUID recovery from anonymous users, foreign owners, other items and malformed or absent identifiers', async function () {
        const input = intent(); await reserve(input).expect(201); const path = root() + '/uploads/' + input.clientUploadId;
        await request(app).get(path).expect(401); await request(app).get(path).set('Cookie', other.cookie).expect(404);
        await request(app).get(root(otherPlan, otherItem) + '/uploads/' + input.clientUploadId).set('Cookie', other.cookie).expect(404);
        for (const value of ['bad', randomUUID()]) await request(app).get(root() + '/uploads/' + value).set('Cookie', owner.cookie).expect(404);
        assert.equal((await quota()).attempts, 1);
    });
    it('rejects anonymous, invalid and expired sessions and verifies original ownership on every read/write', async function () {
        await request(app).get(root()).expect(401);
        await request(app).get(root()).set('Cookie', 'giftlink_session=' + '0'.repeat(64)).expect(401);
        const id = (await reserve().expect(201)).body.upload.id;
        await read(plan, item, other).expect(404);
        await reserve(intent(), plan, item, other).expect(404);
        await request(app).get(root() + '/' + id).set('Cookie', other.cookie).expect(404);
        await post(root() + '/' + id + '/actions', { action: 'delete', imageRevision: 0 }, other).expect(404);
        const token = 'f'.repeat(64); const { tokenHash } = require('../services/identity');
        await db.collection('sessions').insertOne({ _id: tokenHash(token), userId: owner.id, expiresAt: new Date(0) });
        await request(app).get(root()).set('Cookie', 'giftlink_session=' + token).expect(401);
        assert.equal((await quota()).attempts, 1);
    });
    it('denies foreign/malformed parent, item and operation IDs without leaking the existing row', async function () {
        const id = (await reserve().expect(201)).body.upload.id;
        await read(otherPlan, item).expect(404); await read(plan, otherItem).expect(404);
        for (const bad of [new ObjectId().toString(), 'bad']) {
            await request(app).get(root() + '/' + bad).set('Cookie', owner.cookie).expect(404);
            await request(app).get('/api/move-out-plans/' + bad + '/items/' + item._id + '/images').set('Cookie', owner.cookie).expect(404);
        }
        await db.collection('itemImages').updateOne({ _id: new ObjectId(id) }, { $set: { ownerId: other.id } });
        await request(app).get(root() + '/' + id).set('Cookie', owner.cookie).expect(404);
    });
    it('denies deleted accounts and invalid ownership chains, including direct service calls', async function () {
        const id = (await reserve().expect(201)).body.upload.id;
        await db.collection('moveOutPlans').updateOne({ _id: plan._id }, { $set: { ownerId: other.id } });
        await request(app).get(root() + '/' + id).set('Cookie', owner.cookie).expect(404);
        await db.collection('moveOutPlans').updateOne({ _id: plan._id }, { $set: { ownerId: owner.id } });
        await db.collection('items').updateOne({ _id: item._id }, { $set: { planId: otherPlan._id } });
        await read().expect(404);
        await db.collection('users').deleteOne({ _id: owner.id });
        await read().expect(401);
        const service = createItemImagesService({ connectToDatabase: async () => db, configuration: configuration() });
        await assert.rejects(service.reserve(owner.id, plan._id.toString(), item._id.toString(), intent()), error => error.status === 404);
        assert.equal(await db.collection('users').countDocuments({ _id: owner.id }), 0);
    });
    it('preserves exact Origin, CSRF, JSON/body bounds and rejects client-controlled internal fields', async function () {
        const before = await db.collection('moveOutPlans').findOne({ _id: plan._id });
        await request(app).post(root() + '/uploads').set('Cookie', owner.cookie).send(intent()).expect(403);
        await request(app).post(root() + '/uploads').set('Cookie', owner.cookie).set('Origin', 'https://wrong.invalid').set('X-CSRF-Protection', '1').send(intent()).expect(403);
        for (const extra of [{ ownerId: other.id.toString() }, { state: 'ready' }, { storageBinding: binding }, { generation: randomUUID() }, { filename: 'private.txt' }, { bytes: 'abc' }]) {
            await reserve(Object.assign(intent(), extra)).expect(400);
        }
        for (const extra of [{ byteLength: 0 }, { byteLength: 3 * 1024 * 1024 + 1 }, { byteLength: '100' },
            { imageRevision: -1 }, { imageRevision: 1e30 }, { sha256: 'bad' }, { clientUploadId: { $ne: '' } }]) await reserve(Object.assign(intent(), extra)).expect(400);
        await reserve(Object.assign(intent(), { filename: 'x'.repeat(34000) })).expect(413);
        await request(app).get(root() + '?all=true').set('Cookie', owner.cookie).expect(400);
        assert.equal(await db.collection('itemImages').countDocuments(), 0); assert.equal(await quota(), undefined);
        assert.deepEqual(await db.collection('moveOutPlans').findOne({ _id: plan._id }), before);
    });
    it('returns a safe bounded owner DTO without hashes, storage keys/bindings, account IDs or leases', async function () {
        const input = intent(); const result = await reserve(input).expect(201);
        const status = await request(app).get(root() + '/' + result.body.upload.id).set('Cookie', owner.cookie).expect(200);
        const listed = await read().expect(200); const text = JSON.stringify([result.body, status.body, listed.body]);
        for (const forbidden of [input.sha256, binding.fingerprint, binding.namespace, owner.id.toString(), owner.email,
            'fenceToken', 'reservedBytes":1310720,"retainedBytes', 'credentials', 'itemImageQuota']) assert.ok(!text.includes(forbidden));
        assert.equal(listed.headers['cache-control'], 'no-store'); assert.deepEqual(listed.body.images, []);
    });
    it('recovers a lost response by identical upload ID and rejects changed hash/length intent', async function () {
        const input = intent(); await reserve(input).expect(201); // Client deliberately discards the first result.
        const result = await reserve(input).expect(200);
        assert.equal((await request(app).get(root() + '/' + result.body.upload.id).set('Cookie', owner.cookie)).body.upload.state, 'reserved');
        await reserve(Object.assign({}, input, { byteLength: input.byteLength + 1 })).expect(409);
        await reserve(Object.assign({}, input, { sha256: 'd'.repeat(64) })).expect(409);
        assert.equal(await db.collection('itemImages').countDocuments(), 1); assert.equal((await quota()).attempts, 1);
    });
    it('serializes duplicate reservations across two app instances without double charging', async function () {
        const input = intent(); const results = await Promise.all([reserve(input), reserve(input, plan, item, owner, app2)]);
        assert.deepEqual(results.map(r => r.status).sort(), [200, 201]);
        assert.equal(results[0].body.upload.id, results[1].body.upload.id);
        assert.equal(await db.collection('itemImages').countDocuments(), 1); assert.equal((await quota()).operationCount, 1);
    });
    it('enforces the last of five item slots across two instances, including ready and reserved operations', async function () {
        await ready(4);
        const results = await Promise.all([reserve(), reserve(intent(), plan, item, owner, app2)]);
        assert.deepEqual(results.map(r => r.status).sort(), [201, 409]);
        assert.equal(results.find(r => r.status === 409).body.error.code, 'IMAGE_ITEM_LIMIT');
        assert.equal(await db.collection('itemImages').countDocuments(), 5); assert.equal((await quota()).successful, 4);
        assert.equal((await quota()).activeUploads, 1);
    });
    it('shares concurrent account allowance across plans, sessions and instances', async function () {
        const second = await parentAndItem();
        const login = await write(request(app2).post('/api/auth/login')).send({ email: owner.email, password: 'synthetic-image-password' }).expect(200);
        const session = { id: owner.id, cookie: login.headers['set-cookie'][0].split(';')[0] };
        await Promise.all([reserve().expect(201), reserve(intent(), second.p, second.i, session, app2).expect(201)]);
        assert.equal((await reserve().expect(429)).body.error.code, 'IMAGE_UPLOAD_CAPACITY');
        assert.equal((await quota()).activeUploads, 2); assert.equal((await quota()).reservedBytes, 2 * ceiling.reservedBytes);
    });
    it('enforces provisional attempt, successful/held, byte and retained-record caps with actionable errors', async function () {
        await setQuota({ attempts: 50 }); assert.equal((await reserve().expect(429)).body.error.code, 'IMAGE_DAILY_ATTEMPTS');
        await setQuota({ attempts: 0, successful: 20 }); assert.equal((await reserve().expect(429)).body.error.code, 'IMAGE_DAILY_UPLOADS');
        await setQuota({ successful: 0, retainedBytes: 100 * 1024 * 1024 }); assert.equal((await reserve().expect(429)).body.error.code, 'IMAGE_STORAGE_CAPACITY');
        await setQuota({ retainedBytes: 0, operationCount: 1000 });
        const result = await reserve().expect(429); assert.equal(result.body.error.code, 'IMAGE_RECORD_LIMIT'); assert.equal(result.body.error.retryAfterSeconds, undefined);
        assert.equal(await db.collection('itemImages').countDocuments(), 0);
    });
    for (const [caps, code] of [[{ concurrent: 1 }, 'IMAGE_UPLOAD_CAPACITY'],
        [{ accountBytes: ceiling.reservedBytes }, 'IMAGE_STORAGE_CAPACITY'], [{ successes: 1 }, 'IMAGE_DAILY_UPLOADS']]) {
        it('serializes cross-plan first-use admission at the last ' + code + ' allowance', async function () {
            const second = await parentAndItem(); const firstApp = makeApp(caps); const secondApp = makeApp(caps);
            const results = await Promise.all([reserve(intent(), plan, item, owner, firstApp),
                reserve(intent(), second.p, second.i, owner, secondApp)]);
            assert.deepEqual(results.map(r => r.status).sort(), [201, 429]);
            assert.equal(results.find(r => r.status === 429).body.error.code, code);
            const q = await quota(); assert.equal(q.attempts, 1); assert.equal(q.operationCount, 1);
            assert.equal(q.heldSuccess, 1); assert.equal(q.reservedBytes, ceiling.reservedBytes); assert.equal(q.activeUploads, 1);
        });
    }
    it('fails closed on changed target bindings or compromised image references without hiding existing slots', async function () {
        const input = intent(); const row = await op((await reserve(input).expect(201)).body.upload.id); const q = await quota();
        for (const field of ['fingerprint', 'namespace']) {
            await db.collection('itemImages').updateOne({ _id: row._id }, { $set: { ['storageBinding.' + field]: field === 'fingerprint' ? 'e'.repeat(64) : 'item-images-test-' + 'e'.repeat(32) } });
            assert.equal((await read().expect(409)).body.error.code, 'IMAGE_METADATA_INVALID');
            await reserve(input).expect(409); await reserve().expect(409); await remove(row._id.toString()).expect(409);
            await db.collection('itemImages').replaceOne({ _id: row._id }, row);
        }
        await db.collection('itemImages').updateOne({ _id: row._id }, { $set: { ownerId: other.id } });
        await reserve().expect(404); await read().expect(404);
        assert.deepEqual(await quota(), q); assert.equal(await db.collection('itemImages').countDocuments(), 1);
    });
    it('keeps failed unknown writes in the five-slot cap after timeout and logical deletion', async function () {
        await ready(4); const id = (await reserve().expect(201)).body.upload.id;
        const row = await stage(id, 'processing'); const q = await quota();
        await db.collection('itemImages').updateOne({ _id: row._id }, { $set: { state: 'failed',
            'lease.expiresAt': new Date(1), 'cleanup.reason': 'pipeline_failed' } });
        assert.ok(validOperation(await op(id)));
        assert.equal((await reserve().expect(409)).body.error.code, 'IMAGE_ITEM_LIMIT');
        await remove(id).expect(202);
        assert.equal((await reserve(Object.assign(intent(), { imageRevision: 1 })).expect(409)).body.error.code, 'IMAGE_ITEM_LIMIT');
        assert.deepEqual(await quota(), q); assert.equal((await op(id)).charge.slotHeld, true);
    });
    it('bounds recent operation history while retaining active status and direct lost-response recovery', async function () {
        const id = (await reserve().expect(201)).body.upload.id; await remove(id).expect(202);
        const original = await op(id); const rows = [];
        for (let index = 0; index < 24; index++) {
            const row = Object.assign({}, original, { _id: new ObjectId(), clientUploadId: randomUUID(), generation: randomUUID(), variants: {} });
            for (const name of ['thumbnail', 'display']) row.variants[name] = Object.assign({}, original.variants[name],
                { key: binding.namespace + '/' + row._id + '/' + row.generation + '/' + name + '.webp' });
            assert.ok(validOperation(row)); rows.push(row);
        }
        await db.collection('itemImages').insertMany(rows); await setQuota({ operationCount: 25, attempts: 25 });
        const active = (await reserve(Object.assign(intent(), { imageRevision: 1 })).expect(201)).body.upload.id;
        const result = await read().expect(200); assert.equal(result.body.uploads.length, 21);
        assert.equal(result.body.uploads[0].id, active);
        await request(app).get(root() + '/' + id).set('Cookie', owner.cookie).expect(200);
        assert.equal((await quota()).operationCount, 26);
    });
    it('keeps attempts and retained records consumed after safe deletion without double settlement', async function () {
        const limited = makeApp({ records: 1 }); const input = intent();
        const id = (await reserve(input, plan, item, owner, limited).expect(201)).body.upload.id;
        await remove(id, 0, limited).expect(202); const q = await quota();
        assert.equal(q.attempts, 1); assert.equal(q.operationCount, 1); assert.equal(q.activeUploads, 0); assert.equal(q.reservedBytes, 0); assert.equal(q.heldSuccess, 0);
        await remove(id, 0, limited).expect(202); assert.deepEqual(await quota(), q);
        assert.equal((await reserve(Object.assign(intent(), { imageRevision: 1 }), plan, item, owner, limited).expect(429)).body.error.code, 'IMAGE_RECORD_LIMIT');
        const replay = await reserve(input, plan, item, owner, limited).expect(200);
        assert.equal(replay.body.upload.state, 'delete_pending'); assert.equal(replay.body.imageRevision, 1);
    });
    it('does not refund daily successes or retained bytes on logical deletion of a ready image', async function () {
        const limited = makeApp({ successes: 1 }); const row = (await ready(1))[0]; const before = await quota();
        await remove(row._id.toString(), 0, limited).expect(202);
        assert.equal((await quota()).successful, before.successful); assert.equal((await quota()).retainedBytes, before.retainedBytes);
        assert.equal((await reserve(Object.assign(intent(), { imageRevision: 1 }), plan, item, owner, limited).expect(429)).body.error.code, 'IMAGE_DAILY_UPLOADS');
        assert.equal((await op(row._id)).charge.retainedBytes, 48); assert.equal((await op(row._id)).needsMaintenance, true);
    });
    it('uses imageRevision independently of item version and reorders only the complete ready set without renaming keys', async function () {
        const rows = await ready(2); const before = await currentItem(); const keys = rows.map(r => r.variants);
        const path = root() + '/order';
        for (const ids of [[rows[0]._id.toString()], [rows[0]._id.toString(), new ObjectId().toString()]]) await post(path, { imageRevision: 0, imageIds: ids }).expect(409);
        await post(path, { imageRevision: 0, imageIds: [rows[0]._id.toString(), rows[0]._id.toString()] }).expect(400);
        const ids = rows.map(r => r._id.toString()).reverse(); const result = await post(path, { imageRevision: 0, imageIds: ids }).expect(200);
        assert.equal(result.body.imageRevision, 1); assert.deepEqual(result.body.images.map(r => r.id), ids);
        await post(path, { imageRevision: 0, imageIds: ids }).expect(409);
        assert.equal((await currentItem()).version, before.version); assert.equal((await currentItem()).name, before.name);
        assert.deepEqual((await op(rows[0]._id)).variants, keys[0]); assert.deepEqual((await op(rows[1]._id)).variants, keys[1]);
    });
    it('preserves both concurrent inventory edits and photo order changes under the plan boundary', async function () {
        const rows = await ready(2);
        const edit = write(request(app).patch('/api/move-out-plans/' + plan._id + '/items/' + item._id)).set('Cookie', owner.cookie).send({ version: 1, name: 'Updated household chair' });
        const order = post(root() + '/order', { imageRevision: 0, imageIds: rows.map(r => r._id.toString()).reverse() }, owner, app2);
        const results = await Promise.all([edit, order]); assert.deepEqual(results.map(r => r.status), [200, 200]);
        const stored = await currentItem(); assert.equal(stored.version, 2); assert.equal(stored.imageRevision, 1); assert.equal(stored.name, 'Updated household chair');
        assert.equal(stored.status, 'draft');
    });
    it('renumbers remaining ready images on deletion and leaves durable cleanup metadata and byte charges', async function () {
        const rows = await ready(3); const before = await quota();
        await remove(rows[1]._id.toString()).expect(202);
        const result = await read().expect(200); assert.deepEqual(result.body.images.map(r => r.sortPosition), [0, 1]);
        assert.equal(result.body.imageRevision, 1); assert.equal(result.body.uploads[0].cleanupPending, true);
        const deleted = await op(rows[1]._id); assert.equal(deleted.state, 'delete_pending'); assert.equal(deleted.deletedAt, null);
        assert.equal(deleted.sortPosition, null); assert.ok(deleted.lease.fenceToken); assert.equal(deleted.needsMaintenance, true);
        assert.deepEqual(await quota(), before); assert.equal((await currentItem()).version, 1);
    });
    it('serializes delete versus order and preserves the winner without losing the cover or unrelated item text', async function () {
        const rows = await ready(3), ids = rows.map(row => row._id.toString()), before = await quota();
        const results = await Promise.all([
            remove(ids[0]), post(root() + '/order', { imageRevision: 0, imageIds: ids.slice().reverse() }, owner, app2)
        ]);
        assert.equal(results.filter(result => result.status === 409).length, 1);
        const list = (await read().expect(200)).body;
        assert.equal(list.imageRevision, 1); assert.deepEqual(list.images.map(row => row.sortPosition), list.images.map((_, index) => index));
        assert.deepEqual(list.images.map(row => row.id), results[0].status === 202 ? ids.slice(1) : ids.slice().reverse());
        assert.deepEqual(await quota(), before); assert.equal((await currentItem()).version, 1);
        assert.equal((await currentItem()).name, 'Synthetic chair');
    });
    it('denies anonymous, CSRF, foreign-participant and mismatched-item management without changing photos or accounting', async function () {
        const rows = await ready(2), ids = rows.map(row => row._id.toString()), before = await quota();
        const beforeRows = await db.collection('itemImages').find({}).toArray(); const second = await parentAndItem();
        const order = { imageRevision: 0, imageIds: ids.slice().reverse() }, deletion = { imageRevision: 0, action: 'delete' };
        for (const [path, input] of [[root() + '/order', order], [root() + '/' + ids[0] + '/actions', deletion]]) {
            await write(request(app).post(path)).send(input).expect(401);
            await request(app).post(path).set('Cookie', owner.cookie).send(input).expect(403);
            await post(path, input, other).expect(404);
        }
        await post(root(second.p, second.i) + '/' + ids[0] + '/actions', deletion).expect(404);
        await post(root(second.p, second.i) + '/order', order).expect(409);
        assert.deepEqual(await db.collection('itemImages').find({}).toArray(), beforeRows); assert.deepEqual(await quota(), before);
        assert.equal(await revision(), 0);
    });
    it('rejects stale revisions and malformed ready ordering without silently repairing data', async function () {
        const rows = await ready(2);
        await remove(rows[0]._id.toString(), 7).expect(409);
        await db.collection('itemImages').updateOne({ _id: rows[1]._id }, { $set: { sortPosition: 4 } });
        const before = await op(rows[1]._id);
        await read().expect(409); await remove(rows[0]._id.toString()).expect(409);
        assert.deepEqual(await op(rows[1]._id), before); assert.equal(await revision(), 0);
    });
    it('reads and deletes retained photos for cleared/inactive plans but blocks new reservations there', async function () {
        const row = (await ready(1))[0];
        await db.collection('items').updateOne({ _id: item._id }, { $set: { status: 'cleared' } });
        await db.collection('moveOutPlans').updateOne({ _id: plan._id }, { $set: { status: 'completed' } });
        await read().expect(200); await reserve().expect(409);
        await post(root() + '/order', { imageRevision: 0, imageIds: [row._id.toString()] }).expect(200);
        await remove(row._id.toString()).expect(202); assert.equal((await currentItem()).status, 'cleared');
    });
    it('allows draft, published, unlisted and expired owner reservations without altering pickup requests', async function () {
        const pickup = { _id: new ObjectId(), itemId: item._id, planId: plan._id, giverId: owner.id, receiverId: other.id,
            status: 'accepted', active: true, note: 'Synthetic private pickup context' };
        await db.collection('pickupRequests').insertOne(pickup);
        for (const state of ['draft', 'available', 'unlisted', 'expired']) {
            await db.collection('items').updateOne({ _id: item._id }, { $set: { status: state } });
            const result = await reserve(Object.assign(intent(), { imageRevision: await revision() })).expect(201);
            await remove(result.body.upload.id, await revision()).expect(202);
        }
        assert.deepEqual(await db.collection('pickupRequests').findOne({ _id: pickup._id }), pickup);
    });
    it('reads expired reservations without writes and safely reaps at most two never-claimed holds on admission', async function () {
        const ids = [(await reserve().expect(201)).body.upload.id, (await reserve().expect(201)).body.upload.id];
        await db.collection('itemImages').updateMany({}, { $set: { 'lease.expiresAt': new Date(0) } });
        const before = await db.collection('itemImages').find({}).toArray(); const q = await quota();
        const listed = await read().expect(200); assert.ok(listed.body.uploads.every(r => r.reservationExpired));
        assert.deepEqual(await db.collection('itemImages').find({}).toArray(), before); assert.deepEqual(await quota(), q);
        await reserve().expect(201);
        for (const id of ids) { const row = await op(id); assert.equal(row.state, 'failed'); assert.equal(row.charge.reservedBytes, 0); assert.equal(row.charge.holdsSettled, true); }
        assert.equal((await quota()).activeUploads, 1); assert.equal((await quota()).attempts, 3); assert.equal((await quota()).operationCount, 3);
    });
    it('settles expired never-claimed operations exactly once across competing instances', async function () {
        await reserve().expect(201); await reserve().expect(201);
        await db.collection('itemImages').updateMany({}, { $set: { 'lease.expiresAt': new Date(0) } });
        const results = await Promise.all([reserve(), reserve(intent(), plan, item, owner, app2)]);
        assert.deepEqual(results.map(r => r.status), [201, 201]);
        const q = await quota(); assert.equal(q.attempts, 4); assert.equal(q.operationCount, 4); assert.equal(q.activeUploads, 2); assert.equal(q.heldSuccess, 2);
        assert.equal(q.reservedBytes, 2 * ceiling.reservedBytes); assert.equal(await db.collection('itemImages').countDocuments({ state: 'failed' }), 2);
    });
    it('never settles uncertain processing on timeout or logical deletion and fences late finalization', async function () {
        const row = await stage((await reserve().expect(201)).body.upload.id, 'processing');
        await db.collection('itemImages').updateOne({ _id: row._id }, { $set: { 'lease.expiresAt': new Date(0) } });
        const oldFence = row.lease.fenceToken; await remove(row._id.toString()).expect(202);
        const pending = await op(row._id); assert.notEqual(pending.lease.fenceToken, oldFence); assert.equal(pending.charge.reservedBytes, ceiling.reservedBytes);
        assert.equal(pending.charge.concurrencyHeld, true); assert.equal(pending.charge.slotHeld, true);
        await reserve(Object.assign(intent(), { imageRevision: 1 })).expect(201);
        assert.equal((await reserve(Object.assign(intent(), { imageRevision: 1 })).expect(429)).body.error.code, 'IMAGE_UPLOAD_CAPACITY');
        assert.equal((await quota()).reservedBytes, 2 * ceiling.reservedBytes);
    });
    it('rotates UTC daily counters while preserving old-day uncertain byte/concurrency holds', async function () {
        const row = await stage((await reserve().expect(201)).body.upload.id, 'processing');
        const previousDay = day(-1);
        await db.collection('itemImages').updateOne({ _id: row._id }, { $set: { 'charge.quotaDay': previousDay, 'lease.expiresAt': new Date(0) } });
        await setQuota({ utcDay: previousDay, attempts: 50, successful: 19, heldSuccess: 1 });
        await reserve().expect(201); const q = await quota();
        assert.equal(q.utcDay, day(0)); assert.equal(q.attempts, 1); assert.equal(q.successful, 0); assert.equal(q.heldSuccess, 1);
        assert.equal(q.activeUploads, 2); assert.equal(q.reservedBytes, 2 * ceiling.reservedBytes);
        assert.equal((await op(row._id)).state, 'processing'); assert.equal((await op(row._id)).charge.heldSuccess, true);
    });
    it('reaps an old-day unused ticket without subtracting its held-success credit from the new day', async function () {
        const id = (await reserve().expect(201)).body.upload.id;
        await db.collection('itemImages').updateOne({ _id: new ObjectId(id) }, { $set: { 'charge.quotaDay': day(-1), 'lease.expiresAt': new Date(0) } });
        await setQuota({ utcDay: day(-1), attempts: 50, heldSuccess: 1 });
        await reserve().expect(201); const q = await quota(); assert.equal(q.heldSuccess, 1); assert.equal(q.activeUploads, 1); assert.equal(q.reservedBytes, ceiling.reservedBytes);
    });
    it('refuses corrupt or missing accounting instead of underflowing or silently initializing existing media', async function () {
        const id = (await reserve().expect(201)).body.upload.id;
        await setQuota({ activeUploads: 0 }); const before = await op(id);
        await remove(id).expect(409); assert.deepEqual(await op(id), before);
        await db.collection('users').updateOne({ _id: owner.id }, { $unset: { itemImageQuota: '' } });
        await reserve().expect(409); assert.equal(await quota(), undefined);
        await setQuota({ activeUploads: -1 }); await reserve().expect(409);
    });
    it('keeps account quotas private and preserves both photo and messaging counters during profile edits', async function () {
        await reserve().expect(201); const q = await quota();
        const messages = { minute: { count: 3, expiresAt: new Date(Date.now() + 60000) }, hour: { count: 3, expiresAt: new Date(Date.now() + 3600000) } };
        await db.collection('users').updateOne({ _id: owner.id }, { $set: { pickupMessageQuota: messages } });
        const result = await write(request(app).patch('/api/me')).set('Cookie', owner.cookie).send({ firstName: 'Updated' }).expect(200);
        assert.ok(!JSON.stringify(result.body).includes('Quota')); const user = await db.collection('users').findOne({ _id: owner.id });
        assert.deepEqual(user.itemImageQuota, q); assert.deepEqual(user.pickupMessageQuota, messages);
        assert.deepEqual(Object.keys(privateUser(user)).sort(), ['email', 'firstName', 'id', 'lastName']);
        assert.deepEqual(Object.keys(publicUser(user)).sort(), ['firstName', 'id']);
        const me = await request(app).get('/api/me').set('Cookie', owner.cookie).expect(200); assert.equal(me.body.user.itemImageQuota, undefined);
    });
    it('retries a real transaction after an injected post-insert failure with one stable operation and charge', async function () {
        const original = db.collection('itemImages').insertOne.bind(db.collection('itemImages')); const ids = []; let first = true;
        const database = { client: db.client, collection: name => {
            if (name !== 'itemImages') return db.collection(name);
            const collection = db.collection(name);
            return new Proxy(collection, { get(target, property) {
                if (property !== 'insertOne') { const value = target[property]; return typeof value === 'function' ? value.bind(target) : value; }
                return async (row, opts) => {
                    ids.push(row._id.toString()); const result = await original(row, opts);
                    if (first) { first = false; const error = new MongoServerError({ message: 'Synthetic retry' }); error.addErrorLabel('TransientTransactionError'); throw error; }
                    return result;
                };
            } });
        } };
        const result = await reserve(intent(), plan, item, owner, makeApp(null, database)).expect(201);
        assert.equal(ids.length, 2); assert.equal(ids[0], ids[1]); assert.equal(ids[1], result.body.upload.id);
        assert.equal(await db.collection('itemImages').countDocuments(), 1); assert.equal((await quota()).attempts, 1); assert.equal((await quota()).activeUploads, 1);
    });
    it('previews the four new indexes read-only and preserves metadata/accounts on repeated guarded preparation', async function () {
        const row = await op((await reserve().expect(201)).body.upload.id); await db.collection('itemImages').drop(); await db.collection('itemImages').insertOne(row);
        const before = await quota(); const planBefore = await db.collection('moveOutPlans').find({}).toArray();
        const preview = await inspectDatabaseIndexes(db);
        assert.deepEqual(preview.operations.filter(o => o.action === 'create').map(o => o.index),
            ['images_item_state_order', 'images_item_upload_unique', 'images_due_work', 'images_owner_state']);
        assert.deepEqual(preview.images, { invalidOperations: 0, duplicateGroups: 0, invalidQuotas: 0 });
        await assert.rejects(assertDatabaseIndexes(db)); assert.deepEqual(await op(row._id), row);
        await prepareDatabaseIndexes(db); await prepareDatabaseIndexes(db); await assertDatabaseIndexes(db);
        assert.deepEqual(await op(row._id), row); assert.deepEqual(await quota(), before); assert.deepEqual(await db.collection('moveOutPlans').find({}).toArray(), planBefore);
        const indexes = await db.collection('itemImages').indexes(); assert.equal(indexes.length, 5); assert.ok(indexes.every(i => i.expireAfterSeconds === undefined));
    });
    it('blocks malformed metadata, quota and incompatible indexes without repairs or private-data reports', async function () {
        const row = await op((await reserve().expect(201)).body.upload.id);
        await db.collection('itemImages').dropIndex('images_item_upload_unique');
        await db.collection('itemImages').createIndex({ itemId: 1, clientUploadId: 1 }, { name: 'images_item_upload_unique' });
        await db.collection('itemImages').updateOne({ _id: row._id }, { $set: { filename: 'private-file-name' } });
        await setQuota({ reservedBytes: -1 });
        const before = await db.collection('itemImages').find({}).toArray(); const q = await quota(); const preview = await inspectDatabaseIndexes(db);
        assert.equal(preview.ready, false); assert.equal(preview.images.invalidOperations, 1); assert.equal(preview.images.invalidQuotas, 1);
        assert.ok(preview.conflicts.some(c => c.problem === 'incompatible-index'));
        const text = JSON.stringify(preview); for (const forbidden of ['private-file-name', row.intent.sha256, row.variants.display.key]) assert.ok(!text.includes(forbidden));
        await assert.rejects(prepareDatabaseIndexes(db)); assert.deepEqual(await db.collection('itemImages').find({}).toArray(), before); assert.deepEqual(await quota(), q);
        await db.collection('itemImages').drop();
    });
    it('reports duplicate upload identities as counts and rejects creation without normalizing or merging rows', async function () {
        const row = await op((await reserve().expect(201)).body.upload.id); await db.collection('itemImages').dropIndex('images_item_upload_unique');
        const duplicate = Object.assign({}, row, { _id: new ObjectId(), generation: randomUUID(), variants: {} });
        for (const name of ['thumbnail', 'display']) duplicate.variants[name] = Object.assign({}, row.variants[name],
            { key: binding.namespace + '/' + duplicate._id + '/' + duplicate.generation + '/' + name + '.webp' });
        assert.ok(validOperation(duplicate)); await db.collection('itemImages').insertOne(duplicate);
        const preview = await inspectDatabaseIndexes(db); assert.equal(preview.images.duplicateGroups, 1); assert.equal(preview.ready, false);
        await assert.rejects(prepareDatabaseIndexes(db)); assert.equal(await db.collection('itemImages').countDocuments(), 2);
        assert.ok(!JSON.stringify(preview).includes(row.clientUploadId));
    });
});
