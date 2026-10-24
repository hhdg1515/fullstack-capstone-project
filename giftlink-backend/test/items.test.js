const assert = require('node:assert/strict');
const request = require('supertest');
const { ObjectId } = require('mongodb');
const pino = require('pino');
const createApp = require('../app');
const { createIsolatedMongo } = require('./helpers/isolated-mongo');
const { prepareDatabaseIndexes } = require('../services/database-indexes');
const { tokenHash } = require('../services/identity');
const fixtures = require('../util/import-mongo/gifts.json').docs;
const day = offset => new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10);
const write = operation => operation.set('Origin', 'http://localhost:3000').set('X-CSRF-Protection', '1');
const root = id => '/api/move-out-plans/' + id + '/items';

describe('transactional plan inventory on verified isolated MongoDB', function () {
    this.timeout(180000);
    let isolated, db, app, owner, other, plan, otherPlan;
    async function account(email) {
        const response = await write(request(app).post('/api/auth/register')).send({ email, firstName: 'Inventory', lastName: 'Owner', password: 'isolated-inventory-password' }).expect(201);
        return { id: response.body.user.id, cookie: response.headers['set-cookie'][0].split(';')[0], email };
    }
    const create = (data = {}, parent = plan, user = owner) => write(request(app).post(root(parent.id))).set('Cookie', user.cookie).send(Object.assign({ name: 'Box of kitchen supplies' }, data));
    const list = (parent = plan, user = owner) => request(app).get(root(parent.id)).set('Cookie', user.cookie);
    const edit = (item, data, parent = plan, user = owner) => write(request(app).patch(root(parent.id) + '/' + item.id)).set('Cookie', user.cookie).send(Object.assign({ version: item.version }, data));
    const action = (item, name, parent = plan, user = owner) => write(request(app).post(root(parent.id) + '/' + item.id + '/actions')).set('Cookie', user.cookie).send({ version: item.version, action: name });
    const updatePlan = data => write(request(app).patch('/api/move-out-plans/' + plan.id)).set('Cookie', owner.cookie).send(data);
    const publicGet = item => request(app).get('/api/items/' + item.id);
    before(async function () {
        isolated = await createIsolatedMongo(); db = isolated.db; await prepareDatabaseIndexes(db);
        app = createApp({ connectToDatabase: async () => db, logger: pino({ level: 'silent' }) });
        owner = await account('inventory-owner@example.test'); other = await account('inventory-other@example.test');
        await db.collection('gifts').insertMany(fixtures.map(gift => Object.assign({}, gift)));
    });
    after(async function () { if (isolated) await isolated.close(); });
    beforeEach(async function () {
        await db.collection('items').deleteMany({}); await db.collection('moveOutPlans').deleteMany({});
        async function parent(user) {
            return (await write(request(app).post('/api/move-out-plans')).set('Cookie', user.cookie)
                .send({ city: 'San Francisco', neighborhood: 'Sunset', moveOutDeadline: day(20) }).expect(201)).body.plan;
        }
        plan = await parent(owner); otherPlan = await parent(other);
    });
    it('adds multiple free-text/grouped items as private drafts without copying plan information', async function () {
        for (const name of ['Box of kitchen supplies', 'Three identical chairs', 'Miscellaneous craft supplies']) await create({ name }).expect(201);
        const response = await list().expect(200);
        assert.deepEqual(response.body.progress, { total: 3, cleared: 0 });
        assert.equal(response.body.items[0].publishedAt, null); assert.equal(response.body.items[0].status, 'draft');
        assert.equal(response.body.items[0].availableFrom, null); assert.equal(response.body.items[0].effectiveAvailableUntil, plan.moveOutDeadline);
        const rows = await db.collection('items').find({}).toArray();
        rows.forEach(item => {
            assert.equal(item.ownerId.toString(), owner.id); assert.equal(item.planId.toString(), plan.id);
            for (const field of ['city', 'neighborhood', 'moveOutDeadline', 'price', 'address']) assert.equal(item[field], undefined);
        });
        assert.equal(response.headers['cache-control'], 'no-store');
        assert.deepEqual((await request(app).get('/api/items').expect(200)).body.items, []);
    });
    it('publishes with distinct first-publication time and future pickup dates, retaining the timestamp on relist', async function () {
        let item = (await create({ availableFrom: day(5), availableUntil: day(10) })).body.item;
        item = (await action(item, 'publish').expect(200)).body.item;
        assert.equal(item.status, 'available'); assert.equal(item.availableFrom, day(5));
        assert.ok(!Number.isNaN(Date.parse(item.publishedAt)));
        const first = item.publishedAt;
        assert.equal((await publicGet(item).expect(200)).body.item.availableFrom, day(5));
        item = (await action(item, 'unlist').expect(200)).body.item;
        await publicGet(item).expect(404);
        item = (await action(item, 'publish').expect(200)).body.item;
        assert.equal(item.publishedAt, first); await publicGet(item).expect(200);
    });
    it('supports immediate publish while descriptions/categories and specifications stay optional', async function () {
        const item = (await create({ name: 'Spare plant pots', publish: true }).expect(201)).body.item;
        assert.equal(item.status, 'available'); assert.equal(item.description, ''); assert.equal(item.category, '');
        await publicGet(item).expect(200);
    });
    it('distinguishes unlisted from cleared and reopens clearance as a private draft', async function () {
        let item = (await create({ publish: true })).body.item;
        item = (await action(item, 'unlist').expect(200)).body.item;
        assert.equal((await list()).body.progress.cleared, 0);
        item = (await action(item, 'clear').expect(200)).body.item;
        assert.equal((await list()).body.progress.cleared, 1); await publicGet(item).expect(404);
        item = (await action(item, 'reopen').expect(200)).body.item;
        assert.equal(item.status, 'draft'); assert.equal((await list()).body.progress.cleared, 0);
        await publicGet(item).expect(404);
        item = (await action(item, 'publish').expect(200)).body.item; await publicGet(item).expect(200);
        assert.equal(await db.collection('items').countDocuments(), 1);
    });
    it('inherits current location/deadline on every read and supports literal public search', async function () {
        const item = (await create({ name: 'Box [kitchen]', publish: true })).body.item;
        await updatePlan({ city: 'Oakland', neighborhood: 'Temescal', moveOutDeadline: day(15) }).expect(200);
        const visible = (await publicGet(item).expect(200)).body.item;
        assert.equal(visible.city, 'Oakland'); assert.equal(visible.neighborhood, 'Temescal'); assert.equal(visible.effectiveAvailableUntil, day(15));
        assert.equal((await request(app).get('/api/items').query({ q: '[kitchen]', city: 'oakland' }).expect(200)).body.items.length, 1);
        assert.equal((await request(app).get('/api/items').query({ city: 'San Francisco' })).body.items.length, 0);
        await request(app).get('/api/items?q[a]=bad').expect(400);
        assert.equal((await list()).body.items[0].moveOutDeadline, day(15));
    });
    it('rejects invalid date ranges and impossible dates on create and edit', async function () {
        for (const data of [{ availableFrom: day(11), availableUntil: day(10) }, { availableUntil: day(21) },
            { availableFrom: day(21) }, { availableFrom: '2027-02-29' }, { availableUntil: day(5) + 'T00:00:00Z' }, { availableFrom: { $gt: '' } }]) {
            await create(data).expect(400);
        }
        const item = (await create()).body.item;
        await edit(item, { availableUntil: day(30) }).expect(400);
        assert.equal((await list()).body.items[0].version, 1);
        await create({ publish: true, availableUntil: day(-1) }).expect(400);
        await create({ publish: true, availableUntil: day(0) }).expect(201);
    });
    it('reports affected items and requires explicit date resolution before shortening a deadline', async function () {
        const a = (await create({ availableUntil: day(15), name: 'Late pickup' })).body.item;
        const b = (await create({ availableFrom: day(12), name: 'Future start' })).body.item;
        const before = await db.collection('items').find({}).toArray();
        const conflict = await updatePlan({ moveOutDeadline: day(10) }).expect(409);
        assert.equal(conflict.body.error.code, 'ITEM_DATE_CONFLICT');
        assert.deepEqual(conflict.body.error.conflicts.map(item => item.name).sort(), ['Future start', 'Late pickup']);
        assert.deepEqual(await db.collection('items').find({}).toArray(), before);
        assert.equal((await list()).body.plan.moveOutDeadline, day(20));
        await edit(a, { availableUntil: null }).expect(200); await edit(b, { availableFrom: null }).expect(200);
        await updatePlan({ moveOutDeadline: day(10) }).expect(200);
        assert.ok((await list()).body.items.every(item => item.effectiveAvailableUntil === day(10)));
    });
    it('enforces expiry on reads without a scheduler and never republishes expired items implicitly', async function () {
        let item = (await create({ publish: true })).body.item;
        const first = item.publishedAt;
        await db.collection('moveOutPlans').updateOne({ _id: new ObjectId(plan.id) }, { $set: { moveOutDeadline: day(-1) } });
        assert.equal((await list()).body.items[0].status, 'expired'); await publicGet(item).expect(404);
        assert.equal((await request(app).get('/api/items')).body.items.length, 0);
        assert.equal((await db.collection('items').findOne({ _id: new ObjectId(item.id) })).status, 'available');
        await action(item, 'publish').expect(400);
        await updatePlan({ moveOutDeadline: day(30) }).expect(200);
        item = (await list()).body.items[0]; assert.equal(item.status, 'expired'); await publicGet(item).expect(404);
        item = (await edit(item, { description: 'Ready again' }).expect(200)).body.item;
        assert.equal(item.status, 'expired'); await publicGet(item).expect(404);
        item = (await action(item, 'publish').expect(200)).body.item;
        assert.equal(item.publishedAt, first); await publicGet(item).expect(200);
    });
    it('requires valid dates when reopening a cleared item', async function () {
        let item = (await create({ availableUntil: day(-1) })).body.item;
        item = (await action(item, 'clear')).body.item;
        await action(item, 'reopen').expect(400);
        item = (await edit(item, { availableUntil: null })).body.item;
        assert.equal((await action(item, 'reopen').expect(200)).body.item.status, 'draft');
    });
    it('hides inactive plans and requires activation before publishing', async function () {
        const item = (await create({ publish: true })).body.item;
        await updatePlan({ status: 'completed' }).expect(200); await publicGet(item).expect(404);
        await create({ publish: true }).expect(409); await create({ name: 'Private notes' }).expect(201);
        await updatePlan({ status: 'active' }).expect(200); await publicGet(item).expect(200);
    });
    it('checks item and plan ownership together, including inconsistent/orphaned references', async function () {
        const item = (await create({ publish: true })).body.item;
        await list(plan, other).expect(404); await create({}, otherPlan, owner).expect(404);
        await edit(item, { name: 'Takeover' }, plan, other).expect(404); await action(item, 'clear', otherPlan, other).expect(404);
        await db.collection('items').updateOne({ _id: new ObjectId(item.id) }, { $set: { planId: new ObjectId(otherPlan.id) } });
        await publicGet(item).expect(404); assert.equal((await list(otherPlan, other)).body.items.length, 0);
        await edit(item, { name: 'Mismatch' }, otherPlan, other).expect(404);
        await edit(item, { name: 'Mismatch' }, otherPlan, owner).expect(404);
    });
    it('requires sessions and CSRF on management while public reads remain anonymous', async function () {
        const item = (await create({ publish: true })).body.item;
        await request(app).get(root(plan.id)).expect(401);
        await write(request(app).post(root(plan.id))).send({ name: 'Anonymous' }).expect(401);
        await write(request(app).patch(root(plan.id) + '/' + item.id)).send({ name: 'Anonymous', version: 1 }).expect(401);
        await request(app).post(root(plan.id) + '/' + item.id + '/actions').set('Cookie', owner.cookie).send({ action: 'clear', version: 1 }).expect(403);
        await publicGet(item).expect(200);
        const login = await write(request(app).post('/api/auth/login')).send({ email: owner.email, password: 'isolated-inventory-password' });
        const cookie = login.headers['set-cookie'][0].split(';')[0];
        await db.collection('sessions').updateOne({ _id: tokenHash(cookie.split('=')[1]) }, { $set: { expiresAt: new Date(0) } });
        await request(app).get(root(plan.id)).set('Cookie', cookie).expect(401);
    });
    it('rejects ownership spoofing, prices, copied locations, markup, unsupported states and malformed inputs', async function () {
        for (const extra of ['ownerId', 'planId', 'city', 'neighborhood', 'moveOutDeadline', 'status', 'publishedAt', 'address', 'price', 'image']) await create({ [extra]: 'spoof' }).expect(400);
        for (const name of ['', ' ', '<script>alert(1)</script>', { $ne: '' }, 'x'.repeat(161)]) await create({ name }).expect(400);
        await create({ publish: 'true' }).expect(400);
        const item = (await create()).body.item;
        await edit(item, { status: 'reserved' }).expect(400);
        await action(item, 'reserve').expect(400);
        await action(item, ['clear']).expect(400);
        await action(item, 'unlist').expect(409);
    });
    it('blocks obvious restricted goods/contact disclosure at publication without claiming complete moderation', async function () {
        for (const name of ['Firearm ammunition', 'Cocaine', 'Contact private@example.test']) {
            const item = (await create({ name }).expect(201)).body.item;
            await action(item, 'publish').expect(400); await publicGet(item).expect(404);
        }
        const item = (await create({ publish: true })).body.item;
        await edit(item, { description: 'Contact private@example.test' }).expect(400);
    });
    it('allowlists public DTOs and prevents legacy APIs from retrieving private inventory', async function () {
        const visible = (await create({ publish: true })).body.item;
        const hidden = (await create({ name: 'Private draft secret' })).body.item;
        await db.collection('items').updateOne({ _id: new ObjectId(visible.id) }, { $set: {
            email: owner.email, password: 'password-secret', token: 'token-secret', address: 'street-secret', pickupLocation: 'pickup-secret'
        } });
        const response = await publicGet(visible).expect(200);
        assert.equal(response.headers['cache-control'], 'no-store');
        for (const value of [owner.id, owner.email, plan.id, 'password-secret', 'token-secret', 'street-secret', 'pickup-secret', 'version']) assert.ok(!JSON.stringify(response.body).includes(value));
        await publicGet(hidden).expect(404);
        assert.equal((await request(app).get('/api/gifts')).body.length, 16);
        assert.equal((await request(app).get('/api/search')).body.length, 16);
        assert.equal((await request(app).get('/api/search').query({ name: hidden.name })).body.length, 0);
        await request(app).get('/api/gifts/' + hidden.id).expect(404);
    });
    it('rejects stale concurrent actions rather than silently overwriting a newer state', async function () {
        const item = (await create({ publish: true })).body.item;
        const results = await Promise.all([action(item, 'unlist'), action(item, 'clear')]);
        assert.deepEqual(results.map(result => result.status).sort(), [200, 409]);
        assert.equal((await list()).body.items[0].version, 2);
    });
    it('serializes competing item creation and deadline edits so both cannot commit an invalid range', async function () {
        const results = await Promise.all([create({ availableUntil: day(15), publish: true }), updatePlan({ moveOutDeadline: day(10) })]);
        assert.ok(!results.every(result => [200, 201].includes(result.status)));
        assert.ok(results.every(result => [200, 201, 400, 409].includes(result.status)));
        const current = (await list()).body;
        assert.ok(current.items.every(item => item.effectiveAvailableUntil <= current.plan.moveOutDeadline));
    });
    it('persists edits on reload and keeps different concurrent item edits intact', async function () {
        const a = (await create({ name: 'Chair' })).body.item; const b = (await create({ name: 'Lamp' })).body.item;
        const results = await Promise.all([edit(a, { name: 'Three chairs' }), edit(b, { category: 'Reading corner' })]);
        assert.deepEqual(results.map(result => result.status), [200, 200]);
        const fresh = createApp({ connectToDatabase: async () => db, logger: pino({ level: 'silent' }) });
        const response = await request(fresh).get(root(plan.id)).set('Cookie', owner.cookie).expect(200);
        assert.equal(response.body.items[0].name, 'Three chairs'); assert.equal(response.body.items[1].category, 'Reading corner');
        assert.equal(await db.collection('items').countDocuments(), 2);
    });
});
