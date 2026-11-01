/* jshint loopfunc: true */
// UX-2C1: owner-only private photos for independent (v2) drafts, through the
// same quota, lease, sanitization and private storage pipeline as legacy items.
const assert = require('node:assert/strict');
const { randomUUID, createHash } = require('node:crypto');
const { ObjectId } = require('mongodb');
const sharp = require('sharp');
const request = require('supertest');
const pino = require('pino');
const createApp = require('../app');
const { createLocalItemImagePipeline } = require('../services/item-image-pipeline');
const { validOperation } = require('../services/item-image-policy');
const { readServerConfig } = require('../config');
const { createIsolatedMongo } = require('./helpers/isolated-mongo');
const { createIsolatedSeaweedFS } = require('./helpers/isolated-seaweedfs');
const { prepareDatabaseIndexes } = require('../services/database-indexes');
const hash = b => createHash('sha256').update(b).digest('hex');
const origin = 'http://localhost:3000';
const write = call => call.set('Origin', origin).set('X-CSRF-Protection', '1');
const day = offset => new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10);
const confirmed = (extra = {}) => Object.assign({ name: 'Synthetic lamp', stateId: '06', metroId: '41860', pickupTimeZone: 'America/Los_Angeles',
    pickupTimeZoneConfirmed: true, availableUntil: day(10) }, extra);

