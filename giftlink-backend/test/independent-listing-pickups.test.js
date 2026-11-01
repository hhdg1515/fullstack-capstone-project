/* jshint loopfunc: true */
// UX-2C2: pickup requests, private conversations and scheduling for independent
// (listingSchemaVersion 2) listings on a real disposable MongoDB replica set.
// V2 publication is still disabled (UX-2C3), so eligible listings are explicitly
// constructed fixtures with the exact shape a published v2 item will have.
const assert = require('node:assert/strict');
const request = require('supertest');
const pino = require('pino');
const { ObjectId } = require('mongodb');
const { Temporal } = require('@js-temporal/polyfill');
const createApp = require('../app');
const { createIsolatedMongo } = require('./helpers/isolated-mongo');
const { prepareDatabaseIndexes } = require('../services/database-indexes');
const { applyDraft } = require('../services/listing-draft');
const { readServerConfig } = require('../config');
const origin = 'http://localhost:3000', zone = 'America/Los_Angeles';
const write = call => call.set('Origin', origin).set('X-CSRF-Protection', '1');
const localDay = offset => Temporal.Now.zonedDateTimeISO(zone).toPlainDate().add({ days: offset }).toString();

describe('UX-2C2 independent listing pickups, conversations and scheduling on verified disposable MongoDB', function () {
    this.timeout(180000);
    let local, db, app, closedApp, giver, receiver, third;
    const makeApp = pickups => createApp({ connectToDatabase: async () => db, logger: pino({ level: 'silent' }), ownerListingsEnabled: true,
        ownerListingPickupsEnabled: pickups, authLimit: 10000, discoveryLimit: 10000, messageLimit: 1000 });
    async function account(email) {
        const res = await write(request(app).post('/api/auth/register')).send({ email, firstName: email.split('@')[0], lastName: 'Synthetic', password: 'synthetic-pickup-password' }).expect(201);
        return { id: new ObjectId(res.body.user.id), cookie: res.headers['set-cookie'][0].split(';')[0] };
    }
    // The published v2 shape: complete classification/region, confirmed zone and a policy-2 deadline tuple.
    async function listing(overrides = {}, draftInput = {}, owner = giver) {
        const now = new Date(Date.now() - 60000);
        const item = applyDraft({ _id: new ObjectId(), ownerId: owner.id, listingSchemaVersion: 2, status: 'draft', version: 1, coordinationRevision: 0, imageRevision: 0,
            createdAt: now, updatedAt: now, publishedAt: null, name: '', description: '', categoryId: null, itemTypeId: null, customItemType: null, condition: null,
            stateId: null, metroId: null, city: '', neighborhood: '', pickupTimeZone: null, timeZoneConfirmedAt: null, availableFrom: null, availableUntil: null },
            Object.assign({ name: 'Independent bookshelf', description: 'Synthetic independent listing.', categoryId: 'living-room', itemTypeId: 'bookshelf',
                stateId: '06', metroId: '31080', city: 'Los Angeles', neighborhood: 'Synthetic', pickupTimeZone: zone, pickupTimeZoneConfirmed: true, availableUntil: localDay(20) }, draftInput), now);
        Object.assign(item, { status: 'available', publishedAt: now, version: 2 }, overrides);
        await db.collection('items').insertOne(item);
        return item;
    }
    const create = (item, actor = receiver, localDateTime = localDay(3) + 'T10:00', server = app, extra = {}) => write(request(server).post('/api/pickup-requests')).set('Cookie', actor.cookie)
        .send(Object.assign({ itemId: item._id.toHexString(), localDateTime, timeZone: zone, note: 'Synthetic note' }, extra));
    const act = (id, actor, action, version) => write(request(app).post('/api/pickup-requests/' + id + '/actions')).set('Cookie', actor.cookie).send({ action, version });
    const detail = (id, actor) => request(app).get('/api/pickup-requests/' + id).set('Cookie', actor.cookie);
    const propose = (id, actor, version, localDateTime) => write(request(app).post('/api/pickup-requests/' + id + '/reschedule-proposals')).set('Cookie', actor.cookie)
        .send({ version, localDateTime, timeZone: zone });
    const respond = (id, proposal, actor, version, action) => write(request(app).post('/api/pickup-requests/' + id + '/reschedule-proposals/' + proposal + '/actions')).set('Cookie', actor.cookie)
        .send({ version, action });
    const send = (id, actor, text) => write(request(app).post('/api/pickup-requests/' + id + '/conversation/messages')).set('Cookie', actor.cookie).send({ text });
    const messages = (id, actor) => request(app).get('/api/pickup-requests/' + id + '/conversation/messages').set('Cookie', actor.cookie);
    const accept = async (item, actor = receiver) => {
        const made = (await create(item, actor).expect(201)).body.request;
        return (await act(made.id, giver, 'accept', made.version).expect(200)).body.request;
    };
    before(async function () {
        local = await createIsolatedMongo(); db = local.db; await prepareDatabaseIndexes(db);
        app = makeApp(true); closedApp = makeApp(false);
        giver = await account('giver@example.test'); receiver = await account('receiver@example.test'); third = await account('third@example.test');
    });
    beforeEach(async function () {
        for (const name of ['items', 'moveOutPlans', 'pickupRequests', 'pickupMessages']) await db.collection(name).deleteMany({});
        await db.collection('users').updateMany({}, { $unset: { pickupMessageQuota: '' } });
    });
    after(async function () { if (local) await local.close(); });

    it('runs a complete v2 request lifecycle bound to the item, never to a plan', async function () {
        const item = await listing(), other = await listing({ _id: new ObjectId(), name: 'Untouched lamp' });
        const made = await create(item).expect(201); const req = made.body.request;
        assert.equal(req.status, 'pending'); assert.equal(req.role, 'receiver'); assert.equal(req.timeZone, zone);
        assert.deepEqual(Object.keys(req.item).sort(), ['availableFrom', 'category', 'city', 'datePolicy', 'description', 'effectiveAvailableUntil', 'id', 'listingModel', 'metroLabel', 'name', 'neighborhood', 'status']);
        assert.equal(req.item.listingModel, 2); assert.equal(req.item.datePolicy, 'pickup-local'); assert.equal(req.plan, undefined);
        const row = await db.collection('pickupRequests').findOne({ _id: new ObjectId(req.id) });
        assert.equal(row.referenceVersion, 2); assert.ok(!('planId' in row)); assert.ok(row.giverId.equals(giver.id)); assert.ok(row.itemId.equals(item._id));
        assert.equal(await db.collection('moveOutPlans').countDocuments(), 0);
        // Owner inbox and requester list both include it.
        assert.deepEqual((await request(app).get('/api/pickup-requests/received').set('Cookie', giver.cookie).expect(200)).body.requests.map(r => r.id), [req.id]);
        assert.deepEqual((await request(app).get('/api/pickup-requests/sent').set('Cookie', receiver.cookie).expect(200)).body.requests.map(r => r.id), [req.id]);
        const waiting = (await create(item, third, localDay(5) + 'T09:00').expect(201)).body.request; // another applicant before acceptance
        const accepted = (await act(req.id, giver, 'accept', req.version).expect(200)).body.request; assert.equal(accepted.status, 'accepted');
        assert.equal((await create(item, receiver).expect(409)).body.error.code, 'DUPLICATE_PICKUP');
        const feed = (await request(app).get('/api/me/items').set('Cookie', giver.cookie).expect(200)).body.items;
        assert.deepEqual(feed.find(row => row.id === item._id.toHexString()).pickupSummary, { supported: true, reserved: true });
        assert.equal((await send(req.id, receiver, 'Synthetic hello').expect(201)).body.message.sender, 'receiver');
        assert.equal((await send(req.id, giver, 'Synthetic reply').expect(201)).body.message.sender, 'giver');
        assert.deepEqual((await messages(req.id, giver).expect(200)).body.messages.map(m => m.text), ['Synthetic hello', 'Synthetic reply']);
        const proposed = (await propose(req.id, receiver, accepted.version, localDay(4) + 'T11:30').expect(201)).body.request;
        assert.equal(proposed.rescheduling.proposal.proposedBy, 'receiver');
        const moved = (await respond(req.id, proposed.rescheduling.proposal.id, giver, proposed.version, 'accept').expect(200)).body.request;
        assert.equal(moved.localDateTime, localDay(4) + 'T11:30'); assert.equal(moved.rescheduling.proposal, null);
        // Completion waits for the appointment, then clears exactly this item and closes its other active requests.
        assert.equal((await act(req.id, giver, 'complete', moved.version).expect(409)).body.error.code, 'APPOINTMENT_NOT_REACHED');
        await db.collection('pickupRequests').updateOne({ _id: new ObjectId(req.id) }, { $set: { proposedAt: new Date(Date.now() - 60000) } });
        const done = (await act(req.id, giver, 'complete', moved.version).expect(200)).body.request; assert.equal(done.status, 'completed');
        const cleared = await db.collection('items').findOne({ _id: item._id });
        assert.equal(cleared.status, 'cleared'); assert.ok(cleared.clearedByPickupRequestId.equals(new ObjectId(req.id))); assert.equal(cleared.listingSchemaVersion, 2); assert.ok(!('planId' in cleared));
        assert.ok(cleared.coordinationRevision >= 6);
        const closed = await db.collection('pickupRequests').findOne({ _id: new ObjectId(waiting.id) });
        assert.equal(closed.status, 'cancelled'); assert.equal(closed.cancellationReason, 'item_handed_over');
        assert.equal((await db.collection('items').findOne({ _id: other._id })).status, 'available');
        // Closed history stays readable to both original participants; sending is closed.
        assert.equal((await messages(req.id, receiver).expect(200)).body.messages.length, 2);
        assert.equal((await send(req.id, receiver, 'Too late').expect(404)).body.error.code, 'CONVERSATION_UNAVAILABLE');
        const history = (await detail(req.id, giver).expect(200)).body.request.history.map(entry => entry.action);
        assert.deepEqual(history, ['pending', 'accepted', 'reschedule_proposed', 'reschedule_accepted', 'completed']);
    });

    it('denies self-requests, impersonation and third-party access without disclosure', async function () {
        const item = await listing();
        assert.equal((await create(item, giver).expect(409)).body.error.code, 'OWN_ITEM');
        const req = (await create(item).expect(201)).body.request;
        assert.equal((await act(req.id, receiver, 'accept', req.version).expect(409)).body.error.code, 'INVALID_PICKUP_TRANSITION');
        assert.equal((await act(req.id, receiver, 'complete', req.version).expect(409)).body.error.code, 'INVALID_PICKUP_TRANSITION');
        for (const call of [detail(req.id, third), act(req.id, third, 'cancel', req.version), propose(req.id, third, req.version, localDay(4) + 'T10:00')]) {
            assert.equal((await call.expect(404)).body.error.code, 'PICKUP_NOT_FOUND');
        }
        for (const call of [messages(req.id, third), send(req.id, third, 'Intrusion')]) assert.equal((await call.expect(404)).body.error.code, 'CONVERSATION_UNAVAILABLE');
        assert.equal((await request(app).get('/api/pickup-requests/received').set('Cookie', third.cookie).expect(200)).body.requests.length, 0);
        assert.equal(await db.collection('pickupMessages').countDocuments(), 0);
    });

    it('rejects requests for draft, withdrawn, expired, cleared, unconfirmed and corrupt listings', async function () {
        const cases = [
            await listing({ status: 'draft', publishedAt: null }),
            await listing({ _id: new ObjectId(), status: 'unlisted' }),
            await listing({ _id: new ObjectId(), status: 'cleared' }),
            await listing({ _id: new ObjectId() }, { availableUntil: localDay(-1) }),
            await listing({ _id: new ObjectId(), timeZoneConfirmedAt: null, expiresAt: undefined, deadlinePolicyVersion: undefined, deadlineTimeZone: undefined, timeZoneRulesVersion: undefined }),
            await listing({ _id: new ObjectId(), expiresAt: new Date(Date.now() + 365 * 86400000) }),
            await listing({ _id: new ObjectId(), publishedAt: new Date(Date.now() + 3600000) }),
            await listing({ _id: new ObjectId(), description: '' })
        ];
        for (const item of cases) {
            assert.equal((await create(item).expect(409)).body.error.code, 'LISTING_UNAVAILABLE', JSON.stringify({ status: item.status, until: item.availableUntil }));
            await request(app).get('/api/items/' + item._id).expect(404);
        }
        assert.equal(await db.collection('pickupRequests').countDocuments(), 0);
    });

    it('keeps every v2 pickup operation behind its default-off gate', async function () {
        const item = await listing();
        assert.equal((await create(item, receiver, undefined, closedApp).expect(409)).body.error.code, 'LISTING_UNAVAILABLE');
        await request(closedApp).get('/api/items/' + item._id).expect(404);
        assert.deepEqual((await request(closedApp).get('/api/me/items').set('Cookie', giver.cookie).expect(200)).body.items[0].pickupSummary, { supported: false, reserved: false });
        const base = { MONGO_URL: 'mongodb://127.0.0.1:1/x' };
        assert.equal(readServerConfig(base).ownerListingPickupsEnabled, false);
        assert.throws(() => readServerConfig(Object.assign({}, base, { OWNER_LISTING_PICKUPS_ENABLED: '1' })), /true or false/);
        assert.throws(() => readServerConfig(Object.assign({}, base, { OWNER_LISTING_PICKUPS_ENABLED: 'true' })), /requires OWNER_LISTINGS_ENABLED/);
        assert.equal(await db.collection('pickupRequests').countDocuments(), 0);
    });

    it('serves only the eligible v2 item by direct ID and never in browse, counts or locations', async function () {
        const item = await listing();
        const shown = (await request(app).get('/api/items/' + item._id).expect(200)).body.item;
        assert.equal(shown.listingModel, 2); assert.equal(shown.datePolicy, 'pickup-local'); assert.equal(shown.pickupTimeZone, zone);
        assert.equal(shown.isOwner, false); assert.equal(shown.isReserved, false); assert.deepEqual(shown.images, []); assert.equal(shown.metroId, '31080');
        for (const secret of ['ownerId', 'coordinationRevision', 'timeZoneConfirmedAt', 'expiresAt', 'imageRevision', 'listingSchemaVersion']) assert.ok(!(secret in shown));
        assert.equal((await request(app).get('/api/items/' + item._id).set('Cookie', giver.cookie).expect(200)).body.item.isOwner, true);
        const browse = (await request(app).get('/api/items?stateId=06&metroId=31080').expect(200)).body; assert.equal(browse.total, 0);
        assert.deepEqual((await request(app).get('/api/items/locations?stateId=06&metroId=31080').expect(200)).body.locations, []);
    });

    it('handles duplicate, concurrent and retried requests without invalid active rows', async function () {
        const item = await listing();
        const pair = await Promise.all([create(item), create(item)]);
        assert.deepEqual(pair.map(r => r.status).sort(), [201, 409]);
        assert.ok(['DUPLICATE_PICKUP', 'PICKUP_CONFLICT'].includes(pair.find(r => r.status === 409).body.error.code));
        assert.equal((await create(item).expect(409)).body.error.code, 'DUPLICATE_PICKUP'); // a retried submit never duplicates
        const second = (await create(item, third, localDay(6) + 'T15:00').expect(201)).body.request;
        const first = pair.find(r => r.status === 201).body.request;
        const decisions = await Promise.all([act(first.id, giver, 'accept', first.version), act(second.id, giver, 'accept', second.version)]);
        assert.deepEqual(decisions.map(r => r.status).sort(), [200, 409]);
        assert.equal(await db.collection('pickupRequests').countDocuments({ itemId: item._id, status: 'accepted' }), 1);
        const winner = decisions.find(r => r.status === 200).body.request;
        assert.equal((await act(winner.id, giver, 'accept', winner.version - 1).expect(409)).body.error.code, 'PICKUP_CHANGED');
        assert.equal((await act(winner.id, giver, 'decline', 1).expect(409)).body.error.code, 'PICKUP_CHANGED'); // stale client version
        // Another item's ledger is untouched.
        const unrelated = await listing({ _id: new ObjectId(), name: 'Separate chair' });
        assert.equal((await create(unrelated, third).expect(201)).body.request.status, 'pending');
    });

    it('validates v2 appointments in the confirmed local zone, including DST and the exclusive local deadline', async function () {
        const until = localDay(40), item = await listing({}, { availableUntil: until, availableFrom: localDay(1) });
        assert.equal((await create(item, receiver, localDay(0) + 'T00:01').expect(400)).body.error.code, 'APPOINTMENT_PAST');
        assert.equal((await create(item, receiver, localDay(0) + 'T23:59').expect(400)).body.error.code, 'OUTSIDE_PICKUP_WINDOW'); // before availableFrom
        assert.equal((await create(item, receiver, '2099-01-01T10:00').expect(400)).body.error.code, 'OUTSIDE_PICKUP_WINDOW');
        assert.equal((await create(item, receiver, until + 'T10:00', app, { timeZone: 'America/New_York' }).expect(409)).body.error.code, 'PICKUP_TIMEZONE_CHANGED');
        // Last local minute is inside, even though it is the next UTC calendar day.
        const late = (await create(item, receiver, until + 'T23:59').expect(201)).body.request;
        assert.ok(late.proposedAt > until + 'T23:59:59.999Z');
        const next = Temporal.PlainDate.from(until).add({ days: 1 }).toString();
        assert.equal((await create(item, third, next + 'T00:00').expect(400)).body.error.code, 'OUTSIDE_PICKUP_WINDOW');
        // Nonexistent (spring-forward) and repeated (fall-back) local times are rejected, never shifted.
        const dst = await listing({ _id: new ObjectId() }, { availableUntil: '2099-12-31' });
        for (const time of ['2099-03-08T02:30', '2099-11-01T01:30']) assert.equal((await create(dst, third, time).expect(400)).body.error.code, 'INVALID_APPOINTMENT');
        assert.equal(await db.collection('pickupRequests').countDocuments({ receiverId: third.id }), 0);
    });

    it('protects proposals against stale, own, racing and cancelled responses', async function () {
        const item = await listing(); const req = await accept(item);
        assert.equal((await propose(req.id, receiver, req.version, localDay(-1) + 'T10:00').expect(400)).body.error.code, 'APPOINTMENT_PAST');
        assert.equal((await propose(req.id, receiver, req.version, req.localDateTime).expect(400)).body.error.code, 'UNCHANGED_APPOINTMENT');
        const proposed = (await propose(req.id, giver, req.version, localDay(5) + 'T08:00').expect(201)).body.request;
        assert.equal((await propose(req.id, receiver, proposed.version, localDay(6) + 'T08:00').expect(409)).body.error.code, 'RESCHEDULE_PENDING');
        const id = proposed.rescheduling.proposal.id;
        assert.equal((await respond(req.id, id, giver, proposed.version, 'accept').expect(409)).body.error.code, 'OWN_PROPOSAL');
        const raced = await Promise.all([respond(req.id, id, receiver, proposed.version, 'accept'), respond(req.id, id, receiver, proposed.version, 'decline')]);
        assert.deepEqual(raced.map(r => r.status).sort(), [200, 409]);
        const settled = raced.find(r => r.status === 200).body.request;
        assert.equal(settled.rescheduling.proposal, null);
        const again = (await propose(req.id, receiver, settled.version, localDay(7) + 'T09:00').expect(201)).body.request;
        const cancelled = (await act(req.id, receiver, 'cancel', again.version).expect(200)).body.request;
        assert.equal(cancelled.status, 'cancelled'); assert.equal(cancelled.rescheduling.proposal, null);
        assert.deepEqual(cancelled.history.slice(-2).map(e => [e.action, e.reason]), [['reschedule_invalidated', 'request_cancelled'], ['cancelled', null]]);
        assert.equal((await respond(req.id, again.rescheduling.proposal.id, giver, cancelled.version, 'accept').expect(409)).body.error.code, 'RESCHEDULE_UNAVAILABLE');
        assert.equal((await db.collection('pickupRequests').countDocuments({ itemId: item._id, status: 'accepted' })), 0);
    });

    it('applies the shared per-account message quota to v2 conversations', async function () {
        const item = await listing(); const req = (await create(item).expect(201)).body.request;
        for (let index = 0; index < 30; index++) await send(req.id, receiver, 'Message ' + index).expect(201);
        const limited = await send(req.id, receiver, 'One too many').expect(429);
        assert.equal(limited.body.error.code, 'MESSAGE_QUOTA_EXCEEDED'); assert.ok(limited.body.error.retryAfterSeconds >= 1);
        assert.equal(await db.collection('pickupMessages').countDocuments({ requestId: new ObjectId(req.id) }), 30);
        await send(req.id, giver, 'Giver still has quota').expect(201);
    });

    it('fails closed for mixed or forged reference formats and keeps v1 requests on their plan path', async function () {
        const item = await listing(); const req = (await create(item).expect(201)).body.request;
        const plan = { _id: new ObjectId(), ownerId: giver.id, status: 'active', city: 'Oakland', neighborhood: 'Legacy', stateId: '06', metroId: '41860', pickupTimeZone: zone,
            moveOutDeadline: localDay(20), inventoryRevision: 0, createdAt: new Date(), updatedAt: new Date() };
        await db.collection('moveOutPlans').insertOne(plan);
        // A v2 row that also claims a plan, or an unknown version, is not a valid reference.
        await db.collection('pickupRequests').updateOne({ _id: new ObjectId(req.id) }, { $set: { planId: plan._id } });
        for (const call of [act(req.id, receiver, 'cancel', req.version), propose(req.id, receiver, req.version, localDay(4) + 'T10:00')]) await call.expect(404);
        await messages(req.id, receiver).expect(404);
        await db.collection('pickupRequests').updateOne({ _id: new ObjectId(req.id) }, { $unset: { planId: '' }, $set: { referenceVersion: 3 } });
        await act(req.id, receiver, 'cancel', req.version).expect(404); await messages(req.id, receiver).expect(404);
        // A legacy item is still requested and stored through the v1 plan format.
        const legacy = { _id: new ObjectId(), planId: plan._id, ownerId: giver.id, name: 'Legacy desk', description: 'Synthetic legacy item.', category: '',
            categoryId: 'office-lighting', itemTypeId: 'desk', status: 'available', version: 2, availableFrom: null, availableUntil: null, publishedAt: new Date(Date.now() - 60000),
            createdAt: new Date(), updatedAt: new Date() };
        await db.collection('items').insertOne(legacy);
        const old = (await create(legacy, third, localDay(2) + 'T12:00').expect(201)).body.request;
        const stored = await db.collection('pickupRequests').findOne({ _id: new ObjectId(old.id) });
        assert.ok(stored.planId.equals(plan._id)); assert.ok(!('referenceVersion' in stored)); assert.equal(old.item.listingModel, undefined);
        assert.equal((await act(old.id, giver, 'accept', old.version).expect(200)).body.request.status, 'accepted');
        assert.equal((await db.collection('moveOutPlans').findOne({ _id: plan._id })).inventoryRevision, 2);
    });
});
