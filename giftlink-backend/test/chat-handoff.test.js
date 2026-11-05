const assert = require('node:assert/strict');
const request = require('supertest');
const pino = require('pino');
const { ObjectId } = require('mongodb');
const createApp = require('../app');
const { createIsolatedMongo } = require('./helpers/isolated-mongo');
const { prepareDatabaseIndexes } = require('../services/database-indexes');
const day = n => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
const write = call => call.set('Origin', 'http://localhost:3000').set('X-CSRF-Protection', '1');

describe('chat-first confirmed handoff on disposable MongoDB', function () {
    this.timeout(180000);
    let local, db, app, owner, alice, bob, stranger;
    const makeApp = () => createApp({ connectToDatabase: async () => db, logger: pino({ level: 'silent' }),
        ownerListingsEnabled: true, ownerListingPickupsEnabled: true, ownerListingPublicationEnabled: true });
    const post = (path, actor, body) => write(request(app).post(path)).set('Cookie', actor.cookie).send(body);
    const root = '/api/pickup-requests';
    const handoff = (row, actor = owner, changes = {}) => post(root + '/' + row.id + '/actions', actor,
        Object.assign({ action: 'picked_up', version: row.version, confirmHandedOver: true }, changes));
    const create = async (item, actor = alice) => (await post(root, actor, { itemId: item.id,
        localDateTime: day(3) + 'T12:00', timeZone: 'UTC' }).expect(201)).body.request;
    async function listing(model) {
        const details = { name: 'Synthetic handoff chair', description: 'One household chair.', categoryId: 'living-room', itemTypeId: 'sofa', publish: true };
        if (model === 1) {
            const plan = (await post('/api/move-out-plans', owner, { city: 'Oakland', neighborhood: 'Synthetic', stateId: '06', metroId: '41860',
                pickupTimeZone: 'UTC', moveOutDeadline: day(20) }).expect(201)).body.plan;
            return (await post('/api/move-out-plans/' + plan.id + '/items', owner, details).expect(201)).body.item;
        }
        return (await post('/api/items', owner, Object.assign(details, { stateId: '06', metroId: '41860', pickupTimeZone: 'UTC',
            pickupTimeZoneConfirmed: true, availableUntil: day(20) })).expect(201)).body.item;
    }
    before(async function () {
        local = await createIsolatedMongo(); db = local.db; await prepareDatabaseIndexes(db); app = makeApp();
        async function account(name) {
            const r = await write(request(app).post('/api/auth/register')).send({ firstName: name, lastName: 'Synthetic', email: name + '@example.test', password: 'synthetic-handoff-password' }).expect(201);
            return { id: r.body.user.id, cookie: r.headers['set-cookie'][0].split(';')[0] };
        }
        owner = await account('Owner'); alice = await account('Alice'); bob = await account('Bob'); stranger = await account('Stranger');
    });
    beforeEach(async function () {
        app = makeApp();
        for (const collection of ['items', 'moveOutPlans', 'pickupRequests', 'pickupMessages']) await db.collection(collection).deleteMany({});
        await db.collection('users').updateMany({}, { $unset: { pickupMessageQuota: '' } });
    });
    after(async function () { if (local) await local.close(); });
    [1, 2].forEach(model => {
        it('records a v' + model + ' pending handoff without acceptance or waiting, closes others and retains private history', async function () {
            const item = await listing(model), a = await create(item), b = await create(item, bob);
            const messagePath = root + '/' + a.id + '/conversation/messages';
            await post(messagePath, alice, { text: 'Synthetic pickup coordination.' }).expect(201);
            await request(app).get('/api/items/' + item.id).expect(200);
            const result = (await handoff(a).expect(200)).body.request;
            assert.equal(result.status, 'completed'); assert.equal(result.version, a.version + 1);
            assert.ok(new Date(result.completedAt) < new Date(a.proposedAt));
            const stored = await db.collection('items').findOne({ _id: new ObjectId(item.id) });
            assert.equal(stored.status, 'cleared'); assert.equal(stored.clearedByPickupRequestId.toHexString(), a.id);
            const closed = (await request(app).get(root + '/' + b.id).set('Cookie', bob.cookie).expect(200)).body.request;
            assert.equal(closed.status, 'cancelled'); assert.equal(closed.cancellationReason, 'item_handed_over');
            assert.equal(await db.collection('pickupRequests').countDocuments({ active: true }), 0);
            await request(app).get('/api/items/' + item.id).expect(404);
            for (const actor of [owner, alice]) {
                const history = await request(app).get(messagePath).set('Cookie', actor.cookie).expect(200);
                assert.equal(history.body.messages[0].text, 'Synthetic pickup coordination.');
                await post(messagePath, actor, { text: 'Cannot send after handoff.' }).expect(404);
            }
            await request(app).get(messagePath).set('Cookie', stranger.cookie).expect(404);
            await handoff(a).expect(409); await handoff(result).expect(409);
            assert.equal(await db.collection('pickupRequests').countDocuments({ status: 'completed' }), 1);
        });
        it('fences two competing v' + model + ' completions so exactly one receiver gets the handoff', async function () {
            const item = await listing(model), a = await create(item), b = await create(item, bob);
            const results = await Promise.all([handoff(a), handoff(b)]);
            assert.deepEqual(results.map(r => r.status).sort(), [200, 409]);
            assert.equal(await db.collection('pickupRequests').countDocuments({ status: 'completed' }), 1);
            assert.equal(await db.collection('pickupRequests').countDocuments({ status: 'cancelled', cancellationReason: 'item_handed_over' }), 1);
            assert.equal(await db.collection('pickupRequests').countDocuments({ active: true }), 0);
        });
    });
    it('requires owner identity, CSRF, exact version and explicit actual-handoff confirmation', async function () {
        const item = await listing(2), a = await create(item);
        await write(request(app).post(root + '/' + a.id + '/actions')).send({}).expect(401);
        await request(app).post(root + '/' + a.id + '/actions').set('Cookie', owner.cookie).send({ action: 'picked_up', version: a.version, confirmHandedOver: true }).expect(403);
        await handoff(a, alice).expect(409); await handoff(a, stranger).expect(404);
        for (const changes of [{ confirmHandedOver: undefined }, { confirmHandedOver: false }, { confirmHandedOver: 'true' }, { version: a.version + 1 }, { ownerId: owner.id }]) {
            const r = await handoff(a, owner, changes); assert.ok([400, 409].includes(r.status));
        }
        assert.equal((await db.collection('items').findOne({ _id: new ObjectId(item.id) })).status, 'available');
        const row = await db.collection('pickupRequests').findOne({ _id: new ObjectId(a.id) });
        assert.equal(row.status, 'pending'); assert.equal(row.version, a.version);
    });
    it('closes a competing legacy reservation and preserves its formal proposal history', async function () {
        const item = await listing(2), a = await create(item), b = await create(item, bob);
        const accepted = (await post(root + '/' + b.id + '/actions', owner, { action: 'accept', version: b.version }).expect(200)).body.request;
        const proposed = (await post(root + '/' + b.id + '/reschedule-proposals', bob, { version: accepted.version, localDateTime: day(4) + 'T12:00', timeZone: 'UTC' }).expect(201)).body.request;
        await handoff(a).expect(200);
        const closed = (await request(app).get(root + '/' + b.id).set('Cookie', bob.cookie).expect(200)).body.request;
        assert.equal(closed.status, 'cancelled'); assert.equal(closed.proposedAt, proposed.proposedAt);
        assert.equal(closed.rescheduling.proposal, null);
        assert.deepEqual(closed.history.slice(-2).map(e => e.action), ['reschedule_invalidated', 'cancelled']);
    });
    it('never reopens a request when cancellation races with the actual handoff', async function () {
        const item = await listing(2), a = await create(item);
        const results = await Promise.all([handoff(a), post(root + '/' + a.id + '/actions', alice, { action: 'cancel', version: a.version })]);
        assert.deepEqual(results.map(r => r.status).sort(), [200, 409]);
        const row = await db.collection('pickupRequests').findOne({ _id: new ObjectId(a.id) });
        assert.ok(['completed', 'cancelled'].includes(row.status)); assert.equal(row.active, false);
        const saved = await db.collection('items').findOne({ _id: new ObjectId(item.id) });
        assert.equal(saved.status, row.status === 'completed' ? 'cleared' : 'available');
    });
    it('rejects closed requests, damaged original participants and changed ownership without clearing items', async function () {
        for (const state of ['cancelled', 'declined', 'no_show', 'completed']) {
            const item = await listing(2), row = await create(item);
            await db.collection('pickupRequests').updateOne({ _id: new ObjectId(row.id) }, { $set: { status: state, active: false } });
            await handoff(row).expect(409);
            assert.equal((await db.collection('items').findOne({ _id: new ObjectId(item.id) })).status, 'available');
        }
        const item = await listing(2), row = await create(item);
        await db.collection('pickupRequests').updateOne({ _id: new ObjectId(row.id) }, { $set: { 'history.0.actorId': new ObjectId(bob.id) } });
        await handoff(row).expect(404);
        await db.collection('pickupRequests').updateOne({ _id: new ObjectId(row.id) }, { $set: { 'history.0.actorId': new ObjectId(alice.id) } });
        await db.collection('items').updateOne({ _id: new ObjectId(item.id) }, { $set: { ownerId: new ObjectId(stranger.id) } });
        await handoff(row).expect(404);
        assert.equal((await db.collection('items').findOne({ _id: new ObjectId(item.id) })).status, 'available');
    });
    it('serializes a new request racing with handoff and leaves storage/quota records untouched', async function () {
        const item = await listing(2), row = await create(item);
        const quota = { usedBytes: 1234, reservedBytes: 5678, activeUploads: 1, operationCount: 3 };
        await db.collection('users').updateOne({ _id: new ObjectId(owner.id) }, { $set: { itemImageQuota: quota } });
        const image = { _id: new ObjectId(), itemId: new ObjectId(item.id), state: 'tombstone', synthetic: true };
        await db.collection('itemImages').insertOne(image);
        const raced = await Promise.all([handoff(row), post(root, bob, { itemId: item.id, localDateTime: day(3) + 'T12:00', timeZone: 'UTC' })]);
        assert.equal(raced[0].status, 200); assert.ok([201, 409].includes(raced[1].status));
        assert.equal(await db.collection('pickupRequests').countDocuments({ itemId: new ObjectId(item.id), active: true }), 0);
        assert.deepEqual((await db.collection('users').findOne({ _id: new ObjectId(owner.id) })).itemImageQuota, quota);
        assert.deepEqual(await db.collection('itemImages').findOne({ _id: image._id }), image);
    });

});
