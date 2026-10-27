const assert = require('node:assert/strict');
const request = require('supertest');
const pino = require('pino');
const { ObjectId } = require('mongodb');
const createApp = require('../app');
const { createIsolatedMongo } = require('./helpers/isolated-mongo');
const { prepareDatabaseIndexes } = require('../services/database-indexes');
const day = n => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
describe('region-first discovery on verified disposable MongoDB', function () {
    this.timeout(180000);
    let isolated, db, app, parent;
    const get = values => request(app).get('/api/items').query(Object.assign({ stateId: '06', metroId: '41860' }, values));
    const item = overrides => Object.assign({ _id: new ObjectId(), planId: parent._id, ownerId: parent.ownerId, name: 'Reading seat',
        description: 'A useful household item', category: 'Old category', categoryId: 'living-room', itemTypeId: 'sofa', condition: 'good',
        status: 'available', publishedAt: new Date('2026-01-01T12:00:00Z'), availableFrom: null, availableUntil: null }, overrides);
    before(async function () { isolated = await createIsolatedMongo(); db = isolated.db; await prepareDatabaseIndexes(db); });
    after(async function () { if (isolated) await isolated.close(); });
    beforeEach(async function () {
        for (const name of ['items', 'moveOutPlans', 'pickupRequests']) await db.collection(name).deleteMany({});
        parent = { _id: new ObjectId(), ownerId: new ObjectId(), stateId: '06', metroId: '41860', status: 'active', city: 'Oakland', neighborhood: 'Temescal', pickupTimeZone: 'UTC', moveOutDeadline: day(30) };
        await db.collection('moveOutPlans').insertOne(parent);
        app = createApp({ connectToDatabase: async () => db, logger: pino({ level: 'silent' }) });
    });
    it('rejects unscoped browsing before connecting rather than fetching a global feed', async function () {
        let connections = 0;
        const isolatedApp = createApp({ connectToDatabase: async () => { connections++; throw new Error('Must not connect'); }, logger: pino({ level: 'silent' }) });
        for (const suffix of ['', '?city=Oakland', '?stateId=06', '?metroId=41860']) {
            const result = await request(isolatedApp).get('/api/items' + suffix).expect(400);
            assert.equal(result.body.error.code, 'REGION_REQUIRED');
        }
        assert.equal(connections, 0);
    });
    it('filters canonical plan regions on the server without copying region labels onto items', async function () {
        const elsewhere = Object.assign({}, parent, { _id: new ObjectId(), metroId: '31080', city: 'Oakland' });
        const legacy = Object.assign({}, parent, { _id: new ObjectId() }); delete legacy.stateId; delete legacy.metroId;
        await db.collection('moveOutPlans').insertMany([elsewhere, legacy]);
        const rows = [item(), item({ planId: elsewhere._id }), item({ planId: legacy._id })]; await db.collection('items').insertMany(rows);
        const result = await get().expect(200); assert.equal(result.body.total, 1);
        assert.deepEqual(result.body.items.map(row => row.id), [rows[0]._id.toString()]);
        assert.equal(result.body.items[0].metroId, '41860'); assert.equal(result.body.items[0].city, 'Oakland');
        await request(app).get('/api/items/' + rows[2]._id).expect(200); // Legacy direct links remain usable.
        await db.collection('moveOutPlans').updateOne({ _id: parent._id }, { $set: { metroId: '31080' } });
        assert.equal((await get().expect(200)).body.total, 0);
        assert.equal((await get({ metroId: '31080' }).expect(200)).body.total, 2);
        assert.equal((await db.collection('items').findOne({ _id: rows[0]._id })).metroId, undefined);
    });
    it('uses one cross-state metro inventory rather than fragmenting it by selected state', async function () {
        await db.collection('moveOutPlans').updateOne({ _id: parent._id }, { $set: { stateId: '41', metroId: '38900' } });
        const otherState = Object.assign({}, parent, { _id: new ObjectId(), stateId: '53', metroId: '38900' });
        await db.collection('moveOutPlans').insertOne(otherState); await db.collection('items').insertMany([item(), item({ planId: otherState._id })]);
        for (const stateId of ['41', '53']) assert.equal((await get({ stateId, metroId: '38900' }).expect(200)).body.total, 2);
        await get({ stateId: '06', metroId: '38900' }).expect(400);
    });
    it('discovers new cross-state metros through every member with exact combined-filter counts and private DTOs', async function () {
        for (const [metroId, states] of [['37980', ['42', '34', '10', '24']], ['28140', ['29', '20']], ['17140', ['39', '21', '18']]]) {
            const original = parent;
            const plans = states.map(stateId => Object.assign({}, original, { _id: new ObjectId(), stateId, metroId }));
            await db.collection('moveOutPlans').insertMany(plans);
            await db.collection('items').insertMany(plans.map(plan => item({ planId: plan._id })));
            for (const stateId of states) {
                const body = (await get({ stateId, metroId, q: 'couch', categoryId: 'living-room', itemTypeId: 'sofa', condition: 'good', limit: '1' }).expect(200)).body;
                assert.equal(body.total, states.length); assert.equal(body.items.length, 1); assert.equal(body.page.hasMore, true);
                assert.equal(body.items[0].metroId, metroId); assert.ok(states.includes(body.items[0].stateId));
                for (const field of ['ownerId', 'accountId', 'planId', 'email']) assert.equal(body.items[0][field], undefined);
            }
        }
        assert.deepEqual(await db.collection('moveOutPlans').findOne({ _id: parent._id }), parent);
        assert.equal((await get({ stateId: '15', metroId: '46520' }).expect(200)).body.total, 0);
        await get({ stateId: '06', metroId: '37980' }).expect(400);
    });
    it('combines category, type, condition, literal text and explicit sofa/couch synonyms', async function () {
        await db.collection('items').insertMany([item(), item({ name: 'Office table', categoryId: 'office-lighting', itemTypeId: 'desk', condition: 'fair' }),
            item({ name: 'Couch for reading', categoryId: null, itemTypeId: null }), item({ name: 'Box [kitchen]', description: '', categoryId: null, itemTypeId: null })]);
        assert.equal((await get({ q: 'couch', categoryId: 'living-room', itemTypeId: 'sofa', condition: 'good' }).expect(200)).body.total, 1);
        assert.equal((await get({ q: 'SOFA' }).expect(200)).body.total, 2);
        assert.equal((await get({ q: 'desk' }).expect(200)).body.total, 1);
        assert.equal((await get({ q: '[kitchen]' }).expect(200)).body.total, 1);
        assert.equal((await get({ q: '.*' }).expect(200)).body.total, 0);
        assert.equal((await get({ categoryId: 'bedroom', itemTypeId: 'mattress' }).expect(200)).body.total, 0);
    });
    it('counts the same eligible set as pages, excluding reservations and every unavailable lifecycle state', async function () {
        const available = item(), reserved = item();
        await db.collection('items').insertMany([available, reserved, item({ status: 'draft' }), item({ status: 'unlisted' }), item({ status: 'cleared' }),
            item({ status: 'expired' }), item({ availableUntil: day(-1) }), item({ ownerId: new ObjectId() }), item({ publishedAt: null })]);
        await db.collection('pickupRequests').insertOne({ itemId: reserved._id, status: 'accepted' });
        const result = await get({ limit: '1' }).expect(200);
        assert.equal(result.body.total, 1); assert.equal(result.body.items[0].id, available._id.toString()); assert.equal(result.body.page.hasMore, false);
        await request(app).get('/api/items/' + reserved._id).expect(200);
        await db.collection('pickupRequests').updateOne({ itemId: reserved._id }, { $set: { status: 'cancelled' } });
        assert.equal((await get().expect(200)).body.total, 2);
        for (const change of [{ status: 'completed' }, { status: 'active', pickupTimeZone: null }, { pickupTimeZone: 'UTC', moveOutDeadline: day(-1) }]) {
            await db.collection('moveOutPlans').updateOne({ _id: parent._id }, { $set: change }); assert.equal((await get().expect(200)).body.total, 0);
        }
    });
    it('keeps count semantics across all/now/later/date pickup filters', async function () {
        await db.collection('items').insertMany([item(), item({ availableFrom: day(5) })]);
        assert.equal((await get().expect(200)).body.total, 2);
        assert.equal((await get({ availability: 'now' }).expect(200)).body.total, 1);
        assert.equal((await get({ availability: 'later' }).expect(200)).body.total, 1);
        assert.equal((await get({ availability: 'date', date: day(6) }).expect(200)).body.total, 2);
    });
    ['newest', 'deadline'].forEach(sort => it('keeps ' + sort + ' pages stable and totals independent of the continuation boundary', async function () {
        const rows = Array.from({ length: 5 }, () => item());
        await db.collection('items').insertMany(rows.concat([item({ categoryId: 'office-lighting', itemTypeId: 'desk' })]));
        const query = { sort, limit: '2', q: 'couch', categoryId: 'living-room', itemTypeId: 'sofa', condition: 'good' };
        const seen = []; let cursor;
        do {
            const page = (await get(Object.assign({}, query, cursor ? { cursor } : {})).expect(200)).body;
            assert.equal(page.total, 5); seen.push(...page.items.map(row => row.id)); cursor = page.page.nextCursor;
            if (cursor) {
                await get(Object.assign({}, query, { cursor, metroId: '31080' })).expect(400);
                await get(Object.assign({}, query, { cursor, condition: 'fair' })).expect(400);
            }
        } while (cursor);
        const expected = rows.map(row => row._id.toString()).sort(); if (sort === 'newest') expected.reverse();
        assert.deepEqual(seen, expected); assert.equal(new Set(seen).size, 5);
    }));
    it('scopes normalized city/neighborhood selectors to the same region and eligible inventory', async function () {
        const distant = Object.assign({}, parent, { _id: new ObjectId(), metroId: '31080', city: 'Distant city' });
        await db.collection('moveOutPlans').insertOne(distant); await db.collection('items').insertMany([item(), item({ planId: distant._id })]);
        const result = await request(app).get('/api/items/locations?stateId=06&metroId=41860').expect(200);
        assert.deepEqual(result.body.locations, [{ city: 'Oakland', neighborhoods: ['Temescal'] }]);
    });
    it('rejects malformed, unsupported, incomplete or mismatched region/classification parameters', async function () {
        for (const query of [{ stateId: 'CA' }, { metroId: 'unknown' }, { metroId: '' }, { stateId: '02', metroId: '41860' },
            { categoryId: 'unknown' }, { categoryId: 'living-room', itemTypeId: 'desk' }, { itemTypeId: 'sofa' }, { condition: 'new' }]) await get(query).expect(400);
        await request(app).get('/api/items?stateId[$ne]=06&metroId=41860').expect(400);
        await request(app).get('/api/items?stateId=06&stateId=53&metroId=41860').expect(400);
    });
    it('does not treat malformed stored region arrays or mismatched state membership as canonical assignments', async function () {
        for (const values of [{ metroId: ['41860'] }, { stateId: ['06'] }, { stateId: '53' }, { pickupTimeZone: ['UTC'] }]) {
            const malformed = Object.assign({}, parent, values, { _id: new ObjectId() });
            await db.collection('moveOutPlans').insertOne(malformed); await db.collection('items').insertOne(item({ planId: malformed._id }));
        }
        assert.equal((await get().expect(200)).body.total, 0);
    });
});
