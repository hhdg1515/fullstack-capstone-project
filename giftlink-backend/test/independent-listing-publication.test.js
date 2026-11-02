/* jshint loopfunc: true */
const assert = require('node:assert/strict'), request = require('supertest'), pino = require('pino');
const { ObjectId } = require('mongodb');
const { Temporal } = require('@js-temporal/polyfill');
const createApp = require('../app');
const { createIsolatedMongo } = require('./helpers/isolated-mongo');
const { prepareDatabaseIndexes } = require('../services/database-indexes');
const { readServerConfig } = require('../config');
const origin = 'http://localhost:3000', zone = 'America/Los_Angeles';
const write = call => call.set('Origin', origin).set('X-CSRF-Protection', '1');
const day = n => Temporal.Now.zonedDateTimeISO(zone).toPlainDate().add({ days: n }).toString();
describe('C3 publication, mixed discovery and withdrawal on an isolated replica set', function () {
    this.timeout(180000); let local, db, app, owner, receiver, third;
    const make = enabled => createApp({ connectToDatabase: async () => db, logger: pino({ level: 'silent' }), authLimit: 10000, discoveryLimit: 10000,
        ownerListingsEnabled: true, ownerListingPickupsEnabled: true, ownerListingPublicationEnabled: enabled });
    const input = () => ({ name: 'Synthetic bookshelf', description: 'Clean household shelf', categoryId: 'living-room', itemTypeId: 'bookshelf',
        stateId: '06', metroId: '31080', pickupTimeZone: zone, pickupTimeZoneConfirmed: true, availableUntil: day(10) });
    const create = (body = input(), user = owner, server = app) => write(request(server).post('/api/items')).set('Cookie', user).send(body);
    const act = (item, action, extra = {}, user = owner) => write(request(app).post('/api/items/' + item.id + '/actions')).set('Cookie', user).send(Object.assign({ version: item.version, action }, extra));
    const browse = query => request(app).get('/api/items?stateId=06&metroId=31080' + (query || ''));
    const row = item => db.collection('items').findOne({ _id: new ObjectId(item.id) });
    const pickup = (item, user = receiver) => write(request(app).post('/api/pickup-requests')).set('Cookie', user).send({ itemId: item.id, localDateTime: day(2) + 'T12:00', timeZone: zone });
    const published = async () => (await create(Object.assign(input(), { publish: true })).expect(201)).body.item;
    before(async () => {
        local = await createIsolatedMongo(); db = local.db; await prepareDatabaseIndexes(db); app = make(true);
        const accounts = [];
        for (const name of ['owner', 'receiver', 'third']) {
            const res = await write(request(app).post('/api/auth/register')).send({ email: name + '@example.test', password: 'synthetic-local-password', firstName: name, lastName: 'Synthetic' }).expect(201);
            accounts.push(res.headers['set-cookie'][0].split(';')[0]);
        }
        [owner, receiver, third] = accounts;
    });
    beforeEach(async () => { for (const c of ['items', 'moveOutPlans', 'pickupRequests', 'pickupMessages']) await db.collection(c).deleteMany({}); });
    after(async () => { if (local) await local.close(); });
    it('defaults publication off and rejects invalid gate combinations', async () => {
        assert.equal(readServerConfig({ MONGO_URL: 'mongodb://127.0.0.1:27017' }).ownerListingPublicationEnabled, false);
        assert.throws(() => readServerConfig({ MONGO_URL: 'mongodb://127.0.0.1:27017', OWNER_LISTING_PUBLICATION_ENABLED: 'true' }));
        await create(Object.assign(input(), { publish: true }), owner, make(false)).expect(409);
        assert.equal(await db.collection('items').countDocuments(), 0);
    });
    it('keeps name-only drafts private and requires complete publication fields', async () => {
        const item = (await create({ name: 'Name only' }).expect(201)).body.item;
        assert.equal((await browse().expect(200)).body.total, 0); await request(app).get('/api/items/' + item.id).expect(404);
        assert.equal((await act(item, 'publish').expect(400)).body.error.code, 'PUBLICATION_DETAILS_REQUIRED');
        assert.equal((await row(item)).status, 'draft');
        for (const field of ['description', 'categoryId', 'itemTypeId', 'stateId', 'metroId', 'availableUntil', 'pickupTimeZoneConfirmed']) {
            const value = input(); value[field] = field === 'pickupTimeZoneConfirmed' ? false : field === 'description' ? '' : null;
            assert.equal((await create(Object.assign(value, { publish: true }))).status, 400, field);
        }
    });
    it('publishes atomically without optional fields or hidden plans; fences stale and foreign edits', async () => {
        const item = (await create().expect(201)).body.item; await act(item, 'publish', {}, third).expect(404);
        const results = await Promise.all([act(item, 'publish'), act(item, 'publish')]); assert.deepEqual(results.map(r => r.status).sort(), [200, 409]);
        const saved = await row(item); assert.equal(saved.status, 'available'); assert.equal(saved.version, 2); assert.equal(saved.coordinationRevision, 1);
        assert.ok(!('planId' in saved)); assert.equal(await db.collection('moveOutPlans').countDocuments(), 0);
        const detail = (await request(app).get('/api/items/' + item.id).expect(200)).body.item;
        assert.equal(detail.datePolicy, 'pickup-local'); assert.equal(detail.ownerId, undefined); assert.equal(detail.expiresAt, undefined);
    });
    it('combines v1/v2 exact totals, filters, bounded cursors and reservation exclusions', async () => {
        const item = await published(); await create(Object.assign(input(), { stateId: '36', metroId: '35620', publish: true })).expect(201);
        const plan = (await write(request(app).post('/api/move-out-plans')).set('Cookie', owner).send({ city: 'Los Angeles', neighborhood: 'Synthetic', moveOutDeadline: day(12), pickupTimeZone: zone, stateId: '06', metroId: '31080' }).expect(201)).body.plan;
        const legacy = (await write(request(app).post('/api/move-out-plans/' + plan.id + '/items')).set('Cookie', owner).send({ name: 'Legacy shelf', description: 'Shelf', categoryId: 'living-room', itemTypeId: 'bookshelf', publish: true }).expect(201)).body.item;
        const first = (await browse('&limit=1').expect(200)).body; assert.equal(first.total, 2); assert.equal(first.items.length, 1);
        const second = (await browse('&limit=1&cursor=' + first.page.nextCursor).expect(200)).body;
        assert.equal(second.total, 2); assert.deepEqual(new Set([first.items[0].id, second.items[0].id]), new Set([item.id, legacy.id]));
        assert.equal((await browse('&q=bookcase&categoryId=living-room&itemTypeId=bookshelf').expect(200)).body.total, 2);
        await browse('&categoryId=bedroom&cursor=' + first.page.nextCursor).expect(400);
        const req = (await pickup(item).expect(201)).body.request;
        await write(request(app).post('/api/pickup-requests/' + req.id + '/actions')).set('Cookie', owner).send({ action: 'accept', version: req.version }).expect(200);
        assert.equal((await browse().expect(200)).body.total, 1);
        assert.equal((await request(app).get('/api/items/' + item.id).expect(200)).body.item.isReserved, true);
    });
    it('confirms pending cancellation, preserves history, revokes public access and permits explicit republish', async () => {
        const item = await published(), req = (await pickup(item).expect(201)).body.request;
        await write(request(app).post('/api/pickup-requests/' + req.id + '/conversation/messages')).set('Cookie', receiver).send({ text: 'Synthetic history' }).expect(201);
        assert.equal((await act(item, 'withdraw').expect(409)).body.error.code, 'PICKUP_CONFIRMATION_REQUIRED');
        const withdrawn = (await act(item, 'withdraw', { confirmCancelRequests: true }).expect(200)).body.item;
        assert.equal(withdrawn.status, 'unlisted'); await act(item, 'withdraw', { confirmCancelRequests: true }).expect(409);
        assert.equal((await browse().expect(200)).body.total, 0); await pickup(item, third).expect(409); await request(app).get('/api/items/' + item.id).expect(404);
        const history = (await request(app).get('/api/pickup-requests/' + req.id + '/conversation/messages').set('Cookie', receiver).expect(200)).body;
        assert.equal(history.messages[0].text, 'Synthetic history');
        await write(request(app).post('/api/pickup-requests/' + req.id + '/conversation/messages')).set('Cookie', receiver).send({ text: 'No new message' }).expect(404);
        assert.equal((await db.collection('pickupRequests').findOne({ _id: new ObjectId(req.id) })).cancellationReason, 'item_withdrawn');
        const republished = (await act(withdrawn, 'publish').expect(200)).body.item;
        assert.equal(republished.status, 'available'); assert.equal(republished.publishedAt, item.publishedAt);
        assert.equal((await request(app).get('/api/pickup-requests/' + req.id).set('Cookie', receiver).expect(200)).body.request.status, 'cancelled');
    });
    it('requires request-level resolution of reached appointments and invalidates future proposals', async () => {
        const item = await published(); let req = (await pickup(item).expect(201)).body.request;
        req = (await write(request(app).post('/api/pickup-requests/' + req.id + '/actions')).set('Cookie', owner).send({ action: 'accept', version: req.version }).expect(200)).body.request;
        await write(request(app).post('/api/pickup-requests/' + req.id + '/reschedule-proposals')).set('Cookie', receiver).send({ version: req.version, localDateTime: day(3) + 'T10:00', timeZone: zone }).expect(201);
        await db.collection('pickupRequests').updateOne({ _id: new ObjectId(req.id) }, { $set: { proposedAt: new Date(Date.now() - 60000) } });
        assert.equal((await act(item, 'withdraw', { confirmCancelRequests: true }).expect(409)).body.error.code, 'PICKUP_RESOLUTION_REQUIRED');
        await db.collection('pickupRequests').updateOne({ _id: new ObjectId(req.id) }, { $set: { proposedAt: new Date(Date.now() + 86400000) } });
        await act(item, 'withdraw', { confirmCancelRequests: true }).expect(200);
        const closed = await db.collection('pickupRequests').findOne({ _id: new ObjectId(req.id) }); assert.equal(closed.rescheduleProposal, undefined);
        assert.ok(closed.history.some(e => e.action === 'reschedule_invalidated'));
    });
    it('excludes expired, tampered, mixed-model and unconfirmed records before counting', async () => {
        const item = await published(), original = await row(item);
        for (const changes of [{ expiresAt: new Date(Date.now() - 1) }, { expiresAt: new Date(original.expiresAt.getTime() + 1000) }, { timeZoneConfirmedAt: null }, { planId: new ObjectId() }, { categoryId: 'invalid' }, { publishedAt: new Date(Date.now() + 86400000) }]) {
            await db.collection('items').replaceOne({ _id: original._id }, Object.assign({}, original, changes));
            assert.equal((await browse().expect(200)).body.total, 0, JSON.stringify(changes)); await request(app).get('/api/items/' + item.id).expect(404);
        }
    });
    it('serializes withdrawal with concurrent acceptance without leaving an active reservation', async () => {
        const item = await published(), req = (await pickup(item).expect(201)).body.request;
        const results = await Promise.all([act(item, 'withdraw', { confirmCancelRequests: true }), write(request(app).post('/api/pickup-requests/' + req.id + '/actions')).set('Cookie', owner).send({ action: 'accept', version: req.version })]);
        assert.equal(results[0].status, 200); assert.ok([200, 409].includes(results[1].status));
        assert.equal(await db.collection('pickupRequests').countDocuments({ itemId: new ObjectId(item.id), active: true }), 0); assert.equal((await row(item)).status, 'unlisted');
    });
    it('refuses expired draft publication and requires reconfirmation after region or timezone edits', async () => {
        const expired = (await create(Object.assign(input(), { availableUntil: day(-1) })).expect(201)).body.item;
        const failure = await act(expired, 'publish').expect(400); assert.equal(failure.body.error.fields[0].field, 'availableUntil');
        const item = (await create().expect(201)).body.item;
        const changed = (await write(request(app).patch('/api/items/' + item.id)).set('Cookie', owner).send({ version: item.version, stateId: '36', metroId: '35620' }).expect(200)).body.item;
        assert.equal(changed.pickup.timeZoneConfirmed, false); await act(changed, 'publish').expect(400);
        const confirmed = (await write(request(app).patch('/api/items/' + item.id)).set('Cookie', owner).send({ version: changed.version, pickupTimeZone: 'America/New_York', pickupTimeZoneConfirmed: true }).expect(200)).body.item;
        await act(confirmed, 'publish').expect(200);
        const crossState = (await request(app).get('/api/items?stateId=34&metroId=35620').expect(200)).body;
        assert.equal(crossState.total, 1); assert.equal(crossState.items[0].id, item.id);
        assert.equal((await browse().expect(200)).body.total, 0);
    });
    it('uses authoritative database time for v2 discovery despite an old application clock', async () => {
        const item = await published();
        const discovery = require('../services/discovery').createDiscoveryService({ connectToDatabase: async () => db,
            independentPublication: true, independentPickups: true, now: () => new Date('2000-01-01T00:00:00Z') });
        const results = await discovery.browse({ stateId: '06', metroId: '31080' });
        assert.equal(results.total, 1); assert.equal(results.items[0].id, item.id);
        assert.equal((await discovery.detail(item.id)).item.id, item.id);
    });

    it('sorts mixed deadlines by their actual exclusive instants and pages equal local dates correctly', async () => {
        const west = await published();
        const east = (await create(Object.assign(input(), { pickupTimeZone: 'America/New_York', publish: true })).expect(201)).body.item;
        const first = (await browse('&sort=deadline&limit=1').expect(200)).body;
        assert.equal(first.total, 2); assert.equal(first.items[0].id, east.id);
        const cursor = JSON.parse(Buffer.from(first.page.nextCursor, 'base64url')); assert.equal(cursor.v, 2); assert.ok(cursor.value.endsWith('Z'));
        const second = (await browse('&sort=deadline&limit=1&cursor=' + first.page.nextCursor).expect(200)).body;
        assert.equal(second.total, 2); assert.equal(second.items[0].id, west.id);
        const changedMode = Object.assign({}, cursor, { v: 1, value: input().availableUntil });
        assert.equal((await browse('&sort=deadline&limit=1&cursor=' + Buffer.from(JSON.stringify(changedMode)).toString('base64url')).expect(409)).body.error.code, 'STALE_CURSOR');
    });
    it('requires the C3 publication marker for discovery and never exposes an old fixture as newly authorized media', async () => {
        const item = await published(); assert.equal((await row(item)).publicationRequirementsVersion, 2);
        await db.collection('items').updateOne({ _id: new ObjectId(item.id) }, { $unset: { publicationRequirementsVersion: '' } });
        assert.equal((await browse().expect(200)).body.total, 0); await request(app).get('/api/items/' + item.id).expect(404);
    });

});

describe('C3 exact-date query compatibility', function () {
    it('allows the previous UTC date only in mixed mode so an unexpired giver-local day remains selectable', function () {
        const { parseQuery } = require('../services/discovery');
        const query = { stateId: '06', metroId: '31080', availability: 'date', date: '2026-11-01' };
        assert.equal(parseQuery(query, '2026-11-02', true, true).date, '2026-11-01');
        assert.throws(() => parseQuery(query, '2026-11-02'));
        assert.throws(() => parseQuery(Object.assign({}, query, { date: '2026-10-31' }), '2026-11-02', true, true));
    });
});
