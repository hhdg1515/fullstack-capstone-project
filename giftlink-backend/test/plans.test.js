const assert = require('node:assert/strict');
const request = require('supertest');
const { ObjectId } = require('mongodb');
const pino = require('pino');
const createApp = require('../app');
const { createIsolatedMongo } = require('./helpers/isolated-mongo');
const { prepareDatabaseIndexes } = require('../services/database-indexes');
const { isCalendarDate, todayUTC } = require('../services/plans');
const { tokenHash } = require('../services/identity');

const origin = 'http://localhost:3000';
const base = '/api/move-out-plans';
const write = operation => operation.set('Origin', origin).set('X-CSRF-Protection', '1');
const day = offset => new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10);

describe('move-out plans on verified isolated MongoDB', function () {
    this.timeout(180000);
    let isolated;
    let db;
    let app;
    let owner;
    let other;
    let sample;
    const create = (details = sample, account = owner) => write(request(app).post(base)).set('Cookie', account.cookie).send(details);
    const patch = (id, details, account = owner) => write(request(app).patch(base + '/' + id)).set('Cookie', account.cookie).send(details);
    const get = (suffix = '', account = owner) => request(app).get(base + suffix).set('Cookie', account.cookie);
    before(async function () {
        isolated = await createIsolatedMongo(); db = isolated.db;
        await prepareDatabaseIndexes(db);
        app = createApp({ connectToDatabase: async () => db, logger: pino({ level: 'silent' }) });
        async function account(email) {
            const result = await write(request(app).post('/api/auth/register')).send({ email,
                firstName: 'Plan', lastName: 'Owner', password: 'test-only-password' }).expect(201);
            return { id: result.body.user.id, cookie: result.headers['set-cookie'][0].split(';')[0], email };
        }
        owner = await account('owner@example.test'); other = await account('other@example.test');
    });
    after(async function () { if (isolated) await isolated.close(); });
    beforeEach(async function () {
        await db.collection('moveOutPlans').deleteMany({});
        sample = { moveOutDeadline: day(10), city: 'San Francisco', neighborhood: 'Sunset' };
    });

    it('creates an empty private plan with a server-derived owner, status and timestamps', async function () {
        const result = await create().expect(201);
        const plan = result.body.plan;
        assert.deepEqual(Object.keys(plan).sort(), ['id', 'title', 'moveOutDeadline', 'city', 'neighborhood', 'pickupTimeZone', 'status', 'createdAt', 'updatedAt'].sort());
        assert.equal(plan.title, ''); assert.equal(plan.status, 'active');
        assert.equal(plan.createdAt, plan.updatedAt);
        assert.ok(!Number.isNaN(Date.parse(plan.createdAt)));
        assert.equal(result.headers.location, base + '/' + plan.id);
        assert.equal(result.headers['cache-control'], 'no-store');
        const stored = await db.collection('moveOutPlans').findOne({ _id: new ObjectId(plan.id) });
        assert.equal(stored.ownerId.toString(), owner.id);
        assert.ok(stored.createdAt instanceof Date);
        assert.equal(stored.moveOutDeadline, sample.moveOutDeadline);
        assert.equal(stored.items, undefined); assert.equal(stored.address, undefined);
        assert.equal(await db.collection('gifts').countDocuments(), 0);
    });
    it('trims labels and optional titles and accepts neighborhood names without a location provider', async function () {
        const result = await create(Object.assign({}, sample, { title: '  Moving home  ', city: '  Montréal ', neighborhood: ' Côte-des-Neiges ' })).expect(201);
        assert.equal(result.body.plan.title, 'Moving home');
        assert.equal(result.body.plan.city, 'Montréal');
        assert.equal(result.body.plan.neighborhood, 'Côte-des-Neiges');
    });
    it('supports multiple plans and lists only the current owner in deadline/id order', async function () {
        const later = (await create(Object.assign({}, sample, { title: 'Later', moveOutDeadline: day(30) }))).body.plan;
        const first = (await create(Object.assign({}, sample, { title: 'First' }))).body.plan;
        const second = (await create(Object.assign({}, sample, { title: 'Second' }))).body.plan;
        await create(Object.assign({}, sample, { title: 'Other private plan' }), other).expect(201);
        const response = await get('?ownerId=' + other.id).expect(200);
        assert.deepEqual(response.body.plans.map(plan => plan.id), [first.id, second.id, later.id]);
        assert.equal(response.headers['cache-control'], 'no-store');
        assert.deepEqual((await get('', other)).body.plans.map(plan => plan.title), ['Other private plan']);
    });
    it('returns a clear empty list for an owner without plans', async function () {
        const response = await get().expect(200);
        assert.deepEqual(response.body, { plans: [] });
    });
    it('lets only the owner read a plan and conceals whether another owner has that id', async function () {
        const plan = (await create()).body.plan;
        assert.deepEqual((await get('/' + plan.id).expect(200)).body.plan, plan);
        const forbidden = await get('/' + plan.id, other).expect(404);
        const missing = await get('/' + new ObjectId().toString()).expect(404);
        const malformed = await get('/invalid').expect(404);
        assert.deepEqual(forbidden.body, missing.body); assert.deepEqual(malformed.body, missing.body);
        assert.equal(forbidden.headers['cache-control'], 'no-store');
    });
    it('updates fields and manual status while preserving identity, owner and creation time', async function () {
        const plan = (await create()).body.plan;
        const changes = { title: ' New title ', city: ' Oakland ', neighborhood: ' Temescal ', moveOutDeadline: day(20), status: 'completed' };
        const result = await patch(plan.id, changes).expect(200);
        assert.equal(result.body.plan.title, 'New title'); assert.equal(result.body.plan.city, 'Oakland');
        assert.equal(result.body.plan.neighborhood, 'Temescal'); assert.equal(result.body.plan.moveOutDeadline, day(20));
        assert.equal(result.body.plan.status, 'completed'); assert.equal(result.body.plan.createdAt, plan.createdAt);
        assert.equal(result.body.plan.id, plan.id); assert.ok(result.body.plan.updatedAt >= plan.updatedAt);
        const stored = await db.collection('moveOutPlans').findOne({ _id: new ObjectId(plan.id) });
        assert.equal(stored.ownerId.toString(), owner.id);
        await patch(plan.id, { status: 'cancelled', title: '' }).expect(200);
        assert.equal((await get('/' + plan.id)).body.plan.title, '');
        await patch(plan.id, { status: 'active' }).expect(200);
    });
    it('rejects cross-owner updates without altering either account’s plans', async function () {
        const plan = (await create()).body.plan;
        const before = await db.collection('moveOutPlans').find({}).toArray();
        await patch(plan.id, { title: 'Takeover', status: 'cancelled' }, other).expect(404);
        await patch(new ObjectId().toString(), { title: 'Missing' }).expect(404);
        await patch('invalid', { title: 'Missing' }).expect(404);
        assert.deepEqual(await db.collection('moveOutPlans').find({}).toArray(), before);
    });
    it('requires a valid session for create/list/read/update', async function () {
        const plan = (await create()).body.plan;
        await request(app).get(base).expect(401);
        await request(app).get(base + '/' + plan.id).expect(401);
        await write(request(app).post(base)).send(sample).expect(401);
        await write(request(app).patch(base + '/' + plan.id)).send({ title: 'Anonymous' }).expect(401);
        assert.equal(await db.collection('moveOutPlans').countDocuments(), 1);
    });
    it('rejects expired sessions immediately for all private operations', async function () {
        const plan = (await create()).body.plan;
        const login = await write(request(app).post('/api/auth/login')).send({ email: owner.email, password: 'test-only-password' }).expect(200);
        const expired = { cookie: login.headers['set-cookie'][0].split(';')[0] };
        await db.collection('sessions').updateOne({ _id: tokenHash(expired.cookie.split('=')[1]) }, { $set: { expiresAt: new Date(0) } });
        await get('', expired).expect(401); await get('/' + plan.id, expired).expect(401);
        await create(sample, expired).expect(401); await patch(plan.id, { title: 'Expired' }, expired).expect(401);
        assert.deepEqual((await get('/' + plan.id)).body.plan, plan);
    });
    it('rejects caller identity, private address, item and timestamp fields', async function () {
        const plan = (await create()).body.plan;
        for (const field of ['ownerId', 'userId', '_id', 'id', 'createdAt', 'updatedAt', 'address', 'streetAddress', 'apartmentNumber', 'items', 'latitude']) {
            await create(Object.assign({}, sample, { [field]: 'caller-supplied' })).expect(400);
            await patch(plan.id, { [field]: 'caller-supplied' }).expect(400);
        }
        await create(Object.assign({}, sample, { status: 'completed' })).expect(400);
        assert.equal(await db.collection('moveOutPlans').countDocuments(), 1);
    });
    it('validates required and scalar fields, bounded single-line labels and supported status values', async function () {
        const invalid = [{ city: '' }, { neighborhood: '  ' }, { city: null }, { city: ['City'] }, { neighborhood: { $ne: null } },
            { title: 12 }, { title: null }, { title: 'x'.repeat(121) }, { city: 'x'.repeat(101) },
            { neighborhood: 'x'.repeat(101) }, { city: 'City\nName' }, { title: 'bad\u0000value' }];
        for (const changes of invalid) await create(Object.assign({}, sample, changes)).expect(400);
        for (const field of ['moveOutDeadline', 'city', 'neighborhood']) {
            const missing = Object.assign({}, sample); delete missing[field];
            await create(missing).expect(400);
        }
        await create([]).expect(400);
        assert.equal(await db.collection('moveOutPlans').countDocuments(), 0);
        const plan = (await create()).body.plan;
        for (const changes of [{}, { city: '' }, { moveOutDeadline: null }, { status: 'published' }, { status: { $ne: null } }]) {
            await patch(plan.id, changes).expect(400);
        }
        assert.deepEqual((await get('/' + plan.id)).body.plan, plan);
    });
    it('rejects impossible dates, timestamps, offsets and past deadlines without storing invalid plans', async function () {
        for (const date of ['2026-02-30', '2027-02-29', '2026-13-01', '2026-2-01', 'not-a-date',
            day(10) + 'T12:00:00Z', day(10) + 'T00:00:00-07:00', day(-1), null, { $gt: '' }]) {
            const result = await create(Object.assign({}, sample, { moveOutDeadline: date })).expect(400);
            assert.equal(result.body.error.code, 'VALIDATION_FAILED');
            assert.equal(result.body.error.fields[0].field, 'moveOutDeadline');
        }
        assert.equal(await db.collection('moveOutPlans').countDocuments(), 0);
        await create(Object.assign({}, sample, { moveOutDeadline: day(0) })).expect(201);
    });
    it('preserves past plans and permits editing without moving their unchanged deadline', async function () {
        const plan = (await create()).body.plan;
        await db.collection('moveOutPlans').updateOne({ _id: new ObjectId(plan.id) }, { $set: { moveOutDeadline: '2000-01-01' } });
        assert.equal((await get('/' + plan.id)).body.plan.status, 'active');
        await patch(plan.id, { title: 'Finished move', status: 'completed', moveOutDeadline: '2000-01-01' }).expect(200);
        await patch(plan.id, { moveOutDeadline: '2000-01-02' }).expect(400);
        await patch(plan.id, { moveOutDeadline: day(5) }).expect(200);
    });
    it('enforces the existing CSRF and JSON protocol for plan writes', async function () {
        const plan = (await create()).body.plan;
        for (const operation of [() => request(app).post(base), () => request(app).patch(base + '/' + plan.id)]) {
            await operation().set('Cookie', owner.cookie).send(sample).expect(403);
            await operation().set('Cookie', owner.cookie).set('Origin', 'https://untrusted.example.test')
                .set('X-CSRF-Protection', '1').send(sample).expect(403);
            await write(operation()).set('Cookie', owner.cookie).type('form').send(sample).expect(415);
        }
        assert.deepEqual((await get('/' + plan.id)).body.plan, plan);
    });
    it('allowlists private plan responses and never exposes arbitrary stored contact or location data', async function () {
        const plan = (await create()).body.plan;
        await db.collection('moveOutPlans').updateOne({ _id: new ObjectId(plan.id) }, { $set: {
            email: 'private-location@example.test', password: 'hash-secret', token: 'session-secret', address: 'private-street-secret'
        } });
        for (const response of [await get(), await get('/' + plan.id), await patch(plan.id, { title: 'Safe' })]) {
            assert.equal(response.status, 200);
            for (const secret of ['private-location@example.test', 'hash-secret', 'session-secret', 'private-street-secret', owner.id]) {
                assert.ok(!JSON.stringify(response.body).includes(secret));
            }
        }
        for (const path of ['/api/gifts', '/api/search']) {
            assert.deepEqual((await request(app).get(path).expect(200)).body, []);
        }
    });
    it('checks calendar validity and UTC boundaries without the host timezone changing the date', function () {
        assert.equal(isCalendarDate('2028-02-29'), true); assert.equal(isCalendarDate('2027-02-29'), false);
        assert.equal(isCalendarDate('2026-04-31'), false);
        assert.equal(todayUTC(new Date('2026-10-23T23:30:00-07:00')), '2026-10-24');
        assert.equal(todayUTC(new Date('2026-10-24T01:30:00+09:00')), '2026-10-23');
    });
});
