const assert = require('node:assert/strict');
const { ObjectId } = require('mongodb');
const request = require('supertest');
const pino = require('pino');
const createApp = require('../app');
const { createIsolatedMongo } = require('./helpers/isolated-mongo');
const { prepareDatabaseIndexes } = require('../services/database-indexes');
const { createDiscoveryService } = require('../services/discovery');

const day = offset => new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10);
const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
const decode = value => JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
describe('anonymous neighborhood discovery on verified isolated MongoDB', function () {
    this.timeout(180000);
    let isolated, db, app, plan;
    const logger = pino({ level: 'silent' });
    const get = query => request(app).get('/api/items').query(Object.assign({ stateId: '06', metroId: '41860' }, query));
    function item(overrides = {}) {
        return Object.assign({ _id: new ObjectId(), planId: plan._id, ownerId: plan.ownerId, name: 'Kitchen chair',
            description: 'Comfortable reading seat', category: 'Household', status: 'available', availableFrom: null, availableUntil: null,
            publishedAt: new Date('2026-01-01T12:00:00.000Z'), createdAt: new Date(), updatedAt: new Date(), version: 1 }, overrides);
    }
    before(async function () { isolated = await createIsolatedMongo(); db = isolated.db; await prepareDatabaseIndexes(db); });
    after(async function () { if (isolated) await isolated.close(); });
    beforeEach(async function () {
        await db.collection('items').deleteMany({}); await db.collection('moveOutPlans').deleteMany({});
        plan = { _id: new ObjectId(), ownerId: new ObjectId(), city: ' Oakland ', neighborhood: '  North   Temescal ',
            status: 'active', stateId: '06', metroId: '41860', pickupTimeZone: 'UTC', moveOutDeadline: day(30), title: 'Private plan title', email: 'private-plan@example.test', address: 'private-street' };
        await db.collection('moveOutPlans').insertOne(plan);
        app = createApp({ connectToDatabase: async () => db, logger });
    });
    it('browses without a session and returns bounded pagination plus normalized, allowlisted public fields', async function () {
        const stored = item({ email: 'private-item@example.test', token: 'private-token', password: 'hash-secret', apartmentNumber: 'unit-secret' });
        await db.collection('items').insertOne(stored);
        const response = await get().expect(200);
        assert.equal(response.headers['cache-control'], 'no-store');
        assert.deepEqual(response.body.page, { limit: 12, hasMore: false, nextCursor: null });
        assert.equal(response.body.today, day(0));
        const visible = response.body.items[0];
        assert.equal(visible.city, 'Oakland'); assert.equal(visible.neighborhood, 'North Temescal');
        assert.equal(visible.availability, 'now');
        assert.deepEqual(Object.keys(visible).sort(), ['id', 'name', 'description', 'category', 'classification', 'stateId', 'metroId', 'stateLabel', 'metroLabel', 'isOwner', 'status', 'availability', 'availableFrom',
            'availableUntil', 'effectiveAvailableUntil', 'city', 'neighborhood', 'moveOutDeadline', 'publishedAt', 'pickupTimeZone', 'isReserved'].sort());
        assert.equal(visible.isReserved, false);
        for (const secret of [plan.ownerId.toString(), plan._id.toString(), 'private-plan@example.test', 'Private plan title',
            'private-street', 'private-item@example.test', 'private-token', 'hash-secret', 'unit-secret', 'version']) {
            assert.ok(!JSON.stringify(response.body).includes(secret));
        }
    });
    it('searches names, full descriptions and extensible tags case-insensitively with literal query characters', async function () {
        await db.collection('items').insertMany([item({ name: 'Box [kitchen]', description: '', category: '' }),
            item({ name: 'Lamp', description: 'Great for a quiet\nreading   corner', category: 'Decor & craft' })]);
        for (const [q, expected] of [['[kitchen]', 'Box [kitchen]'], ['READING corner', 'Lamp'], ['decor & craft', 'Lamp']]) {
            const response = await get({ q }).expect(200);
            assert.deepEqual(response.body.items.map(value => value.name), [expected]);
        }
        assert.equal((await get({ q: '.*' }).expect(200)).body.items.length, 0);
    });
    it('matches case and whitespace-normalized city/neighborhood labels without requiring either one', async function () {
        await db.collection('items').insertOne(item());
        for (const query of [{ city: ' oakLAND ' }, { neighborhood: ' north\tTEMESCAL ' },
            { city: ' OAKLAND ', neighborhood: 'North  Temescal' }, {}]) assert.equal((await get(query).expect(200)).body.items.length, 1);
        assert.equal((await get({ city: 'Other city' })).body.items.length, 0);
        assert.equal((await get({ neighborhood: 'North' })).body.items.length, 0);
    });
    it('deduplicates location selectors and permits the same neighborhood label across cities', async function () {
        const second = Object.assign({}, plan, { _id: new ObjectId(), city: 'oakland', neighborhood: 'NORTH TEMESCAL' });
        const third = Object.assign({}, plan, { _id: new ObjectId(), city: ' Berkeley ', neighborhood: 'North Temescal' });
        await db.collection('moveOutPlans').insertMany([second, third]);
        await db.collection('items').insertMany([item(), item({ planId: second._id }), item({ planId: third._id })]);
        const response = await request(app).get('/api/items/locations').expect(200);
        assert.equal(response.body.locations.length, 2);
        assert.ok(response.body.locations.every(value => value.neighborhoods.length === 1));
        assert.ok(response.body.locations.every(value => value.neighborhoods[0].toLowerCase() === 'north temescal'));
        assert.equal((await get({ neighborhood: 'NORTH TEMESCAL' })).body.items.length, 3);
        assert.equal((await get({ city: 'Berkeley' })).body.items.length, 1);
        assert.equal(response.body.truncated, false);
    });
    it('handles accented case variants in location options and searches', async function () {
        await db.collection('moveOutPlans').updateOne({ _id: plan._id }, { $set: { city: 'Montréal', neighborhood: ' Côte-des-Neiges ' } });
        await db.collection('items').insertOne(item());
        assert.equal((await get({ city: 'MONTRÉAL', neighborhood: 'CÔTE-DES-NEIGES' }).expect(200)).body.items.length, 1);
        assert.equal((await request(app).get('/api/items/locations')).body.locations[0].city, 'Montréal');
    });
    it('normalizes pasted non-breaking whitespace in stored location labels', async function () {
        await db.collection('moveOutPlans').updateOne({ _id: plan._id }, { $set: { city: 'North\u00a0Oakland', neighborhood: 'Golden\u00a0 Gate' } });
        await db.collection('items').insertOne(item());
        const response = await get({ city: ' north oakland ', neighborhood: 'GOLDEN GATE' }).expect(200);
        assert.equal(response.body.items.length, 1); assert.equal(response.body.items[0].city, 'North Oakland');
        assert.equal((await request(app).get('/api/items/locations')).body.locations[0].neighborhoods[0], 'Golden Gate');
    });
    it('distinguishes now/later without hiding future pickup windows in general browsing', async function () {
        await db.collection('items').insertMany([item({ name: 'Immediate' }), item({ name: 'Starts today', availableFrom: day(0) }),
            item({ name: 'Later', availableFrom: day(5) })]);
        const response = await get().expect(200);
        assert.equal(response.body.items.length, 3);
        assert.equal(response.body.items.find(value => value.name === 'Later').availability, 'later');
        assert.deepEqual((await get({ availability: 'now' })).body.items.map(value => value.name).sort(), ['Immediate', 'Starts today']);
        assert.deepEqual((await get({ availability: 'later' })).body.items.map(value => value.name), ['Later']);
    });
    it('matches an inclusive selected date against overridden and inherited pickup windows', async function () {
        await db.collection('items').insertMany([item({ name: 'Override', availableFrom: day(3), availableUntil: day(6) }),
            item({ name: 'Inherited' }), item({ name: 'Too late', availableFrom: day(10) })]);
        for (const offset of [3, 6]) assert.deepEqual((await get({ availability: 'date', date: day(offset) }).expect(200)).body.items.map(value => value.name).sort(), ['Inherited', 'Override']);
        assert.deepEqual((await get({ availability: 'date', date: day(7) })).body.items.map(value => value.name), ['Inherited']);
        assert.equal((await get({ availability: 'date', date: day(31) })).body.items.length, 0);
    });
    ['newest', 'deadline'].forEach(sort => {
        it('paginates beyond 50 results with deterministic tie-breakers using ' + sort, async function () {
            const records = Array.from({ length: 73 }, (_, index) => item({ _id: new ObjectId((index + 100).toString(16).padStart(24, '0')),
                name: 'Item ' + index, availableUntil: day(1 + index % 8) }));
            await db.collection('items').insertMany(records);
            const expected = records.slice().sort((a, b) => sort === 'newest' ? b._id.toString().localeCompare(a._id.toString()) :
                a.availableUntil.localeCompare(b.availableUntil) || a._id.toString().localeCompare(b._id.toString())).map(value => value._id.toString());
            const found = []; let cursor;
            do {
                const response = await get(Object.assign({ limit: '11', sort }, cursor ? { cursor } : {})).expect(200);
                assert.ok(response.body.items.length <= 11); found.push(...response.body.items.map(value => value.id));
                cursor = response.body.page.nextCursor;
                assert.equal(response.body.page.hasMore, Boolean(cursor));
            } while (cursor);
            assert.deepEqual(found, expected); assert.equal(new Set(found).size, 73);
        });
    });
    it('combines all filters with pagination instead of searching only the old first 50', async function () {
        const records = Array.from({ length: 65 }, () => item({ name: 'Other item' }));
        records[0].description = 'Needle reading corner'; records[1].category = 'Needle reading corner'; records[2].name = 'Needle reading corner';
        await db.collection('items').insertMany(records);
        const query = { q: 'needle reading corner', city: 'OAKLAND', neighborhood: ' north TEMESCAL ', availability: 'now', sort: 'deadline', limit: '2' };
        const first = await get(query).expect(200); const second = await get(Object.assign({}, query, { cursor: first.body.page.nextCursor })).expect(200);
        assert.equal(first.body.items.length, 2); assert.equal(second.body.items.length, 1);
        assert.equal(second.body.page.nextCursor, null);
    });
    it('binds continuation to its filters, sort and page size and rejects malformed cursors before querying', async function () {
        await db.collection('items').insertMany([item(), item(), item()]);
        const first = await get({ limit: '1' }).expect(200); const cursor = first.body.page.nextCursor;
        for (const query of [{ limit: '2' }, { limit: '1', sort: 'deadline' }, { limit: '1', city: 'Other' }, { limit: '1', q: 'changed' }]) {
            await get(Object.assign({}, query, { cursor })).expect(400);
        }
        for (const value of ['not-base64!', encode(null), encode([]), encode({}), 'a'.repeat(1025), encode(Object.assign(decode(cursor), { id: 'not-an-id' }))]) {
            await get({ limit: '1', cursor: value }).expect(400);
        }
        const stale = encode(Object.assign(decode(cursor), { at: Date.now() - 16 * 60000 }));
        assert.equal((await get({ limit: '1', cursor: stale }).expect(409)).body.error.code, 'STALE_CURSOR');
    });
    it('accepts logically equivalent location filters with different case/spacing on continuation', async function () {
        await db.collection('items').insertMany([item(), item()]);
        const first = await get({ city: ' Oakland ', limit: '1' });
        assert.equal((await get({ city: 'OAKLAND', limit: '1', cursor: first.body.page.nextCursor }).expect(200)).body.items.length, 1);
    });
    it('rechecks visibility on every page and does not require a withdrawn anchor to remain public', async function () {
        const records = [item(), item(), item(), item()]; await db.collection('items').insertMany(records);
        const first = await get({ limit: '1' });
        await db.collection('items').updateOne({ _id: new ObjectId(first.body.items[0].id) }, { $set: { status: 'unlisted' } });
        await db.collection('items').updateOne({ _id: records[1]._id }, { $set: { status: 'cleared' } });
        const rest = await get({ limit: '1', cursor: first.body.page.nextCursor }).expect(200);
        assert.ok(rest.body.items.every(value => value.id !== records[1]._id.toString()));
        assert.notEqual(rest.body.items[0].id, first.body.items[0].id);
    });
    it('excludes post-start publications from a deadline continuation and exposes them after refreshing', async function () {
        await db.collection('items').insertMany([item({ availableUntil: day(1) }), item({ availableUntil: day(5) })]);
        const first = await get({ limit: '1', sort: 'deadline' }); const at = decode(first.body.page.nextCursor).at;
        const fresh = item({ name: 'New publication', availableUntil: day(10), publishedAt: new Date(at + 1) });
        await db.collection('items').insertOne(fresh);
        const next = await get({ limit: '1', sort: 'deadline', cursor: first.body.page.nextCursor });
        assert.deepEqual(next.body.items.map(value => value.name), ['Kitchen chair']); assert.equal(next.body.page.nextCursor, null);
        assert.ok((await get({ sort: 'deadline' })).body.items.some(value => value.name === 'New publication'));
    });
    it('invalidates a continuation across UTC midnight even within its time-to-live', async function () {
        await db.collection('moveOutPlans').updateOne({ _id: plan._id }, { $set: { moveOutDeadline: '2030-02-01' } });
        await db.collection('items').insertMany([item(), item()]);
        let time = new Date('2030-01-01T23:59:00.000Z');
        const service = createDiscoveryService({ connectToDatabase: async () => db, now: () => time });
        const first = await service.browse({ stateId: '06', metroId: '41860', limit: '1' }); time = new Date('2030-01-02T00:01:00.000Z');
        await assert.rejects(service.browse({ stateId: '06', metroId: '41860', limit: '1', cursor: first.page.nextCursor }), error => error.code === 'STALE_CURSOR');
    });
    it('never exposes hidden, inactive, expired, unpublished, orphaned or mismatched records through any public endpoint', async function () {
        const hiddenPlan = Object.assign({}, plan, { _id: new ObjectId(), status: 'completed', city: 'Hidden city', neighborhood: 'Hidden neighborhood' });
        await db.collection('moveOutPlans').insertOne(hiddenPlan);
        const hidden = ['draft', 'unlisted', 'cleared', 'expired', 'AVAILABLE'].map(status => item({ status }));
        hidden.push(item({ availableUntil: day(-1) }), item({ publishedAt: null }), item({ planId: hiddenPlan._id }),
            item({ ownerId: new ObjectId() }), item({ planId: new ObjectId() }), item({ availableFrom: day(31) }));
        await db.collection('items').insertMany(hidden);
        assert.equal((await get().expect(200)).body.items.length, 0);
        assert.deepEqual((await request(app).get('/api/items/locations').expect(200)).body.locations, []);
        for (const value of hidden) await request(app).get('/api/items/' + value._id).expect(404);
        await request(app).get('/api/items/not-valid').expect(404);
    });
    it('returns a shareable anonymous detail with the full description and refreshed inherited dates/location', async function () {
        const record = item({ availableFrom: day(2), description: 'Full details\n' + 'Household notes. '.repeat(60) });
        await db.collection('items').insertOne(record);
        const response = await request(app).get('/api/items/' + record._id).expect(200);
        assert.equal(response.body.item.description, record.description); assert.equal(response.body.item.availability, 'later');
        await db.collection('moveOutPlans').updateOne({ _id: plan._id }, { $set: { city: ' Berkeley ', moveOutDeadline: day(10) } });
        const changed = await request(app).get('/api/items/' + record._id).expect(200);
        assert.equal(changed.body.item.city, 'Berkeley'); assert.equal(changed.body.item.effectiveAvailableUntil, day(10));
        await db.collection('items').updateOne({ _id: record._id }, { $set: { status: 'unlisted' } });
        await request(app).get('/api/items/' + record._id).expect(404);
    });
    it('validates all query bounds and combinations without echoing supplied text', async function () {
        for (const query of [{ limit: '0' }, { limit: '51' }, { limit: '1.5' }, { limit: '05' }, { limit: '-1' },
            { sort: 'random' }, { availability: 'reserved' }, { q: 'x'.repeat(101) }, { city: 'x'.repeat(101) },
            { date: day(1) }, { availability: 'date' }, { availability: 'date', date: '2027-02-29' }, { availability: 'date', date: day(-1) }, { status: 'draft' }]) {
            await get(query).expect(400);
        }
        await request(app).get('/api/items?q=a&q=b').expect(400);
        await request(app).get('/api/items?city[$ne]=private-input-secret').expect(400);
        await request(app).get('/api/items/locations?city=private-input-secret').expect(400);
        const response = await get({ q: 'private-input-secret'.repeat(20) }).expect(400);
        assert.ok(!JSON.stringify(response.body).includes('private-input-secret'));
    });
    it('bounds location metadata and signals when more public pairs exist', async function () {
        const plans = Array.from({ length: 502 }, (_, index) => Object.assign({}, plan, { _id: new ObjectId(), city: 'City ' + String(index).padStart(3, '0') }));
        await db.collection('moveOutPlans').insertMany(plans);
        await db.collection('items').insertMany(plans.map(parent => item({ planId: parent._id })));
        const response = await request(app).get('/api/items/locations').expect(200);
        assert.equal(response.body.locations.length, 500); assert.equal(response.body.truncated, true);
    });
    it('limits anonymous discovery requests with a safe retry response', async function () {
        const limited = createApp({ connectToDatabase: async () => db, logger, discoveryLimit: 2 });
        await request(limited).get('/api/items?stateId=06&metroId=41860').expect(200); await request(limited).get('/api/items/locations').expect(200);
        const response = await request(limited).get('/api/items').expect(429);
        assert.equal(response.body.error.code, 'DISCOVERY_RATE_LIMIT'); assert.equal(response.headers['cache-control'], 'no-store');
    });
    it('rejects malformed filters before opening a database connection', async function () {
        let connections = 0;
        const invalidApp = createApp({ connectToDatabase: async () => { connections++; throw new Error('Do not connect'); }, logger });
        await request(invalidApp).get('/api/items?limit=100000').expect(400);
        await request(invalidApp).get('/api/items?cursor=bad!').expect(400);
        assert.equal(connections, 0);
    });
    it('caps MongoDB execution time and returns a safe retry error on timeout', async function () {
        const service = createDiscoveryService({ connectToDatabase: async () => ({ collection: () => ({ aggregate: (pipeline, options) => {
            assert.equal(options.maxTimeMS, 5000); assert.equal(options.allowDiskUse, false);
            return { toArray: async () => { const error = new Error('private-driver-secret'); error.code = 50; throw error; } };
        } }) }) });
        await assert.rejects(service.browse({ stateId: '06', metroId: '41860' }), error => error.status === 503 && error.code === 'DISCOVERY_BUSY' && !error.message.includes('private-driver-secret'));
    });
});
