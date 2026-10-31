/* jshint loopfunc: true */
const assert = require('node:assert/strict');
const { ObjectId } = require('mongodb');
const { randomUUID, createHash } = require('node:crypto');
const sharp = require('sharp'), request = require('supertest'), sinon = require('sinon');
const { S3Client } = require('@aws-sdk/client-s3');
const { createIsolatedMongo } = require('./helpers/isolated-mongo');
const { createIsolatedSeaweedFS } = require('./helpers/isolated-seaweedfs');
const { blockProviderNetwork } = require('./helpers/r2-fixture');
const { prepareDatabaseIndexes, assertDatabaseIndexes } = require('../services/database-indexes');
const { createRestoreExercise } = require('./helpers/photo-restore-exercise');
const restore = require('./helpers/local-photo-restore');
const { digest } = require('../services/item-image-recovery');
const hash = b => createHash('sha256').update(b).digest('hex');
const write = c => c.set('Origin', 'http://localhost:3000').set('X-CSRF-Protection', '1');
const day = n => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
describe('coordinated local photo disaster recovery with independent OS workers and private real storage', function () {
    this.timeout(180000); blockProviderNetwork();
    let mongo, fixture, db, ex, app, owner, receiver, plan, item, bytes; const timings = [];
    const root = () => '/api/move-out-plans/' + plan.id + '/items/' + item.id;
    const row = id => db.collection('itemImages').findOne({ _id: new ObjectId(id) });
    const quota = async () => (await db.collection('users').findOne({ _id: new ObjectId(owner.id) })).itemImageQuota;
    const confirm = p => ({ target: digest(ex.local.identity), plan: p.digest });
    async function login(worker, actor) {
        const r = await write(request(worker.url).post('/api/auth/login')).send({ email: actor.email, password: 'synthetic-restore-password' }).expect(200);
        return r.headers['set-cookie'][0].split(';')[0];
    }
    async function reserve(worker = app) {
        const current = await db.collection('items').findOne({ _id: new ObjectId(item.id) });
        return (await write(request(worker.url).post(root() + '/images/uploads')).set('Cookie', owner.cookie)
            .send({ imageRevision: current.imageRevision || 0, clientUploadId: randomUUID(), byteLength: bytes.length, sha256: hash(bytes) }).expect(201)).body.upload.id;
    }
    const upload = (id, worker = app) => write(request(worker.url).put(root() + '/images/' + id + '/content')).set('Cookie', owner.cookie)
        .attach('file', bytes, { filename: 'synthetic.png', contentType: 'image/png' }).timeout({ deadline: 20000 });
    async function ready() { const id = await reserve(); await upload(id).expect(201); return id; }
    const view = (worker, id, cookie = '') => request(worker.url).get('/api/item-images/' + id + '/thumbnail').set('Cookie', cookie);
    async function remove(id) {
        const current = await db.collection('items').findOne({ _id: new ObjectId(item.id) });
        await write(request(app.url).post(root() + '/images/' + id + '/actions')).set('Cookie', owner.cookie).send({ action: 'delete', imageRevision: current.imageRevision }).expect(202);
    }
    async function expire(id) {
        const current = await row(id), past = new Date(Date.now() - 60000), changes = { 'lease.expiresAt': past, maintenanceDueAt: past, 'cleanup.nextAttemptAt': null };
        if (current.cleanup.recovery) changes['cleanup.recovery.expiresAt'] = past;
        await db.collection('itemImages').updateOne({ _id: current._id }, { $set: changes });
    }
    async function apply(snapshot, inventories = [], crash = false) {
        const p = await ex.plan(snapshot, inventories); const r = await ex.execute(snapshot, p, confirm(p), inventories, crash);
        if (r.elapsedMs !== undefined) timings.push({ kind: r.kind, elapsedMs: r.elapsedMs }); return r;
    }
    async function freshGrants() {
        const runtime = await ex.fresh('runtime'), recovery = await ex.fresh('recovery');
        await ex.change('rotate-runtime', runtime, recovery); await ex.change('rotate-recovery', runtime, recovery);
        return { runtime, recovery };
    }
    before(async function () {
        mongo = await createIsolatedMongo(); db = mongo.db; await prepareDatabaseIndexes(db); fixture = await createIsolatedSeaweedFS();
        bytes = await sharp({ create: { width: 96, height: 64, channels: 3, background: '#427354' } }).png().toBuffer();
    });
    beforeEach(async function () {
        for (const name of restore.collections) await db.collection(name).deleteMany({});
        ex = await createRestoreExercise(mongo, fixture); app = await ex.photo();
        async function account() {
            const email = randomUUID() + '@example.invalid'; const r = await write(request(app.url).post('/api/auth/register'))
                .send({ firstName: 'Synthetic', lastName: 'Restore', email, password: 'synthetic-restore-password' }).expect(201);
            return { id: r.body.user.id, email, cookie: r.headers['set-cookie'][0].split(';')[0] };
        }
        owner = await account(); receiver = await account();
        plan = (await write(request(app.url).post('/api/move-out-plans')).set('Cookie', owner.cookie).send({ title: 'Synthetic restore plan', city: 'Oakland', neighborhood: 'Temescal',
            moveOutDeadline: day(20), pickupTimeZone: 'UTC', stateId: '06', metroId: '41860' }).expect(201)).body.plan;
        item = (await write(request(app.url).post('/api/move-out-plans/' + plan.id + '/items')).set('Cookie', owner.cookie)
            .send({ name: 'Synthetic restore chair', description: 'Synthetic household item.', categoryId: 'other-household', itemTypeId: 'other', publish: true }).expect(201)).body.item;
    });
    afterEach(async function () { sinon.restore(); if (ex) await ex.close(); });
    after(async function () { try { if (fixture) await fixture.close(); } finally { if (mongo) await mongo.close(); }
        console.log(JSON.stringify({ localRestoreMeasurements: timings, interpretation: 'Synthetic logical snapshot apply only; not production RPO/RTO or provider restore certification' })); });

    it('restores independent Ready snapshots under outage, discards sessions, and requires fresh paused grants before read-only reauthorization', async function () {
        const id = await ready(), before = await quota(), backup = await ex.captureDatabase(), objects = await ex.captureObjects([backup]);
        await ex.quarantine(); await apply(objects, [backup]); await apply(backup); await assert.rejects(ex.photo());
        assert.equal(await db.collection('sessions').countDocuments(), 0); assert.deepEqual(await quota(), before);
        let report = await ex.inspect(backup); assert.equal(report.consistentWithinInventory, true, report.findings.join(','));
        await assert.rejects(ex.accept(backup, report, { target: report.target, report: report.digest }, ex.runtime(), ex.recovery()));
        const grants = await freshGrants(); report = await ex.inspect(backup);
        await assert.rejects(ex.accept(backup, report, { target: '0'.repeat(64), report: report.digest }, grants.runtime, grants.recovery));
        await ex.accept(backup, report, { target: report.target, report: report.digest }, grants.runtime, grants.recovery);
        const resumed = await ex.photo(); await request(resumed.url).get('/api/me').set('Cookie', owner.cookie).expect(401);
        owner.cookie = await login(resumed, owner); receiver.cookie = await login(resumed, receiver);
        await view(resumed, id).expect(200); await view(resumed, id, owner.cookie).expect(200);
        await write(request(resumed.url).post(root() + '/images/uploads')).set('Cookie', owner.cookie).send({ imageRevision: 1, clientUploadId: randomUUID(), byteLength: bytes.length, sha256: hash(bytes) }).expect(503);
        await write(request(resumed.url).post(root() + '/actions')).set('Cookie', owner.cookie).send({ action: 'unlist', version: item.version }).expect(200);
        await view(resumed, id, receiver.cookie).expect(404); await view(resumed, id, owner.cookie).expect(200); assert.deepEqual(await quota(), before);
        await assertDatabaseIndexes(db, { imageMetadataEnabled: true });
    });
    it('detects lost tombstones and quota rollback when an older database and older object backup resurrect deleted bytes, keeping all photo access closed', async function () {
        const id = await ready(), old = await ex.captureDatabase(), objects = await ex.captureObjects([old]);
        await remove(id); const cleanup = await ex.recover(ex.recovery()), manifest = await cleanup.rpc('preview'); await cleanup.rpc('apply', manifest);
        await ex.change('revoke-runtime'); const checkpoint = await ex.captureDatabase(); await ex.quarantine();
        await apply(old); await apply(objects, [old]); const report = await ex.inspect(checkpoint);
        for (const category of ['lost_tombstone', 'quota_checkpoint_changed', 'control_rollback', 'deleted_bytes_restored']) assert.ok(report.findings.includes(category), category);
        await assert.rejects(ex.photo()); const text = await ex.text(checkpoint); await view(text, id).expect(404);
        const cookie = await login(text, owner); await request(text.url).get('/api/me').set('Cookie', cookie).expect(200);
        await request(text.url).get('/api/move-out-plans').set('Cookie', cookie).expect(200);
        assert.equal((await row(id)).state, 'ready'); // Detected, never silently repaired or published by the recovery coordinator.
    });
    it('keeps durable deleted rows private even if old object bytes reappear; explicit exact-key reconstruction of the empty snapshot never refunds again', async function () {
        const id = await ready(), old = await ex.captureDatabase(), full = await ex.captureObjects([old]); await remove(id);
        const cleanup = await ex.recover(ex.recovery()); await cleanup.rpc('apply', await cleanup.rpc('preview'));
        const checkpoint = await ex.captureDatabase(), empty = await ex.captureObjects([checkpoint]), before = await quota();
        await ex.quarantine(); await apply(checkpoint); await apply(full, [checkpoint]);
        assert.ok((await ex.inspect(checkpoint)).findings.includes('deleted_bytes_restored'));
        const text = await ex.text(checkpoint); await view(text, id, owner.cookie).expect(404); await ex.quarantine();
        await apply(empty, [checkpoint]); assert.equal((await ex.inspect(checkpoint)).consistentWithinInventory, true);
        assert.equal((await row(id)).state, 'deleted'); assert.deepEqual(await quota(), before); assert.equal(before.operationCount, 1);
    });
    it('refuses Ready rows with missing objects and treats unavailable storage as failure, never as an empty successful restore', async function () {
        const id = await ready(), backup = await ex.captureDatabase(); await remove(id); const cleaner = await ex.recover(ex.recovery()); await cleaner.rpc('apply', await cleaner.rpc('preview'));
        await ex.quarantine(); await apply(backup); const before = await quota();
        assert.ok((await ex.inspect(backup)).findings.includes('ready_bytes_missing'));
        const stub = sinon.stub(S3Client.prototype, 'send').rejects(Object.assign(new Error('synthetic timeout'), { name: 'TimeoutError' }));
        await assert.rejects(ex.inspect(backup)); stub.restore(); assert.deepEqual(await quota(), before); await assert.rejects(ex.photo());
    });
    it('retains an issued-but-unsent unknown PUT and reserved quota across restore, negative GET and fresh recovery without replay', async function () {
        const id = await reserve(); await app.arm('before_put'); const pending = upload(id).then(v => v, () => null); await app.take('barrier'); await app.kill(); await pending;
        const backup = await ex.captureDatabase(), before = await quota(); await ex.quarantine(); await apply(backup);
        assert.ok((await ex.inspect(backup)).findings.includes('unresolved_operation')); await assert.rejects(ex.photo()); await expire(id);
        const fresh = await ex.fresh('recovery'); await ex.change('rotate-recovery', ex.runtime(), fresh); const cleaner = await ex.recover(fresh), manifest = await cleaner.rpc('preview');
        assert.equal(manifest.operations[0].action, 'unknown_write'); assert.equal((await cleaner.rpc('apply', manifest)).results[0].status, 'unresolved');
        assert.deepEqual(await quota(), before); assert.equal(cleaner.puts + cleaner.deletes, 0); assert.equal((await row(id)).variants.thumbnail.outcome, 'unknown');
    });
    it('settles a real committed lost PUT after database restore with two independently approved recovery OS processes exactly once', async function () {
        const id = await reserve(); await app.arm('after_put'); const pending = upload(id).then(v => v, () => null); await app.take('barrier'); await app.kill(); await pending;
        const backup = await ex.captureDatabase(), before = await quota(); assert.ok(before.reservedBytes > 0); await ex.quarantine(); await apply(backup); await expire(id);
        const fresh = await ex.fresh('recovery'); await ex.change('rotate-recovery', ex.runtime(), fresh);
        const a = await ex.recover(fresh), b = await ex.recover(fresh); assert.notEqual(a.pid, b.pid); const manifest = await a.rpc('preview');
        const results = await Promise.allSettled([a.rpc('apply', manifest), b.rpc('apply', manifest)]);
        assert.equal(results.filter(v => v.status === 'fulfilled' && v.value.results[0].status === 'deleted').length, 1);
        const after = await quota(); assert.equal(after.reservedBytes, 0); assert.equal(after.operationCount, 1); assert.equal(after.successful, before.successful);
        assert.equal(a.puts + b.puts, 0); assert.equal((await row(id)).state, 'deleted'); await assert.rejects(ex.photo());
    });
    it('restores an interrupted DELETE journal and old object backup without losing holds, then requires fresh recovery and verified settlement', async function () {
        const id = await ready(), old = await ex.captureDatabase(), objects = await ex.captureObjects([old]); await remove(id);
        const cleaner = await ex.recover(ex.recovery()), manifest = await cleaner.rpc('preview'); await cleaner.arm('after_delete');
        const pending = cleaner.rpc('apply', manifest).catch(() => null); await cleaner.take('barrier'); await cleaner.kill(); await pending;
        const backup = await ex.captureDatabase(), before = await quota(); assert.equal((await row(id)).variants.thumbnail.outcome, 'delete_unknown');
        await ex.quarantine(); await apply(backup); await apply(objects, [backup]); assert.deepEqual(await quota(), before); await expire(id);
        const fresh = await ex.fresh('recovery'); await ex.change('rotate-recovery', ex.runtime(), fresh); const next = await ex.recover(fresh);
        await assert.rejects(next.rpc('apply', manifest)); assert.equal((await next.rpc('apply', await next.rpc('preview'))).results[0].status, 'deleted');
        assert.equal((await quota()).retainedBytes, 0); assert.equal((await quota()).operationCount, 1); await assert.rejects(ex.photo());
    });
    it('quarantines authentication when an older database would resurrect old account security state, without reusing any restored session', async function () {
        await ready(); const old = await ex.captureDatabase();
        await db.collection('users').updateOne({ _id: new ObjectId(owner.id) }, { $set: { password: await require('bcryptjs').hash('synthetic-newer-password', 10) } });
        const checkpoint = await ex.captureDatabase(); await ex.quarantine(); await apply(old); const report = await ex.inspect(checkpoint);
        assert.equal(report.authSafe, false); assert.ok(report.findings.includes('account_security_changed')); assert.equal(await db.collection('sessions').countDocuments(), 0);
        const text = await ex.text(checkpoint); await write(request(text.url).post('/api/auth/login')).send({ email: owner.email, password: 'synthetic-restore-password' }).expect(503);
        await request(text.url).get('/api/me').set('Cookie', owner.cookie).expect(503); await assert.rejects(ex.photo());
    });
    it('does not silently reopen cancelled requests or unlisted media when snapshots regress visibility and private conversation history', async function () {
        const id = await ready(); const pickup = (await write(request(app.url).post('/api/pickup-requests')).set('Cookie', receiver.cookie)
            .send({ itemId: item.id, localDateTime: day(1) + 'T12:00', timeZone: 'UTC', note: 'Synthetic pickup' }).expect(201)).body.request;
        await write(request(app.url).post('/api/pickup-requests/' + pickup.id + '/conversation/messages')).set('Cookie', receiver.cookie).send({ text: 'Synthetic private history' }).expect(201);
        const old = await ex.captureDatabase();
        await write(request(app.url).post('/api/pickup-requests/' + pickup.id + '/actions')).set('Cookie', receiver.cookie).send({ action: 'cancel', version: pickup.version }).expect(200);
        await write(request(app.url).post(root() + '/actions')).set('Cookie', owner.cookie).send({ action: 'unlist', version: item.version }).expect(200);
        const checkpoint = await ex.captureDatabase(); await ex.quarantine(); await apply(old); const report = await ex.inspect(checkpoint);
        assert.ok(report.findings.includes('private_history_checkpoint_changed')); assert.ok(report.findings.includes('item_visibility_checkpoint_changed'));
        const locked = await ex.text(checkpoint); await request(locked.url).get('/api/items/' + item.id).expect(503); await view(locked, id).expect(503);
        await ex.quarantine(); await apply(checkpoint); const text = await ex.text(checkpoint), cookie = await login(text, receiver);
        const history = await request(text.url).get('/api/pickup-requests/' + pickup.id + '/conversation/messages').set('Cookie', cookie).expect(200);
        assert.equal(history.body.messages[0].text, 'Synthetic private history'); await view(text, id, cookie).expect(404);
        await write(request(text.url).post('/api/pickup-requests/' + pickup.id + '/conversation/messages')).set('Cookie', cookie).send({ text: 'Closed cannot send' }).expect(404);
    });
    it('rejects compromised restored owner references for both accounts and refuses photo reauthorization instead of transferring ownership', async function () {
        const id = await ready(), checkpoint = await ex.captureDatabase();
        await db.collection('items').updateOne({ _id: new ObjectId(item.id) }, { $set: { ownerId: new ObjectId(receiver.id) } });
        await view(app, id, owner.cookie).expect(404); await view(app, id, receiver.cookie).expect(404);
        const corrupted = await ex.captureDatabase(); await ex.quarantine(); await apply(corrupted);
        const report = await ex.inspect(checkpoint); assert.ok(report.findings.includes('ownership_conflict')); assert.equal(report.consistentWithinInventory, false);
        const text = await ex.text(checkpoint); await view(text, id).expect(503); await ex.quarantine();
        const grants = await freshGrants(); const updated = await ex.inspect(checkpoint);
        await assert.rejects(ex.accept(checkpoint, updated, { target: updated.target, report: updated.digest }, grants.runtime, grants.recovery));
    });
    it('refuses corrupt, oversized or differently bound backup inventories before reading or mutating object storage', async function () {
        await ready(); const backup = await ex.captureDatabase(), clone = () => JSON.parse(JSON.stringify(backup));
        const corrupt = clone(); corrupt.data.items[0].name = 'tampered';
        await assert.rejects(restore.objectSnapshot(ex.local, [corrupt]));
        const foreign = clone(); foreign.target.database = 'unrelated'; foreign.digest = digest(Object.fromEntries(Object.entries(foreign).filter(([k]) => k !== 'digest')));
        await assert.rejects(restore.objectSnapshot(ex.local, [foreign]));
        const huge = clone(); huge.data.itemImages = Array(26).fill(huge.data.itemImages[0]); huge.digest = digest(Object.fromEntries(Object.entries(huge).filter(([k]) => k !== 'digest')));
        await assert.rejects(restore.objectSnapshot(ex.local, [huge]));
        const binding = clone(); binding.data.itemImages[0].storageBinding.fingerprint = 'f'.repeat(64); binding.digest = digest(Object.fromEntries(Object.entries(binding).filter(([k]) => k !== 'digest')));
        await assert.rejects(restore.objectSnapshot(ex.local, [binding]));
        const plan = await ex.plan(backup), bad = Object.assign({}, plan, { applyBefore: new Date(Date.parse(plan.issuedAt) + 86400000).toISOString() });
        bad.digest = digest(Object.fromEntries(Object.entries(bad).filter(([k]) => k !== 'digest')));
        assert.throws(() => restore.verifySnapshot(bad, ex.local.identity, 'restore-plan'));
        assert.equal(digest((await ex.captureDatabase()).data), digest(backup.data));
    });
    it('rejects wrong targets, wrong approval digests, live workers and stale preimages before restore mutations', async function () {
        await ready(); const backup = await ex.captureDatabase(), p = await ex.plan(backup); await assert.rejects(ex.execute(backup, p, confirm(p)));
        await ex.quarantine(); const before = digest((await ex.captureDatabase()).data);
        for (const bad of [{ target: '0'.repeat(64), plan: p.digest }, { target: digest(ex.local.identity), plan: '0'.repeat(64) }]) await assert.rejects(ex.execute(backup, p, bad));
        assert.equal(digest((await ex.captureDatabase()).data), before);
        await db.collection('users').updateOne({ _id: new ObjectId(owner.id) }, { $set: { syntheticRestoreChange: true } }); const changed = digest((await ex.captureDatabase()).data);
        await assert.rejects(ex.execute(backup, p, confirm(p))); assert.equal(digest((await ex.captureDatabase()).data), changed);
    });
    it('inspects a lost restore response after actual MongoDB commit and process SIGKILL, keeping photo admission closed without blindly replaying', async function () {
        const id = await ready(), backup = await ex.captureDatabase(); await ex.quarantine();
        await db.collection('items').updateOne({ _id: new ObjectId(item.id) }, { $set: { name: 'Synthetic post-backup change' } });
        const p = await ex.plan(backup), result = await ex.execute(backup, p, confirm(p), [], true);
        assert.equal(result.status, 'response_lost_inspect_required'); assert.equal((await db.collection('items').findOne({ _id: new ObjectId(item.id) })).name, item.name);
        assert.equal((await row(id)).state, 'ready'); assert.equal(await db.collection('sessions').countDocuments(), 0); await assert.rejects(ex.photo());
        await assert.rejects(ex.execute(backup, p, confirm(p))); assert.equal((await ex.inspect(backup)).consistentWithinInventory, true);
    });
    it('explicitly demonstrates F4 old-trust rollback acceptance in an unmanaged test worker while the approved recovery coordinator refuses photo startup', async function () {
        const id = await ready(), oldSettings = ex.settings(ex.runtime()), backup = await ex.captureDatabase();
        await ex.change('revoke-all'); const checkpoint = await ex.captureDatabase(); await ex.quarantine(); await apply(backup);
        assert.ok((await ex.inspect(checkpoint)).findings.includes('control_rollback')); await assert.rejects(ex.photo());
        const unmanaged = await ex.processes.launch('distributed-photo-worker.js', { local: ex.localTarget, env: oldSettings });
        const cookie = await login(unmanaged, owner); await view(unmanaged, id, cookie).expect(200); // Deliberate counterexample, not a recovery authorization.
        await ex.quarantine(); assert.equal(ex.processes.stopped(), true); await assert.rejects(ex.photo());
    });
});
