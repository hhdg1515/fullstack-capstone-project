const assert = require('node:assert/strict');
const request = require('supertest');
const { ObjectId } = require('mongodb');
const pino = require('pino');
const createApp = require('../app');
const { createIsolatedMongo } = require('./helpers/isolated-mongo');
const { prepareDatabaseIndexes } = require('../services/database-indexes');
const { createPickupService } = require('../services/pickups');
const { appointment, validTimeZone } = require('../services/pickup-policy');
const day = n => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
const write = op => op.set('Origin', 'http://localhost:3000').set('X-CSRF-Protection', '1');

describe('pickup appointment timezone interpretation', function () {
    it('converts an explicit IANA local time to UTC without consulting the process timezone', function () {
        assert.equal(appointment('2030-07-01T12:30', 'America/Los_Angeles', new Date('2029-01-01')).toISOString(), '2030-07-01T19:30:00.000Z');
        assert.equal(appointment('2030-01-01T12:30', 'America/Los_Angeles', new Date('2029-01-01')).toISOString(), '2030-01-01T20:30:00.000Z');
        assert.ok(validTimeZone('Asia/Kolkata')); assert.ok(validTimeZone('Etc/GMT+5'));
    });
    it('rejects missing/invalid zones, numeric offsets, skipped/repeated DST times, invalid dates and offset-bearing inputs', function () {
        for (const zone of ['', null, '+05:30', '-08:00', 'Not/A_Zone']) assert.equal(validTimeZone(zone), false);
        for (const value of ['2030-03-10T02:30', '2030-11-03T01:30', '2030-02-30T12:00', '2030-07-01T12:30Z', '2030-07-01T12:30-07:00']) {
            assert.throws(() => appointment(value, 'America/Los_Angeles', new Date('2029-01-01')), error => error.code === 'INVALID_APPOINTMENT');
        }
        assert.throws(() => appointment('2020-01-01T12:00', 'UTC', new Date()), error => error.code === 'APPOINTMENT_PAST');
    });
});

