/* jshint loopfunc: true */
const assert = require('node:assert/strict');
const { ObjectId, ClientSession, MongoServerError } = require('mongodb');
const { randomUUID } = require('node:crypto');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const sharp = require('sharp');
const sinon = require('sinon');
const request = require('supertest');
const pino = require('pino');
const { S3Client, PutObjectCommand, DeleteBucketCommand } = require('@aws-sdk/client-s3');
const { createIsolatedMongo, startupDiagnostic } = require('./helpers/isolated-mongo');
const { createIsolatedSeaweedFS } = require('./helpers/isolated-seaweedfs');
const { prepareDatabaseIndexes } = require('../services/database-indexes');
const { createItemImagesService } = require('../services/item-images');
const { createLocalItemImagePipeline } = require('../services/item-image-pipeline');
const { createImageAuthorization } = require('../services/item-image-delivery');
const { createLocalImageRecovery, digest, bounds } = require('../services/item-image-recovery');
const { openLocalMaintenance } = require('../util/local-image-maintenance');
const { readPrivateJson, writePrivateJson } = require('../util/local-maintenance-receipt');
const { run, parse } = require('../util/reconcile-item-images');
const { processRaster, sha256 } = require('../services/item-image-processing');
const { validOperation, ceiling } = require('../services/item-image-policy');
const createApp = require('../app');
const execute = promisify(execFile);

describe('isolated MongoDB startup diagnostics', function () {
    it('reports bounded categories and state without forwarding logs, credentials or private configuration', function () {
        const state = { State: { Running: false, OOMKilled: false, ExitCode: 132 },
            Config: { Env: ['secret-sentinel'] }, NetworkSettings: { Ports: {} } };
        const result = startupDiagnostic(state, 'secret-sentinel: MongoDB requires AVX; private credentials');
        assert.deepEqual(result, { category: 'cpu_unsupported', running: false, oomKilled: false, exitCode: 132, portPublished: false });
        assert.ok(!/secret-sentinel|credentials|private/.test(JSON.stringify(result)));
        assert.equal(startupDiagnostic({}, 'pthread_create failed').category, 'resource_limit');
    });
});

