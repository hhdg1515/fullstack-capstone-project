/* jshint loopfunc: true */
const assert = require('node:assert/strict');
const { ObjectId } = require('mongodb');
const { fork } = require('node:child_process');
const { generateKeyPairSync, randomUUID, createHash } = require('node:crypto');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const sharp = require('sharp'), request = require('supertest');
const { createIsolatedMongo } = require('./helpers/isolated-mongo');
const { createIsolatedSeaweedFS } = require('./helpers/isolated-seaweedfs');
const { r2Environment, blockProviderNetwork } = require('./helpers/r2-fixture');
const { prepareDatabaseIndexes } = require('../services/database-indexes');
const { openLocalMaintenance } = require('../util/local-image-maintenance');
const { createLocalControlOperator } = require('../util/local-photo-control');
const localCli = require('../util/local-photo-control'), approveCli = require('../util/approve-photo-control');
const { openR2PhotoContext } = require('../util/r2-photo-context');
const { readServerConfig } = require('../config');
const { writePrivateJson, readPrivateJson } = require('../util/local-maintenance-receipt');
const c = require('../services/photo-control');
const hash = b => createHash('sha256').update(b).digest('hex');
const write = call => call.set('Origin', 'http://localhost:3000').set('X-CSRF-Protection', '1');
describe('distributed photo control: independent OS processes, actual MongoDB and verified SeaweedFS only', function () {
    this.timeout(180000); blockProviderNetwork();
    let mongo, fixture, local, operator, db, ownerPublic, ownerPrivate, f, r, environments, children, temp, input, localTarget, initial;
    const confirmation = change => ({ target: c.targetId(change.target), change: c.stateDigest(change), previous: change.previousDigest || 'absent', revision: change.revision });
    const proof = env => ({ approval: readPrivateJson(env.ITEM_IMAGE_R2_APPROVAL_FILE), key: env.ITEM_IMAGE_R2_APPROVAL_PUBLIC_KEY });
    const row = id => db.collection('itemImages').findOne({ _id: new ObjectId(id) });
    const controlRow = () => db.collection(c.collection).findOne({ _id: c.targetId(operator.identity) });
    async function change(action, runtime = f, recovery = r) {
        const snapshot = await operator.preview();
        const signed = c.signChange({ snapshot: snapshot.state, target: operator.identity, action, runtime: proof(runtime.env), recovery: proof(recovery.env), privateKey: ownerPrivate });
        await operator.apply(signed, confirmation(signed)); return controlRow();
    }
    function settings(source) { return Object.assign({}, source.env, { ITEM_IMAGE_DISTRIBUTED_CONTROL_ENABLED: 'true',
        ITEM_IMAGE_CONTROL_OWNER_PUBLIC_KEY: ownerPublic, ITEM_IMAGE_CONTROL_ID: initial.controlId, ITEM_IMAGE_CONTROL_MIN_REVISION: '1' }); }
    async function launch(source = f, extra = {}) {
        const file = path.join(temp, randomUUID() + '.json'); writePrivateJson(file, { local: localTarget, env: Object.assign(settings(source), extra) });
        const child = fork(path.join(__dirname, 'helpers/distributed-photo-worker.js'), [file], { stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
        const inbox = [], worker = { child, puts: 0, deletes: 0, conflicts: 0, output: '', url: null };
        child.stdout.on('data', b => { worker.output += b.toString(); }); child.stderr.on('data', b => { worker.output += b.toString(); });
        child.on('message', message => { inbox.push(message); worker.conflicts += Number(message.event === 'write_conflict'); if (message.event === 'storage') { worker.puts += Number(message.method === 'PUT'); worker.deletes += Number(message.method === 'DELETE'); } });
        worker.take = async (event, id) => {
            const deadline = Date.now() + 15000;
            while (Date.now() < deadline) {
                const at = inbox.findIndex(m => m.event === event && (!id || m.id === id));
                if (at >= 0) return inbox.splice(at, 1)[0];
                if (inbox.some(m => m.event === 'refused') || child.exitCode !== null || child.signalCode !== null) throw Error('Local worker stopped/refused');
                await new Promise(resolve => setTimeout(resolve, 20));
            }
            throw Error('Local worker event deadline');
        };
        worker.arm = async stage => { child.send({ type: 'arm', stage }); await worker.take('armed'); };
        worker.release = () => child.send({ type: 'release' });
        worker.rpc = async (type, manifest) => { const id = randomUUID(); child.send({ type, id, manifest }); const value = await worker.take('result', id); if (value.error) throw Error('Local recovery refused'); return value.result; };
        worker.stop = async () => {
            if (child.exitCode !== null || child.signalCode !== null) return;
            if (child.connected) child.send({ type: 'close' });
            await new Promise(resolve => { const timer = setTimeout(() => { child.kill('SIGKILL'); }, 2000); child.once('exit', () => { clearTimeout(timer); resolve(); }); });
        };
        worker.kill = async () => { const done = new Promise(resolve => child.once('exit', resolve)); child.kill('SIGKILL'); await done; };
        children.push(worker); const ready = await worker.take('ready'); worker.pid = ready.pid; if (ready.port) worker.url = 'http://127.0.0.1:' + ready.port;
        return worker;
    }
    const root = actor => '/api/move-out-plans/' + actor.plan + '/items/' + actor.item + '/images';
    async function account(worker) {
        const registered = await write(request(worker.url).post('/api/auth/register')).send({ firstName: 'Synthetic', lastName: 'Worker',
            email: randomUUID() + '@example.invalid', password: 'synthetic-worker-password-123' }).expect(201);
        const actor = { id: new ObjectId(registered.body.user.id), cookie: registered.headers['set-cookie'][0].split(';')[0], plan: new ObjectId(), item: new ObjectId() }, at = new Date();
        await db.collection('moveOutPlans').insertOne({ _id: actor.plan, ownerId: actor.id, status: 'active', inventoryRevision: 0, moveOutDeadline: '2099-01-01', createdAt: at, updatedAt: at });
        await db.collection('items').insertOne({ _id: actor.item, planId: actor.plan, ownerId: actor.id, name: 'Synthetic control item', status: 'draft', version: 1, createdAt: at, updatedAt: at }); return actor;
    }
    const quota = async actor => (await db.collection('users').findOne({ _id: actor.id })).itemImageQuota;
    const revision = async actor => (await db.collection('items').findOne({ _id: actor.item })).imageRevision || 0;
    const reserveRequest = async (w, actor) => write(request(w.url).post(root(actor) + '/uploads')).set('Cookie', actor.cookie)
        .send({ imageRevision: await revision(actor), clientUploadId: randomUUID(), byteLength: input.length, sha256: hash(input) });
    const reserve = async (w, actor) => { const response = await reserveRequest(w, actor); assert.equal(response.status, 201); return response.body.upload.id; };
    const upload = (w, actor, id) => write(request(w.url).put(root(actor) + '/' + id + '/content')).set('Cookie', actor.cookie)
        .attach('file', input, { filename: 'synthetic.png', contentType: 'image/png' }).timeout({ deadline: 15000 });
    async function ready(w, actor) { const id = await reserve(w, actor); await upload(w, actor, id).expect(201); return id; }
    async function expire(id) {
        const past = new Date(Date.now() - 60000), current = await row(id), values = { 'lease.expiresAt': past, maintenanceDueAt: past, 'cleanup.nextAttemptAt': null };
        if (current.cleanup.recovery) values['cleanup.recovery.expiresAt'] = past;
        await db.collection('itemImages').updateOne({ _id: new ObjectId(id) }, { $set: values });
    }
    before(async function () {
        mongo = await createIsolatedMongo(); db = mongo.db; await prepareDatabaseIndexes(db); fixture = await createIsolatedSeaweedFS();
        localTarget = { mongoReceiptPath: mongo.receiptPath, storageReceiptPath: fixture.receiptPath, databaseName: mongo.dbName,
            environment: 'development', provider: 'seaweedfs-local', bucket: fixture.receipt.bucket, namespace: fixture.receipt.namespace };
        local = await openLocalMaintenance(localTarget);
        const keys = generateKeyPairSync('ed25519'); ownerPublic = keys.publicKey.export({ format: 'der', type: 'spki' }).toString('hex'); ownerPrivate = keys.privateKey.export({ format: 'der', type: 'pkcs8' }).toString('hex');
        operator = await createLocalControlOperator(local, ownerPublic); temp = fs.mkdtempSync(path.join(os.tmpdir(), 'moveout-control-'));
        input = await sharp({ create: { width: 64, height: 48, channels: 3, background: '#315f42' } }).png().toBuffer();
    });
    beforeEach(async function () {
        children = []; environments = [];
        for (const name of ['photoControls', 'itemImages', 'users', 'sessions', 'items', 'moveOutPlans']) await db.collection(name).deleteMany({});
        f = await r2Environment({ mongo, fixture }); r = await r2Environment({ mongo, fixture, role: 'recovery' }); environments.push(f, r);
        initial = c.signChange({ snapshot: null, target: operator.identity, action: 'initialize', runtime: proof(f.env), recovery: proof(r.env), privateKey: ownerPrivate });
        await operator.apply(initial, confirmation(initial));
    });
    afterEach(async function () { for (const w of children) await w.stop(); for (const e of environments) e.close(); });
    after(async function () { if (local) await local.close(); try { if (fixture) await fixture.close(); } finally { if (mongo) await mongo.close(); } if (temp) fs.rmSync(temp, { recursive: true }); });

    it('initializes paused only through signed exact confirmations; startup missing/invalid control creates no schema or storage client', async function () {
        await db.collection(c.collection).drop(); let clients = 0;
        await assert.rejects(openR2PhotoContext({ env: settings(f), storageOptions: () => { clients++; return {}; } })); assert.equal(clients, 0);
        assert.equal((await db.listCollections({ name: c.collection }).toArray()).length, 0);
        for (const [key, bad] of [['target', '0'.repeat(64)], ['previous', 'wrong'], ['revision', 2], ['change', '0'.repeat(64)]]) {
            await assert.rejects(operator.apply(initial, Object.assign(confirmation(initial), { [key]: bad })));
        }
        await operator.apply(initial, confirmation(initial)); assert.equal((await controlRow()).uploadAdmission, false);
        assert.deepEqual((await db.collection(c.collection).indexes()).map(i => i.name), ['_id_']);
        await db.collection(c.collection).createIndex({ issuedAt: 1 }, { name: 'unapproved_extra' });
        try { await assert.rejects(openR2PhotoContext({ env: settings(f) })); assert.ok((await db.collection(c.collection).indexes()).some(v => v.name === 'unapproved_extra')); }
        finally { await db.collection(c.collection).dropIndex('unapproved_extra'); }
        const reads = [], observer = event => { if (event.command.find === c.collection) reads.push(event.command.readConcern); };
        local.db.client.on('commandStarted', observer);
        try {
            const guard = c.createGuard({ db: local.db, target: operator.identity, ownerKey: ownerPublic, controlId: initial.controlId,
                minimumRevision: 1, approval: f.approval, verificationKey: f.env.ITEM_IMAGE_R2_APPROVAL_PUBLIC_KEY, verifyBase: local.verifyDatabase });
            await guard.check(); assert.ok(reads.some(value => value && value.level === 'linearizable'));
        } finally { local.db.client.off('commandStarted', observer); }
        await assert.rejects(operator.apply(initial, confirmation(initial)));
        await assert.rejects(openR2PhotoContext({ env: f.env })); // F1 fallback refused on adopted target.
        assert.throws(() => readServerConfig(settings(f)), /ordinary startup remains disabled/);
        await assert.rejects(openR2PhotoContext({ env: Object.assign(settings(f), { PHOTO_CONTROL_OWNER_PRIVATE_KEY: ownerPrivate }) }));
        const inspect = require('../util/inspect-photo-readiness').inspect;
        assert.equal(inspect(settings(f)).configurationValid, true); assert.equal(inspect(settings(f)).hostedTrialReady, false);
        assert.equal(inspect(Object.assign(settings(f), { ITEM_IMAGE_CONTROL_MIN_REVISION: undefined })).configurationValid, false);
        assert.equal(inspect(Object.assign(settings(f), { ITEM_IMAGE_CONTROL_OWNER_PUBLIC_KEY: f.env.ITEM_IMAGE_R2_APPROVAL_PUBLIC_KEY })).configurationValid, false);
        await change('resume');
        const readonly = await openR2PhotoContext({ env: Object.assign(settings(f), { ITEM_IMAGE_R2_UPLOADS_ENABLED: 'false' }) });
        const session = readonly.db.client.startSession();
        try { await assert.rejects(session.withTransaction(() => readonly.control.fence(session, true))); }
        finally { await session.endSession(); await readonly.close(); }
    });
    it('uses two actual Node PIDs and keeps status/reads separate from pause/resume and ownership', async function () {
        const a = await launch(), b = await launch(); assert.notEqual(a.pid, b.pid); assert.notEqual(a.pid, process.pid);
        const actor = await account(a), other = await account(b);
        assert.equal((await reserveRequest(a, actor)).status, 503); assert.equal((await reserveRequest(b, other)).status, 503);
        await change('resume'); const id = await ready(a, actor); const before = await quota(actor); await change('pause');
        for (const w of [a, b]) {
            assert.equal((await reserveRequest(w, actor)).status, 503);
            await request(w.url).get(root(actor) + '/' + id).set('Cookie', actor.cookie).expect(200);
            await request(w.url).get('/api/item-images/' + id + '/thumbnail').set('Cookie', actor.cookie).expect(200);
            await request(w.url).get('/api/item-images/' + id + '/thumbnail').set('Cookie', other.cookie).expect(404);
            const listing = await request(w.url).get(root(actor)).set('Cookie', actor.cookie).expect(200); assert.equal(listing.body.capabilities.binaryUpload, false); assert.equal(listing.body.capabilities.imageRead, true);
        }
        assert.deepEqual(await quota(actor), before); await change('resume'); await reserve(b, other);
    });
    it('refuses accidental metadata-only wiring on an adopted target instead of bypassing the shared transaction guard', async function () {
        const a = await launch(), actor = await account(a);
        const config = require('../services/item-image-policy').readImageMetadataConfig(f.env);
        const bare = require('../app')({ connectToDatabase: async () => db, imageMetadata: config, logger: require('pino')({ level: 'silent' }) });
        await request(bare).get(root(actor)).set('Cookie', actor.cookie).expect(503);
        await write(request(bare).post(root(actor) + '/uploads')).set('Cookie', actor.cookie).send({ imageRevision: 0, clientUploadId: randomUUID(), byteLength: input.length, sha256: hash(input) }).expect(503);
        assert.equal(await db.collection('itemImages').countDocuments(), 0); assert.equal(await quota(actor), undefined);
    });
    it('rejects a stale reservation transaction after pause commits first, without quota or operation changes', async function () {
        await change('resume'); const a = await launch(), b = await launch(), actor = await account(a); await account(b);
        await a.arm('before_fence'); const pending = reserveRequest(a, actor); // request is started below without awaiting its result
        const response = pending.then(value => value); await a.take('barrier'); await change('pause'); a.release();
        assert.equal((await response).status, 503); assert.equal(await db.collection('itemImages').countDocuments(), 0); assert.equal(await quota(actor), undefined);
        assert.ok(a.conflicts >= 1, 'MongoDB code 112 observed at the paused control fence');
    });
    it('rejects a stale new claim after pause wins the shared control write conflict', async function () {
        await change('resume'); const a = await launch(), b = await launch(), actor = await account(a), id = await reserve(a, actor), before = await quota(actor);
        await b.arm('before_fence'); const pending = upload(b, actor, id).then(value => value);
        await b.take('barrier'); await change('pause'); b.release(); assert.equal((await pending).status, 503);
        assert.equal((await row(id)).state, 'reserved'); assert.deepEqual(await quota(actor), before); assert.equal(b.puts, 0);
        assert.ok(b.conflicts >= 1, 'MongoDB code 112 observed at the stale claim fence');
    });
    it('drains a claim committed before pause, but denies subsequent claims and duplicate PUT replay', async function () {
        await change('resume'); const a = await launch(), b = await launch(), actor = await account(a), id = await reserve(a, actor);
        await a.arm('after_claim'); const pending = upload(a, actor, id).then(value => value); await a.take('barrier'); await change('pause');
        assert.equal((await reserveRequest(b, actor)).status, 503); a.release(); assert.equal((await pending).status, 201);
        assert.equal((await row(id)).state, 'ready'); assert.equal(a.puts, 2); await upload(b, actor, id).expect(200); assert.equal(b.puts, 0);
    });
    it('admits no new authority after revocation, but records a previously authorized late PUT as unknown for separate cleanup', async function () {
        await change('resume'); const a = await launch(), b = await launch(), actor = await account(a), id = await reserve(a, actor);
        await a.arm('before_put'); const pending = upload(a, actor, id).then(value => value); await a.take('barrier'); await change('revoke-runtime'); a.release();
        assert.equal((await pending).status, 503); assert.equal(a.puts, 1); assert.equal((await row(id)).variants.thumbnail.outcome, 'unknown');
        const held = await quota(actor); assert.ok(held.reservedBytes > 0); assert.equal((await reserveRequest(b, actor)).status, 503);
        await request(b.url).get('/api/me').set('Cookie', actor.cookie).expect(200); await expire(id);
        const recovery = await launch(r), manifest = await recovery.rpc('preview'); assert.equal(manifest.operations[0].action, 'cleanup');
        assert.equal((await recovery.rpc('apply', manifest)).results[0].status, 'deleted'); assert.equal((await quota(actor)).operationCount, 1);
    });
    it('preserves an issued-but-unsent PUT hold after SIGKILL and negative reads, never refunding or replaying it', async function () {
        await change('resume'); const a = await launch(), actor = await account(a), id = await reserve(a, actor);
        await a.arm('before_put'); const pending = upload(a, actor, id).then(v => v, () => null); await a.take('barrier'); await a.kill(); await pending; await change('pause');
        const before = await quota(actor); await expire(id); const recovery = await launch(r), manifest = await recovery.rpc('preview');
        assert.equal(manifest.operations[0].action, 'unknown_write'); assert.equal((await recovery.rpc('apply', manifest)).results[0].status, 'unresolved');
        assert.deepEqual(await quota(actor), before); assert.equal(recovery.deletes, 0); assert.equal((await row(id)).variants.thumbnail.outcome, 'unknown');
    });
    it('recovers a committed lost PUT across a real worker crash and concurrent cleanup processes exactly once', async function () {
        await change('resume'); const a = await launch(), actor = await account(a), id = await reserve(a, actor);
        await a.arm('after_put'); const pending = upload(a, actor, id).then(v => v, () => null); await a.take('barrier'); await a.kill(); await pending;
        await change('pause'); const restart = await launch(); await upload(restart, actor, id).expect(202); assert.equal(restart.puts, 0); await expire(id);
        const one = await launch(r), two = await launch(r); assert.notEqual(one.pid, two.pid); const manifest = await one.rpc('preview');
        const results = await Promise.allSettled([one.rpc('apply', manifest), two.rpc('apply', manifest)]);
        assert.equal(results.filter(v => v.status === 'fulfilled' && v.value.results[0].status === 'deleted').length, 1);
        assert.equal((await quota(actor)).reservedBytes, 0); assert.equal((await quota(actor)).operationCount, 1); assert.equal((await row(id)).state, 'deleted');
    });
    it('keeps delete_unknown and charges after cleanup SIGKILL; revoked recovery must rotate and obtain a fresh manifest', async function () {
        await change('resume'); const a = await launch(), actor = await account(a), id = await ready(a, actor);
        await write(request(a.url).post(root(actor) + '/' + id + '/actions')).set('Cookie', actor.cookie).send({ action: 'delete', imageRevision: await revision(actor) }).expect(202);
        const before = await quota(actor), old = await launch(r), manifest = await old.rpc('preview'); await old.arm('after_delete');
        const pending = old.rpc('apply', manifest).catch(() => null); await old.take('barrier'); await old.kill(); await pending;
        assert.equal((await row(id)).variants.thumbnail.outcome, 'delete_unknown'); assert.deepEqual(await quota(actor), before); await change('revoke-recovery');
        await assert.rejects(launch(r));
        const next = await r2Environment({ mongo, fixture, role: 'recovery' }); environments.push(next); await change('rotate-recovery', f, next); await expire(id);
        const fresh = await launch(next); await assert.rejects(fresh.rpc('apply', manifest));
        assert.equal((await fresh.rpc('apply', await fresh.rpc('preview'))).results[0].status, 'deleted');
        assert.equal((await quota(actor)).retainedBytes, 0); assert.equal((await quota(actor)).operationCount, 1);
    });
    it('refuses old still-valid keys/receipts after rotation without depending on private-file replacement', async function () {
        await change('resume'); const a = await launch(), actor = await account(a), id = await ready(a, actor); const oldSignature = readPrivateJson(f.env.ITEM_IMAGE_R2_APPROVAL_FILE).signature;
        await change('revoke-runtime'); const next = await r2Environment({ mongo, fixture }); environments.push(next);
        await change('rotate-runtime', next); await change('resume');
        assert.equal(readPrivateJson(f.env.ITEM_IMAGE_R2_APPROVAL_FILE).signature, oldSignature);
        await request(a.url).get('/api/item-images/' + id + '/thumbnail').set('Cookie', actor.cookie).expect(503); await assert.rejects(launch());
        const fresh = await launch(next); await request(fresh.url).get('/api/item-images/' + id + '/thumbnail').set('Cookie', actor.cookie).expect(200);
        await assert.rejects(change('rotate-runtime', f)); // Old receipt cannot be reauthorized by a normal control transition.
    });
    it('detects rollback in an observing worker/minimum checkpoint, while demonstrating fresh old-trust boot remains an unresolved restore limit', async function () {
        await change('resume'); const a = await launch(), actor = await account(a), id = await ready(a, actor), prior = await controlRow();
        const revoked = await change('revoke-runtime'); await request(a.url).get('/api/item-images/' + id + '/thumbnail').set('Cookie', actor.cookie).expect(503);
        await db.collection(c.collection).replaceOne({ _id: prior._id }, prior); // Test-only restoration of an earlier signed control row.
        await request(a.url).get('/api/item-images/' + id + '/thumbnail').set('Cookie', actor.cookie).expect(503);
        await assert.rejects(launch(f, { ITEM_IMAGE_CONTROL_MIN_REVISION: String(revoked.revision) }));
        const oldBoot = await launch(); await request(oldBoot.url).get('/api/item-images/' + id + '/thumbnail').set('Cookie', actor.cookie).expect(200);
        await db.collection(c.collection).replaceOne({ _id: revoked._id }, revoked);
        await request(oldBoot.url).get('/api/item-images/' + id + '/thumbnail').set('Cookie', actor.cookie).expect(503);
        assert.equal((await row(id)).state, 'ready'); // No replay, deletion or accounting change was used to simulate rollback.
    });
    it('refuses tampered target/signature/state, missing records and an exhausted fence without storage I/O or refunds', async function () {
        await change('resume'); const a = await launch(), actor = await account(a), before = await controlRow();
        for (const changes of [{ uploadAdmission: false }, { 'target.bucket': 'unrelated-bucket' }, { fence: Number.MAX_SAFE_INTEGER }]) {
            await db.collection(c.collection).updateOne({ _id: before._id }, { $set: changes }); assert.equal((await reserveRequest(a, actor)).status, 503);
            assert.equal(await quota(actor), undefined); assert.equal(a.puts, 0); await db.collection(c.collection).replaceOne({ _id: before._id }, before);
        }
        await db.collection(c.collection).deleteOne({ _id: before._id }); assert.equal((await reserveRequest(a, actor)).status, 503); assert.equal(await quota(actor), undefined);
    });
    it('serializes competing signed owner changes and rejects expired/future/wrong-owner control approvals without altering photo data', async function () {
        const snapshot = await operator.preview(), make = action => c.signChange({ snapshot: snapshot.state, target: operator.identity, action, privateKey: ownerPrivate });
        const one = make('pause'), two = make('revoke-runtime'); const results = await Promise.allSettled([operator.apply(one, confirmation(one)), operator.apply(two, confirmation(two))]);
        assert.equal(results.filter(x => x.status === 'fulfilled').length, 1); assert.equal((await controlRow()).revision, 2);
        for (const time of [Date.now() - 700000, Date.now() + 60000]) {
            const current = await operator.preview(), signed = c.signChange({ snapshot: current.state, target: operator.identity, action: 'pause', privateKey: ownerPrivate, time });
            await assert.rejects(operator.apply(signed, confirmation(signed)));
        }
        assert.equal(await db.collection('itemImages').countDocuments(), 0);
        assert.throws(() => c.signChange({ snapshot: null, target: operator.identity, action: 'initialize', runtime: proof(f.env), recovery: proof(r.env), privateKey: f.privateKey }));
    });
    it('orders five concurrent pause/resume races and two-process reservations without treating cache state as admission', async function () {
        const a = await launch(), b = await launch(); let accepted = 0;
        for (let i = 0; i < 5; i++) {
            const actor = await account(a), other = await account(b), prior = (await operator.preview()).state;
            const plans = ['pause', 'resume'].map(action => c.signChange({ snapshot: prior, target: operator.identity, action, privateKey: ownerPrivate }));
            const results = await Promise.allSettled(plans.map(plan => operator.apply(plan, confirmation(plan))));
            assert.equal(results.filter(v => v.status === 'fulfilled').length, 1);
            const state = await controlRow(); assert.equal(state.revision, prior.revision + 1);
            const replies = await Promise.all([reserveRequest(a, actor), reserveRequest(b, other)]);
            assert.ok(replies.every(reply => reply.status === (state.uploadAdmission ? 201 : 503)));
            accepted += state.uploadAdmission ? 2 : 0;
            for (const user of [actor, other]) { const q = await quota(user); if (state.uploadAdmission) assert.equal(q.attempts, 1); else assert.equal(q, undefined); }
        }
        assert.equal(await db.collection('itemImages').countDocuments(), accepted); assert.equal(a.puts + b.puts, 0);
    });
    it('fully revokes both application photo roles while leaving text/auth and all required recovery records intact', async function () {
        await change('resume'); const a = await launch(), actor = await account(a), id = await ready(a, actor);
        await write(request(a.url).post(root(actor) + '/' + id + '/actions')).set('Cookie', actor.cookie).send({ action: 'delete', imageRevision: await revision(actor) }).expect(202);
        const recovery = await launch(r), manifest = await recovery.rpc('preview'), before = await quota(actor); await change('revoke-all');
        await assert.rejects(recovery.rpc('apply', manifest)); assert.equal(recovery.deletes, 0);
        await request(a.url).get('/api/item-images/' + id + '/thumbnail').set('Cookie', actor.cookie).expect(503);
        await request(a.url).get('/api/me').set('Cookie', actor.cookie).expect(200);
        assert.deepEqual(await quota(actor), before); assert.equal((await row(id)).state, 'delete_pending');
        await assert.rejects(launch()); await assert.rejects(launch(r));
    });
    it('runs separate guarded local preview/offline signing/apply commands, preserving confirmations and private output', async function () {
        const snapshot = path.join(temp, randomUUID() + '.json'), signedFile = path.join(temp, randomUUID() + '.json'), reports = [];
        const common = ['--local-fixture', '--mongo-receipt', mongo.receiptPath, '--storage-receipt', fixture.receiptPath, '--database', mongo.dbName, '--bucket', fixture.receipt.bucket, '--namespace', fixture.receipt.namespace];
        const env = { ITEM_IMAGE_CONTROL_OWNER_PUBLIC_KEY: ownerPublic };
        await localCli.run(['--dry-run', '--snapshot', snapshot].concat(common), v => reports.push(v), env); const previous = readPrivateJson(snapshot).state;
        approveCli.run(['--snapshot', snapshot, '--action', 'pause', '--output', signedFile, '--confirm-target', c.targetId(operator.identity), '--confirm-previous', c.stateDigest(previous), '--confirm-revision', String(previous.revision + 1)],
            v => reports.push(v), Object.assign({}, env, { PHOTO_CONTROL_OWNER_PRIVATE_KEY: ownerPrivate }));
        const signed = readPrivateJson(signedFile);
        await localCli.run(['--apply', '--change', signedFile, '--confirm-target', c.targetId(operator.identity), '--confirm-previous', signed.previousDigest, '--confirm-revision', String(signed.revision), '--confirm-change', c.stateDigest(signed)].concat(common), v => reports.push(v), env);
        for (const args of [common.concat('--allow-remote'), common.concat('--dry-run', '--apply'), ['--apply']]) assert.throws(() => localCli.parse(args));
        const out = JSON.stringify(reports); for (const value of [ownerPrivate, f.privateKey, f.env.ITEM_IMAGE_R2_SECRET_ACCESS_KEY, f.env.ITEM_IMAGE_R2_NAMESPACE, f.env.MONGO_URL]) assert.ok(!out.includes(value));
        await assert.rejects(operator.apply(signed, confirmation(signed))); assert.equal((await controlRow()).revision, signed.revision);
    });
});