describe('two-party pickup lifecycle on verified isolated MongoDB', function () {
    this.timeout(180000);
    let isolated, db, app, giver, receiver, other, plan, item;
    const calls = '/api/pickup-requests';
    const itemPath = () => '/api/move-out-plans/' + plan.id + '/items/' + item.id;
    const submit = (data = {}, user = receiver) => write(request(app).post(calls)).set('Cookie', user.cookie)
        .send(Object.assign({ itemId: item.id, localDateTime: day(1) + 'T12:00', timeZone: 'UTC', note: 'Meet near the public library.' }, data));
    const act = (row, action, user = giver) => write(request(app).post(calls + '/' + row.id + '/actions')).set('Cookie', user.cookie).send({ action, version: row.version });
    const get = (row, user = receiver) => request(app).get(calls + '/' + row.id).set('Cookie', user.cookie);
    const planEdit = changes => write(request(app).patch('/api/move-out-plans/' + plan.id)).set('Cookie', giver.cookie).send(changes);
    const inventory = (action, confirmed) => write(request(app).post(itemPath() + '/actions')).set('Cookie', giver.cookie)
        .send(Object.assign({ action, version: item.version }, confirmed === undefined ? {} : { confirmCancelRequests: confirmed }));
    before(async function () {
        isolated = await createIsolatedMongo(); db = isolated.db; await prepareDatabaseIndexes(db);
        app = createApp({ connectToDatabase: async () => db, logger: pino({ level: 'silent' }) });
        const account = async name => {
            const result = await write(request(app).post('/api/auth/register')).send({ firstName: name, lastName: 'Private surname', email: name.toLowerCase() + '@example.test', password: 'isolated-pickup-password' }).expect(201);
            return { id: result.body.user.id, cookie: result.headers['set-cookie'][0].split(';')[0] };
        };
        giver = await account('Giver'); receiver = await account('Receiver'); other = await account('Other');
    });
    after(async function () { if (isolated) await isolated.close(); });
    beforeEach(async function () {
        app = createApp({ connectToDatabase: async () => db, logger: pino({ level: 'silent' }) });
        for (const name of ['pickupRequests', 'items', 'moveOutPlans']) await db.collection(name).deleteMany({});
        const result = await write(request(app).post('/api/move-out-plans')).set('Cookie', giver.cookie)
            .send({ title: 'Private management title', city: 'Oakland', neighborhood: 'Temescal', moveOutDeadline: day(30), pickupTimeZone: 'UTC', stateId: '06', metroId: '41860' }).expect(201);
        plan = result.body.plan;
        item = (await write(request(app).post('/api/move-out-plans/' + plan.id + '/items')).set('Cookie', giver.cookie)
            .send({ categoryId: "other-household", itemTypeId: "other", name: 'One box of household supplies', description: 'Whole box, one pickup.', publish: true }).expect(201)).body.item;
        await db.collection('users').updateOne({ _id: new ObjectId(giver.id) }, { $set: { phone: 'private phone', address: 'private address' } });
    });
    it('requires sessions and CSRF protection and refuses client-supplied identities or unsupported fields', async function () {
        await write(request(app).post(calls)).send({}).expect(401);
        for (const path of ['/sent', '/received', '/' + new ObjectId()]) await request(app).get(calls + path).expect(401);
        await request(app).post(calls).set('Cookie', receiver.cookie).send({}).expect(403);
        for (const key of ['giverId', 'receiverId', 'ownerId', 'status', 'proposedAt', 'version', 'address']) await submit({ [key]: giver.id }).expect(400);
        assert.equal(await db.collection('pickupRequests').countDocuments(), 0);
    });
    it('creates server-owned pending requests without reserving or changing the listing', async function () {
        const result = await submit().expect(201); const row = result.body.request;
        assert.equal(row.status, 'pending'); assert.equal(row.version, 1); assert.equal(row.role, 'receiver');
        assert.equal(row.timeZone, 'UTC'); assert.equal(row.proposedAt, day(1) + 'T12:00:00.000Z');
        const stored = await db.collection('pickupRequests').findOne({ _id: new ObjectId(row.id) });
        assert.ok(stored.giverId.equals(new ObjectId(giver.id))); assert.ok(stored.receiverId.equals(new ObjectId(receiver.id)));
        assert.ok(stored.planId.equals(new ObjectId(plan.id))); assert.ok(stored.itemId.equals(new ObjectId(item.id)));
        assert.ok(stored.history[0].actorId.equals(stored.receiverId));
        assert.equal((await request(app).get('/api/items/' + item.id).expect(200)).body.item.status, 'available');
        assert.equal((await db.collection('items').findOne({ _id: stored.itemId })).version, 1);
        assert.equal(result.headers['cache-control'], 'no-store');
        await submit({}, other).expect(201);
    });
    async function assertReservation(expected) {
        const detail = (await request(app).get('/api/items/' + item.id).expect(200)).body.item;
        const listing = (await request(app).get('/api/items?stateId=06&metroId=41860').expect(200)).body.items.find(row => row.id === item.id);
        const owned = (await request(app).get('/api/move-out-plans/' + plan.id + '/items').set('Cookie', giver.cookie).expect(200)).body.items.find(row => row.id === item.id);
        for (const row of [detail, owned]) assert.equal(row.isReserved, expected);
        if (expected) assert.equal(listing, undefined); else assert.equal(listing.isReserved, false);
        for (const value of ['pickupReservations', 'receiverId', 'giverId', 'public library', receiver.id, plan.id]) {
            assert.ok(!JSON.stringify(detail).includes(value));
        }
    }
    it('reports authoritative reservations across browsing and inventory without exposing pickup details', async function () {
        await assertReservation(false);
        let row = (await submit().expect(201)).body.request;
        await assertReservation(false);
        row = (await act(row, 'accept').expect(200)).body.request;
        await db.collection('items').updateOne({ _id: new ObjectId(item.id) }, { $set: { isReserved: false } });
        await assertReservation(true);
        await act(row, 'cancel', receiver).expect(200);
        await assertReservation(false);
        row = (await submit().expect(201)).body.request;
        row = (await act(row, 'accept').expect(200)).body.request;
        const service = createPickupService({ connectToDatabase: async () => db, now: () => new Date(day(1) + 'T12:01:00Z') });
        await service.act(new ObjectId(giver.id), row.id, { action: 'no_show', version: row.version });
        await assertReservation(false);
        row = (await submit().expect(201)).body.request;
        row = (await act(row, 'accept').expect(200)).body.request;
        await service.act(new ObjectId(giver.id), row.id, { action: 'complete', version: row.version });
        await request(app).get('/api/items/' + item.id).expect(404);
        const owned = (await request(app).get('/api/move-out-plans/' + plan.id + '/items').set('Cookie', giver.cookie).expect(200)).body;
        assert.equal(owned.items[0].status, 'cleared'); assert.equal(owned.items[0].isReserved, false);
    });
    it('matches the write guard conservatively for inconsistent legacy references without repairing records', async function () {
        for (const mismatch of [{ giverId: new ObjectId(other.id) }, { planId: new ObjectId() }]) {
            const row = Object.assign({ itemId: new ObjectId(item.id), giverId: new ObjectId(giver.id), planId: new ObjectId(plan.id),
                receiverId: new ObjectId(receiver.id), status: 'accepted', active: true }, mismatch);
            const inserted = await db.collection('pickupRequests').insertOne(row);
            await assertReservation(true);
            const blocked = await submit({}, other).expect(409);
            assert.equal(blocked.body.error.code, 'ITEM_RESERVED');
            assert.deepEqual(await db.collection('pickupRequests').findOne({ _id: inserted.insertedId }), Object.assign({}, row, { _id: inserted.insertedId }));
            await db.collection('pickupRequests').deleteOne({ _id: inserted.insertedId });
        }
        await db.collection('pickupRequests').insertOne({ itemId: new ObjectId(), status: 'accepted' });
        await assertReservation(false);
    });
    it('keeps an accepted reservation visible to its owner after the listing deadline', async function () {
        let row = (await submit().expect(201)).body.request;
        await act(row, 'accept').expect(200);
        await db.collection('items').updateOne({ _id: new ObjectId(item.id) }, { $set: { availableUntil: day(-1) } });
        await request(app).get('/api/items/' + item.id).expect(404);
        const owned = (await request(app).get('/api/move-out-plans/' + plan.id + '/items').set('Cookie', giver.cookie).expect(200)).body;
        assert.equal(owned.items[0].status, 'expired'); assert.equal(owned.items[0].isReserved, true);
    });
    it('rejects own items and hidden, expired, unpublished, inactive and mismatched-owner listings', async function () {
        await submit({}, giver).expect(409);
        for (const status of ['draft', 'unlisted', 'cleared', 'expired']) {
            await db.collection('items').updateOne({ _id: new ObjectId(item.id) }, { $set: { status } }); await submit().expect(409);
        }
        await db.collection('items').updateOne({ _id: new ObjectId(item.id) }, { $set: { status: 'available', availableUntil: day(-1) } }); await submit().expect(409);
        await db.collection('items').updateOne({ _id: new ObjectId(item.id) }, { $set: { availableUntil: null, publishedAt: null } }); await submit().expect(409);
        await db.collection('items').updateOne({ _id: new ObjectId(item.id) }, { $set: { publishedAt: new Date() } });
        await planEdit({ status: 'completed' }).expect(200); await submit().expect(409);
        await planEdit({ status: 'active' }).expect(200);
        await db.collection('items').updateOne({ _id: new ObjectId(item.id) }, { $set: { ownerId: new ObjectId(other.id) } }); await submit().expect(409);
        assert.equal(await db.collection('pickupRequests').countDocuments(), 0);
    });
    it('reports only server-validated viewer ownership and rejects self-requests without changing inventory', async function () {
        const before = await db.collection('moveOutPlans').findOne({ _id: new ObjectId(plan.id) });
        const own = await request(app).get('/api/items/' + item.id).set('Cookie', giver.cookie).expect(200);
        assert.equal(own.body.item.isOwner, true); assert.equal(own.headers['cache-control'], 'no-store');
        const ownedFeed = await request(app).get('/api/items?stateId=06&metroId=41860').set('Cookie', giver.cookie).expect(200);
        assert.equal(ownedFeed.body.items[0].isOwner, true); assert.ok(!JSON.stringify(ownedFeed.body).includes(giver.id));
        assert.ok(!JSON.stringify(own.body).includes(giver.id));
        for (const cookie of [receiver.cookie, '', 'giftlink_session=' + 'a'.repeat(64)]) {
            assert.equal((await request(app).get('/api/items/' + item.id).set('Cookie', cookie).expect(200)).body.item.isOwner, false);
        }
        assert.equal((await submit({}, giver).expect(409)).body.error.code, 'OWN_ITEM');
        assert.equal(await db.collection('pickupRequests').countDocuments(), 0);
        assert.deepEqual(await db.collection('moveOutPlans').findOne({ _id: before._id }), before);
        await submit({}, receiver).expect(201);
    });
    it('requires explicit reservation cancellation when assigning or changing canonical plan regions', async function () {
        await db.collection('moveOutPlans').updateOne({ _id: new ObjectId(plan.id) }, { $unset: { stateId: '', metroId: '' } });
        const pending = (await submit().expect(201)).body.request;
        const accepted = (await act(pending, 'accept').expect(200)).body.request;
        const conflict = await planEdit({ stateId: '06', metroId: '41860' }).expect(409);
        assert.equal(conflict.body.error.code, 'PICKUP_CONFIRMATION_REQUIRED');
        assert.equal((await get(accepted).expect(200)).body.request.status, 'accepted');
        assert.equal((await db.collection('moveOutPlans').findOne({ _id: new ObjectId(plan.id) })).metroId, undefined);
        await planEdit({ stateId: '06', metroId: '41860', confirmCancelRequests: true }).expect(200);
        const cancelled = (await get(accepted).expect(200)).body.request;
        assert.equal(cancelled.status, 'cancelled'); assert.equal(cancelled.cancellationReason, 'location_changed');
        assert.equal((await request(app).get('/api/move-out-plans/' + plan.id + '/items').set('Cookie', giver.cookie).expect(200)).body.plan.metroId, '41860');
        const stored = await db.collection('items').findOne({ _id: new ObjectId(item.id) });
        assert.equal(stored.metroId, undefined); assert.equal(stored.stateId, undefined);
    });
    it('accepts advance requests only inside the inclusive local availability window', async function () {
        await write(request(app).patch(itemPath())).set('Cookie', giver.cookie).send({ version: item.version, availableFrom: day(5), availableUntil: day(10) }).expect(200);
        await submit().expect(400); await submit({ localDateTime: day(11) + 'T00:00' }).expect(400);
        await submit({ localDateTime: day(5) + 'T00:00' }).expect(201);
        const first = (await request(app).get(calls + '/sent').set('Cookie', receiver.cookie)).body.requests[0];
        await act(first, 'cancel', receiver).expect(200);
        await submit({ localDateTime: day(10) + 'T23:59' }).expect(201);
    });
    it('requires giver timezone setup, rejects changed zones and enforces the existing UTC expiration cutoff', async function () {
        await planEdit({ pickupTimeZone: null }).expect(200); assert.equal((await submit().expect(409)).body.error.code, 'PICKUP_TIMEZONE_REQUIRED');
        await planEdit({ pickupTimeZone: 'America/Los_Angeles' }).expect(200); await submit().expect(409);
        await write(request(app).patch(itemPath())).set('Cookie', giver.cookie).send({ version: 1, availableUntil: day(5) }).expect(200);
        await submit({ timeZone: 'America/Los_Angeles', localDateTime: day(5) + 'T23:00' }).expect(400);
        const row = (await submit({ timeZone: 'America/Los_Angeles', localDateTime: day(5) + 'T09:00' }).expect(201)).body.request;
        assert.equal(new Intl.DateTimeFormat('en-CA', { timeZone: row.timeZone, hour: 'numeric', hourCycle: 'h23' }).format(new Date(row.proposedAt)), '09');
    });
    it('validates appointment and note input without echoing private content', async function () {
        for (const data of [{ localDateTime: '2020-01-01T12:00' }, { localDateTime: '2030-02-30T12:00' }, { note: '<private markup>' }, { note: 'x'.repeat(501) }, { note: { $gt: '' } }]) {
            const response = await submit(data).expect(400); assert.ok(!JSON.stringify(response.body).includes('private markup'));
        }
        await planEdit({ pickupTimeZone: '+04:00' }).expect(400);
    });
    it('prevents duplicate active requests under concurrent submissions and allows a new request after cancellation', async function () {
        const results = await Promise.all([submit(), submit()]); assert.deepEqual(results.map(r => r.status).sort(), [201, 409]);
        const row = results.find(r => r.status === 201).body.request;
        await act(row, 'cancel', receiver).expect(200); await submit().expect(201);
    });
    it('enforces accepted and active-receiver uniqueness directly in MongoDB', async function () {
        const row = (await submit()).body.request; await act(row, 'accept').expect(200);
        const stored = await db.collection('pickupRequests').findOne({ _id: new ObjectId(row.id) });
        await assert.rejects(db.collection('pickupRequests').insertOne(Object.assign({}, stored, { _id: new ObjectId(), receiverId: new ObjectId(other.id) })), error => error.code === 11000);
        await assert.rejects(db.collection('pickupRequests').insertOne(Object.assign({}, stored, { _id: new ObjectId(), status: 'pending' })), error => error.code === 11000);
        assert.equal(await db.collection('pickupRequests').countDocuments(), 1);
    });
    it('serializes request submission with confirmed withdrawal and never leaves an invalid active request', async function () {
        const results = await Promise.all([submit(), inventory('unlist', true)]);
        assert.equal(results[1].status, 200); assert.ok([201, 409].includes(results[0].status));
        assert.equal(await db.collection('pickupRequests').countDocuments({ active: true }), 0);
    });
    it('allows only one of competing pending requests to be accepted, and blocks new requests while reserved', async function () {
        const a = (await submit().expect(201)).body.request; const b = (await submit({}, other).expect(201)).body.request;
        const results = await Promise.all([act(a, 'accept'), act(b, 'accept')]); assert.deepEqual(results.map(r => r.status).sort(), [200, 409]);
        assert.equal(await db.collection('pickupRequests').countDocuments({ status: 'accepted' }), 1);
        const accepted = results.find(r => r.status === 200).body.request;
        const pending = accepted.id === a.id ? b : a;
        assert.equal((await get(pending, pending.id === a.id ? receiver : other)).body.request.status, 'pending');
        await act(accepted, 'cancel', giver).expect(200);
        await act(pending, 'accept').expect(200);
    });
    it('protects request reads/actions, role transitions, stale versions and terminal states', async function () {
        const row = (await submit().expect(201)).body.request;
        await get(row, other).expect(404); await act(row, 'accept', other).expect(404);
        for (const action of ['accept', 'decline', 'complete', 'no_show']) await act(row, action, receiver).expect(409);
        const accepted = (await act(row, 'accept').expect(200)).body.request;
        await act(row, 'cancel', receiver).expect(409);
        await act(accepted, 'complete').expect(409); await act(accepted, 'no_show').expect(409);
        const cancelled = (await act(accepted, 'cancel', receiver).expect(200)).body.request;
        assert.equal(cancelled.cancellationReason, 'cancelled_by_receiver');
        await act(cancelled, 'accept').expect(409); await get({ id: 'bad' }).expect(404);
        const sent = await request(app).get(calls + '/sent').set('Cookie', other.cookie); assert.deepEqual(sent.body.requests, []);
    });
    it('records giver decline and cancellation separately from receiver withdrawal', async function () {
        let row = (await submit()).body.request; row = (await act(row, 'decline').expect(200)).body.request;
        assert.equal(row.status, 'declined'); assert.ok(row.declinedAt);
        row = (await submit()).body.request; row = (await act(row, 'cancel', receiver).expect(200)).body.request;
        assert.equal(row.history[1].actor, 'receiver');
        row = (await submit()).body.request; row = (await act(row, 'accept')).body.request;
        row = (await act(row, 'cancel').expect(200)).body.request; assert.equal(row.history[2].actor, 'giver');
        assert.equal((await db.collection('items').findOne({ _id: new ObjectId(item.id) })).status, 'available');
    });
    it('blocks additional requests on a reservation and releases it without auto-accepting another pending request', async function () {
        let row = (await submit()).body.request; row = (await act(row, 'accept')).body.request;
        assert.equal((await submit({}, other).expect(409)).body.error.code, 'ITEM_RESERVED');
        await act(row, 'cancel').expect(200); const next = (await submit({}, other).expect(201)).body.request; assert.equal(next.status, 'pending');
    });
    ['unlist', 'clear'].forEach(action => it('requires atomic confirmation to ' + action + ' items with pending and accepted requests', async function () {
        let a = (await submit()).body.request; a = (await act(a, 'accept')).body.request;
        // A competing pending request existed before acceptance.
        const stored = await db.collection('pickupRequests').findOne({ _id: new ObjectId(a.id) });
        await db.collection('pickupRequests').insertOne(Object.assign({}, stored, { _id: new ObjectId(), receiverId: new ObjectId(other.id), status: 'pending', version: 1 }));
        assert.equal((await inventory(action).expect(409)).body.error.code, 'PICKUP_CONFIRMATION_REQUIRED');
        assert.equal((await get(a)).body.request.status, 'accepted'); await request(app).get('/api/items/' + item.id).expect(200);
        await inventory(action, true).expect(200);
        assert.equal(await db.collection('pickupRequests').countDocuments({ active: true }), 0);
        assert.equal((await get(a)).body.request.cancellationReason, action === 'clear' ? 'external_clearance' : 'item_unlisted');
        await request(app).get('/api/items/' + item.id).expect(404);
        assert.equal((await db.collection('items').findOne({ _id: new ObjectId(item.id) })).status, action === 'clear' ? 'cleared' : 'unlisted');
    }));
    it('keeps compatible item edits, but atomically cancels incompatible window changes after confirmation', async function () {
        const row = (await submit()).body.request;
        item = (await write(request(app).patch(itemPath())).set('Cookie', giver.cookie).send({ version: item.version, description: 'Updated description' }).expect(200)).body.item;
        const change = { version: item.version, availableFrom: day(3) };
        await write(request(app).patch(itemPath())).set('Cookie', giver.cookie).send(change).expect(409);
        await write(request(app).patch(itemPath())).set('Cookie', giver.cookie).send(Object.assign({}, change, { confirmCancelRequests: true })).expect(200);
        assert.equal((await get(row)).body.request.cancellationReason, 'availability_changed');
    });
    it('requires confirmation for plan timezone, location, deadline and inactive-status conflicts', async function () {
        for (const changes of [{ pickupTimeZone: 'Europe/London' }, { city: 'Berkeley' }, { moveOutDeadline: day(0) }, { status: 'completed' }, { status: 'cancelled' }]) {
            const row = (await submit()).body.request;
            const before = await db.collection('moveOutPlans').findOne({ _id: new ObjectId(plan.id) });
            await planEdit(changes).expect(409); assert.deepEqual(await db.collection('moveOutPlans').findOne({ _id: before._id }), before);
            await planEdit(Object.assign({}, changes, { confirmCancelRequests: true })).expect(200);
            assert.equal((await get(row)).body.request.status, 'cancelled');
            await planEdit({ pickupTimeZone: 'UTC', city: 'Oakland', status: 'active', moveOutDeadline: day(30) }).expect(200);
        }
    });
    it('reports the total affected request count across every item before confirming a plan change', async function () {
        const first = (await submit()).body.request;
        const second = (await write(request(app).post('/api/move-out-plans/' + plan.id + '/items')).set('Cookie', giver.cookie).send({ categoryId: "other-household", itemTypeId: "other", description: "A household item for local pickup.", name: 'Another box', publish: true }).expect(201)).body.item;
        const next = (await submit({ itemId: second.id }).expect(201)).body.request;
        const response = await planEdit({ status: 'cancelled' }).expect(409);
        assert.equal(response.body.error.affectedRequests, 2);
        assert.equal((await get(first)).body.request.status, 'pending'); assert.equal((await get(next)).body.request.status, 'pending');
        await planEdit({ status: 'cancelled', confirmCancelRequests: true }).expect(200);
        assert.equal(await db.collection('pickupRequests').countDocuments({ active: true }), 0);
    });
    it('serializes acceptance against confirmed withdrawal, never leaving a surviving accepted reservation', async function () {
        const row = (await submit()).body.request;
        const results = await Promise.all([act(row, 'accept'), inventory('unlist', true)]);
        assert.equal(results[1].status, 200); assert.ok([200, 409].includes(results[0].status));
        assert.equal(await db.collection('pickupRequests').countDocuments({ active: true }), 0);
        assert.equal((await get(row)).body.request.status, 'cancelled');
    });
    it('completes a handoff and clears the item/cancels competitors in the same transaction; preserves private details', async function () {
        const a = (await submit()).body.request; const b = (await submit({}, other)).body.request;
        await act(a, 'accept').expect(200);
        const clock = new Date(day(1) + 'T12:01:00Z');
        const service = createPickupService({ connectToDatabase: async () => db, now: () => clock });
        const result = await service.act(new ObjectId(giver.id), a.id, { action: 'complete', version: 2 });
        assert.equal(result.request.status, 'completed'); assert.ok(result.request.completedAt);
        assert.equal((await db.collection('items').findOne({ _id: new ObjectId(item.id) })).status, 'cleared');
        assert.equal((await get(b, other)).body.request.cancellationReason, 'item_handed_over');
        await request(app).get('/api/items/' + item.id).expect(404);
        assert.equal((await get(a)).body.request.item.description, 'Whole box, one pickup.');
    });
    it('verifies owner-only handoff provenance and clears it when inventory is reopened or manually cleared', async function () {
        const pending = (await submit().expect(201)).body.request;
        const accepted = (await act(pending, 'accept').expect(200)).body.request;
        const list = () => request(app).get('/api/move-out-plans/' + plan.id + '/items').set('Cookie', giver.cookie).expect(200);
        assert.equal((await list()).body.items[0].isPickedUp, false);
        assert.equal((await list()).body.items[0].isReserved, true);
        const service = createPickupService({ connectToDatabase: async () => db, now: () => new Date(Date.parse(accepted.proposedAt) + 1000) });
        await service.act(new ObjectId(giver.id), accepted.id, { action: 'complete', version: accepted.version });
        item = (await list()).body.items[0]; assert.equal(item.isPickedUp, true); assert.equal(item.isReserved, false);
        assert.equal(item.clearedByPickupRequestId, undefined); assert.equal(item.completedHandoffs, undefined);
        await write(request(app).patch(itemPath())).set('Cookie', giver.cookie).send({ version: item.version, isPickedUp: true }).expect(400);
        await request(app).get('/api/move-out-plans/' + plan.id + '/items').set('Cookie', receiver.cookie).expect(404);
        item = (await inventory('reopen').expect(200)).body.item;
        assert.equal((await list()).body.items[0].isPickedUp, false);
        item = (await inventory('clear').expect(200)).body.item;
        assert.equal((await list()).body.items[0].isPickedUp, false);
        const stored = await db.collection('items').findOne({ _id: new ObjectId(item.id) });
        assert.equal(stored.clearedByPickupRequestId, undefined);
        assert.equal((await get(accepted).expect(200)).body.request.status, 'completed');
    });
    it('does not claim a pickup for deleted, compromised, unrelated or unmarked historical completion references', async function () {
        const pending = (await submit().expect(201)).body.request;
        const accepted = (await act(pending, 'accept').expect(200)).body.request;
        const service = createPickupService({ connectToDatabase: async () => db, now: () => new Date(Date.parse(accepted.proposedAt) + 1000) });
        await service.act(new ObjectId(giver.id), accepted.id, { action: 'complete', version: accepted.version });
        const list = () => request(app).get('/api/move-out-plans/' + plan.id + '/items').set('Cookie', giver.cookie).expect(200);
        const original = await db.collection('pickupRequests').findOne({ _id: new ObjectId(accepted.id) });
        assert.equal((await list()).body.items[0].isPickedUp, true);
        for (const changes of [{ giverId: new ObjectId(other.id) }, { receiverId: new ObjectId(giver.id) }, { planId: new ObjectId() },
            { itemId: new ObjectId() }, { active: true }, { status: 'cancelled' }, { history: 'corrupt' }]) {
            await db.collection('pickupRequests').replaceOne({ _id: original._id }, Object.assign({}, original, changes));
            const response = await list(); assert.equal(response.body.items[0].isPickedUp, false);
            assert.ok(!JSON.stringify(response.body).includes(receiver.id));
        }
        await db.collection('pickupRequests').replaceOne({ _id: original._id }, original);
        await db.collection('items').updateOne({ _id: new ObjectId(item.id) }, { $unset: { clearedByPickupRequestId: '' } });
        const before = await db.collection('items').findOne({ _id: new ObjectId(item.id) });
        assert.equal((await list()).body.items[0].isPickedUp, false);
        assert.deepEqual(await db.collection('items').findOne({ _id: before._id }), before);
        await db.collection('items').updateOne({ _id: before._id }, { $set: { clearedByPickupRequestId: original._id } });
        await db.collection('pickupRequests').deleteOne({ _id: original._id });
        assert.equal((await list()).body.items[0].isPickedUp, false);
    });
    it('records a no-show only after the appointment, releasing the reservation without clearing or transferring it', async function () {
        const a = (await submit()).body.request; const b = (await submit({}, other)).body.request;
        await act(a, 'accept').expect(200);
        const service = createPickupService({ connectToDatabase: async () => db, now: () => new Date(day(1) + 'T12:01:00Z') });
        const result = await service.act(new ObjectId(giver.id), a.id, { action: 'no_show', version: 2 });
        assert.equal(result.request.status, 'no_show'); assert.ok(result.request.noShowAt);
        assert.equal((await db.collection('items').findOne({ _id: new ObjectId(item.id) })).status, 'available');
        assert.equal((await get(b, other)).body.request.status, 'pending'); await act(b, 'accept').expect(200);
    });
    it('serializes competing completion and no-show outcomes with version checks', async function () {
        const row = (await submit()).body.request; await act(row, 'accept').expect(200);
        const service = createPickupService({ connectToDatabase: async () => db, now: () => new Date(day(1) + 'T12:01:00Z') });
        const results = await Promise.allSettled(['complete', 'no_show'].map(action => service.act(new ObjectId(giver.id), row.id, { action, version: 2 })));
        assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
        assert.equal(results.find(result => result.status === 'rejected').reason.code, 'PICKUP_CHANGED');
        const current = (await get(row)).body.request;
        const actual = await db.collection('items').findOne({ _id: new ObjectId(item.id) });
        assert.equal(actual.status, current.status === 'completed' ? 'cleared' : 'available');
    });
    it('does not accept elapsed proposals or new requests on expiration; past accepted appointments remain reportable', async function () {
        const a = (await submit()).body.request; const b = (await submit({}, other)).body.request;
        await act(a, 'accept').expect(200);
        const service = createPickupService({ connectToDatabase: async () => db, now: () => new Date(day(31) + 'T12:00:00Z') });
        await assert.rejects(service.act(new ObjectId(giver.id), b.id, { action: 'accept', version: 1 }), error => error.status === 409);
        await assert.rejects(service.create(new ObjectId(receiver.id), item.id, { timeZone: 'UTC', localDateTime: day(32) + 'T12:00' }), error => error.code === 'LISTING_UNAVAILABLE');
        assert.equal((await service.act(new ObjectId(giver.id), a.id, { action: 'no_show', version: 2 })).request.status, 'no_show');
    });
    it('allowlists participant data and keeps notes, identities and management information out of public discovery', async function () {
        const row = (await submit()).body.request; const text = JSON.stringify(row);
        for (const secret of ['@example.test', 'private phone', 'private address', giver.id, receiver.id, plan.id, 'Private management title', 'Private surname']) assert.ok(!text.includes(secret));
        assert.deepEqual(row.counterpart, { firstName: 'Giver' }); assert.equal(row.note, 'Meet near the public library.');
        const incoming = (await get(row, giver)).body.request; assert.equal(incoming.plan.id, plan.id);
        assert.deepEqual(incoming.counterpart, { firstName: 'Receiver' });
        for (const path of ['/api/items?stateId=06&metroId=41860', '/api/items/' + item.id, '/api/items/locations']) {
            const body = (await request(app).get(path)).body; const publicText = JSON.stringify(body);
            for (const secret of ['public library', 'receiverId', 'giverId', 'counterpart', 'note', '@example.test', plan.id]) assert.ok(!publicText.includes(secret));
        }
    });
    it('omits coordination notes and personal account data from application logs', async function () {
        const lines = [];
        const loggingApp = createApp({ connectToDatabase: async () => db, logger: pino({ level: 'info' }, { write: line => lines.push(line) }) });
        await write(request(loggingApp).post(calls)).set('Cookie', receiver.cookie)
            .send({ itemId: item.id, localDateTime: day(1) + 'T12:00', timeZone: 'UTC', note: 'Private coordination note for library meeting.' }).expect(201);
        assert.ok(lines.length > 0);
        const logged = lines.join('\n');
        for (const secret of ['Private coordination note', 'library meeting', '@example.test', receiver.cookie, 'Private surname']) assert.ok(!logged.includes(secret));
    });
    it('paginates and filters private dashboards, rejecting unbounded or structured query input', async function () {
        const first = await db.collection('pickupRequests').findOne({}); assert.equal(first, null);
        const row = (await submit()).body.request; const stored = await db.collection('pickupRequests').findOne({ _id: new ObjectId(row.id) });
        await act(row, 'cancel', receiver);
        await db.collection('pickupRequests').insertMany(Array.from({ length: 30 }, () => Object.assign({}, stored, { _id: new ObjectId(), status: 'declined', active: false })));
        const response = await request(app).get(calls + '/sent').set('Cookie', receiver.cookie).expect(200);
        assert.equal(response.body.requests.length, 25); assert.ok(response.body.nextCursor);
        const next = await request(app).get(calls + '/sent').query({ cursor: response.body.nextCursor }).set('Cookie', receiver.cookie).expect(200);
        assert.equal(next.body.requests.length, 6);
        const ids = [...response.body.requests, ...next.body.requests].map(r => r.id); assert.equal(new Set(ids).size, 31);
        assert.equal((await request(app).get(calls + '/received?status=accepted').set('Cookie', giver.cookie)).body.requests.length, 0);
        for (const query of ['limit=100000', 'cursor=bad', 'status[]=pending', 'status=secret']) await request(app).get(calls + '/sent?' + query).set('Cookie', receiver.cookie).expect(400);
    });
});
