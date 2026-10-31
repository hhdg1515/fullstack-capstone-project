/* jshint loopfunc: true */
// Each test closes over a fresh block-scoped const change/row.
const assert = require('node:assert/strict');
const { ObjectId, MongoClient } = require('mongodb');
const { deriveDeadline, resolveDeadline, rulesVersion } = require('../services/listing-deadline');
const { resolveListingContext } = require('../services/listing-context');
const { listingTransaction } = require('../services/listing-transaction');
const { createIsolatedMongo } = require('./helpers/isolated-mongo');
const owner = new ObjectId(), other = new ObjectId(), now = new Date('2027-03-14T12:00:00Z');
function independent(extra = {}) {
    return Object.assign({ _id: new ObjectId(), ownerId: owner, listingSchemaVersion: 2, version: 1, coordinationRevision: 0,
        stateId: '06', metroId: '31080', city: '', neighborhood: '', pickupTimeZone: 'America/Los_Angeles',
        availableUntil: '2027-03-14', availableFrom: null, timeZoneConfirmedAt: new Date('2027-01-01'), status: 'available',
        name: 'Chair', description: 'A household chair.', categoryId: 'office-lighting', itemTypeId: 'office-chair', publishedAt: new Date('2027-01-01') },
    deriveDeadline('2027-03-14', 'America/Los_Angeles'), extra);
}
describe('versioned listing context and local deadlines (internal only)', function () {
    for (const row of [
        ['2027-11-12', 'America/Los_Angeles', '2027-11-13T08:00:00Z'],
        ['2027-03-14', 'America/Los_Angeles', '2027-03-15T07:00:00Z'],
        ['2027-11-07', 'America/Los_Angeles', '2027-11-08T08:00:00Z'],
        ['2027-03-14', 'America/New_York', '2027-03-15T04:00:00Z'],
        ['2027-11-07', 'America/New_York', '2027-11-08T05:00:00Z'],
        ['2027-11-12', 'America/Phoenix', '2027-11-13T07:00:00Z'],
        ['2027-11-12', 'Asia/Kathmandu', '2027-11-12T18:15:00Z'],
        ['2018-11-03', 'America/Sao_Paulo', '2018-11-04T03:00:00Z'],
        ['2011-12-29', 'Pacific/Apia', '2011-12-30T10:00:00Z']
    ]) it('derives ' + row[0] + ' in ' + row[1], function () { assert.equal(deriveDeadline(row[0], row[1]).expiresAt.toISOString(), new Date(row[2]).toISOString()); });
    it('uses the exact exclusive expiration boundary and preserves future availability', function () {
        const item = independent();
        for (const offset of [-1, 0, 1]) assert.equal(resolveDeadline(item, new Date(item.expiresAt.getTime() + offset)).expired, offset >= 0);
        assert.equal(resolveDeadline(independent({ availableFrom: '2027-03-14' }), new Date('2027-03-14T07:59:59Z')).pickupAvailable, false);
        assert.equal(resolveDeadline(independent({ availableFrom: '2027-03-14' }), now).pickupAvailable, true);
    });
    for (const date of ['not-a-date', '2027-02-30', '2011-12-30']) it('rejects nonexistent date ' + date, function () {
        assert.throws(() => deriveDeadline(date, date === '2011-12-30' ? 'Pacific/Apia' : 'UTC'));
    });
    for (const change of [{ pickupTimeZone: 'Bad/Zone' }, { timeZoneConfirmedAt: null }, { timeZoneConfirmedAt: new Date('2030-01-01') },
        { deadlinePolicyVersion: 1 }, { timeZoneRulesVersion: 'different-rules' }, { expiresAt: new Date('2027-03-15T08:00:00Z') },
        { expiresAt: '2027-03-15T07:00:00Z' }, { deadlineTimeZone: 'UTC' }, { availableFrom: '2027-03-15' }]) {
        it('refuses corrupt deadline metadata ' + Object.keys(change)[0] + JSON.stringify(change).slice(0, 50), function () {
            assert.throws(() => resolveDeadline(independent(change), now));
        });
    }
    it('resolves a complete v2 context without a plan but never enables public v2', function () {
        const ctx = resolveListingContext(independent(), null, owner, now);
        assert.equal(ctx.modelVersion, 2); assert.equal(ctx.fence, 'item'); assert.equal(ctx.publicEnabled, false);
        assert.equal(ctx.policyEligible, true); assert.equal(ctx.timeZoneRulesVersion, rulesVersion);
    });
    for (const change of [{ listingSchemaVersion: 1 }, { listingSchemaVersion: null }, { listingSchemaVersion: 3 }, { metroId: 'unknown' },
        { stateId: '01' }, { planId: new ObjectId() }, { ownerId: other }, { coordinationRevision: -1 }, { availableUntil: null }]) {
        it('rejects invalid model or identity ' + Object.keys(change)[0] + JSON.stringify(change).slice(0, 50), function () {
            assert.throws(() => resolveListingContext(independent(change), { moveOutDeadline: '2099-01-01' }, owner, now));
        });
    }
    it('preserves legacy inheritance and UTC expiration, denying invalid parents and partial model metadata', function () {
        const plan = { _id: new ObjectId(), ownerId: owner, moveOutDeadline: '2027-03-14', city: 'Oakland', pickupTimeZone: 'America/Los_Angeles' };
        const item = { _id: new ObjectId(), ownerId: owner, planId: plan._id, status: 'available' };
        assert.equal(resolveListingContext(item, plan, owner, new Date('2027-03-15T00:00:00Z')).expired, true);
        assert.equal(resolveListingContext(item, plan, owner, now).region.city, 'Oakland');
        for (const parent of [null, Object.assign({}, plan, { ownerId: other }), Object.assign({}, plan, { _id: new ObjectId() })]) assert.throws(() => resolveListingContext(item, parent, owner, now));
        assert.throws(() => resolveListingContext(Object.assign({}, item, { expiresAt: new Date() }), plan, owner, now));
    });
});
describe('listing fences on verified disposable native MongoDB', function () {
    this.timeout(180000); let local, db, second, remoteDb;
    before(async function () {
        local = await createIsolatedMongo(); db = local.db;
        second = new MongoClient(local.mongoUrl); await second.connect(); remoteDb = second.db(local.dbName); remoteDb.client = second;
    });
    after(async function () { if (second) await second.close(); if (local) await local.close(); });
    beforeEach(async function () { await db.collection('items').deleteMany({}); await db.collection('moveOutPlans').deleteMany({}); });
    it('stores server-derived expiry and serializes independent instances without lost increments', async function () {
        const item = independent({ availableUntil: '2099-01-01', timeZoneConfirmedAt: new Date('2020-01-01') });
        Object.assign(item, deriveDeadline(item.availableUntil, item.pickupTimeZone)); await db.collection('items').insertOne(item);
        await Promise.all(Array.from({ length: 6 }, (_, i) => listingTransaction(i % 2 ? db : remoteDb, owner, item._id, 1,
            (ctx, session) => (i % 2 ? db : remoteDb).collection('items').updateOne({ _id: ctx.item._id }, { $inc: { counter: 1 } }, { session }))));
        const saved = await db.collection('items').findOne({ _id: item._id });
        assert.equal(saved.counter, 6); assert.equal(saved.coordinationRevision, 6); assert.equal(saved.version, 1);
        assert.equal(await db.collection('moveOutPlans').countDocuments(), 0);
    });
    it('retains plan-then-item lock order and shares conflicts with existing legacy plan writers', async function () {
        const plan = { _id: new ObjectId(), ownerId: owner, moveOutDeadline: '2099-01-01' };
        const item = { _id: new ObjectId(), ownerId: owner, planId: plan._id, version: 1, status: 'draft' };
        await db.collection('moveOutPlans').insertOne(plan); await db.collection('items').insertOne(item);
        const { planTransaction } = require('../services/inventory');
        await Promise.all([
            listingTransaction(db, owner, item._id, 1, async (ctx, session) => {
                assert.equal(ctx.plan.inventoryRevision >= 1, true);
                assert.equal((await db.collection('items').findOne({ _id: item._id }, { session })).coordinationRevision >= 1, true);
                await db.collection('items').updateOne({ _id: item._id }, { $inc: { counter: 1 } }, { session });
            }),
            planTransaction(remoteDb, owner, plan._id.toString(), (parent, session) => remoteDb.collection('items').updateOne({ _id: item._id }, { $inc: { counter: 1 } }, { session }))
        ]);
        assert.equal((await db.collection('items').findOne({ _id: item._id })).counter, 2);
        assert.equal((await db.collection('moveOutPlans').findOne({ _id: plan._id })).inventoryRevision, 2);
    });
    it('allows only one conflicting content/withdrawal winner under optimistic versions', async function () {
        const item = independent({ availableUntil: '2099-01-01', timeZoneConfirmedAt: new Date('2020-01-01') });
        Object.assign(item, deriveDeadline(item.availableUntil, item.pickupTimeZone)); await db.collection('items').insertOne(item);
        const outcomes = await Promise.allSettled([db, remoteDb].map((client, index) => listingTransaction(client, owner, item._id, 1,
            (ctx, session) => client.collection('items').updateOne({ _id: ctx.item._id, status: 'available' },
                { $set: { status: index ? 'unlisted' : 'cleared' }, $inc: { version: 1 } }, { session }))));
        assert.equal(outcomes.filter(row => row.status === 'fulfilled').length, 1);
        assert.equal(outcomes.filter(row => row.status === 'rejected').length, 1);
        const saved = await db.collection('items').findOne({ _id: item._id });
        assert.equal(saved.version, 2); assert.equal(saved.coordinationRevision, 1);
    });
    it('never upserts missing/foreign items and rolls back its fence on callback failure', async function () {
        await assert.rejects(listingTransaction(db, owner, new ObjectId(), 1, () => {}));
        const plan = { _id: new ObjectId(), ownerId: owner, moveOutDeadline: '2099-01-01' };
        const item = { _id: new ObjectId(), ownerId: owner, planId: plan._id, version: 2 };
        await db.collection('moveOutPlans').insertOne(plan); await db.collection('items').insertOne(item);
        await assert.rejects(listingTransaction(db, other, item._id, 2, () => {}));
        await assert.rejects(listingTransaction(db, owner, item._id, 1, () => {}));
        await assert.rejects(listingTransaction(db, owner, item._id, 2, () => { throw Error('synthetic rollback'); }));
        assert.deepEqual(await db.collection('items').findOne({ _id: item._id }), item);
        assert.deepEqual(await db.collection('moveOutPlans').findOne({ _id: plan._id }), plan);
    });
});
