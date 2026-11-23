const assert = require('node:assert/strict');
const request = require('supertest');
const pino = require('pino');
const { ObjectId } = require('mongodb');
const createApp = require('../app');
const { createIsolatedMongo } = require('./helpers/isolated-mongo');
const { prepareDatabaseIndexes } = require('../services/database-indexes');
const day = n => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
const write = call => call.set('Origin', 'http://localhost:3000').set('X-CSRF-Protection', '1');

describe('owner relisting after a completed handoff on disposable MongoDB', function () {
    this.timeout(180000);
    let local, db, app, owner, receiver, other;
    const makeApp = (enabled = true) => createApp({ connectToDatabase: async () => db, logger: pino({ level: 'silent' }),
        ownerListingsEnabled: true, ownerListingPickupsEnabled: true, ownerListingPublicationEnabled: enabled });
    const post = (url, actor, body) => write(request(app).post(url)).set('Cookie', actor.cookie).send(body);
    const read = (url, actor) => request(app).get(url).set('Cookie', actor.cookie);
    const root = id => '/api/items/' + id;
    const requests = id => '/api/pickup-requests/' + id;
    const relist = (item, actor = owner, changes = {}) => post(root(item.id) + '/actions', actor,
        Object.assign({ action: 'reopen', version: item.version, confirmRelist: true }, changes));
    async function completed() {
        const item = (await post('/api/items', owner, { name: 'Synthetic relisting chair', description: 'One household chair.', categoryId: 'living-room', itemTypeId: 'sofa',
            stateId: '06', metroId: '41860', pickupTimeZone: 'UTC', pickupTimeZoneConfirmed: true, availableUntil: day(20), publish: true }).expect(201)).body.item;
        const create = async actor => (await post('/api/pickup-requests', actor, { itemId: item.id, localDateTime: day(3) + 'T12:00', timeZone: 'UTC' }).expect(201)).body.request;
        const chosen = await create(receiver), competing = await create(other);
        await post(requests(chosen.id) + '/conversation/messages', receiver, { text: 'Synthetic handoff history.' }).expect(201);
        await post(requests(chosen.id) + '/actions', owner, { action: 'picked_up', version: chosen.version, confirmHandedOver: true }).expect(200);
        return { item: (await read('/api/me/items/' + item.id, owner).expect(200)).body.item, chosen, competing };
    }
    before(async function () {
        local = await createIsolatedMongo(); db = local.db; await prepareDatabaseIndexes(db); app = makeApp();
        async function account(name) {
            const result = await write(request(app).post('/api/auth/register')).send({ firstName: name, lastName: 'Synthetic', email: name + '@example.test', password: 'local-relisting-password' }).expect(201);
            return { id: result.body.user.id, cookie: result.headers['set-cookie'][0].split(';')[0] };
        }
        owner = await account('Owner'); receiver = await account('Receiver'); other = await account('Other');
    });
    beforeEach(async function () {
        app = makeApp();
        for (const name of ['items', 'moveOutPlans', 'pickupRequests', 'pickupMessages', 'itemImages']) await db.collection(name).deleteMany({});
        await db.collection('users').updateMany({}, { $unset: { pickupMessageQuota: '' } });
    });
    after(async function () { if (local) await local.close(); });

    it('allows the owner to read a closed listing while public and foreign access remain denied', async function () {
        const { item } = await completed();
        assert.equal(item.status, 'cleared'); assert.equal(item.capabilities.editDraft, false); assert.equal(item.capabilities.reopenDraft, true);
        await request(app).get('/api/me/items/' + item.id).expect(401);
        await read('/api/me/items/' + item.id, other).expect(404);
        await request(app).get(root(item.id)).expect(404);
    });
    it('restores only a private draft and preserves the exact closed requests, messages, photos and held quotas', async function () {
        const { item, chosen, competing } = await completed();
        const oldRequests = await db.collection('pickupRequests').find().sort({ _id: 1 }).toArray();
        const oldMessages = await db.collection('pickupMessages').find().toArray();
        const holds = { reservedBytes: 1234, usedBytes: 5678, operationCount: 3 };
        await db.collection('users').updateOne({ _id: new ObjectId(owner.id) }, { $set: { itemImageQuota: holds } });
        const photo = { _id: new ObjectId(), itemId: new ObjectId(item.id), state: 'tombstone', putUncertain: true };
        await db.collection('itemImages').insertOne(photo);
        await db.collection('items').updateOne({ _id: new ObjectId(item.id) }, { $set: { imageRevision: 9 } });
        const result = (await relist(item).expect(200)).body.item;
        assert.equal(result.id, item.id); assert.equal(result.status, 'draft'); assert.equal(result.version, item.version + 1); assert.equal(result.capabilities.editDraft, true);
        assert.equal(result.capabilities.reopenDraft, false); assert.equal(result.name, item.name); assert.deepEqual(result.pickup, item.pickup);
        const saved = await db.collection('items').findOne({ _id: new ObjectId(item.id) });
        assert.equal(saved.publishedAt, null); assert.ok(saved.firstPublishedAt instanceof Date);
        assert.equal(saved.clearedByPickupRequestId.toHexString(), chosen.id); assert.equal(saved.imageRevision, 9); assert.ok(saved.relistedAt instanceof Date);
        assert.deepEqual(await db.collection('pickupRequests').find().sort({ _id: 1 }).toArray(), oldRequests);
        assert.deepEqual(await db.collection('pickupMessages').find().toArray(), oldMessages);
        assert.deepEqual((await db.collection('users').findOne({ _id: new ObjectId(owner.id) })).itemImageQuota, holds);
        assert.deepEqual(await db.collection('itemImages').findOne({ _id: photo._id }), photo);
        await request(app).get(root(item.id)).expect(404);
        for (const row of [chosen, competing]) {
            await read(requests(row.id) + '/conversation/messages', row === chosen ? receiver : other).expect(200);
            await post(requests(row.id) + '/conversation/messages', row === chosen ? receiver : other, { text: 'Must remain closed.' }).expect(404);
        }
        await post('/api/pickup-requests', receiver, { itemId: item.id, localDateTime: day(3) + 'T12:00', timeZone: 'UTC' }).expect(409);
    });
    it('requires an explicit separate publication and creates a new request instead of reopening historical conversations', async function () {
        const { item, chosen } = await completed(); const draft = (await relist(item).expect(200)).body.item;
        const published = (await write(request(app).patch(root(item.id))).set('Cookie', owner.cookie).send({ version: draft.version, name: 'Relisted chair', publish: true }).expect(200)).body.item;
        assert.equal(published.status, 'available'); await request(app).get(root(item.id)).expect(200);
        const newer = (await post('/api/pickup-requests', receiver, { itemId: item.id, localDateTime: day(4) + 'T12:00', timeZone: 'UTC' }).expect(201)).body.request;
        assert.notEqual(newer.id, chosen.id); assert.equal(newer.status, 'pending');
        assert.equal((await read(requests(chosen.id), receiver).expect(200)).body.request.status, 'completed');
        await post(requests(chosen.id) + '/conversation/messages', receiver, { text: 'Old chat stays closed.' }).expect(404);
        await post(requests(newer.id) + '/conversation/messages', receiver, { text: 'A distinct new conversation.' }).expect(201);
        await post(requests(newer.id) + '/actions', owner, { action: 'picked_up', version: newer.version, confirmHandedOver: true }).expect(200);
        assert.equal(await db.collection('pickupRequests').countDocuments({ itemId: new ObjectId(item.id), status: 'completed' }), 2);
        assert.equal((await db.collection('items').findOne({ _id: new ObjectId(item.id) })).clearedByPickupRequestId.toHexString(), newer.id);
        assert.equal((await read(requests(chosen.id), receiver)).body.request.status, 'completed');
    });
    it('requires ownership, CSRF, an exact version and explicit confirmation without allowing extra fields', async function () {
        const { item } = await completed();
        await relist(item, other).expect(404);
        await request(app).post(root(item.id) + '/actions').set('Cookie', owner.cookie).send({ action: 'reopen', version: item.version, confirmRelist: true }).expect(403);
        for (const input of [{ confirmRelist: undefined }, { confirmRelist: false }, { version: item.version - 1 }]) await relist(item, owner, input).expect(409);
        for (const input of [{ confirmRelist: 'true' }, { status: 'available' }, { ownerId: other.id }, { relistedAt: day(0) }]) await relist(item, owner, input).expect(400);
        assert.equal((await read('/api/me/items/' + item.id, owner).expect(200)).body.item.status, 'cleared');
    });
    it('fences concurrent relisting and refuses both stale replay and reopening an already restored draft', async function () {
        const { item } = await completed(); const responses = await Promise.all([relist(item), relist(item)]);
        assert.deepEqual(responses.map(r => r.status).sort(), [200, 409]);
        const draft = (await read('/api/me/items/' + item.id, owner)).body.item;
        assert.equal(draft.version, item.version + 1); await relist(item).expect(409); await relist(draft).expect(409);
        assert.equal(await db.collection('pickupRequests').countDocuments({ status: 'completed' }), 1);
    });
    it('leaves publication gates and direct editing of closed records fail-closed', async function () {
        const { item } = await completed(); app = makeApp(false);
        assert.equal((await read('/api/me/items/' + item.id, owner).expect(200)).body.item.capabilities.reopenDraft, false);
        await relist(item).expect(409); app = makeApp();
        await write(request(app).patch(root(item.id))).set('Cookie', owner.cookie).send({ version: item.version, name: 'Cannot silently restore' }).expect(409);
        assert.equal((await read('/api/me/items/' + item.id, owner)).body.item.status, 'cleared');
    });
    it('refuses inconsistent open pickups and damaged or foreign handoff references without repairing them', async function () {
        const { item } = await completed(); const id = new ObjectId(item.id), original = await db.collection('items').findOne({ _id: id });
        const rogue = { itemId: id, status: 'pending', active: false }; const inserted = await db.collection('pickupRequests').insertOne(rogue);
        await relist(item).expect(409); await db.collection('pickupRequests').deleteOne({ _id: inserted.insertedId });
        for (const reference of [new ObjectId(), 'invalid-reference']) {
            await db.collection('items').updateOne({ _id: id }, { $set: { clearedByPickupRequestId: reference } }); await relist(item).expect(409);
        }
        await db.collection('items').updateOne({ _id: id }, { $set: { clearedByPickupRequestId: original.clearedByPickupRequestId } });
        await db.collection('pickupRequests').updateOne({ _id: original.clearedByPickupRequestId }, { $set: { giverId: new ObjectId(other.id) } });
        await relist(item).expect(409); assert.equal((await db.collection('items').findOne({ _id: id })).status, 'cleared');
    });
    it('permits editing an expired completed listing as a draft but refuses publication until its deadline is corrected', async function () {
        const { item } = await completed(); const until = day(-3), expiry = new Date(until + 'T00:00:00Z'); expiry.setUTCDate(expiry.getUTCDate() + 1);
        await db.collection('items').updateOne({ _id: new ObjectId(item.id) }, { $set: { availableUntil: until, expiresAt: expiry } });
        const draft = (await relist(item).expect(200)).body.item;
        await post(root(item.id) + '/actions', owner, { action: 'publish', version: draft.version }).expect(400);
        await write(request(app).patch(root(item.id))).set('Cookie', owner.cookie).send({ version: draft.version, availableUntil: day(10), publish: true }).expect(200);
    });
});