describe('durable local physical image recovery on real MongoDB and SeaweedFS', function () {
    this.timeout(180000);
    let mongo, fixture, context, db, service, storage, config, owner, plan, item, bytes, variants, target, temp, pipeline;
    const row = id => db.collection('itemImages').findOne({ _id: new ObjectId(id) });
    const quota = async () => (await db.collection('users').findOne({ _id: owner })).itemImageQuota;
    const storedInput = v => ({ key: v.key, byteLength: v.byteLength, sha256: v.sha256 });
    const ids = () => [owner, plan._id.toHexString(), item._id.toHexString()];
    const confirmations = manifest => Object.assign({}, context.identity, { manifest: manifest.digest });
    async function preview() { const r = createLocalImageRecovery(context); try { return await r.preview(); } finally { r.close(); } }
    async function apply(manifest) { const r = createLocalImageRecovery(context); try { return await r.apply(manifest, confirmations(manifest)); } finally { r.close(); } }
    async function expire(id) {
        const past = new Date(Date.now() - 60000);
        await db.collection('itemImages').updateOne({ _id: new ObjectId(id) }, { $set: { 'lease.expiresAt': past, maintenanceDueAt: past } });
    }
    async function expireCleanup(id) {
        const past = new Date(Date.now() - 60000);
        await db.collection('itemImages').updateOne({ _id: new ObjectId(id) }, { $set: { 'cleanup.recovery.expiresAt': past,
            'cleanup.nextAttemptAt': null, maintenanceDueAt: past } });
    }
    async function reserve() {
        const current = await db.collection('items').findOne({ _id: item._id });
        return (await service.reserve(...ids(), { imageRevision: current.imageRevision || 0, clientUploadId: randomUUID(), byteLength: bytes.length, sha256: sha256(bytes) })).body.upload.id;
    }
    async function prepared() {
        const id = await reserve(), claimed = await service.claim(...ids(), id);
        await service.prepareVariants(claimed.row, variants); return claimed.row;
    }
    async function put(ticket, name, mark = true) {
        const intent = await service.beginPut(ticket, name);
        await storage.putVariant({ key: intent.key, body: variants[name].body });
        await storage.getVariant({ key: intent.key, byteLength: intent.byteLength, sha256: intent.sha256 });
        if (mark) await service.stored(ticket, name);
    }
    async function ready() {
        const ticket = await prepared(); await put(ticket, 'thumbnail'); await put(ticket, 'display'); await service.finalize(ticket); return row(ticket._id);
    }
    async function remove(id) {
        const current = await db.collection('items').findOne({ _id: item._id });
        return service.remove(...ids(), id.toString(), { imageRevision: current.imageRevision || 0, action: 'delete' });
    }
    async function absent(operation, name) {
        const v = operation.variants[name];
        await assert.rejects(storage.getVariant({ key: v.key, byteLength: v.byteLength, sha256: v.sha256 }), e => e.category === 'not_found' && e.outcome === 'absent');
    }
    async function assertSettled(id, success = false) {
        const current = await row(id), q = await quota(); assert.ok(validOperation(current)); assert.equal(current.state, 'deleted');
        assert.equal(q.activeUploads, 0); assert.equal(q.reservedBytes, 0); assert.equal(q.retainedBytes, 0); assert.equal(q.heldSuccess, 0);
        assert.equal(q.attempts, 1); assert.equal(q.successful, Number(success)); assert.equal(q.operationCount, 1);
        assert.equal(current.cleanup.recovery.status, 'complete'); assert.ok(current.deletedAt); assert.equal(current.charge.slotHeld, false);
        assert.ok(Object.values(current.cleanup.recovery.absent).every(Boolean));
    }
    before(async function () {
        mongo = await createIsolatedMongo(); db = mongo.db; await prepareDatabaseIndexes(db);
        fixture = await createIsolatedSeaweedFS();
        config = { storageBinding: { fingerprint: fixture.config.targetFingerprint, namespace: fixture.receipt.namespace },
            limits: { attempts: 50, successes: 20, accountBytes: 100 * 1024 * 1024, concurrent: 2, records: 1000 } };
        target = { mongoReceiptPath: mongo.receiptPath, storageReceiptPath: fixture.receiptPath, databaseName: mongo.dbName,
            environment: 'development', provider: 'seaweedfs-local', bucket: fixture.receipt.bucket, namespace: fixture.receipt.namespace };
        context = await openLocalMaintenance(target);
        service = createItemImagesService({ connectToDatabase: async () => db, configuration: config });
        pipeline = createLocalItemImagePipeline({ connectToDatabase: async () => db, configuration: config, storageConfig: fixture.config });
        bytes = await sharp({ create: { width: 800, height: 600, channels: 3, background: '#387ab2' } }).png().toBuffer();
        variants = (await processRaster(bytes)).variants;
        temp = fs.mkdtempSync(path.join(os.tmpdir(), 'moveout-recovery-tests-'));
    });
    beforeEach(async function () {
        for (const name of ['itemImages', 'items', 'moveOutPlans', 'users', 'sessions']) await db.collection(name).deleteMany({});
        owner = new ObjectId(); await db.collection('users').insertOne({ _id: owner, email: owner.toHexString() + '@example.test' });
        const now = new Date();
        plan = { _id: new ObjectId(), ownerId: owner, status: 'active', inventoryRevision: 0,
            moveOutDeadline: new Date(Date.now() + 20 * 86400000).toISOString().slice(0, 10), createdAt: now, updatedAt: now };
        item = { _id: new ObjectId(), ownerId: owner, planId: plan._id, status: 'draft', version: 1, createdAt: now, updatedAt: now };
        await db.collection('moveOutPlans').insertOne(plan); await db.collection('items').insertOne(item);
        storage = fixture.storage();
    });
    afterEach(function () { sinon.restore(); if (storage) storage.close(); });
    after(async function () {
        if (pipeline) pipeline.close(); if (context) await context.close();
        try { if (fixture) await fixture.close(); } finally { if (mongo) await mongo.close(); }
        if (temp) fs.rmSync(temp, { recursive: true });
    });
    it('revokes logical visibility first, physically removes both real variants and settles retained bytes exactly once', async function () {
        const r = await ready(), before = await quota(); await remove(r._id);
        assert.equal((await row(r._id)).state, 'delete_pending'); assert.equal((await quota()).retainedBytes, before.retainedBytes);
        for (const name of ['thumbnail', 'display']) await storage.getVariant(storedInput(r.variants[name]));
        const manifest = await preview(); assert.equal(manifest.operations[0].action, 'cleanup');
        const sessions = sinon.spy(context.db.client, 'startSession'), originalSend = S3Client.prototype.send;
        sinon.stub(S3Client.prototype, 'send').callsFake(async function (...args) {
            assert.ok(sessions.getCalls().every(call => !call.returnValue.inTransaction()), 'No S3 I/O inside MongoDB transaction callbacks');
            return originalSend.apply(this, args);
        });
        assert.equal((await apply(manifest)).results[0].status, 'deleted');
        for (const name of ['thumbnail', 'display']) await absent(r, name);
        await assertSettled(r._id, true);
        const q = await quota(); assert.deepEqual((await apply(await preview())).results, []); assert.deepEqual(await quota(), q);
        assert.equal((await remove(r._id)).status, 200);
    });
    it('dry-run performs no document, quota, object or index writes and preserves a real stored object', async function () {
        const r = await ready(); await remove(r._id);
        const before = digest({ row: await row(r._id), quota: await quota() });
        const send = sinon.spy(S3Client.prototype, 'send');
        const commands = [], listener = event => commands.push(event.commandName);
        context.db.client.on('commandStarted', listener);
        let manifest;
        try { manifest = await preview(); } finally { context.db.client.removeListener('commandStarted', listener); }
        assert.equal(manifest.operations.length, 1);
        assert.equal(digest({ row: await row(r._id), quota: await quota() }), before);
        assert.ok(send.getCalls().every(c => c.args[0].constructor.name === 'GetObjectCommand'));
        assert.ok(commands.includes('aggregate')); assert.ok(!commands.some(name => ['insert', 'update', 'delete', 'findAndModify', 'createIndexes', 'drop', 'create', 'dropDatabase'].includes(name)));
        for (const name of ['thumbnail', 'display']) await storage.getVariant(storedInput(r.variants[name]));
    });
    for (const phase of ['before_put', 'after_journal']) it('recovers real process termination ' + phase + ' without manufacturing unknown-write proof', async function () {
        const id = await reserve();
        await assert.rejects(execute(process.execPath, [path.join(__dirname, 'helpers/image-recovery-crash.js'), JSON.stringify({ target, config, phase,
            owner: owner.toHexString(), plan: plan._id.toHexString(), item: item._id.toHexString(), image: id })], { timeout: 20000 }), e => e.signal === 'SIGKILL');
        await expire(id); const manifest = await preview();
        if (phase === 'before_put') { assert.equal(manifest.operations[0].action, 'cleanup'); await apply(manifest); await assertSettled(id); }
        else {
            assert.equal(manifest.operations[0].action, 'unknown_write');
            const before = digest(await quota()); const result = await apply(manifest);
            assert.equal(result.results[0].status, 'unresolved'); assert.equal((await row(id)).variants.thumbnail.outcome, 'unknown');
            assert.equal(digest(await quota()), before); assert.equal((await quota()).activeUploads, 1);
        }
    });
    it('compensates a stored first variant and never-issued second variant without refunding daily attempts', async function () {
        const ticket = await prepared(); await put(ticket, 'thumbnail'); await service.fail(ticket);
        await apply(await preview()); await absent(await row(ticket._id), 'thumbnail'); await assertSettled(ticket._id);
    });
    it('keeps an unknown PUT charged after a genuine negative HEAD and GET, then handles a deliberately delayed real PUT', async function () {
        const ticket = await prepared(); const intent = await service.beginPut(ticket, 'thumbnail');
        let release;
        const delayed = new Promise(resolve => { release = resolve; }).then(() => storage.putVariant({ key: intent.key, body: variants.thumbnail.body }));
        await assert.rejects(storage.headVariant({ key: intent.key }), e => e.category === 'unconfirmed_absence');
        await absent(await row(ticket._id), 'thumbnail'); await expire(ticket._id);
        const blocked = await preview(); assert.equal(blocked.operations[0].action, 'unknown_write');
        const send = sinon.spy(S3Client.prototype, 'send'); await apply(blocked);
        assert.equal(send.getCalls().filter(c => c.args[0].constructor.name === 'DeleteObjectCommand').length, 0);
        assert.equal((await quota()).reservedBytes, ceiling.reservedBytes);
        release(); await delayed; // An actual provider commit AFTER the negative read.
        await apply(await preview()); const current = await row(ticket._id);
        assert.deepEqual(current.cleanup.recovery.unknownWrites, ['thumbnail']); await absent(current, 'thumbnail'); await assertSettled(ticket._id);
    });
    it('resolves a real committed PUT with a lost response only through a matching actual-byte GET', async function () {
        const ticket = await prepared(); await put(ticket, 'thumbnail', false); await expire(ticket._id);
        assert.equal((await row(ticket._id)).variants.thumbnail.outcome, 'unknown');
        assert.equal((await preview()).operations[0].observed.thumbnail, 'verified_present');
        await apply(await preview()); await assertSettled(ticket._id);
    });
    it('cleans both stored outputs after a final native transaction failure without ever returning to ready', async function () {
        const ticket = await prepared(); await put(ticket, 'thumbnail'); await put(ticket, 'display');
        const collection = db.collection('items'); const original = collection.updateOne.bind(collection);
        // Native transaction rollback, not simulated storage deletion.
        sinon.stub(db, 'collection').callsFake(name => name === 'items' ? Object.assign(Object.create(collection), { updateOne: async () => { throw new Error('injected final write'); } }) : db.client.db(db.databaseName).collection(name));
        await assert.rejects(service.finalize(ticket)); sinon.restore();
        assert.equal((await row(ticket._id)).state, 'processing'); assert.equal((await quota()).successful, 0);
        await expire(ticket._id); await apply(await preview()); await assertSettled(ticket._id);
        await assert.rejects(service.finalize(ticket)); assert.equal((await row(ticket._id)).state, 'deleted');
    });
    it('owner deletion fences an in-flight writer; cleanup stays blocked until its actual PUT is observed', async function () {
        const ticket = await prepared(), intent = await service.beginPut(ticket, 'thumbnail');
        await remove(ticket._id); await assert.rejects(service.stored(ticket, 'thumbnail'));
        const first = await preview(); assert.equal(first.operations[0].action, 'unknown_write'); await apply(first);
        assert.equal((await quota()).activeUploads, 1);
        await storage.putVariant({ key: intent.key, body: variants.thumbnail.body });
        await apply(await preview()); await absent(await row(ticket._id), 'thumbnail'); await assertSettled(ticket._id);
        await assert.rejects(service.finalize(ticket));
    });
    it('serializes reorder racing logical deletion and never renames or deletes the surviving photo', async function () {
        const first = await ready(), second = await ready();
        const outcomes = await Promise.allSettled([service.reorder(...ids(), { imageRevision: 2, imageIds: [second._id.toHexString(), first._id.toHexString()] }),
            service.remove(...ids(), first._id.toHexString(), { imageRevision: 2, action: 'delete' })]);
        assert.equal(outcomes.filter(o => o.status === 'fulfilled').length, 1);
        if ((await row(first._id)).state === 'ready') await remove(first._id);
        await apply(await preview()); assert.equal((await row(second._id)).state, 'ready'); assert.equal((await row(second._id)).sortPosition, 0);
        await storage.getVariant(storedInput(second.variants.display));
        assert.equal((await quota()).retainedBytes, second.charge.retainedBytes);
    });
    for (const close of ['plan_closure', 'manual_clear', 'handoff']) it('fences finalization and cleans outputs after ' + close + ' during processing', async function () {
        const ticket = await prepared(); await put(ticket, 'thumbnail'); await put(ticket, 'display');
        if (close === 'plan_closure') await db.collection('moveOutPlans').updateOne({ _id: plan._id }, { $set: { status: 'completed' } });
        else await db.collection('items').updateOne({ _id: item._id }, { $set: { status: 'cleared', clearedByPickupRequestId: close === 'handoff' ? new ObjectId() : null } });
        await assert.rejects(service.finalize(ticket)); await service.fail(ticket);
        await apply(await preview()); await assertSettled(ticket._id);
    });
    it('recovers SIGKILL after real DELETE, before acknowledgment journaling, and preserves stale-worker fencing', async function () {
        const r = await ready(); await remove(r._id); const manifest = await preview();
        await assert.rejects(execute(process.execPath, [path.join(__dirname, 'helpers/image-recovery-crash.js'), JSON.stringify({ target, phase: 'cleanup_after_delete', manifest,
            confirmations: confirmations(manifest) })], { timeout: 20000 }), e => e.signal === 'SIGKILL');
        const killed = await row(r._id); assert.equal(killed.variants.thumbnail.outcome, 'delete_unknown'); await absent(killed, 'thumbnail');
        assert.equal((await quota()).retainedBytes, r.charge.retainedBytes); await expireCleanup(r._id);
        await apply(await preview()); await assertSettled(r._id, true);
    });
    it('permits only one cleanup lease and one exact-once charge settlement across two workers', async function () {
        const r = await ready(); await remove(r._id); const manifest = await preview();
        const a = createLocalImageRecovery(context), b = createLocalImageRecovery(context);
        try {
            const results = await Promise.allSettled([a.apply(manifest, confirmations(manifest)), b.apply(manifest, confirmations(manifest))]);
            assert.equal(results.filter(x => x.status === 'fulfilled' && x.value.results[0].status === 'deleted').length, 1);
            await assertSettled(r._id, true); for (const name of ['thumbnail', 'display']) await absent(r, name);
        } finally { a.close(); b.close(); }
    });
    for (const fault of ['authorization', 'target_missing', 'timeout']) it('retains charges and objects when actual cleanup inspection fails: ' + fault, async function () {
        const r = await ready(); await remove(r._id); const manifest = await preview();
        const original = S3Client.prototype.send;
        sinon.stub(S3Client.prototype, 'send').callsFake(async function (command, ...rest) {
            if (command.constructor.name === 'GetObjectCommand') {
                const error = new Error('PRIVATE provider diagnostic must never escape');
                error.name = fault === 'target_missing' ? 'NoSuchBucket' : fault === 'timeout' ? 'TimeoutError' : 'AccessDenied';
                error.$metadata = { httpStatusCode: fault === 'target_missing' ? 404 : 403 }; throw error;
            }
            return original.call(this, command, ...rest);
        });
        const result = await apply(manifest); assert.equal(result.results[0].status, 'unresolved'); assert.equal(result.results[0].category, fault); sinon.restore();
        assert.equal((await quota()).retainedBytes, r.charge.retainedBytes); assert.notEqual((await row(r._id)).state, 'deleted');
        for (const name of ['thumbnail', 'display']) await storage.getVariant(storedInput(r.variants[name]));
    });
    it('does not confuse DELETE acknowledgment or an ambiguous response with verified absence and settlement', async function () {
        const r = await ready(); await remove(r._id); const manifest = await preview();
        const original = S3Client.prototype.send; let injected = false;
        sinon.stub(S3Client.prototype, 'send').callsFake(async function (command, ...rest) {
            const result = await original.call(this, command, ...rest);
            if (command.constructor.name === 'DeleteObjectCommand' && !injected) { injected = true; const e = new Error('lost delete response'); e.name = 'TimeoutError'; throw e; }
            return result;
        });
        const first = await apply(manifest); sinon.restore(); assert.equal(first.results[0].category, 'timeout');
        await absent(r, 'thumbnail'); assert.equal((await row(r._id)).variants.thumbnail.outcome, 'delete_unknown');
        assert.equal((await quota()).retainedBytes, r.charge.retainedBytes);
        await expireCleanup(r._id); await apply(await preview()); await assertSettled(r._id, true);
    });
    it('requires actual absence even when a DELETE response claims success while the real object remains', async function () {
        const r = await ready(); await remove(r._id); const manifest = await preview();
        const original = S3Client.prototype.send;
        sinon.stub(S3Client.prototype, 'send').callsFake(async function (command, ...rest) {
            if (command.constructor.name === 'DeleteObjectCommand') return { $metadata: { httpStatusCode: 204 } };
            return original.call(this, command, ...rest);
        });
        const result = await apply(manifest); sinon.restore(); assert.equal(result.results[0].category, 'integrity');
        assert.equal((await row(r._id)).variants.thumbnail.outcome, 'delete_acknowledged');
        assert.equal((await quota()).retainedBytes, r.charge.retainedBytes); await storage.getVariant(storedInput(r.variants.thumbnail));
        await expireCleanup(r._id); await apply(await preview()); await assertSettled(r._id, true);
    });
    it('rejects a stale cleanup worker after a second fenced worker settles the operation', async function () {
        const r = await ready(); await remove(r._id); const manifest = await preview();
        const original = S3Client.prototype.send; let release, waiting;
        const entered = new Promise(resolve => { waiting = resolve; });
        let held = false;
        sinon.stub(S3Client.prototype, 'send').callsFake(async function (command, ...rest) {
            if (command.constructor.name === 'DeleteObjectCommand' && !held) {
                held = true; waiting(); await new Promise(resolve => { release = resolve; });
            }
            return original.call(this, command, ...rest);
        });
        const first = apply(manifest); await entered; await expireCleanup(r._id);
        const next = await preview(); const second = await apply(next); assert.equal(second.results[0].status, 'deleted');
        release(); assert.equal((await first).results[0].status, 'unresolved'); await assertSettled(r._id, true);
    });
    it('rejects real externally modified bytes, but safely settles known completed PUTs whose objects are already absent', async function () {
        const r = await ready(); await remove(r._id);
        const raw = fixture.client(), v = r.variants.thumbnail;
        await raw.send(new PutObjectCommand({ Bucket: fixture.receipt.bucket, Key: v.key, Body: Buffer.from('tampered'),
            ContentType: 'image/webp', CacheControl: 'no-store', Metadata: { sha256: v.sha256 } }));
        const blocked = await preview(); assert.equal(blocked.operations[0].action, 'storage_unresolved'); await apply(blocked);
        assert.equal((await quota()).retainedBytes, r.charge.retainedBytes);
        await storage.deleteVariant({ key: v.key }); // Verified owned target, test-only external removal.
        await apply(await preview()); await assertSettled(r._id, true);
    });
    it('does not treat a missing real bucket as object absence or authorize a destructive fallback', async function () {
        // This test owns an entirely separate disposable service; never remove
        // the suite's bucket or any existing development resource.
        const separate = await createIsolatedSeaweedFS();
        let maintenance, recovery;
        try {
            const alternate = { storageBinding: { fingerprint: separate.config.targetFingerprint, namespace: separate.receipt.namespace }, limits: config.limits };
            const metadata = createItemImagesService({ connectToDatabase: async () => db, configuration: alternate });
            const id = (await metadata.reserve(...ids(), { imageRevision: 0, clientUploadId: randomUUID(), byteLength: bytes.length, sha256: sha256(bytes) })).body.upload.id;
            const claimed = await metadata.claim(...ids(), id); await metadata.prepareVariants(claimed.row, variants); await expire(id);
            maintenance = await openLocalMaintenance(Object.assign({}, target, { storageReceiptPath: separate.receiptPath,
                bucket: separate.receipt.bucket, namespace: separate.receipt.namespace }));
            const raw = separate.client(); await separate.verify(); await raw.send(new DeleteBucketCommand({ Bucket: separate.receipt.bucket }));
            recovery = createLocalImageRecovery(maintenance); const manifest = await recovery.preview();
            assert.equal(manifest.operations[0].action, 'storage_unresolved'); assert.equal(manifest.operations[0].observed.thumbnail, 'target_missing');
            const results = await recovery.apply(manifest, Object.assign({}, maintenance.identity, { manifest: manifest.digest }));
            assert.equal(results.results[0].status, 'unresolved'); assert.equal((await row(id)).state, 'processing');
        } finally { if (recovery) recovery.close(); if (maintenance) await maintenance.close(); await separate.close(); }
        assert.equal((await quota()).activeUploads, 1);
    });
    it('retries MongoDB commit uncertainty without repeating physical I/O or settling twice', async function () {
        const r = await ready(); await remove(r._id); const manifest = await preview();
        const send = sinon.spy(S3Client.prototype, 'send'); const original = ClientSession.prototype.commitTransaction;
        let injected = false;
        sinon.stub(ClientSession.prototype, 'commitTransaction').callsFake(async function (...args) {
            const result = await original.apply(this, args);
            const current = await row(r._id);
            if (!injected && current.state === 'deleted') { injected = true; throw new MongoServerError({ message: 'synthetic lost commit response', errorLabels: ['UnknownTransactionCommitResult'] }); }
            return result;
        });
        await apply(manifest); assert.equal(injected, true); await assertSettled(r._id, true);
        assert.equal(send.getCalls().filter(c => c.args[0].constructor.name === 'DeleteObjectCommand').length, 2);
    });
    it('keeps deletion journals and charges when settlement rolls back after physical removal, then recovers with a new manifest', async function () {
        const r = await ready(); await remove(r._id); const manifest = await preview();
        const original = context.db.collection.bind(context.db);
        sinon.stub(context.db, 'collection').callsFake(name => {
            const c = original(name);
            if (name !== 'users') return c;
            return Object.assign(Object.create(c), { updateOne: async () => { throw new Error('injected settlement rollback'); } });
        });
        await apply(manifest); sinon.restore();
        const current = await row(r._id); assert.notEqual(current.state, 'deleted'); assert.equal((await quota()).retainedBytes, r.charge.retainedBytes);
        for (const name of ['thumbnail', 'display']) await absent(r, name);
        await expireCleanup(r._id); await apply(await preview()); await assertSettled(r._id, true);
    });
    it('retains tombstones, generation, intent and operation counts after repeated manual reconciliation', async function () {
        const r = await ready(); await remove(r._id); await apply(await preview());
        const current = await row(r._id), q = await quota();
        assert.equal(current.generation, r.generation); assert.deepEqual(current.intent, r.intent); assert.deepEqual(current.storageBinding, r.storageBinding);
        assert.equal(current.clientUploadId, r.clientUploadId); for (let i = 0; i < 3; i++) await apply(await preview());
        assert.deepEqual(await quota(), q); assert.equal(await db.collection('itemImages').countDocuments(), 1);
    });
    for (const key of ['database', 'environment', 'databaseFingerprint', 'storageFingerprint', 'provider', 'bucket', 'namespace', 'manifest']) it('refuses wrong explicit confirmation: ' + key, async function () {
        const r = await ready(); await remove(r._id); const manifest = await preview(), recovery = createLocalImageRecovery(context);
        const before = digest(await quota());
        try { await assert.rejects(recovery.apply(manifest, Object.assign(confirmations(manifest), { [key]: 'wrong' })), /target_mismatch/); }
        finally { recovery.close(); }
        assert.equal(digest(await quota()), before); await storage.getVariant(storedInput(r.variants.display));
    });
    it('refuses stale, tampered, expired, lost and oversized manifests before any DELETE', async function () {
        const r = await ready(); await remove(r._id); const manifest = await preview();
        const send = sinon.spy(S3Client.prototype, 'send');
        const changed = JSON.parse(JSON.stringify(manifest)); changed.operations[0].version++;
        await assert.rejects(apply(changed));
        const expired = JSON.parse(JSON.stringify(manifest)); expired.createdAt = new Date(Date.now() - 1200000).toISOString();
        expired.expiresAt = new Date(Date.parse(expired.createdAt) + bounds.manifestMs).toISOString(); delete expired.digest; expired.digest = digest(expired);
        await assert.rejects(apply(expired));
        await db.collection('itemImages').updateOne({ _id: r._id }, { $inc: { version: 1 } }); await assert.rejects(apply(manifest), /changed/);
        await assert.rejects(apply(null));
        const large = Object.assign({}, manifest, { operations: Array.from({ length: 26 }, () => manifest.operations[0]) }); delete large.digest; large.digest = digest(large);
        await assert.rejects(apply(large));
        assert.equal(send.getCalls().filter(c => c.args[0].constructor.name === 'DeleteObjectCommand').length, 0);
    });
    it('refuses forged receipts, wrong namespaces, remote environment and unbranded recovery targets', async function () {
        assert.throws(() => createLocalImageRecovery(Object.assign({}, context)), /target_mismatch/);
        for (const override of [{ databaseName: 'production' }, { namespace: 'foreign' }, { environment: 'staging' }, { provider: 'r2' }]) {
            await assert.rejects(openLocalMaintenance(Object.assign({}, target, override)));
        }
        for (const kind of ['mongo', 'storage']) {
            const originalPath = kind === 'mongo' ? mongo.receiptPath : fixture.receiptPath;
            const forged = readPrivateJson(originalPath); if (kind === 'mongo') forged.processId = '0'.repeat(24); else forged.nonce = '0'.repeat(48);
            const file = path.join(temp, randomUUID() + '.json'); writePrivateJson(file, forged);
            await assert.rejects(openLocalMaintenance(Object.assign({}, target, { [kind + 'ReceiptPath']: file })));
        }
    });
    it('fails closed on missing or corrupt accounting and never upserts a missing account', async function () {
        const r = await ready(); await remove(r._id); const saved = await quota();
        await db.collection('users').updateOne({ _id: owner }, { $set: { 'itemImageQuota.retainedBytes': 0 } });
        await assert.rejects(preview(), /accounting/);
        await db.collection('users').updateOne({ _id: owner }, { $set: { itemImageQuota: saved } });
        const manifest = await preview(); await db.collection('users').deleteOne({ _id: owner });
        await assert.rejects(apply(manifest), /accounting/); assert.equal(await db.collection('users').countDocuments(), 0);
        for (const name of ['thumbnail', 'display']) await storage.getVariant(storedInput(r.variants[name]));
    });
    it('settles old-day byte/concurrency holds without releasing new-day held successes', async function () {
        const ticket = await prepared(); const oldDay = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
        const time = new Date(Date.now() - 60000);
        await db.collection('itemImages').updateOne({ _id: ticket._id }, { $set: { 'charge.quotaDay': oldDay, 'lease.expiresAt': time, maintenanceDueAt: time } });
        await db.collection('users').updateOne({ _id: owner }, { $set: { 'itemImageQuota.utcDay': oldDay } });
        // Current-day reservation rotates daily counters while preserving old holds.
        const second = await reserve(); assert.equal((await quota()).heldSuccess, 1);
        await apply(await preview()); const q = await quota(); assert.equal(q.activeUploads, 1); assert.equal(q.heldSuccess, 1);
        assert.equal(q.reservedBytes, ceiling.reservedBytes); assert.equal(q.attempts, 1); assert.equal(q.operationCount, 2);
        assert.equal((await row(ticket._id)).state, 'deleted'); assert.equal((await row(second)).state, 'reserved');
    });
    it('cleans a verified orphan without restoring missing parents or granting image access', async function () {
        const r = await ready(); await remove(r._id); await db.collection('items').deleteOne({ _id: item._id });
        await db.collection('moveOutPlans').deleteOne({ _id: plan._id });
        await apply(await preview()); await assertSettled(r._id, true);
        assert.equal(await db.collection('items').countDocuments(), 0); assert.equal(await db.collection('moveOutPlans').countDocuments(), 0);
    });
    it('refuses compromised keys or live ownership changes and never deletes unrelated objects', async function () {
        const r = await ready(); await remove(r._id);
        await db.collection('itemImages').updateOne({ _id: r._id }, { $set: { 'variants.thumbnail.key': fixture.receipt.namespace + '/foreign' } });
        await assert.rejects(preview(), /integrity/);
        await db.collection('itemImages').updateOne({ _id: r._id }, { $set: { 'variants.thumbnail.key': r.variants.thumbnail.key } });
        await db.collection('items').updateOne({ _id: item._id }, { $set: { ownerId: new ObjectId() } });
        await assert.rejects(preview(), /integrity/); for (const name of ['thumbnail', 'display']) await storage.getVariant(storedInput(r.variants[name]));
    });
    it('keeps a deleted image inaccessible through the real image delivery route', async function () {
        const r = await ready();
        const authorize = createImageAuthorization({ connectToDatabase: async () => db, configuration: config });
        await authorize(r._id.toHexString(), 'display', owner);
        await remove(r._id); await assert.rejects(authorize(r._id.toHexString(), 'display', owner));
        await apply(await preview()); await assert.rejects(authorize(r._id.toHexString(), 'display', owner));
        const app = createApp({ connectToDatabase: async () => db, imageMetadata: config, imagePipeline: pipeline,
            discoveryLimit: 10000, logger: pino({ level: 'silent' }) });
        await request(app).get('/api/item-images/' + r._id + '/display').expect(404);
        await request(app).head('/api/item-images/' + r._id + '/thumbnail').expect(404);
        for (const name of ['thumbnail', 'display']) await absent(r, name);
    });
    it('runs the real CLI dry-run and confirmed apply using only private local receipts, without leaking keys or secrets', async function () {
        const r = await ready(); await remove(r._id); const file = path.join(temp, randomUUID() + '.json');
        const args = ['--mongo-receipt', mongo.receiptPath, '--storage-receipt', fixture.receiptPath, '--database', mongo.dbName,
            '--environment', 'development', '--provider', 'seaweedfs-local', '--bucket', fixture.receipt.bucket, '--namespace', fixture.receipt.namespace, '--manifest', file];
        const cli = path.join(__dirname, '../util/reconcile-item-images.js');
        const dry = await execute(process.execPath, [cli, '--dry-run', ...args], { timeout: 20000 });
        const summary = JSON.parse(dry.stdout); assert.equal(summary.operations, 1); const manifest = readPrivateJson(file);
        assert.equal(summary.manifestDigest, manifest.digest);
        await assert.rejects(execute(process.execPath, [cli, '--apply', ...args], { timeout: 20000 }), e =>
            e.code === 1 && /target_mismatch/.test(e.stderr) && !/mongodb:|PRIVATE|secretAccessKey/.test(e.stderr));
        assert.equal((await quota()).retainedBytes, r.charge.retainedBytes);
        await storage.getVariant(storedInput(r.variants.display));
        const c = context.identity;
        const applied = await execute(process.execPath, [cli, '--apply', ...args, '--confirm-database', c.database, '--confirm-environment', c.environment,
            '--confirm-database-target', c.databaseFingerprint, '--confirm-storage-target', c.storageFingerprint, '--confirm-provider', c.provider,
            '--confirm-bucket', c.bucket, '--confirm-namespace', c.namespace, '--confirm-manifest', manifest.digest], { timeout: 20000 });
        assert.equal(JSON.parse(applied.stdout).results[0].status, 'deleted');
        assert.ok(!dry.stdout.includes(r.variants.display.key)); assert.ok(!applied.stdout.includes(r.ownerId.toHexString()));
        assert.ok(!/mongodb:|AWS_|secretAccessKey|PRIVATE/.test(dry.stdout + applied.stdout + dry.stderr + applied.stderr));
        await assertSettled(r._id, true);
    });
    it('rejects missing confirmation, remote flags, duplicate args, excessive limits and unsafe manifest files', async function () {
        for (const args of [[], ['--apply', '--allow-remote'], ['--dry-run', '--dry-run'], ['--limit', '26'], ['--dry-run', '--apply']]) assert.throws(() => parse(args));
        const file = path.join(temp, randomUUID() + '.json'); writePrivateJson(file, { synthetic: true });
        assert.throws(() => writePrivateJson(file, {}));
        const link = path.join(temp, randomUUID() + '.json'); fs.symlinkSync(file, link); assert.throws(() => readPrivateJson(link));
        if (process.platform !== 'win32') { fs.chmodSync(file, 0o644); assert.throws(() => readPrivateJson(file)); }
    });
    it('bounds a full apply to 25 operations with a resumable preview cursor and no full-namespace sweep', async function () {
        for (let i = 0; i < 26; i++) { const id = await reserve(); await remove(id); }
        const first = await preview(); assert.equal(first.operations.length, 25); assert.ok(first.nextCursor);
        const r = createLocalImageRecovery(context);
        try { assert.equal((await r.preview({ after: first.nextCursor })).operations.length, 1); }
        finally { r.close(); }
        const result = await apply(first); assert.equal(result.operations, 25); assert.equal(result.inspections, 0);
        assert.ok(result.results.every(x => x.status === 'deleted')); assert.equal((await preview()).operations.length, 1);
        const q = await quota(); assert.equal(q.attempts, 26); assert.equal(q.operationCount, 26); assert.equal(q.activeUploads, 0);
    });
    it('uses exactly 100 bounded real-object inspections for a full 25-image physical deletion batch', async function () {
        const operations = [];
        for (let i = 0; i < 25; i++) {
            if (i === 20) {
                owner = new ObjectId(); await db.collection('users').insertOne({ _id: owner, email: owner.toHexString() + '@example.test' });
                plan = Object.assign({}, plan, { _id: new ObjectId(), ownerId: owner });
                item = Object.assign({}, item, { _id: new ObjectId(), planId: plan._id, ownerId: owner });
                await db.collection('moveOutPlans').insertOne(plan); await db.collection('items').insertOne(item);
            }
            const r = await ready(); operations.push(r); await remove(r._id);
        }
        const manifest = await preview(); assert.equal(manifest.operations.length, 25);
        const results = await apply(manifest); assert.equal(results.inspections, 100); assert.ok(results.results.every(r => r.status === 'deleted'));
        for (const r of operations) for (const name of ['thumbnail', 'display']) await absent(r, name);
        assert.equal(await db.collection('itemImages').countDocuments({ state: 'deleted' }), 25);
        const accounts = await db.collection('users').find({}).toArray();
        assert.ok(accounts.every(a => a.itemImageQuota.retainedBytes === 0 && a.itemImageQuota.reservedBytes === 0));
        assert.equal(accounts.reduce((sum, a) => sum + a.itemImageQuota.successful, 0), 25);
        assert.equal(accounts.reduce((sum, a) => sum + a.itemImageQuota.operationCount, 0), 25);
    });
    it('exposes an exhausted recovery budget without resetting attempts or entering an automatic retry loop', async function () {
        const r = await ready(); await remove(r._id);
        await db.collection('itemImages').updateOne({ _id: r._id }, { $set: { 'cleanup.attempts': bounds.attempts } });
        const manifest = await preview(); assert.equal(manifest.operations[0].action, 'retry_budget_exhausted');
        const result = await apply(manifest); assert.equal(result.results[0].category, 'retry_budget_exhausted');
        assert.equal((await quota()).retainedBytes, r.charge.retainedBytes); assert.equal((await row(r._id)).cleanup.attempts, bounds.attempts);
        await storage.getVariant(storedInput(r.variants.display));
    });
    it('never cleans a ready photo even if a corrupt maintenance flag makes it appear in a due query', async function () {
        const r = await ready(); const q = await quota();
        await db.collection('itemImages').updateOne({ _id: r._id }, { $set: { needsMaintenance: true, maintenanceDueAt: new Date(0) } });
        const manifest = await preview(); assert.equal(manifest.operations[0].action, 'ineligible_state');
        const result = await apply(manifest); assert.equal(result.results[0].status, 'unresolved');
        assert.equal((await row(r._id)).state, 'ready'); assert.deepEqual(await quota(), q);
        for (const name of ['thumbnail', 'display']) await storage.getVariant(storedInput(r.variants[name]));
    });
});