describe('UX-2C1 independent listing photos with owned MongoDB and real private SeaweedFS', function () {
    this.timeout(180000);
    let isolated, fixture, db, config, pipeline, app, closedApp, owner, other, image, plan, legacy;
    const makeApp = photos => createApp({ connectToDatabase: async () => db, imageMetadata: config, imagePipeline: pipeline, ownerListingsEnabled: true,
        ownerListingPhotosEnabled: photos, imageControlLimit: 10000, discoveryLimit: 10000, authLimit: 10000, logger: pino({ level: 'silent' }) });
    const root = id => '/api/items/' + id + '/images';
    const draft = async (input = confirmed(), actor = owner) => (await write(request(app).post('/api/items')).set('Cookie', actor.cookie).send(input).expect(201)).body.item;
    const reserve = (id, actor = owner, revision = 0, server = app) => write(request(server).post(root(id) + '/uploads')).set('Cookie', actor.cookie)
        .send({ imageRevision: revision, clientUploadId: randomUUID(), byteLength: image.length, sha256: hash(image) });
    const upload = (id, operation, actor = owner) => write(request(app).put(root(id) + '/' + operation + '/content')).set('Cookie', actor.cookie)
        .attach('file', image, { filename: 'synthetic.bin', contentType: 'application/octet-stream' });
    const metadata = (id, actor = owner, server = app) => request(server).get(root(id)).set('Cookie', actor.cookie);
    const view = (imageId, actor = null, server = app) => request(server).get('/api/item-images/' + imageId + '/thumbnail').set('Cookie', actor ? actor.cookie : '');
    const itemRow = id => db.collection('items').findOne({ _id: new ObjectId(id) });
    const quota = async () => (await db.collection('users').findOne({ _id: owner.id })).itemImageQuota;
    before(async function () {
        isolated = await createIsolatedMongo(); db = isolated.db; await prepareDatabaseIndexes(db);
        fixture = await createIsolatedSeaweedFS();
        config = { storageBinding: { fingerprint: fixture.config.targetFingerprint, namespace: fixture.receipt.namespace },
            limits: { attempts: 50, successes: 20, accountBytes: 100 * 1024 * 1024, concurrent: 2, records: 1000 } };
        pipeline = createLocalItemImagePipeline({ connectToDatabase: async () => db, configuration: config, storageConfig: fixture.config });
        app = makeApp(true); closedApp = makeApp(false);
        async function account(email) {
            const result = await write(request(app).post('/api/auth/register')).send({ email, firstName: 'Synthetic', lastName: 'Person', password: 'synthetic-photo-password' }).expect(201);
            return { id: new ObjectId(result.body.user.id), cookie: result.headers['set-cookie'][0].split(';')[0] };
        }
        owner = await account('independent-photo-owner@example.test'); other = await account('independent-photo-other@example.test');
        image = await sharp({ create: { width: 800, height: 600, channels: 3, background: '#54875c' } }).png().toBuffer();
    });
    beforeEach(async function () {
        for (const name of ['itemImages', 'items', 'moveOutPlans']) await db.collection(name).deleteMany({});
        await db.collection('users').updateMany({}, { $unset: { itemImageQuota: '' } });
        const now = new Date();
        plan = { _id: new ObjectId(), ownerId: owner.id, title: '', city: 'Oakland', neighborhood: 'Local', stateId: '06', metroId: '41860',
            status: 'active', pickupTimeZone: 'America/Los_Angeles', moveOutDeadline: day(20), inventoryRevision: 0, createdAt: now, updatedAt: now };
        legacy = { _id: new ObjectId(), planId: plan._id, ownerId: owner.id, name: 'Legacy chair', description: '', category: '', categoryId: 'other-household',
            itemTypeId: 'other', status: 'draft', version: 1, availableFrom: null, availableUntil: null, publishedAt: null, createdAt: now, updatedAt: now };
        await db.collection('moveOutPlans').insertOne(plan); await db.collection('items').insertOne(legacy);
    });
    after(async function () {
        if (pipeline) pipeline.close();
        try { if (fixture) await fixture.close(); } finally { if (isolated) await isolated.close(); }
    });

    it('stores a confirmed draft photo as an owner-only schema 2 operation without any plan reference', async function () {
        const item = await draft(); const before = await itemRow(item.id);
        const meta = (await metadata(item.id).expect(200)).body;
        assert.equal(meta.allowance.newUploadsAllowed, true); assert.equal(meta.capabilities.binaryUpload, true); assert.deepEqual(meta.images, []);
        const reserved = await reserve(item.id).expect(201);
        const operation = reserved.body.upload.id;
        const stored = await db.collection('itemImages').findOne({ _id: new ObjectId(operation) });
        assert.equal(stored.schemaVersion, 2); assert.ok(!('planId' in stored)); assert.ok(stored.itemId.equals(new ObjectId(item.id))); assert.ok(validOperation(stored));
        const done = await upload(item.id, operation).expect(201);
        assert.equal(done.body.image.state, 'ready'); assert.equal(done.body.imageRevision, 1);
        const listed = (await metadata(item.id).expect(200)).body;
        assert.deepEqual(listed.images.map(row => row.id), [operation]); assert.equal(listed.imageRevision, 1); assert.equal(listed.allowance.itemSlots, 4);
        const q = await quota(); assert.equal(q.successful, 1); assert.equal(q.activeUploads, 0); assert.equal(q.heldSuccess, 0);
        // Photo writes fence the item, never its content version or a plan.
        const after = await itemRow(item.id);
        assert.equal(after.version, before.version); assert.ok(after.coordinationRevision > before.coordinationRevision); assert.equal(after.imageRevision, 1);
        assert.ok(!('planId' in after)); assert.equal(await db.collection('moveOutPlans').countDocuments(), 1);
        const owned = (await request(app).get('/api/me/items/' + item.id).set('Cookie', owner.cookie).expect(200)).body;
        assert.equal(owned.item.photoPreview.availability, 'ready'); assert.equal(owned.item.photoPreview.images[0].id, operation);
        assert.equal(owned.item.capabilities.photos, true); assert.deepEqual(owned.photoCapabilities, { metadata: true, binaryUpload: true, imageRead: true });
        const bytes = await view(operation, owner).expect(200);
        assert.equal(bytes.headers['content-type'], 'image/webp'); assert.equal(bytes.headers['cache-control'], 'private, no-store');
        await view(operation, other).expect(404); await view(operation).expect(404);
        // Draft text edits still work after photo activity (no version coupling).
        const edited = await write(request(app).patch('/api/items/' + item.id)).set('Cookie', owner.cookie).send({ version: item.version, description: 'Now with a photo.' }).expect(200);
        assert.equal(edited.body.item.version, item.version + 1);
        assert.equal((await metadata(item.id).expect(200)).body.images.length, 1);
    });

    it('blocks intake without a confirmed future deadline and charges nothing', async function () {
        for (const input of [{ name: 'Name only' }, confirmed({ pickupTimeZoneConfirmed: false }), confirmed({ availableUntil: undefined }), confirmed({ availableUntil: day(-2) })]) {
            const item = await draft(input);
            const meta = (await metadata(item.id).expect(200)).body; assert.equal(meta.allowance.newUploadsAllowed, false);
            const refused = await reserve(item.id).expect(409); assert.equal(refused.body.error.code, 'IMAGE_LISTING_DEADLINE_REQUIRED');
        }
        assert.equal(await db.collection('itemImages').countDocuments(), 0);
        assert.equal(await quota(), undefined);
    });

    it('revokes binary intake when the confirmed context changes after a reservation', async function () {
        const item = await draft(); const operation = (await reserve(item.id).expect(201)).body.upload.id;
        await write(request(app).patch('/api/items/' + item.id)).set('Cookie', owner.cookie).send({ version: item.version, pickupTimeZone: 'America/Denver' }).expect(200);
        const refused = await upload(item.id, operation).expect(409); assert.equal(refused.body.error.code, 'IMAGE_UPLOAD_UNAVAILABLE');
        const row = await db.collection('itemImages').findOne({ _id: new ObjectId(operation) });
        assert.equal(row.state, 'reserved'); assert.equal(row.lease.fenceToken, null); // never claimed, so no PUT could have happened
        assert.equal((await quota()).activeUploads, 1); // held until reaped; no refund on refusal
        assert.equal((await metadata(item.id).expect(200)).body.allowance.newUploadsAllowed, false);
    });

    it('never crosses legacy and independent models, owners or items', async function () {
        const item = await draft(); const operation = (await reserve(item.id).expect(201)).body.upload.id; await upload(item.id, operation).expect(201);
        const plans = '/api/move-out-plans/' + plan._id + '/items/';
        // A v2 item is invisible through its owner's plan route, and a legacy item through the v2 route.
        assert.equal((await request(app).get(plans + item.id + '/images').set('Cookie', owner.cookie).expect(404)).body.error.code, 'IMAGE_UNAVAILABLE');
        assert.equal((await metadata(legacy._id.toHexString()).expect(404)).body.error.code, 'IMAGE_UNAVAILABLE');
        await reserve(legacy._id.toHexString()).expect(404);
        await write(request(app).post(plans + legacy._id + '/images/' + operation + '/actions')).set('Cookie', owner.cookie).send({ imageRevision: 0, action: 'delete' }).expect(404);
        // Another account sees the same denial as a missing item and creates nothing.
        for (const call of [metadata(item.id, other), reserve(item.id, other), request(app).get(root(item.id) + '/' + operation).set('Cookie', other.cookie),
            write(request(app).post(root(item.id) + '/' + operation + '/actions')).set('Cookie', other.cookie).send({ imageRevision: 1, action: 'delete' })]) {
            assert.equal((await call.expect(404)).body.error.code, 'IMAGE_UNAVAILABLE');
        }
        assert.equal(await db.collection('itemImages').countDocuments(), 1);
        assert.equal((await db.collection('users').findOne({ _id: other.id })).itemImageQuota, undefined);
        // A forged schema 1 row on the v2 item is integrity damage, not access.
        await db.collection('itemImages').insertOne(Object.assign({}, await db.collection('itemImages').findOne({ _id: new ObjectId(operation) }),
            { _id: new ObjectId(), clientUploadId: randomUUID(), schemaVersion: 1, planId: plan._id, state: 'failed', sortPosition: null }));
        assert.equal((await metadata(item.id).expect(409)).body.error.code, 'IMAGE_METADATA_INVALID');
    });

    it('logically deletes with the shared quota held and frees the item slot', async function () {
        const item = await draft(); const operation = (await reserve(item.id).expect(201)).body.upload.id; await upload(item.id, operation).expect(201);
        const retained = (await quota()).retainedBytes; assert.ok(retained > 0);
        const removed = await write(request(app).post(root(item.id) + '/' + operation + '/actions')).set('Cookie', owner.cookie).send({ imageRevision: 1, action: 'delete' }).expect(202);
        assert.equal(removed.body.upload.state, 'delete_pending'); assert.equal(removed.body.imageRevision, 2);
        const meta = (await metadata(item.id).expect(200)).body; assert.deepEqual(meta.images, []); assert.equal(meta.allowance.itemSlots, 5);
        assert.equal((await quota()).retainedBytes, retained); // released only by verified cleanup
        await view(operation, owner).expect(404);
    });

    it('serializes concurrent photo and draft writes on the item fence without lost updates', async function () {
        const item = await draft();
        const results = await Promise.all([reserve(item.id), reserve(item.id),
            write(request(app).patch('/api/items/' + item.id)).set('Cookie', owner.cookie).send({ version: item.version, description: 'Concurrent edit' })]);
        assert.deepEqual(results.map(r => r.status).sort(), [200, 201, 201]);
        const saved = await itemRow(item.id);
        assert.equal(saved.description, 'Concurrent edit'); assert.equal(saved.version, item.version + 1);
        assert.equal(saved.coordinationRevision, 3); assert.equal(await db.collection('itemImages').countDocuments({ itemId: saved._id, state: 'reserved' }), 2);
        assert.equal((await quota()).activeUploads, 2);
    });

    it('keeps independent photos fully disabled behind their own default-off gate', async function () {
        const item = await draft(); const operation = (await reserve(item.id).expect(201)).body.upload.id; await upload(item.id, operation).expect(201);
        assert.equal((await metadata(item.id, owner, closedApp).expect(503)).body.error.code, 'OWNER_LISTING_PHOTOS_DISABLED');
        assert.equal((await reserve(item.id, owner, 1, closedApp).expect(503)).body.error.code, 'OWNER_LISTING_PHOTOS_DISABLED');
        await view(operation, owner, closedApp).expect(404);
        const owned = (await request(closedApp).get('/api/me/items/' + item.id).set('Cookie', owner.cookie).expect(200)).body;
        assert.equal(owned.item.photoPreview.availability, 'disabled'); assert.equal(owned.item.capabilities.photos, false);
        assert.deepEqual(owned.photoCapabilities, { metadata: false, binaryUpload: false, imageRead: false });
        // Legacy plan photos are unaffected by the independent gate.
        await request(closedApp).get('/api/move-out-plans/' + plan._id + '/items/' + legacy._id + '/images').set('Cookie', owner.cookie).expect(200);
    });

    it('validates the independent photo flag at startup', function () {
        const base = { MONGO_URL: 'mongodb://127.0.0.1:1/x', NODE_ENV: 'development' };
        assert.equal(readServerConfig(base).ownerListingPhotosEnabled, false);
        assert.throws(() => readServerConfig(Object.assign({}, base, { OWNER_LISTING_PHOTOS_ENABLED: 'yes' })), /true or false/);
        assert.throws(() => readServerConfig(Object.assign({}, base, { OWNER_LISTING_PHOTOS_ENABLED: 'true' })), /requires OWNER_LISTINGS_ENABLED/);
        assert.throws(() => readServerConfig(Object.assign({}, base, { OWNER_LISTING_PHOTOS_ENABLED: 'true', OWNER_LISTINGS_ENABLED: 'true' })), /ITEM_IMAGE_METADATA_ENABLED/);
    });
});
