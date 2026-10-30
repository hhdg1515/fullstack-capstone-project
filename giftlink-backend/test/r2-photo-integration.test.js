/* jshint loopfunc: true */
const assert = require('node:assert/strict');
const { ObjectId } = require('mongodb');
const { randomUUID, randomBytes, createHash } = require('node:crypto');
const fs = require('node:fs'), path = require('node:path');
const sharp = require('sharp'), request = require('supertest'), pino = require('pino');
const { Readable } = require('node:stream');
const { createIsolatedMongo } = require('./helpers/isolated-mongo');
const { createIsolatedSeaweedFS } = require('./helpers/isolated-seaweedfs');
const { r2Environment, seaweedR2Bridge, blockProviderNetwork } = require('./helpers/r2-fixture');
const { prepareDatabaseIndexes } = require('../services/database-indexes');
const { openR2PhotoContext } = require('../util/r2-photo-context');
const { createR2ItemImagePipeline } = require('../services/item-image-pipeline');
const { createR2ImageRecovery, createLocalImageRecovery } = require('../services/item-image-recovery');
const { createR2ImageStorage } = require('../services/r2-image-storage');
const { readR2ImageStorageConfig } = require('../services/r2-image-storage-config');
const { createItemImagesService } = require('../services/item-images');
const { readPrivateJson } = require('../util/local-maintenance-receipt');
const reconcile = require('../util/reconcile-r2-item-images');
const { initializeApplication } = require('../runtime');
const { readServerConfig } = require('../config');
const createApp = require('../app');
const sinon = require('sinon');
const hash = value => createHash('sha256').update(value).digest('hex');
const write = call => call.set('Origin', 'http://localhost:3000').set('X-CSRF-Protection', '1');
describe('R2 architecture with real isolated MongoDB, Sharp and receipt-verified SeaweedFS bridge', function () {
    blockProviderNetwork();
    this.timeout(180000);
    let mongo, fixture, db, f, context, pipeline, app, owner, other, plan, item, image, fault, contexts, environments, bridges;
    const root = () => '/api/move-out-plans/' + plan._id + '/items/' + item._id + '/images';
    const row = id => db.collection('itemImages').findOne({ _id: new ObjectId(id) });
    const quota = async () => (await db.collection('users').findOne({ _id: owner.id })).itemImageQuota;
    const makeApp = (pipe = pipeline) => createApp({ connectToDatabase: context.applicationConnectToDatabase, imageMetadata: context.metadata,
        imagePipeline: pipe, imageControlLimit: 10000, authLimit: 10000, discoveryLimit: 10000, logger: pino({ level: 'silent' }) });
    const upload = (id, actor = owner, server = app) => write(request(server).put(root() + '/' + id + '/content')).set('Cookie', actor.cookie)
        .attach('file', image, { filename: 'synthetic-private-source.png', contentType: 'image/png' });
    const revision = async () => (await db.collection('items').findOne({ _id: item._id })).imageRevision || 0;
    const reserve = async () => (await write(request(app).post(root() + '/uploads')).set('Cookie', owner.cookie)
        .send({ imageRevision: await revision(), clientUploadId: randomUUID(), byteLength: image.length, sha256: hash(image) }).expect(201)).body.upload.id;
    const ready = async () => { const id = await reserve(); await upload(id).expect(201); return row(id); };
    const remove = async id => write(request(app).post(root() + '/' + id + '/actions')).set('Cookie', owner.cookie)
        .send({ imageRevision: await revision(), action: 'delete' }).expect(202);
    async function recoveryContext(handler) {
        const r = await r2Environment({ mongo, fixture, role: 'recovery' }); environments.push(r);
        const c = await openR2PhotoContext({ env: r.env, storageOptions: () => {
            const bridge = seaweedR2Bridge(fixture, r.env); bridge.next = handler || null; bridges.push(bridge); return { requestHandler: bridge };
        } }); contexts.push(c); return { c, r };
    }
    const recover = (c, method, manifest) => { const service = createR2ImageRecovery(c); return service[method](...(method === 'apply' ? [manifest, Object.assign({}, c.identity, { manifest: manifest.digest })] : [] )).finally(() => service.close()); };
    const expire = id => { const past = new Date(Date.now() - 60000); return db.collection('itemImages').updateOne({ _id: new ObjectId(id) }, { $set: {
        'lease.expiresAt': past, 'cleanup.nextAttemptAt': null, maintenanceDueAt: past } }); };
    before(async function () {
        mongo = await createIsolatedMongo(); db = mongo.db; await prepareDatabaseIndexes(db); fixture = await createIsolatedSeaweedFS();
        image = await sharp({ create: { width: 600, height: 400, channels: 3, background: '#4e785c' } }).png().toBuffer();
    });
    beforeEach(async function () {
        contexts = []; environments = []; bridges = []; fault = null;
        for (const name of ['itemImages', 'items', 'moveOutPlans', 'users', 'sessions']) await db.collection(name).deleteMany({});
        f = await r2Environment({ mongo, fixture }); environments.push(f);
        context = await openR2PhotoContext({ env: f.env, storageOptions: () => {
            const bridge = seaweedR2Bridge(fixture, f.env); bridge.next = (req, ctx, send) => fault ? fault(req, ctx, send) : send();
            bridges.push(bridge); return { requestHandler: bridge };
        } }); contexts.push(context); pipeline = createR2ItemImagePipeline(context); app = makeApp();
        async function account() {
            const r = await write(request(app).post('/api/auth/register')).send({ email: randomUUID() + '@example.invalid', firstName: 'Synthetic', lastName: 'Tester', password: 'synthetic-password-123' }).expect(201);
            return { id: new ObjectId(r.body.user.id), cookie: r.headers['set-cookie'][0].split(';')[0] };
        }
        owner = await account(); other = await account(); const now = new Date();
        plan = { _id: new ObjectId(), ownerId: owner.id, status: 'active', inventoryRevision: 0, moveOutDeadline: '2099-01-01', createdAt: now, updatedAt: now };
        item = { _id: new ObjectId(), planId: plan._id, ownerId: owner.id, name: 'Synthetic fixture item', status: 'draft', version: 1, createdAt: now, updatedAt: now };
        await db.collection('moveOutPlans').insertOne(plan); await db.collection('items').insertOne(item);
    });
    afterEach(async function () { sinon.restore(); if (pipeline) pipeline.close(); for (const c of contexts) await c.close(); for (const e of environments) e.close(); });
    after(async function () { try { if (fixture) await fixture.close(); } finally { if (mongo) await mongo.close(); } });
    it('runs authoritative Sharp intake, conditional PUT, verification GET and private owner delivery through the R2 protocol path', async function () {
        assert.equal(context.db.client.options.maxPoolSize, 10); assert.equal(context.db.client.options.waitQueueTimeoutMS, 2000);
        const r = await ready(); assert.equal(r.state, 'ready'); assert.equal(r.storageBinding.fingerprint, f.env.ITEM_IMAGE_R2_TARGET);
        for (const variant of ['thumbnail', 'display']) {
            const response = await request(app).get('/api/item-images/' + r._id + '/' + variant).set('Cookie', owner.cookie).expect(200);
            assert.equal(response.headers['cache-control'], 'private, no-store'); assert.equal(response.headers['content-type'], 'image/webp');
            const meta = await sharp(response.body).metadata(); assert.equal(meta.format, 'webp'); assert.equal(meta.exif, undefined);
            await request(app).get('/api/item-images/' + r._id + '/' + variant).expect(404);
            await request(app).get('/api/item-images/' + r._id + '/' + variant).set('Cookie', other.cookie).expect(404);
        }
        assert.equal(bridges.flatMap(b => b.requests).filter(r => r.method === 'PUT').length, 2);
    });
    it('keeps admission separate from reads/status/delete, refuses new reservations without charging, and can resume only an approved gate', async function () {
        const r = await ready(), pending = await reserve(), before = await quota(); pipeline.setUploadAdmission(false);
        const capabilities = (await request(app).get(root()).set('Cookie', owner.cookie).expect(200)).body.capabilities;
        assert.deepEqual(capabilities, { metadata: true, binaryUpload: false, imageRead: true });
        await upload(pending).expect(503); await upload(pending, other).expect(404);
        await write(request(app).post(root() + '/uploads')).set('Cookie', owner.cookie).send({ imageRevision: await revision(), clientUploadId: randomUUID(), byteLength: image.length, sha256: hash(image) }).expect(503);
        assert.deepEqual(await quota(), before); assert.equal((await row(pending)).state, 'reserved');
        await request(app).get(root() + '/' + pending).set('Cookie', owner.cookie).expect(200);
        await request(app).get('/api/item-images/' + r._id + '/thumbnail').set('Cookie', owner.cookie).expect(200);
        await remove(r._id); pipeline.setUploadAdmission(true); await upload(pending).expect(201);
        const { c } = await recoveryContext(); assert.equal((await recover(c, 'apply', await recover(c, 'preview'))).results[0].status, 'deleted');
    });
    it('defaults an explicitly injected R2 runtime to read/status only when upload admission is disabled', async function () {
        const r = await ready(); const readonly = await openR2PhotoContext({ env: Object.assign({}, f.env, { ITEM_IMAGE_R2_UPLOADS_ENABLED: 'false' }), storageOptions: () => ({ requestHandler: seaweedR2Bridge(fixture, f.env) }) }); contexts.push(readonly);
        const p = createR2ItemImagePipeline(readonly); const server = createApp({ connectToDatabase: readonly.applicationConnectToDatabase, imageMetadata: readonly.metadata, imagePipeline: p, logger: pino({ level: 'silent' }) });
        try {
            assert.throws(() => p.setUploadAdmission(true));
            const storage = readonly.createStorage();
            try { await assert.rejects(storage.putVariant({ key: r.variants.thumbnail.key, body: Buffer.from('synthetic') }), e => e.category === 'authorization'); }
            finally { storage.close(); }
            await request(server).get('/api/item-images/' + r._id + '/thumbnail').set('Cookie', owner.cookie).expect(200);
        }
        finally { p.close(); }
    });
    it('pins the application database connection and leaves text/auth usable after photo authority is revoked', async function () {
        assert.throws(() => createApp({ connectToDatabase: async () => db, imageMetadata: context.metadata, imagePipeline: pipeline }), /connection mismatch/);
        const r = await ready(), before = await quota(); fs.writeFileSync(f.env.ITEM_IMAGE_R2_APPROVAL_FILE, '{}');
        await request(app).get('/api/me').set('Cookie', owner.cookie).expect(200);
        await request(app).get('/api/item-images/' + r._id + '/thumbnail').set('Cookie', owner.cookie).expect(503);
        await write(request(app).post(root() + '/uploads')).set('Cookie', owner.cookie).send({ imageRevision: 1, clientUploadId: randomUUID(), byteLength: image.length, sha256: hash(image) }).expect(503);
        assert.deepEqual(await quota(), before); assert.equal((await row(r._id)).state, 'ready');
    });
    it('drains an already claimed upload when admission pauses but never claims the next batch file', async function () {
        const first = await reserve(), second = await reserve(); let release, arrived;
        const gate = new Promise(resolve => { release = resolve; }), seen = new Promise(resolve => { arrived = resolve; }); let puts = 0;
        fault = async (req, ctx, send) => { if (req.method === 'PUT' && ++puts === 1) { arrived(); await gate; } return send(); };
        const pending = upload(first).then(value => value);
        try { await seen; pipeline.setUploadAdmission(false); await upload(second).expect(503); }
        finally { release(); }
        assert.equal((await pending).status, 201); assert.equal((await row(first)).state, 'ready'); assert.equal((await row(second)).state, 'reserved');
        assert.equal(puts, 2); assert.equal((await quota()).successful, 1);
    });
    it('demonstrates two-instance pause boundaries while preserving authorized reads/status and requiring each instance to stop', async function () {
        const r = await ready(), pending = await reserve(), second = createR2ItemImagePipeline(context), secondApp = makeApp(second);
        try {
            pipeline.setUploadAdmission(false); await upload(pending).expect(503);
            await upload(pending, owner, secondApp).expect(201); // Local pause is deliberately not a fleet guarantee.
            second.setUploadAdmission(false);
            const requestBody = { imageRevision: await revision(), clientUploadId: randomUUID(), byteLength: image.length, sha256: hash(image) };
            for (const server of [app, secondApp]) {
                await write(request(server).post(root() + '/uploads')).set('Cookie', owner.cookie).send(requestBody).expect(503);
                await request(server).get(root() + '/' + pending).set('Cookie', owner.cookie).expect(200);
                await request(server).get('/api/item-images/' + r._id + '/thumbnail').set('Cookie', owner.cookie).expect(200);
            }
            pipeline.setUploadAdmission(true); assert.equal((await request(app).get(root()).set('Cookie', owner.cookie)).body.capabilities.binaryUpload, true);
            assert.equal((await request(secondApp).get(root()).set('Cookie', owner.cookie)).body.capabilities.binaryUpload, false);
        } finally { second.close(); }
    });
    it('stops an approval expiring after a committed PUT without retry/refund; fresh guarded recovery preserves the durable outcome', async function () {
        let puts = 0;
        fault = async (req, ctx, send) => {
            const result = await send();
            if (req.method === 'PUT' && ++puts === 1) sinon.stub(Date, 'now').returns(Date.parse(f.approval.expiresAt) + 1);
            return result;
        };
        const id = await reserve();
        try { await upload(id).expect(503); assert.equal(puts, 1); }
        finally { sinon.restore(); fault = null; }
        const held = await quota(); assert.ok(held.reservedBytes > 0); assert.equal(held.activeUploads, 1);
        assert.equal((await row(id)).variants.thumbnail.outcome, 'unknown');
        await upload(id).expect(202); assert.equal(puts, 1);
        await expire(id); const { c } = await recoveryContext(), manifest = await recover(c, 'preview');
        assert.equal(manifest.operations[0].action, 'cleanup');
        assert.equal((await recover(c, 'apply', manifest)).results[0].status, 'deleted');
        assert.equal((await quota()).reservedBytes, 0); assert.equal((await quota()).operationCount, 1);
    });
    it('requires restart and a fresh manifest after receipt renewal, refusing stale worker and manifest replay before DELETE', async function () {
        const r = await ready(); await remove(r._id);
        const { c, r: maintenance } = await recoveryContext(), manifest = await recover(c, 'preview'), before = await quota(); maintenance.approve();
        await assert.rejects(recover(c, 'apply', manifest)); assert.deepEqual(await quota(), before);
        const renewed = await openR2PhotoContext({ env: maintenance.env, storageOptions: () => {
            const bridge = seaweedR2Bridge(fixture, maintenance.env); bridges.push(bridge); return { requestHandler: bridge };
        } }); contexts.push(renewed);
        await assert.rejects(recover(renewed, 'apply', manifest));
        assert.equal(bridges.flatMap(b => b.requests).filter(r => r.method === 'DELETE').length, 0);
        const fresh = await recover(renewed, 'preview'); assert.equal((await recover(renewed, 'apply', fresh)).results[0].status, 'deleted');
        const settled = await quota(); await assert.rejects(recover(renewed, 'apply', fresh)); assert.deepEqual(await quota(), settled);
        assert.equal(settled.operationCount, 1);
    });
    it('keeps stale image revisions independent of item text and never issues storage mutations for a rejected edit', async function () {
        const r = await ready(), before = await quota(), requests = bridges.flatMap(b => b.requests).length;
        await write(request(app).post(root() + '/order')).set('Cookie', owner.cookie).send({ imageRevision: 0, imageIds: [r._id.toString()] }).expect(409);
        assert.equal((await db.collection('items').findOne({ _id: item._id })).version, 1); assert.deepEqual(await quota(), before);
        assert.equal(bridges.flatMap(b => b.requests).length, requests);
    });
    it('refuses redirects and oversized error bodies without another endpoint, retry or private-body exposure', async function () {
        const r = await ready(); let calls = 0;
        fault = async () => { calls++; return { response: { statusCode: 307, headers: { location: 'https://must-not-contact.invalid/private' }, body: Readable.from([]) } }; };
        await request(app).get('/api/item-images/' + r._id + '/thumbnail').set('Cookie', owner.cookie).expect(503); assert.equal(calls, 1);
        fault = async () => ({ response: { statusCode: 500, headers: { 'content-type': 'application/xml' }, body: Readable.from([Buffer.alloc(16385)]) } });
        const storage = context.createStorage();
        try { await assert.rejects(storage.getVariant({ key: r.variants.thumbnail.key, byteLength: r.variants.thumbnail.byteLength, sha256: r.variants.thumbnail.sha256 }), e => e.category === 'integrity' && !e.message.includes('private')); }
        finally { storage.close(); }
    });
    it('never sends an uncertain PUT twice; canonical status and known bytes allow only approved compensation', async function () {
        let puts = 0; fault = async (req, ctx, send) => { if (req.method === 'PUT') { puts++; await send(); throw Error('private provider lost reply'); } return send(); };
        const id = await reserve(); await upload(id).expect(503); await upload(id).expect(409); assert.equal(puts, 1); fault = null;
        const current = await row(id); assert.equal(current.variants.thumbnail.outcome, 'unknown'); assert.ok((await quota()).reservedBytes > 0);
        await expire(id); const { c } = await recoveryContext(); const manifest = await recover(c, 'preview'); assert.equal(manifest.operations[0].action, 'cleanup');
        assert.equal((await recover(c, 'apply', manifest)).results[0].status, 'deleted'); assert.equal((await quota()).reservedBytes, 0); assert.equal((await quota()).operationCount, 1);
    });
    it('does not refund a missing unknown write from timeout, elapsed time or negative object reads', async function () {
        fault = async (req, ctx, send) => { if (req.method === 'PUT') throw Error('synthetic pre-network failure with uncertain permit'); return send(); };
        const id = await reserve(); await upload(id).expect(503); fault = null; await expire(id); const before = await quota();
        const { c } = await recoveryContext(); const manifest = await recover(c, 'preview'); assert.equal(manifest.operations[0].action, 'unknown_write');
        assert.equal((await recover(c, 'apply', manifest)).results[0].status, 'unresolved'); assert.deepEqual(await quota(), before);
        assert.equal(bridges.flatMap(b => b.requests).filter(r => r.method === 'DELETE').length, 0);
    });
    it('uses actual S3 conditional atomicity across clients and enforces runtime/delete and recovery/PUT separation', async function () {
        const { c } = await recoveryContext(), key = f.env.ITEM_IMAGE_R2_NAMESPACE + '/' + randomBytes(12).toString('hex') + '/' + randomUUID() + '/display.webp';
        const one = context.createStorage(), two = context.createStorage(), cleanup = c.createStorage(); const data = Buffer.from('synthetic protocol bytes');
        try {
            const results = await Promise.allSettled([one.putVariant({ key, body: data }), two.putVariant({ key, body: data })]);
            assert.equal(results.filter(r => r.status === 'fulfilled').length, 1); assert.equal(results.find(r => r.status === 'rejected').reason.category, 'conflict');
            await assert.rejects(one.deleteVariant({ key }), e => e.category === 'authorization');
            await assert.rejects(cleanup.putVariant({ key, body: data }), e => e.category === 'authorization');
            assert.deepEqual((await cleanup.getVariant({ key, byteLength: data.length, sha256: hash(data) })).body, data);
            await cleanup.deleteVariant({ key });
        } finally { one.close(); two.close(); cleanup.close(); }
        assert.throws(() => createR2ImageRecovery(context)); assert.throws(() => createR2ItemImagePipeline(c)); assert.throws(() => createLocalImageRecovery(c));
    });
    it('preserves durable delete_unknown and charges after a lost DELETE; a fresh preview is required for safe recovery', async function () {
        const r = await ready(); await remove(r._id); const before = await quota(); let failed = false;
        const { c } = await recoveryContext(async (req, ctx, send) => { if (req.method === 'DELETE' && !failed) { failed = true; await send(); throw Error('private lost DELETE reply'); } return send(); });
        const manifest = await recover(c, 'preview'); const result = await recover(c, 'apply', manifest); assert.equal(result.results[0].status, 'unresolved');
        assert.equal((await row(r._id)).variants.thumbnail.outcome, 'delete_unknown'); assert.deepEqual(await quota(), before);
        await assert.rejects(recover(c, 'apply', manifest));
        await expire(r._id); const past = new Date(Date.now() - 1000); await db.collection('itemImages').updateOne({ _id: r._id }, { $set: { 'cleanup.recovery.expiresAt': past } });
        assert.equal((await recover(c, 'apply', await recover(c, 'preview'))).results[0].status, 'deleted'); assert.equal((await quota()).retainedBytes, 0);
    });
    it('rejects stale or concurrent manifests and settles one tombstone exactly once', async function () {
        const r = await ready(); await remove(r._id); const { c } = await recoveryContext(), manifest = await recover(c, 'preview');
        const results = await Promise.allSettled([recover(c, 'apply', manifest), recover(c, 'apply', manifest)]);
        assert.equal(results.filter(result => result.status === 'fulfilled' && result.value.results[0].status === 'deleted').length, 1);
        assert.equal((await quota()).retainedBytes, 0); assert.equal((await quota()).successful, 1); assert.equal((await quota()).operationCount, 1);
        assert.deepEqual((await recover(c, 'preview')).operations, []);
    });
    it('refuses compromised account ownership and cross-target records without deleting or refunding', async function () {
        const r = await ready(); await remove(r._id); const before = await quota(); const { c } = await recoveryContext();
        await db.collection('items').updateOne({ _id: item._id }, { $set: { ownerId: other.id } });
        await assert.rejects(recover(c, 'preview')); assert.deepEqual(await quota(), before);
        await db.collection('items').updateOne({ _id: item._id }, { $set: { ownerId: owner.id } });
        await db.collection('itemImages').updateOne({ _id: r._id }, { $set: { 'storageBinding.fingerprint': '0'.repeat(64) } });
        await assert.rejects(recover(c, 'preview')); assert.deepEqual(await quota(), before);
        assert.equal(bridges.flatMap(b => b.requests).filter(r => r.method === 'DELETE').length, 0);
    });
    it('revokes signed authority between preview and apply before any mutation or storage DELETE', async function () {
        const r = await ready(); await remove(r._id); const { c, r: maintenance } = await recoveryContext(), manifest = await recover(c, 'preview'), before = await quota();
        fs.writeFileSync(maintenance.env.ITEM_IMAGE_R2_APPROVAL_FILE, '{}'); await assert.rejects(recover(c, 'apply', manifest));
        assert.deepEqual(await quota(), before); assert.equal(bridges.flatMap(b => b.requests).filter(r => r.method === 'DELETE').length, 0);
    });
    it('rejects wrong live database fingerprint and missing indexes without auto-preparation or storage I/O', async function () {
        const previous = f.env.ITEM_IMAGE_R2_DATABASE_TARGET; f.env.ITEM_IMAGE_R2_DATABASE_TARGET = '0'.repeat(64); f.approve(); let clients = 0;
        await assert.rejects(openR2PhotoContext({ env: f.env, storageOptions: () => { clients++; return {}; } })); assert.equal(clients, 0);
        f.env.ITEM_IMAGE_R2_DATABASE_TARGET = previous; f.approve();
        await db.collection('itemImages').dropIndex('images_owner_state');
        try {
            await assert.rejects(openR2PhotoContext({ env: f.env, storageOptions: () => { clients++; return {}; } }));
            assert.equal((await db.collection('itemImages').indexes()).some(i => i.name === 'images_owner_state'), false); assert.equal(clients, 0);
        } finally { await prepareDatabaseIndexes(db); }
    });
    it('runs the guarded production-compatible CLI path with a private manifest, exact confirmations and bounded local-only cleanup', async function () {
        const r = await ready(); await remove(r._id); const { r: maintenance } = await recoveryContext(); const reports = [];
        const manifestFile = path.join(maintenance.directory, 'manifest.json'), common = ['--allow-remote', '--approval-receipt', maintenance.env.ITEM_IMAGE_R2_APPROVAL_FILE,
            '--database', mongo.dbName, '--environment', 'staging', '--provider', 'r2-private', '--bucket', fixture.receipt.bucket, '--namespace', maintenance.env.ITEM_IMAGE_R2_NAMESPACE, '--manifest', manifestFile];
        const options = { env: maintenance.env, storageOptions: () => ({ requestHandler: seaweedR2Bridge(fixture, maintenance.env) }) };
        assert.equal(await reconcile.run(['--dry-run'].concat(common), value => reports.push(value), options), 0); const manifest = readPrivateJson(manifestFile);
        const confirms = ['--confirm-database', mongo.dbName, '--confirm-environment', 'staging', '--confirm-database-target', maintenance.env.ITEM_IMAGE_R2_DATABASE_TARGET,
            '--confirm-storage-target', maintenance.env.ITEM_IMAGE_R2_TARGET, '--confirm-provider', 'r2-private', '--confirm-bucket', fixture.receipt.bucket,
            '--confirm-namespace', maintenance.env.ITEM_IMAGE_R2_NAMESPACE, '--confirm-manifest', manifest.digest];
        const before = await quota();
        for (let i = 1; i < confirms.length; i += 2) {
            const wrong = confirms.slice(); wrong[i] = 'unrelated';
            await assert.rejects(reconcile.run(['--apply'].concat(common, wrong), () => {}, options)); assert.deepEqual(await quota(), before);
        }
        assert.equal(await reconcile.run(['--apply'].concat(common, confirms), value => reports.push(value), options), 0);
        assert.equal((await row(r._id)).state, 'deleted'); const output = JSON.stringify(reports);
        for (const value of [maintenance.privateKey, maintenance.env.ITEM_IMAGE_R2_SECRET_ACCESS_KEY, maintenance.env.ITEM_IMAGE_R2_ACCESS_KEY_ID, fixture.receipt.namespace, owner.id.toString()]) assert.ok(!output.includes(value));
    });
    it('keeps owner/CSRF/session boundaries and fails image reads safely on corrupt or unavailable bytes', async function () {
        const id = await reserve(); await upload(id, other).expect(404);
        await request(app).put(root() + '/' + id + '/content').set('Cookie', owner.cookie).attach('file', image).expect(403);
        await upload(id).expect(201);
        fault = async req => ({ response: { statusCode: 200, headers: { 'content-type': 'text/html', 'content-length': '3' }, body: Readable.from([Buffer.from('bad')]) } });
        await request(app).get('/api/item-images/' + id + '/thumbnail').set('Cookie', owner.cookie).expect(503); fault = null;
        await db.collection('sessions').deleteMany({ userId: owner.id });
        await request(app).get('/api/item-images/' + id + '/thumbnail').set('Cookie', owner.cookie).expect(404);
        assert.equal((await row(id)).state, 'ready');
    });
    it('rolls back to disabled ordinary startup without SDK/storage I/O, DDL, tombstone loss or text-service failure', async function () {
        const r = await ready(); await remove(r._id); const before = await quota(), beforeRow = await row(r._id), calls = bridges.flatMap(b => b.requests).length;
        const config = readServerConfig({ MONGO_URL: mongo.mongoUrl, MONGO_DB_NAME: mongo.dbName, ITEM_IMAGE_R2_ENABLED: 'false', ITEM_IMAGE_METADATA_ENABLED: 'false', ITEM_IMAGE_PIPELINE_ENABLED: 'false' });
        const disabled = await initializeApplication(config, { database: { connect: async () => db }, logger: pino({ level: 'silent' }) });
        await request(disabled).get('/api/me').set('Cookie', owner.cookie).expect(200); await request(disabled).get('/api/item-images/' + r._id + '/thumbnail').set('Cookie', owner.cookie).expect(404);
        assert.deepEqual(await row(r._id), beforeRow); assert.deepEqual(await quota(), before); assert.equal(bridges.flatMap(b => b.requests).length, calls);
    });
});
