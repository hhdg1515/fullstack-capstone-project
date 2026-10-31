/* jshint loopfunc: true */
// Each generated case captures its own block-scoped field/value.
const assert = require('node:assert/strict');
const request = require('supertest');
const pino = require('pino');
const { ObjectId, MongoClient } = require('mongodb');
const createApp = require('../app');
const { createIsolatedMongo } = require('./helpers/isolated-mongo');
const { prepareDatabaseIndexes, inspectDatabaseIndexes, assertDatabaseIndexes } = require('../services/database-indexes');
const { initializeApplication } = require('../runtime');
const { readServerConfig } = require('../config');
const { tokenHash } = require('../services/identity');
const { feedPipeline, feedIndex } = require('../services/owner-listings');
const { resolveListingContext } = require('../services/listing-context');
const logger = pino({ level: 'silent' }), origin = 'http://localhost:3000';
const write = call => call.set('Origin', origin).set('X-CSRF-Protection', '1');
describe('independent private owner listings on verified disposable MongoDB', function () {
    this.timeout(180000); let local, db, client, app, owner, other, commands;
    const create = (input = { name: 'Chair' }, user = owner) => write(request(app).post('/api/items')).set('Cookie', user.cookie).send(input);
    const patch = (item, input, user = owner) => write(request(app).patch('/api/items/' + item.id)).set('Cookie', user.cookie).send(Object.assign({ version: item.version }, input));
    const act = (item, action, user = owner) => write(request(app).post('/api/items/' + item.id + '/actions')).set('Cookie', user.cookie).send({ version: item.version, action });
    const detail = (item, user = owner) => request(app).get('/api/me/items/' + item.id).set('Cookie', user.cookie);
    const list = (query = '', user = owner) => request(app).get('/api/me/items' + query).set('Cookie', user.cookie);
    const row = item => db.collection('items').findOne({ _id: new ObjectId(item.id) });
    async function account(email) {
        const res = await write(request(app).post('/api/auth/register')).send({ email, firstName: 'Synthetic', lastName: 'Owner', password: 'isolated-listing-password' }).expect(201);
        return { id: res.body.user.id, cookie: res.headers['set-cookie'][0].split(';')[0] };
    }
    before(async function () {
        local = await createIsolatedMongo(); await prepareDatabaseIndexes(local.db);
        client = new MongoClient(local.mongoUrl, { directConnection: true, monitorCommands: true }); await client.connect();
        db = client.db(local.dbName); db.client = client; commands = [];
        client.on('commandStarted', event => commands.push(event.commandName));
        app = createApp({ connectToDatabase: async () => db, logger, ownerListingsEnabled: true, authLimit: 1000 });
        owner = await account('owner-listings@example.test'); other = await account('other-listings@example.test');
    });
    beforeEach(async function () {
        await db.collection('items').deleteMany({}); await db.collection('moveOutPlans').deleteMany({});
        await db.collection('pickupRequests').deleteMany({}); commands.length = 0;
        // A fresh limiter per case; production retains its original bounded instance.
        app = createApp({ connectToDatabase: async () => db, logger, ownerListingsEnabled: true });
    });
    afterEach(function () { assert.deepEqual(commands.filter(name => /^(create|createIndexes|drop|dropIndexes|dropDatabase|collMod)$/.test(name)), []); });
    after(async function () { if (client) await client.close(); if (local) await local.close(); });
    it('creates a name-only draft with server identities, counters and no invented context or hidden plan', async function () {
        const item = (await create().expect(201)).body.item, saved = await row(item);
        assert.equal(saved.listingSchemaVersion, 2); assert.ok(saved.ownerId.equals(new ObjectId(owner.id)));
        assert.equal(saved.version, 1); assert.equal(saved.coordinationRevision, 0); assert.equal(saved.imageRevision, 0);
        assert.equal(saved.status, 'draft'); assert.equal(saved.pickupTimeZone, null); assert.equal(saved.availableUntil, null);
        for (const field of ['planId', 'expiresAt', 'deadlinePolicyVersion', 'timeZoneRulesVersion']) assert.ok(!(field in saved));
        assert.equal(await db.collection('moveOutPlans').countDocuments(), 0);
        assert.equal(item.capabilities.editDraft, true); assert.equal(item.pickup.datePolicy, 'pickup-local');
        assert.equal((await detail(item).expect(200)).headers['cache-control'], 'no-store');
        assert.throws(() => resolveListingContext(saved, null, saved.ownerId, new Date()));
    });
    it('keeps locations/deadlines independent and edits without clearing unrelated fields', async function () {
        const a = (await create({ name: 'Chair', stateId: '06', metroId: '31080', city: 'Los Angeles', description: 'Chair description' }).expect(201)).body.item;
        const b = (await create({ name: 'Desk', stateId: '36', metroId: '35620' }).expect(201)).body.item;
        const edited = (await patch(a, { neighborhood: 'Westside' }).expect(200)).body.item;
        assert.equal(edited.description, 'Chair description'); assert.equal(edited.location.city, 'Los Angeles');
        assert.equal((await detail(b).expect(200)).body.item.location.stateId, '36');
        assert.equal(await db.collection('moveOutPlans').countDocuments(), 0);
        assert.equal((await row(a)).coordinationRevision, 1); assert.equal((await row(a)).version, 2);
    });
    it('derives the full local deadline tuple only after explicit confirmation', async function () {
        let item = (await create({ name: 'Chair', pickupTimeZone: 'America/Los_Angeles', availableUntil: '2027-03-14' }).expect(201)).body.item;
        assert.equal((await row(item)).expiresAt, undefined);
        await patch(item, { pickupTimeZoneConfirmed: true }).expect(400);
        item = (await patch(item, { pickupTimeZone: 'America/Los_Angeles', pickupTimeZoneConfirmed: true }).expect(200)).body.item;
        assert.equal(item.pickup.expiresAt, '2027-03-15T07:00:00.000Z'); assert.equal(item.pickup.timeZoneConfirmed, true);
        const saved = await row(item); assert.equal(saved.deadlinePolicyVersion, 2); assert.ok(saved.timeZoneConfirmedAt instanceof Date);
        item = (await patch(item, { availableUntil: '2027-11-07' }).expect(200)).body.item;
        assert.equal(item.pickup.expiresAt, '2027-11-08T08:00:00.000Z');
        assert.equal((await row(item)).timeZoneConfirmedAt.getTime(), saved.timeZoneConfirmedAt.getTime());
    });
    it('invalidates confirmation on location/zone changes and supports explicit reconfirmation/clearing', async function () {
        let item = (await create({ name: 'Chair', pickupTimeZone: 'UTC', pickupTimeZoneConfirmed: true, availableUntil: '2027-03-14' }).expect(201)).body.item;
        item = (await patch(item, { stateId: '06' }).expect(200)).body.item;
        assert.equal(item.pickup.timeZoneConfirmed, false); assert.equal(item.pickup.expiresAt, null);
        item = (await patch(item, { pickupTimeZone: 'America/New_York', pickupTimeZoneConfirmed: true }).expect(200)).body.item;
        assert.equal(item.pickup.expiresAt, '2027-03-15T04:00:00.000Z');
        item = (await patch(item, { pickupTimeZoneConfirmed: false }).expect(200)).body.item;
        assert.equal(item.pickup.expiresAt, null); assert.ok(!('expiresAt' in await row(item)));
    });
    it('checks changed starts in the selected local timezone without inventing a zone', async function () {
        const item = (await create().expect(201)).body.item;
        await patch(item, { availableFrom: '2000-01-01', pickupTimeZone: 'America/Los_Angeles' }).expect(400);
        const partial = (await patch(item, { availableFrom: '2000-01-01' }).expect(200)).body.item;
        await patch(partial, { pickupTimeZone: 'UTC' }).expect(400);
    });
    for (const input of [ { name: '' }, { name: '<script>' }, { name: 'x'.repeat(161) }, { description: [] }, { stateId: '00' },
        { metroId: '31080' }, { stateId: '36', metroId: '31080' }, { itemTypeId: 'microwave' },
        { categoryId: 'dining-kitchen', itemTypeId: 'office-chair' }, { condition: 'invented' }, { customItemType: 'unknown' },
        { pickupTimeZone: 'Bad/Zone' }, { pickupTimeZone: '+02:00' }, { pickupTimeZoneConfirmed: true },
        { availableUntil: '2027-02-30' }, { availableFrom: '2027-03-15', availableUntil: '2027-03-14' },
        { pickupTimeZone: 'Pacific/Apia', availableUntil: '2011-12-30' }, { city: 'private@example.test' } ]) {
        it('rejects malformed optional draft context: ' + JSON.stringify(input), async function () {
            await create(Object.assign({ name: 'Chair' }, input)).expect(400);
            assert.equal(await db.collection('items').countDocuments(), 0);
        });
    }
    it('preserves classification editing and sanitized custom Other', async function () {
        const taxonomy = require('../data/item-taxonomy.json'), category = taxonomy.categories.find(c => c.itemTypes.some(t => t.custom)), type = category.itemTypes.find(t => t.custom);
        let item = (await create({ name: 'Household item', categoryId: category.id, itemTypeId: type.id, customItemType: '  Storage   accessory  ' }).expect(201)).body.item;
        assert.equal(item.classification.customItemType, 'Storage accessory');
        item = (await patch(item, { categoryId: 'dining-kitchen', itemTypeId: 'microwave' }).expect(200)).body.item;
        assert.equal(item.classification.itemType.id, 'microwave'); assert.equal(item.classification.customItemType, undefined);
    });
    for (const field of ['ownerId', 'listingSchemaVersion', 'coordinationRevision', 'imageRevision', 'deadlinePolicyVersion', 'expiresAt', 'deadlineTimeZone', 'timeZoneRulesVersion', 'timeZoneConfirmedAt', 'planId', 'publishedAt', 'storageBinding', 'photoId', 'status', 'confirmPickupTimeZone']) {
        it('rejects client authority field ' + field + ' on create and patch', async function () {
            await create({ name: 'Chair', [field]: 'forged' }).expect(400);
            const item = (await create().expect(201)).body.item, saved = await row(item);
            await patch(item, { [field]: 'forged' }).expect(400); assert.deepEqual(await row(item), saved);
        });
    }
    it('requires authentication and exact Origin/CSRF on new writes', async function () {
        await request(app).get('/api/me/items').expect(401);
        await write(request(app).post('/api/items')).send({ name: 'Chair' }).expect(401);
        await request(app).post('/api/items').set('Cookie', owner.cookie).send({ name: 'Chair' }).expect(403);
        await request(app).post('/api/items').set('Cookie', owner.cookie).set('Origin', 'https://foreign.example.test').set('X-CSRF-Protection', '1').send({ name: 'Chair' }).expect(403);
        await create({ name: 'x'.repeat(34000) }).expect(413);
    });
    it('denies foreign and missing detail/mutations without revealing item data', async function () {
        const item = (await create().expect(201)).body.item, saved = await row(item);
        await detail(item, other).expect(404); await patch(item, { name: 'Stolen' }, other).expect(404); await act(item, 'publish', other).expect(404);
        await detail({ id: 'invalid' }).expect(404); await detail({ id: new ObjectId().toHexString() }).expect(404);
        assert.deepEqual(await row(item), saved); assert.deepEqual((await list('', other).expect(200)).body.items, []);
    });
    it('rejects stale and competing edits without lost updates or fence regressions', async function () {
        const item = (await create().expect(201)).body.item;
        const results = await Promise.all([patch(item, { name: 'One' }), patch(item, { name: 'Two' })]);
        assert.deepEqual(results.map(r => r.status).sort(), [200, 409]);
        const saved = await row(item); assert.equal(saved.version, 2); assert.equal(saved.coordinationRevision, 1);
        await patch(item, { description: 'Stale' }).expect(409); assert.deepEqual(await row(item), saved);
    });
    it('rejects all publication/withdrawal actions atomically, never creating a public row', async function () {
        await create({ name: 'Chair', publish: true }).expect(409); assert.equal(await db.collection('items').countDocuments(), 0);
        const item = (await create().expect(201)).body.item, saved = await row(item);
        assert.equal((await patch(item, { publish: true, name: 'Changed' }).expect(409)).body.error.code, 'V2_PUBLICATION_DISABLED');
        for (const action of ['publish', 'withdraw', 'unlist', 'clear', 'reopen']) await act(item, action).expect(409);
        assert.deepEqual(await row(item), saved);
        await act(Object.assign({}, item, { version: 9 }), 'publish').expect(409);
    });
    async function legacy() {
        const plan = (await write(request(app).post('/api/move-out-plans')).set('Cookie', owner.cookie).send({ city: 'Los Angeles', neighborhood: 'Westside', moveOutDeadline: '2027-11-12', stateId: '06', metroId: '31080' }).expect(201)).body.plan;
        const item = (await write(request(app).post('/api/move-out-plans/' + plan.id + '/items')).set('Cookie', owner.cookie).send({ name: 'Legacy Chair' }).expect(201)).body.item;
        return { plan, item };
    }
    it('returns a model-neutral mixed owner inventory and keeps legacy writes on their original route', async function () {
        const v1 = await legacy(), v2 = (await create().expect(201)).body.item;
        const result = (await list().expect(200)).body; assert.equal(result.items.length, 2);
        const one = result.items.find(i => i.id === v1.item.id); assert.equal(one.pickup.availableUntil, '2027-11-12'); assert.equal(one.capabilities.legacyEditor, true);
        assert.equal((await detail(v1.item).expect(200)).body.item.id, v1.item.id);
        assert.equal((await patch(v1.item, { name: 'Unsafe' }).expect(409)).body.error.code, 'LEGACY_ITEM_ROUTE_REQUIRED');
        await act(v1.item, 'publish').expect(409);
        await write(request(app).patch('/api/move-out-plans/' + v1.plan.id + '/items/' + v1.item.id)).set('Cookie', owner.cookie).send({ version: 1, name: 'Legacy edited' }).expect(200);
        for (const item of result.items.concat((await detail(v2).expect(200)).body.item)) {
            const serialized = JSON.stringify(item);
            for (const field of ['ownerId', 'planId', 'coordinationRevision', 'imageRevision', 'storageBinding', 'timeZoneRulesVersion', 'timeZoneConfirmedAt', 'passwordHash', 'ticket']) assert.ok(!serialized.includes('"' + field + '"'));
        }
    });
    it('paginates tied timestamps deterministically with owner/filter-bound cursors and no duplicates', async function () {
        const items = [];
        for (let i = 0; i < 5; i++) items.push((await create({ name: 'Item ' + i }).expect(201)).body.item);
        await db.collection('items').updateMany({}, { $set: { createdAt: new Date('2026-01-01') } });
        const seen = []; let cursor = null;
        do { const result = (await list('?limit=2' + (cursor ? '&cursor=' + cursor : '')).expect(200)).body;
            seen.push.apply(seen, result.items.map(i => i.id)); cursor = result.nextCursor;
        } while (cursor);
        assert.deepEqual(seen, items.map(i => i.id).sort().reverse()); assert.equal(new Set(seen).size, 5);
        const first = (await list('?limit=1').expect(200)).body;
        await list('?cursor=' + first.nextCursor, other).expect(400); await list('?status=draft&cursor=' + first.nextCursor).expect(400);
        for (const query of ['?cursor=bad', '?limit=51', '?limit=0', '?status=picked-up', '?ownerId=foreign', '?limit=2&limit=3']) await list(query).expect(400);
    });
    it('filters derived legacy UTC expiry and preserves v2 draft status regardless of its deadline', async function () {
        const v1 = await legacy(), v2 = (await create({ name: 'Old private draft', pickupTimeZone: 'UTC', pickupTimeZoneConfirmed: true, availableUntil: '2000-01-01' }).expect(201)).body.item;
        await db.collection('items').updateOne({ _id: new ObjectId(v1.item.id) }, { $set: { status: 'available', publishedAt: new Date('1999-01-01'), availableUntil: '2000-01-01' } });
        assert.deepEqual((await list('?status=expired').expect(200)).body.items.map(i => i.id), [v1.item.id]);
        assert.deepEqual((await list('?status=draft').expect(200)).body.items.map(i => i.id), [v2.id]);
        assert.deepEqual((await list('?status=available').expect(200)).body.items, []);
    });
    it('refuses malformed persisted draft metadata and corrupt published records, not repairing them on edit', async function () {
        const item = (await create().expect(201)).body.item, original = await row(item);
        for (const changes of [{ deadlinePolicyVersion: 2 }, { expiresAt: new Date() }, { timeZoneConfirmedAt: new Date('2099-01-01') }, { status: 'available' }, { planId: new ObjectId() }, { listingSchemaVersion: 99 }]) {
            await db.collection('items').updateOne({ _id: original._id }, { $set: changes }); const corrupt = await row(item);
            await detail(item).expect(409); await patch(item, { name: 'Repair?' }).expect(409); assert.deepEqual(await row(item), corrupt);
            await db.collection('items').replaceOne({ _id: original._id }, original);
        }
    });
    it('allows owner-only complete unlisted/expired v2 reads, never writes or public activation', async function () {
        const item = (await create({ name: 'Chair', description: 'A chair', categoryId: 'office-lighting', itemTypeId: 'office-chair', stateId: '06', metroId: '31080', pickupTimeZone: 'UTC', pickupTimeZoneConfirmed: true, availableUntil: '2027-11-12' }).expect(201)).body.item;
        for (const status of ['unlisted', 'expired']) {
            await db.collection('items').updateOne({ _id: new ObjectId(item.id) }, { $set: { status } });
            assert.equal((await detail(item).expect(200)).body.item.status, status); await detail(item, other).expect(404); await patch(item, { name: 'No' }).expect(409);
        }
    });
    it('keeps v2 out of public detail/discovery, existing image routes and pickup requests', async function () {
        const item = (await create().expect(201)).body.item;
        await request(app).get('/api/items/' + item.id).expect(404);
        assert.deepEqual((await request(app).get('/api/items?stateId=06&metroId=31080').expect(200)).body.items, []);
        await request(app).get('/api/items/' + item.id + '/edit-context').set('Cookie', owner.cookie).expect(404);
        const v1 = await legacy();
        const metadata = require('../services/item-image-policy').readImageMetadataConfig({ ITEM_IMAGE_METADATA_ENABLED: 'true', ITEM_IMAGE_STORAGE_TARGET: 'a'.repeat(64), ITEM_IMAGE_NAMESPACE: 'item-images-test-' + 'b'.repeat(32) });
        const photoApp = createApp({ connectToDatabase: async () => db, logger, imageMetadata: metadata });
        await request(photoApp).get('/api/move-out-plans/' + v1.plan.id + '/items/' + item.id + '/images').set('Cookie', owner.cookie).expect(404);
        await write(request(app).post('/api/pickup-requests')).set('Cookie', other.cookie).send({ itemId: item.id, localDateTime: '2027-11-10T12:00', timeZone: 'UTC' }).expect(409);
        assert.equal(await db.collection('pickupRequests').countDocuments(), 0);
    });
    it('rejects compromised legacy parents without leaking their location or rewriting references', async function () {
        const v1 = await legacy(); await db.collection('moveOutPlans').updateOne({ _id: new ObjectId(v1.plan.id) }, { $set: { ownerId: new ObjectId(other.id) } });
        await detail(v1.item).expect(409); await list().expect(409); await detail(v1.item, other).expect(404);
    });
    it('uses the explicit owner-feed index without a blocking sort', async function () {
        for (let i = 0; i < 3; i++) await create({ name: 'Item ' + i }).expect(201);
        const plan = await db.collection('items').aggregate(feedPipeline(new ObjectId(owner.id), { limit: 2, status: 'all', cursor: null }, false),
            { hint: feedIndex, collation: { locale: 'simple' } }).explain('executionStats');
        const serialized = JSON.stringify(plan); assert.ok(serialized.includes(feedIndex)); assert.ok(!serialized.includes('"stage":"SORT"'));
    });
    it('does not silently scan when the required feed index is missing', async function () {
        await db.collection('items').dropIndex(feedIndex); commands.length = 0;
        try { await list().expect(503); }
        finally { await db.collection('items').createIndex({ ownerId: 1, createdAt: -1, _id: -1 }, { name: feedIndex, collation: { locale: 'simple' } }); commands.length = 0; }
    });
    it('accepts equivalent differently named indexes but rejects an incompatible index at enabled startup', async function () {
        const config = { imageMetadata: null, ownerListingsEnabled: true };
        const options = { database: { connect: async () => db }, logger, appFactory: value => value };
        await db.collection('items').dropIndex(feedIndex); commands.length = 0;
        try {
            await db.collection('items').createIndex({ ownerId: 1, createdAt: -1, _id: -1 }, { name: 'equivalent_owner_feed', collation: { locale: 'simple' } }); commands.length = 0;
            await initializeApplication(config, options); await list().expect(200);
            await db.collection('items').dropIndex('equivalent_owner_feed');
            await db.collection('items').createIndex({ ownerId: 1, createdAt: -1, _id: -1 }, { name: feedIndex, sparse: true }); commands.length = 0;
            await assert.rejects(initializeApplication(config, options), /Database indexes are required/);
        } finally {
            for (const name of ['equivalent_owner_feed', feedIndex]) try { await db.collection('items').dropIndex(name); } catch (error) { if (error.code !== 27) throw error; }
            await db.collection('items').createIndex({ ownerId: 1, createdAt: -1, _id: -1 }, { name: feedIndex, collation: { locale: 'simple' } }); commands.length = 0;
        }
    });
    it('keeps existing photo-maintenance readiness independent of the new owner index', async function () {
        await db.collection('items').dropIndex(feedIndex); commands.length = 0;
        try {
            await assertDatabaseIndexes(db, { imageMetadataEnabled: true });
            await assert.rejects(assertDatabaseIndexes(db, { imageMetadataEnabled: true, ownerListingsEnabled: true }), /Database indexes are required/);
            assert.deepEqual(commands.filter(name => /^(create|createIndexes|drop|dropIndexes|collMod)$/.test(name)), []);
        } finally {
            await db.collection('items').createIndex({ ownerId: 1, createdAt: -1, _id: -1 }, { name: feedIndex, collation: { locale: 'simple' } }); commands.length = 0;
        }
    });
    it('keeps the owner API off by default and rejects malformed activation configuration', async function () {
        const disabled = createApp({ connectToDatabase: async () => db, logger });
        await request(disabled).get('/api/me/items').set('Cookie', owner.cookie).expect(503);
        await write(request(disabled).post('/api/items')).set('Cookie', owner.cookie).send({ name: 'Chair' }).expect(503);
        assert.throws(() => readServerConfig({ OWNER_LISTINGS_ENABLED: 'yes' }), /OWNER_LISTINGS_ENABLED/);
    });
    it('gates only the new startup index, retains old checks and never performs startup DDL', async function () {
        const operation = (await inspectDatabaseIndexes(db)).operations.find(o => o.index === feedIndex);
        await db.collection('items').dropIndex(feedIndex); commands.length = 0;
        const config = { imageMetadata: null, ownerListingsEnabled: false };
        const options = { database: { connect: async () => db }, logger, appFactory: value => value };
        try {
            assert.equal((await initializeApplication(config, options)).ownerListingsEnabled, false);
            await assert.rejects(initializeApplication(Object.assign({}, config, { ownerListingsEnabled: true }), options), /Database indexes are required/);
            await db.collection('users').dropIndex('users_email_unique'); commands.length = 0;
            try { await assert.rejects(initializeApplication(config, options), /Database indexes are required/); }
            finally { await db.collection('users').createIndex({ email: 1 }, { name: 'users_email_unique', unique: true, collation: { locale: 'simple' } }); commands.length = 0; }
        } finally { await db.collection('items').createIndex(operation.key, Object.assign({ name: operation.index }, operation.options)); commands.length = 0; }
        assert.equal((await initializeApplication(Object.assign({}, config, { ownerListingsEnabled: true }), options)).ownerListingsEnabled, true);
    });
    it('expires sessions on private new endpoints without changing drafts', async function () {
        const item = (await create().expect(201)).body.item;
        await db.collection('sessions').updateOne({ _id: tokenHash(owner.cookie.split('=')[1]) }, { $set: { expiresAt: new Date(0) } });
        await detail(item).expect(401); await list().expect(401); await patch(item, { name: 'No' }).expect(401);
        assert.equal((await row(item)).version, 1);
    });
});
