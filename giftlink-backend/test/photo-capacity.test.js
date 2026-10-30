/* jshint loopfunc: true */
const assert = require('node:assert/strict');
const { ObjectId, BSON } = require('mongodb');
const { randomUUID, randomBytes, createHash } = require('node:crypto');
const fs = require('node:fs'), path = require('node:path');
const sharp = require('sharp'), request = require('supertest'), pino = require('pino');
const { createIsolatedMongo } = require('./helpers/isolated-mongo');
const { r2Environment, blockProviderNetwork } = require('./helpers/r2-fixture');
const { ProtocolObjectStore } = require('./helpers/protocol-object-store');
const { prepareDatabaseIndexes } = require('../services/database-indexes');
const { openR2PhotoContext } = require('../util/r2-photo-context');
const { createR2ItemImagePipeline } = require('../services/item-image-pipeline');
const { createR2ImageRecovery } = require('../services/item-image-recovery');
const { approvalIdentity } = require('../services/r2-image-storage-config');
const { signApproval } = require('../services/r2-photo-approval');
const { variantKey, validOperation } = require('../services/item-image-policy');
const createApp = require('../app');
const hash = data => createHash('sha256').update(data).digest('hex');
const write = call => call.set('Origin', 'http://localhost:3000').set('X-CSRF-Protection', '1');
describe('ticket-scoped client capacity with real MongoDB/Sharp and synthetic protocol only', function () {
    this.timeout(180000); blockProviderNetwork();
    let mongo, db, f, context, pipeline, server, app, image, contexts;
    const root = item => '/api/move-out-plans/' + item.planId + '/items/' + item._id + '/images';
    const quota = async owner => (await db.collection('users').findOne({ _id: owner.id })).itemImageQuota;
    async function owner() {
        const result = await write(request(app).post('/api/auth/register')).send({ firstName: 'Synthetic', lastName: 'Capacity', email: randomUUID() + '@example.invalid', password: 'synthetic-capacity-password' }).expect(201);
        return { id: new ObjectId(result.body.user.id), cookie: result.headers['set-cookie'][0].split(';')[0] };
    }
    async function itemFor(actor) {
        const at = new Date(), plan = { _id: new ObjectId(), ownerId: actor.id, status: 'active', inventoryRevision: 0, moveOutDeadline: '2099-01-01', createdAt: at, updatedAt: at };
        const item = { _id: new ObjectId(), ownerId: actor.id, planId: plan._id, status: 'draft', version: 1, name: 'Synthetic capacity item', createdAt: at, updatedAt: at };
        await db.collection('moveOutPlans').insertOne(plan); await db.collection('items').insertOne(item); return item;
    }
    const revision = async item => (await db.collection('items').findOne({ _id: item._id })).imageRevision || 0;
    const input = async item => ({ imageRevision: await revision(item), clientUploadId: randomUUID(), byteLength: image.length, sha256: hash(image) });
    const reserve = async (actor, item) => (await write(request(app).post(root(item) + '/uploads')).set('Cookie', actor.cookie).send(await input(item)).expect(201)).body.upload.id;
    const upload = (actor, item, id, application = app) => write(request(application).put(root(item) + '/' + id + '/content')).set('Cookie', actor.cookie)
        .attach('file', image, { filename: 'synthetic.png', contentType: 'image/png' });
    const row = id => db.collection('itemImages').findOne({ _id: new ObjectId(id) });
    async function recovery() {
        const env = Object.assign({}, f.env, { ITEM_IMAGE_R2_ROLE: 'recovery', ITEM_IMAGE_R2_UPLOADS_ENABLED: 'false',
            ITEM_IMAGE_R2_ACCESS_KEY_ID: randomBytes(16).toString('hex'), ITEM_IMAGE_R2_SECRET_ACCESS_KEY: randomBytes(32).toString('hex'),
            ITEM_IMAGE_R2_APPROVAL_FILE: path.join(f.directory, randomUUID() + '.json') });
        fs.writeFileSync(env.ITEM_IMAGE_R2_APPROVAL_FILE, JSON.stringify(signApproval(approvalIdentity(env), f.privateKey)), { mode: 0o600 });
        const c = await openR2PhotoContext({ env, storageOptions: () => ({ requestHandler: server.client() }) }); contexts.push(c); return c;
    }
    async function preview(c) { const worker = createR2ImageRecovery(c); try { return await worker.preview(); } finally { worker.close(); } }
    async function apply(c, manifest) { const worker = createR2ImageRecovery(c); try { return await worker.apply(manifest, Object.assign({}, c.identity, { manifest: manifest.digest })); } finally { worker.close(); } }
    before(async function () { mongo = await createIsolatedMongo(); db = mongo.db; await prepareDatabaseIndexes(db);
        image = await sharp({ create: { width: 64, height: 48, channels: 3, background: '#557a61' } }).png().toBuffer(); });
    beforeEach(async function () {
        for (const name of ['itemImages', 'users', 'sessions', 'items', 'moveOutPlans']) await db.collection(name).deleteMany({});
        f = await r2Environment({ mongo }); server = new ProtocolObjectStore(); contexts = [];
        context = await openR2PhotoContext({ env: f.env, storageOptions: () => ({ requestHandler: server.client() }) }); contexts.push(context);
        pipeline = createR2ItemImagePipeline(context);
        app = createApp({ connectToDatabase: context.applicationConnectToDatabase, imageMetadata: context.metadata, imagePipeline: pipeline,
            imageControlLimit: 10000, authLimit: 10000, logger: pino({ level: 'silent' }) });
    });
    afterEach(async function () { pipeline.close(); for (const c of contexts) await c.close(); f.close(); });
    after(async function () { if (mongo) await mongo.close(); });
    it('passes 260 distinct PUT keys through one warm pipeline without raising any user quota or evicting an attempted key', async function () {
        const actors = []; let item, actor, first;
        for (let i = 0; i < 130; i++) {
            if (i % 20 === 0) { actor = await owner(); actors.push(actor); }
            if (i % 5 === 0) item = await itemFor(actor);
            const id = await reserve(actor, item); await upload(actor, item, id).expect(201); if (!first) first = { actor, item, id };
        }
        assert.equal(server.puts.size, 260); assert.ok([...server.puts.values()].every(n => n === 1));
        assert.equal(server.clients.length, 131); assert.equal(server.clients.filter(c => !c.closed).length, 1);
        assert.ok(server.clients.slice(1).every(c => c.closed && c.puts === 2));
        await upload(first.actor, first.item, first.id).expect(200); assert.equal(server.clients.length, 131); assert.equal(server.puts.size, 260);
        const second = createR2ItemImagePipeline(context), secondApp = createApp({ connectToDatabase: context.applicationConnectToDatabase,
            imageMetadata: context.metadata, imagePipeline: second, logger: pino({ level: 'silent' }) });
        try { await upload(first.actor, first.item, first.id, secondApp).expect(200); assert.equal(server.puts.size, 260); } finally { second.close(); }
        assert.equal(await db.collection('itemImages').countDocuments({ state: 'ready' }), 130);
        for (const actor of actors) { const q = await quota(actor); assert.ok(q.attempts <= 20 && q.successful <= 20 && q.retainedBytes < 100 * 1024 * 1024); assert.equal(q.activeUploads, 0); }
        const max = await db.collection('itemImages').aggregate([{ $match: { state: 'ready' } }, { $group: { _id: '$itemId', count: { $sum: 1 } } }, { $sort: { count: -1 } }]).next(); assert.equal(max.count, 5);
    });
    for (const failure of ['before', 'after']) it('retains an uncertain ' + failure + '-commit PUT across new clients and never automatically replays it', async function () {
        const actor = await owner(), item = await itemFor(actor), failed = await reserve(actor, item); server.failPut = failure;
        await upload(actor, item, failed).expect(503); const held = await quota(actor); assert.ok(held.activeUploads === 1 && held.reservedBytes > 0);
        const next = await reserve(actor, item); await upload(actor, item, next).expect(201);
        const clients = server.clients.length, puts = [...server.puts.values()].reduce((a, b) => a + b, 0);
        await upload(actor, item, failed).expect(409); assert.equal(server.clients.length, clients); assert.equal([...server.puts.values()].reduce((a, b) => a + b, 0), puts);
        const before = await quota(actor); assert.equal(before.activeUploads, 1); assert.equal(before.operationCount, 2);
        const past = new Date(Date.now() - 60000); await db.collection('itemImages').updateOne({ _id: new ObjectId(failed) }, { $set: { 'lease.expiresAt': past, maintenanceDueAt: past, 'cleanup.nextAttemptAt': null } });
        const c = await recovery(), manifest = await preview(c);
        assert.equal(manifest.operations[0].action, failure === 'before' ? 'unknown_write' : 'cleanup');
        const result = await apply(c, manifest);
        if (failure === 'before') { assert.equal(result.results[0].status, 'unresolved'); assert.deepEqual(await quota(actor), before); }
        else { assert.equal(result.results[0].status, 'deleted'); assert.equal((await quota(actor)).activeUploads, 0); }
        assert.equal((await quota(actor)).operationCount, 2); assert.equal((await row(next)).state, 'ready');
    });
    it('does not leak a native-processing slot or manufacture quota settlement when client teardown throws', async function () {
        const actor = await owner(), item = await itemFor(actor), id = await reserve(actor, item);
        server.failPut = 'before'; server.failClose = true;
        await upload(actor, item, id).expect(503); const held = await quota(actor);
        assert.equal(held.activeUploads, 1); assert.ok(held.reservedBytes > 0);
        const next = await reserve(actor, item); await upload(actor, item, next).expect(201);
        assert.equal((await row(id)).variants.thumbnail.outcome, 'unknown'); assert.equal((await quota(actor)).activeUploads, 1);
        assert.equal((await quota(actor)).operationCount, 2); assert.equal((await row(next)).state, 'ready');
        assert.ok(server.clients.slice(1).every(client => client.closed));
    });
    it('enforces 999/1000 retained rows under concurrent admission and keeps tombstones after cleanup and day rollover', async function () {
        const actor = await owner(), item = await itemFor(actor), id = await reserve(actor, item); await upload(actor, item, id).expect(201);
        await write(request(app).post(root(item) + '/' + id + '/actions')).set('Cookie', actor.cookie).send({ action: 'delete', imageRevision: await revision(item) }).expect(202);
        const c = await recovery(); await apply(c, await preview(c)); const template = await row(id), old = new Date(Date.now() - 10 * 86400000), oldDay = old.toISOString().slice(0, 10), records = [];
        // Construct valid synthetic historical rows, not a claim of 999 real uploads.
        for (let i = 0; i < 999; i++) {
            const r = BSON.deserialize(BSON.serialize(template)); r._id = new ObjectId(); r.clientUploadId = randomUUID(); r.generation = randomUUID();
            const stamp = new Date(old.getTime() - Math.floor(i / 20) * 86400000);
            for (const key of ['createdAt', 'updatedAt', 'readyAt', 'deleteRequestedAt', 'deletedAt']) r[key] = stamp;
            r.charge.quotaDay = stamp.toISOString().slice(0, 10); r.charge.storageReleasedAt = stamp;
            r.lease.claimedAt = stamp; r.lease.expiresAt = new Date(stamp.getTime() + 60000);
            r.cleanup.recovery.claimedAt = stamp; r.cleanup.recovery.expiresAt = new Date(stamp.getTime() + 60000);
            for (const name of ['thumbnail', 'display']) r.variants[name].key = variantKey(r, name);
            assert.ok(validOperation(r)); records.push(r);
        }
        await db.collection('itemImages').deleteMany({}); await db.collection('itemImages').insertMany(records);
        const q = await quota(actor); q.utcDay = oldDay; q.attempts = 20; q.successful = 20; q.operationCount = 999;
        await db.collection('users').updateOne({ _id: actor.id }, { $set: { itemImageQuota: q } });
        const data = [await input(item), await input(item)];
        const responses = await Promise.all(data.map(body => write(request(app).post(root(item) + '/uploads')).set('Cookie', actor.cookie).send(body)));
        assert.equal(responses.filter(r => r.status === 201).length, 1); assert.equal(await db.collection('itemImages').countDocuments(), 1000);
        const limited = await write(request(app).post(root(item) + '/uploads')).set('Cookie', actor.cookie).send(await input(item)).expect(429); assert.equal(limited.body.error.code, 'IMAGE_RECORD_LIMIT');
        const reserved = await db.collection('itemImages').findOne({ state: 'reserved' }), past = new Date(Date.now() - 60000);
        await db.collection('itemImages').updateOne({ _id: reserved._id }, { $set: { 'lease.expiresAt': past, maintenanceDueAt: past } });
        const manifest = await preview(c), workers = await Promise.allSettled([apply(c, manifest), apply(c, manifest)]);
        assert.equal(workers.filter(r => r.status === 'fulfilled' && r.value.results[0].status === 'deleted').length, 1);
        assert.equal((await quota(actor)).operationCount, 1000); assert.equal((await quota(actor)).reservedBytes, 0); assert.equal(await db.collection('itemImages').countDocuments({ state: 'deleted' }), 1000);
        await write(request(app).post(root(item) + '/uploads')).set('Cookie', actor.cookie).send(await input(item)).expect(429);
    });
});
