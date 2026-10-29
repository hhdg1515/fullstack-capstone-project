/* jshint loopfunc: true */
const assert = require('node:assert/strict');
const { randomUUID, createHash } = require('node:crypto');
const { ObjectId, MongoServerError } = require('mongodb');
const sharp = require('sharp');
const request = require('supertest');
const sinon = require('sinon');
const http = require('node:http');
const pino = require('pino');
const { S3Client } = require('@aws-sdk/client-s3');
const createApp = require('../app');
const { createLocalItemImagePipeline } = require('../services/item-image-pipeline');
const { createItemImagesService } = require('../services/item-images');
const { ceiling, validOperation } = require('../services/item-image-policy');
const { createIsolatedMongo } = require('./helpers/isolated-mongo');
const { createIsolatedSeaweedFS } = require('./helpers/isolated-seaweedfs');
const { prepareDatabaseIndexes } = require('../services/database-indexes');
const hash = b => createHash('sha256').update(b).digest('hex');
const origin = 'http://localhost:3000';
const write = call => call.set('Origin', origin).set('X-CSRF-Protection', '1');

describe('native image pipeline with owned MongoDB and real private SeaweedFS', function () {
    this.timeout(180000);
    let isolated, fixture, db, config, pipeline, pipeline2, app, app2, owner, other, ownerRecord, otherRecord, sessionRecords, plan, item, image;
    const root = () => '/api/move-out-plans/' + plan._id + '/items/' + item._id + '/images';
    const row = id => db.collection('itemImages').findOne({ _id: new ObjectId(id) });
    const quota = async () => (await db.collection('users').findOne({ _id: owner.id })).itemImageQuota;
    const makeApp = (pipe = pipeline) => createApp({ connectToDatabase: async () => db, imageMetadata: config, imagePipeline: pipe,
        imageControlLimit: 10000, discoveryLimit: 10000, authLimit: 10000, logger: pino({ level: 'silent' }) });
    const reserve = async (bytes = image, server = app) => (await write(request(server).post(root() + '/uploads')).set('Cookie', owner.cookie)
        .send({ imageRevision: 0, clientUploadId: randomUUID(), byteLength: bytes.length, sha256: hash(bytes) }).expect(201)).body.upload.id;
    const upload = (id, bytes = image, server = app, actor = owner) => write(request(server).put(root() + '/' + id + '/content'))
        .set('Cookie', actor.cookie).attach('file', bytes, { filename: 'synthetic.bin', contentType: 'application/octet-stream' });
    const view = (id, variant = 'display', actor = null, server = app) => request(server).get('/api/item-images/' + id + '/' + variant).set('Cookie', actor ? actor.cookie : '');
    const remove = id => write(request(app).post(root() + '/' + id + '/actions')).set('Cookie', owner.cookie).send({ imageRevision: 0, action: 'delete' });
    before(async function () {
        isolated = await createIsolatedMongo(); db = isolated.db; await prepareDatabaseIndexes(db);
        fixture = await createIsolatedSeaweedFS();
        config = { storageBinding: { fingerprint: fixture.config.targetFingerprint, namespace: fixture.receipt.namespace },
            limits: { attempts: 50, successes: 20, accountBytes: 100 * 1024 * 1024, concurrent: 2, records: 1000 } };
        pipeline = createLocalItemImagePipeline({ connectToDatabase: async () => db, configuration: config, storageConfig: fixture.config });
        pipeline2 = createLocalItemImagePipeline({ connectToDatabase: async () => db, configuration: config, storageConfig: fixture.config });
        app = makeApp(); app2 = makeApp(pipeline2);
        async function account(email) {
            const result = await write(request(app).post('/api/auth/register')).send({ email, firstName: 'Synthetic', lastName: 'Person', password: 'synthetic-pipeline-password' }).expect(201);
            return { id: new ObjectId(result.body.user.id), cookie: result.headers['set-cookie'][0].split(';')[0] };
        }
        owner = await account('pipeline-owner@example.test'); other = await account('pipeline-other@example.test');
        ownerRecord = await db.collection('users').findOne({ _id: owner.id }); otherRecord = await db.collection('users').findOne({ _id: other.id });
        sessionRecords = await db.collection('sessions').find({}).toArray();
        image = await sharp({ create: { width: 800, height: 600, channels: 3, background: '#387ab2' } }).png().toBuffer();
    });
    afterEach(function () { sinon.restore(); });
    beforeEach(async function () {
        for (const name of ['itemImages', 'items', 'moveOutPlans', 'users', 'sessions', 'pickupRequests']) await db.collection(name).deleteMany({});
        await db.collection('sessions').insertMany(sessionRecords.map(r => Object.assign({}, r)));
        await db.collection('users').insertMany([Object.assign({}, ownerRecord), Object.assign({}, otherRecord)]);
        const now = new Date(); const deadline = new Date(Date.now() + 20 * 86400000).toISOString().slice(0, 10);
        plan = { _id: new ObjectId(), ownerId: owner.id, title: '', city: 'San Francisco', neighborhood: 'Sunset', stateId: '06', metroId: '41860',
            status: 'active', pickupTimeZone: 'America/Los_Angeles', moveOutDeadline: deadline, inventoryRevision: 0, createdAt: now, updatedAt: now };
        item = { _id: new ObjectId(), planId: plan._id, ownerId: owner.id, name: 'Synthetic household chair', description: 'Synthetic item.', category: '',
            categoryId: 'other-household', itemTypeId: 'other', status: 'draft', version: 1, availableFrom: null, availableUntil: null,
            publishedAt: null, createdAt: now, updatedAt: now };
        await db.collection('moveOutPlans').insertOne(plan); await db.collection('items').insertOne(item);
    });
    after(async function () {
        if (pipeline) pipeline.close(); if (pipeline2) pipeline2.close();
        try { if (fixture) await fixture.close(); } finally { if (isolated) await isolated.close(); }
    });
    it('fulfills a reservation with two sanitized private variants and exact-once quota/revision settlement', async function () {
        const id = await reserve(); const result = await upload(id).expect(201);
        assert.equal(result.body.imageRevision, 1); assert.equal(result.body.image.state, 'ready'); assert.equal(result.body.binaryUploadsEnabled, false);
        const current = await row(id); assert.ok(validOperation(current));
        assert.equal(current.state, 'ready'); assert.equal(current.sortPosition, 0); assert.equal(current.variants.thumbnail.width, 400);
        const q = await quota(); assert.equal(q.attempts, 1); assert.equal(q.successful, 1); assert.equal(q.heldSuccess, 0); assert.equal(q.activeUploads, 0);
        assert.equal(q.reservedBytes, 0); assert.equal(q.retainedBytes, current.variants.thumbnail.byteLength + current.variants.display.byteLength);
        const stored = fixture.storage();
        for (const name of ['thumbnail', 'display']) {
            const v = current.variants[name]; const object = await stored.getVariant({ key: v.key, byteLength: v.byteLength, sha256: v.sha256 });
            const actual = await sharp(object.body).metadata(); assert.equal(actual.format, 'webp'); assert.equal(actual.exif, undefined); assert.equal(actual.icc, undefined);
            assert.notEqual(hash(object.body), hash(image));
        }
        const spy = sinon.spy(S3Client.prototype, 'send');
        await upload(id, Buffer.from('different content'), app2).expect(200);
        assert.equal(spy.callCount, 0); assert.deepEqual(await quota(), q);
        assert.equal((await db.collection('items').findOne({ _id: item._id })).imageRevision, 1);
        assert.equal((await db.collection('items').findOne({ _id: item._id })).version, 1);
    });
    it('keeps draft images private and serves verified owner GET/HEAD with fixed safe headers', async function () {
        const id = await reserve(); await upload(id).expect(201);
        await view(id).expect(404); await view(id, 'display', other).expect(404);
        const response = await view(id, 'display', owner).expect(200);
        assert.equal(response.headers['content-type'], 'image/webp'); assert.equal(response.headers['cache-control'], 'private, no-store');
        assert.equal(response.headers['x-content-type-options'], 'nosniff'); assert.equal(response.headers['cross-origin-resource-policy'], 'same-site');
        const spy = sinon.spy(S3Client.prototype, 'send');
        const head = await request(app).head('/api/item-images/' + id + '/display').set('Cookie', owner.cookie).expect(200);
        assert.equal(head.text, undefined); assert.equal(head.headers['content-length'], response.headers['content-length']);
        assert.ok(spy.getCalls().every(call => call.args[0].constructor.name === 'HeadObjectCommand'));
    });
    it('authenticates owner/session/Origin/CSRF before accepting any malformed image bytes', async function () {
        const id = await reserve(); const spy = sinon.spy(S3Client.prototype, 'send');
        const path = root() + '/' + id + '/content';
        await write(request(app).put(path)).set('Content-Type', 'multipart/form-data; boundary=x').send('malformed').expect(401);
        await write(request(app).put(path)).set('Cookie', 'giftlink_session=' + 'e'.repeat(64)).set('Content-Type', 'multipart/form-data; boundary=x').send('bad').expect(401);
        await upload(id, image, app, other).expect(404);
        await request(app).put(path).set('Cookie', owner.cookie).attach('file', image).expect(403);
        await write(request(app).put(path)).set('Origin', 'http://wrong.invalid').set('Cookie', owner.cookie).attach('file', image).expect(403);
        await write(request(app).put(root() + '/' + new ObjectId() + '/content')).set('Cookie', owner.cookie).attach('file', image).expect(404);
        assert.equal(spy.callCount, 0); assert.equal((await row(id)).state, 'reserved');
    });
    it('keeps multipart disabled elsewhere, requires valid target injection, and never enables deployment flags', async function () {
        await write(request(app).post('/api/me')).set('Cookie', owner.cookie).attach('file', image).expect(415);
        await write(request(app).post(root() + '/uploads')).set('Cookie', owner.cookie).attach('file', image).expect(415);
        const disabled = makeApp(null), id = await reserve();
        await upload(id, image, disabled).expect(415); await view(id, 'display', owner, disabled).expect(404);
        assert.throws(() => makeApp({ enabled: true }), /Invalid local/);
        assert.throws(() => createLocalItemImagePipeline({ connectToDatabase: async () => db, configuration: config, storageConfig: {} }));
    });
    it('reports binary/read capability only for an actual sealed local pipeline while retaining the deployed product gate', async function () {
        const local = await request(app).get(root()).set('Cookie', owner.cookie).expect(200);
        assert.deepEqual(local.body.capabilities, { metadata: true, binaryUpload: true, imageRead: true });
        assert.equal(local.body.binaryUploadsEnabled, false);
        const disabled = await request(makeApp(null)).get(root()).set('Cookie', owner.cookie).expect(200);
        assert.deepEqual(disabled.body.capabilities, { metadata: true, binaryUpload: false, imageRead: false });
        assert.equal(disabled.body.allowance.itemSlots, 5);
    });
    it('rejects encoding and oversized request declarations without claiming the reservation', async function () {
        const id = await reserve();
        await upload(id).set('Content-Encoding', 'gzip').expect(415);
        await write(request(app).put(root() + '/' + id + '/content')).set('Cookie', owner.cookie)
            .set('Content-Type', 'multipart/form-data; boundary=x').set('Content-Length', '3407873').send('x').expect(413);
        assert.equal((await row(id)).state, 'reserved'); assert.equal((await quota()).activeUploads, 1);
    });
    for (const kind of ['truncated', 'extra-field', 'two-files', 'wrong-field', 'empty']) it('durably fails ' + kind + ' multipart before any storage operation', async function () {
        const id = await reserve(); const path = root() + '/' + id + '/content'; let call = write(request(app).put(path)).set('Cookie', owner.cookie);
        if (kind === 'truncated') call = call.set('Content-Type', 'multipart/form-data; boundary=x').send('--x\r\ntruncated');
        else if (kind === 'extra-field') call = call.attach('file', image).field('ownerId', other.id.toString());
        else if (kind === 'two-files') call = call.attach('file', image).attach('file', image);
        else if (kind === 'wrong-field') call = call.attach('ownerId', image);
        else call = call.attach('file', Buffer.alloc(0));
        const spy = sinon.spy(S3Client.prototype, 'send'); await call.expect(400);
        assert.equal(spy.callCount, 0); assert.equal((await row(id)).state, 'failed');
        const q = await quota(); assert.equal(q.activeUploads, 0); assert.equal(q.reservedBytes, 0); assert.equal(q.attempts, 1); assert.equal(q.operationCount, 1);
        await upload(id).expect(409); assert.equal(spy.callCount, 0);
    });
    it('enforces actual chunked request and file bytes, including absent Content-Length', async function () {
        const id = await reserve(); const server = app.listen(0, '127.0.0.1');
        await new Promise(resolve => server.once('listening', resolve));
        try {
            const status = await new Promise((resolve, reject) => {
                const req = http.request({ host: '127.0.0.1', port: server.address().port, method: 'PUT', path: root() + '/' + id + '/content',
                    headers: { Origin: origin, 'X-CSRF-Protection': '1', Cookie: owner.cookie, 'Content-Type': 'multipart/form-data; boundary=x', 'Transfer-Encoding': 'chunked', Connection: 'close' } },
                res => { res.resume(); res.on('end', () => resolve(res.statusCode)); });
                req.on('error', reject); req.end(Buffer.alloc(3407873));
            });
            assert.equal(status, 413); assert.equal((await row(id)).state, 'failed'); assert.equal((await quota()).activeUploads, 0);
        } finally { await new Promise(resolve => server.close(resolve)); }
    });
    it('times out a genuinely stalled body, releases only proven no-write capacity and keeps the attempt', async function () {
        const id = await reserve(); const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
        try {
            const status = await new Promise((resolve, reject) => {
                const req = http.request({ host: '127.0.0.1', port: server.address().port, method: 'PUT', path: root() + '/' + id + '/content',
                    headers: { Origin: origin, 'X-CSRF-Protection': '1', Cookie: owner.cookie, 'Content-Type': 'multipart/form-data; boundary=x', Connection: 'close' } },
                res => { res.resume(); res.on('end', () => { req.destroy(); resolve(res.statusCode); }); });
                req.on('error', reject); req.write('--x\r\n');
            });
            assert.equal(status, 408); assert.equal((await row(id)).state, 'failed'); assert.equal((await quota()).activeUploads, 0); assert.equal((await quota()).attempts, 1);
        } finally { await new Promise(resolve => server.close(resolve)); }
    });
    it('checks actual length and SHA-256 before decode/PUT and never retries failed tickets', async function () {
        const id = await reserve(), changed = Buffer.from(image); changed[changed.length - 1] ^= 1;
        const spy = sinon.spy(S3Client.prototype, 'send');
        await upload(id, changed).expect(422); await upload(id).expect(409);
        assert.equal(spy.callCount, 0); assert.equal((await quota()).attempts, 1); assert.equal((await quota()).reservedBytes, 0);
        const second = await reserve(); await upload(second, image.subarray(0, -1)).expect(422); assert.equal(spy.callCount, 0);
    });
    it('claims one processing execution across two independent services sharing real transactions', async function () {
        const id = await reserve(); const a = createItemImagesService({ connectToDatabase: async () => db, configuration: config });
        const b = createItemImagesService({ connectToDatabase: async () => db, configuration: config });
        const claims = await Promise.all([a.claim(owner.id, plan._id.toString(), item._id.toString(), id), b.claim(owner.id, plan._id.toString(), item._id.toString(), id)]);
        assert.equal(claims.filter(c => c.claimed).length, 1); assert.equal((await row(id)).state, 'processing');
        const spy = sinon.spy(S3Client.prototype, 'send'); await upload(id).expect(202); assert.equal(spy.callCount, 0);
        assert.equal((await quota()).activeUploads, 1);
    });
    it('rejects expired, cleared and inactive-plan content tickets without another processing attempt', async function () {
        const id = await reserve();
        await db.collection('itemImages').updateOne({ _id: new ObjectId(id) }, { $set: { 'lease.expiresAt': new Date(1) } });
        await upload(id).expect(409);
        await db.collection('itemImages').updateOne({ _id: new ObjectId(id) }, { $set: { 'lease.expiresAt': new Date(Date.now() + 60000) } });
        await db.collection('items').updateOne({ _id: item._id }, { $set: { status: 'cleared' } }); await upload(id).expect(409);
        await db.collection('items').updateOne({ _id: item._id }, { $set: { status: 'draft' } });
        await db.collection('moveOutPlans').updateOne({ _id: plan._id }, { $set: { status: 'completed' } }); await upload(id).expect(409);
        assert.equal((await row(id)).state, 'reserved');
    });
    for (const failure of ['lost-response', 'second-put']) it('journals and retains holds after ' + failure + ' without replay or negative-HEAD refunds', async function () {
        const id = await reserve(); const original = S3Client.prototype.send; let puts = 0;
        sinon.stub(S3Client.prototype, 'send').callsFake(async function (command, options) {
            if (command.constructor.name === 'PutObjectCommand') {
                puts++;
                if (failure === 'lost-response') { await original.call(this, command, options); throw Object.assign(new Error('Private provider details'), { code: 'ETIMEDOUT' }); }
                if (puts === 2) throw Object.assign(new Error('Private provider details'), { $metadata: { httpStatusCode: 503 } });
            }
            return original.call(this, command, options);
        });
        const result = await upload(id).expect(503); assert.ok(!JSON.stringify(result.body).includes('Private provider'));
        const current = await row(id); assert.equal(current.state, 'failed'); assert.equal(current.needsMaintenance, true);
        assert.ok(Object.values(current.variants).some(v => v.outcome === 'unknown')); assert.equal((await quota()).reservedBytes, ceiling.reservedBytes);
        assert.equal((await quota()).activeUploads, 1); assert.equal((await quota()).successful, 0);
        const before = puts; await upload(id).expect(409); assert.equal(puts, before);
        const storage = fixture.storage(); const v = current.variants.display;
        await assert.rejects(storage.headVariant({ key: v.key })); assert.equal((await quota()).reservedBytes, ceiling.reservedBytes);
        await view(id, 'display', owner).expect(404);
    });
    for (const change of ['delete', 'clear', 'close']) it('fences finalization when owner ' + change + ' wins during an actual object write', async function () {
        const id = await reserve(); const original = S3Client.prototype.send; let puts = 0;
        sinon.stub(S3Client.prototype, 'send').callsFake(async function (command, options) {
            const result = await original.call(this, command, options);
            if (command.constructor.name === 'PutObjectCommand' && ++puts === 1) {
                if (change === 'delete') await remove(id).expect(202);
                if (change === 'clear') await db.collection('items').updateOne({ _id: item._id }, { $set: { status: 'cleared' } });
                if (change === 'close') await db.collection('moveOutPlans').updateOne({ _id: plan._id }, { $set: { status: 'completed' } });
            }
            return result;
        });
        await upload(id).expect(409); const current = await row(id);
        assert.equal(current.state, change === 'delete' ? 'delete_pending' : 'failed');
        assert.equal(current.charge.concurrencyHeld, true); assert.equal(current.charge.reservedBytes, ceiling.reservedBytes);
        assert.equal((await quota()).successful, 0); assert.equal(puts, 1); await view(id, 'display', owner).expect(404);
    });
    it('rolls finalization back on a real MongoDB write failure after storing both variants', async function () {
        const id = await reserve(); const collection = db.collection('items'), original = collection.updateOne;
        sinon.stub(collection, 'updateOne').callsFake(async function (filter, update, options) {
            if (update.$set && update.$set.imageRevision) throw new Error('Synthetic DB failure');
            return original.call(this, filter, update, options);
        });
        // Db.collection returns stable equivalent collection instances, so intercept at Db selection.
        const select = db.collection.bind(db); sinon.stub(db, 'collection').callsFake(name => name === 'items' ? collection : select(name));
        await upload(id).expect(503); assert.equal((await row(id)).state, 'failed');
        assert.ok(Object.values((await row(id)).variants).every(v => v.outcome === 'stored'));
        assert.equal((await quota()).successful, 0); assert.equal((await quota()).reservedBytes, ceiling.reservedBytes);
        assert.equal((await db.collection('items').findOne({ _id: item._id })).imageRevision, undefined);
    });
    it('uses current public-detail eligibility, including reservations, and revokes non-owner access on withdrawal/clearance', async function () {
        const id = await reserve(); await upload(id).expect(201);
        await db.collection('items').updateOne({ _id: item._id }, { $set: { status: 'available', publishedAt: new Date() } });
        await db.collection('pickupRequests').insertOne({ _id: new ObjectId(), itemId: item._id, planId: plan._id, giverId: owner.id, receiverId: other.id, status: 'accepted', active: true });
        await view(id).expect(200); await view(id, 'display', other).expect(200);
        for (const state of ['unlisted', 'cleared', 'draft', 'expired']) {
            await db.collection('items').updateOne({ _id: item._id }, { $set: { status: state } });
            await view(id).expect(404); await view(id, 'display', other).expect(404); await view(id, 'display', owner).expect(200);
        }
        await db.collection('moveOutPlans').updateOne({ _id: plan._id }, { $set: { status: 'completed' } }); await view(id, 'display', owner).expect(200);
    });
    it('rechecks revocation after storage fetch and revalidates the owner session before sending bytes', async function () {
        const id = await reserve(); await upload(id).expect(201); const original = S3Client.prototype.send;
        sinon.stub(S3Client.prototype, 'send').callsFake(async function (command, options) {
            const result = await original.call(this, command, options);
            if (command.constructor.name === 'GetObjectCommand') await db.collection('sessions').deleteMany({ userId: owner.id });
            return result;
        });
        await view(id, 'display', owner).expect(404);
    });
    it('rejects invalid variants, mismatched references, deleted owner accounts and non-ready images generically', async function () {
        const id = await reserve(); await view(id, 'display', owner).expect(404); await upload(id).expect(201);
        await view(id, 'original', owner).expect(404); await view('bad', 'display', owner).expect(404);
        await db.collection('itemImages').updateOne({ _id: new ObjectId(id) }, { $set: { ownerId: other.id } }); await view(id, 'display', owner).expect(404);
        await db.collection('itemImages').updateOne({ _id: new ObjectId(id) }, { $set: { ownerId: owner.id } });
        await db.collection('users').deleteOne({ _id: owner.id }); await view(id, 'display', owner).expect(404);
    });
    it('holds one native admission across app instances, returns canonical duplicates, and appends independently completed reservations', async function () {
        const first = await reserve(), second = await reserve(); const original = S3Client.prototype.send;
        let entered, release, puts = 0; const arrived = new Promise(resolve => { entered = resolve; }); const barrier = new Promise(resolve => { release = resolve; });
        sinon.stub(S3Client.prototype, 'send').callsFake(async function (command, options) {
            const result = await original.call(this, command, options);
            if (command.constructor.name === 'PutObjectCommand' && ++puts === 1) { entered(); await barrier; }
            return result;
        });
        const pending = upload(first).then(r => r);
        try {
            await arrived; await upload(first, image, app2).expect(202);
            assert.equal((await upload(second, image, app2).expect(429)).body.error.code, 'IMAGE_PROCESSOR_BUSY');
            assert.equal((await row(second)).state, 'reserved'); assert.equal(puts, 1);
        } finally { release(); }
        assert.equal((await pending).status, 201); await upload(second, image, app2).expect(201);
        assert.equal((await quota()).successful, 2); assert.equal((await row(first)).sortPosition, 0); assert.equal((await row(second)).sortPosition, 1);
        assert.equal((await db.collection('items').findOne({ _id: item._id })).imageRevision, 2);
    });
    it('retries only the final MongoDB transaction while keeping both object PUTs outside all transactions', async function () {
        const id = await reserve(); const collection = db.collection('items'), update = collection.updateOne, select = db.collection.bind(db);
        let revisions = 0; const sessions = []; const start = db.client.startSession;
        sinon.stub(db.client, 'startSession').callsFake(function (...args) { const session = start.apply(this, args); sessions.push(session); return session; });
        sinon.stub(collection, 'updateOne').callsFake(async function (filter, changes, options) {
            const result = await update.call(this, filter, changes, options);
            if (changes.$set && changes.$set.imageRevision && ++revisions === 1) {
                const error = new MongoServerError({ message: 'Synthetic transaction retry' }); error.addErrorLabel('TransientTransactionError'); throw error;
            }
            return result;
        });
        sinon.stub(db, 'collection').callsFake(name => name === 'items' ? collection : select(name));
        const send = S3Client.prototype.send; let puts = 0;
        sinon.stub(S3Client.prototype, 'send').callsFake(function (command, options) {
            assert.ok(sessions.every(session => !session.inTransaction())); if (command.constructor.name === 'PutObjectCommand') puts++;
            return send.call(this, command, options);
        });
        await upload(id).expect(201); assert.equal(puts, 2); assert.equal(revisions, 2); assert.equal((await quota()).successful, 1);
        assert.equal((await db.collection('items').findOne({ _id: item._id })).imageRevision, 1);
    });
    it('bounds concurrent verified media reads to eight without queuing extra requests', async function () {
        const id = await reserve(); await upload(id).expect(201); const original = S3Client.prototype.send;
        let enter, release, gets = 0; const all = new Promise(resolve => { enter = resolve; }); const barrier = new Promise(resolve => { release = resolve; });
        sinon.stub(S3Client.prototype, 'send').callsFake(async function (command, options) {
            const result = await original.call(this, command, options);
            if (command.constructor.name === 'GetObjectCommand') { if (++gets === 8) enter(); await barrier; }
            return result;
        });
        const pending = Array.from({ length: 8 }, () => view(id, 'display', owner).then(r => r));
        try { await all; await view(id, 'display', owner, app2).expect(429); assert.equal(gets, 8); }
        finally { release(); }
        assert.ok((await Promise.all(pending)).every(r => r.status === 200));
    });
    it('does not serve overwritten bytes whose metadata hash no longer matches the ready ledger', async function () {
        const id = await reserve(); await upload(id).expect(201); const current = await row(id);
        const { PutObjectCommand } = require('@aws-sdk/client-s3'); await fixture.verify();
        await fixture.client().send(new PutObjectCommand({ Bucket: fixture.receipt.bucket, Key: current.variants.display.key,
            Body: Buffer.from('tampered synthetic bytes'), ContentType: 'image/webp', CacheControl: 'no-store', Metadata: { sha256: 'a'.repeat(64) } }));
        const response = await view(id, 'display', owner).expect(503);
        assert.equal(response.headers['content-type'].startsWith('application/json'), true);
        assert.ok(!JSON.stringify(response.body).includes(fixture.receipt.bucket));
        await request(app).head('/api/item-images/' + id + '/display').set('Cookie', owner.cookie).expect(503);
    });
    it('rechecks public revocation after object fetch instead of trusting a prior public authorization', async function () {
        const id = await reserve(); await upload(id).expect(201);
        await db.collection('items').updateOne({ _id: item._id }, { $set: { status: 'available', publishedAt: new Date() } });
        const original = S3Client.prototype.send;
        sinon.stub(S3Client.prototype, 'send').callsFake(async function (command, options) {
            const result = await original.call(this, command, options);
            if (command.constructor.name === 'GetObjectCommand') await db.collection('items').updateOne({ _id: item._id }, { $set: { status: 'unlisted' } });
            return result;
        });
        await view(id).expect(404);
    });
    it('refuses an expired producer after a real PUT and keeps its uncertain accounting', async function () {
        const id = await reserve(), original = S3Client.prototype.send;
        sinon.stub(S3Client.prototype, 'send').callsFake(async function (command, options) {
            const result = await original.call(this, command, options);
            if (command.constructor.name === 'PutObjectCommand') await db.collection('itemImages').updateOne({ _id: new ObjectId(id) }, { $set: { 'lease.expiresAt': new Date(1) } });
            return result;
        });
        await upload(id).expect(409); assert.equal((await row(id)).state, 'failed');
        assert.equal((await quota()).successful, 0); assert.equal((await quota()).reservedBytes, ceiling.reservedBytes);
        assert.equal((await db.collection('items').findOne({ _id: item._id })).imageRevision, undefined);
    });
    it('denies public reads for effective expiry and corrupted immutable targets before touching storage', async function () {
        const id = await reserve(); await upload(id).expect(201); const original = await row(id);
        const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
        await db.collection('items').updateOne({ _id: item._id }, { $set: { status: 'available', publishedAt: new Date(), availableUntil: yesterday } });
        const spy = sinon.spy(S3Client.prototype, 'send'); await view(id).expect(404); assert.equal(spy.callCount, 0);
        await db.collection('items').updateOne({ _id: item._id }, { $set: { availableUntil: null } });
        for (const values of [{ generation: randomUUID() }, { planId: new ObjectId() }, { itemId: new ObjectId() },
            { storageBinding: { fingerprint: 'c'.repeat(64), namespace: fixture.receipt.namespace } }]) {
            await db.collection('itemImages').replaceOne({ _id: original._id }, Object.assign({}, original, values));
            await view(id, 'display', owner).expect(404);
            await request(app).head('/api/item-images/' + id + '/display').set('Cookie', owner.cookie).expect(404);
        }
        assert.equal(spy.callCount, 0);
    });
    it('records bounded warm local HTTP proxy overhead without exposing source or storage identifiers', async function () {
        const id = await reserve(); await upload(id).expect(201); const { performance } = require('node:perf_hooks');
        let start = performance.now(); const get = await view(id, 'display', owner).expect(200); const getMs = Math.round(performance.now() - start);
        start = performance.now(); await request(app).head('/api/item-images/' + id + '/display').set('Cookie', owner.cookie).expect(200);
        console.log(JSON.stringify({ imageProxyProbe: { scope: 'warm local HTTP including live Docker target verifier', getMs,
            headMs: Math.round(performance.now() - start), getBytes: Number(get.headers['content-length']), headBytes: 0 } }));
    });
    it('rejects array-shaped ownership/reference corruption even when MongoDB equality would match', async function () {
        const id = await reserve(); await upload(id).expect(201);
        for (const [collection, objectId, field, value] of [['moveOutPlans', plan._id, 'ownerId', owner.id],
            ['items', item._id, 'ownerId', owner.id], ['items', item._id, 'planId', plan._id]]) {
            await db.collection(collection).updateOne({ _id: objectId }, { $set: { [field]: [value] } });
            await view(id, 'display', owner).expect(404);
            await request(app).get(root()).set('Cookie', owner.cookie).expect(404);
            await db.collection(collection).updateOne({ _id: objectId }, { $set: { [field]: value } });
        }
    });
});
