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
                .send({ city: 'San Francisco', neighborhood: 'Sunset', moveOutDeadline: day(20), stateId: '06', metroId: '41860', pickupTimeZone: 'UTC' }).expect(201)).body.plan;
        }
        plan = await parent(owner); otherPlan = await parent(other);
    });
    it('resolves an owner-only edit context for public and private items without changing public draft access', async function () {
        const item = (await create().expect(201)).body.item, url = '/api/items/' + item.id + '/edit-context';
        await request(app).get(url).expect(401);
        await request(app).get(url).set('Cookie', other.cookie).expect(404);
        const result = await request(app).get(url).set('Cookie', owner.cookie).expect(200);
        assert.deepEqual(result.body, { itemId: item.id, planId: plan.id }); assert.equal(result.headers['cache-control'], 'no-store');
        await publicGet(item).set('Cookie', owner.cookie).expect(404);
        const published = (await edit(item, { description: 'A local household item.', categoryId: 'dining-kitchen', itemTypeId: 'microwave', publish: true }).expect(200)).body.item;
        const detail = (await publicGet(published).expect(200)).body.item; assert.equal(detail.classification.itemType.id, 'microwave');
        for (const key of ['planId', 'ownerId', 'email']) assert.ok(!Object.prototype.hasOwnProperty.call(detail, key));
        await request(app).get(url).set('Cookie', owner.cookie).expect(200);
        for (const bad of ['invalid', new ObjectId().toHexString()]) await request(app).get('/api/items/' + bad + '/edit-context').set('Cookie', owner.cookie).expect(404);
    });
    it('denies edit-context access for missing parents and compromised item/plan ownership references', async function () {
        const item = (await create().expect(201)).body.item, url = '/api/items/' + item.id + '/edit-context';
        await db.collection('items').updateOne({ _id: new ObjectId(item.id) }, { $set: { planId: new ObjectId(otherPlan.id) } });
        for (const user of [owner, other]) await request(app).get(url).set('Cookie', user.cookie).expect(404);
        await db.collection('items').updateOne({ _id: new ObjectId(item.id) }, { $set: { planId: new ObjectId() } });
        await request(app).get(url).set('Cookie', owner.cookie).expect(404);
    });
    it('accepts distinct Microwave and Mirror types and discovers their safe synonyms without changing legacy classification', async function () {
        for (const [categoryId, itemTypeId, q] of [['dining-kitchen', 'microwave', 'microwave oven'], ['other-household', 'mirror', 'looking glass']]) {
            const item = (await create({ categoryId, itemTypeId, description: 'Synthetic household item.', publish: true }).expect(201)).body.item;
            const results = await request(app).get('/api/items').query({ stateId: '06', metroId: '41860', q, categoryId }).expect(200);
            assert.equal(results.body.total, 1); assert.equal(results.body.items[0].id, item.id);
            await edit(item, { name: 'Renamed item' }).expect(200);
            assert.equal((await publicGet(item).expect(200)).body.item.classification.itemType.id, itemTypeId);
        }
        await create({ categoryId: 'bedroom', itemTypeId: 'microwave' }).expect(400);
    });
    it('reports the owner plan timezone explicitly without requiring it to publish', async function () {
        await updatePlan({ pickupTimeZone: null }).expect(200);
        assert.equal((await list().expect(200)).body.plan.pickupTimeZone, null);
        const item = (await create({ categoryId: "other-household", itemTypeId: "other", description: "A household item for local pickup.", publish: true }).expect(201)).body.item;
        await publicGet(item).expect(200);
        await updatePlan({ pickupTimeZone: 'America/Los_Angeles' }).expect(200);
        assert.equal((await list().expect(200)).body.plan.pickupTimeZone, 'America/Los_Angeles');
        await list(plan, other).expect(404);
    });
    it('stores validated optional classification separately from legacy category, title and description', async function () {
        const first = (await create({ description: "A household item for local pickup.", category: 'Legacy Furniture', categoryId: 'living-room', itemTypeId: 'sofa', condition: 'good', publish: true }).expect(201)).body.item;
        assert.deepEqual(first.classification, { category: { id: 'living-room', label: 'Living Room' }, itemType: { id: 'sofa', label: 'Sofa' }, condition: { id: 'good', label: 'Good' } });
        assert.equal((await publicGet(first).expect(200)).body.item.classification.itemType.id, 'sofa');
        const before = await db.collection('items').findOne({ _id: new ObjectId(first.id) });
        await edit(first, { categoryId: 'office-lighting' }).expect(400);
        assert.deepEqual(await db.collection('items').findOne({ _id: before._id }), before);
        const changed = (await edit(first, { categoryId: 'office-lighting', itemTypeId: 'desk', condition: 'fair' }).expect(200)).body.item;
        assert.equal(changed.classification.itemType.label, 'Desk'); assert.equal(changed.category, 'Legacy Furniture');
        assert.equal(changed.name, first.name); assert.equal(changed.description, first.description);
        await edit(changed, { itemTypeId: 'sofa' }).expect(400);
        await edit(changed, { condition: 'like-new' }, plan, other).expect(404);
        for (const input of [{ categoryId: 'private-unknown' }, { itemTypeId: 'desk' }, { categoryId: 'bedroom', itemTypeId: 'desk' }, { condition: { $gt: '' } }]) {
            const rejected = await create(input).expect(400); assert.ok(!JSON.stringify(rejected.body).includes('private-unknown'));
        }
        const legacy = (await create({ category: 'Existing craft category' }).expect(201)).body.item;
        await edit(legacy, { name: 'Renamed legacy item' }).expect(200);
        const preserved = await db.collection('items').findOne({ _id: new ObjectId(legacy.id) });
        assert.equal(preserved.category, 'Existing craft category'); assert.equal(preserved.categoryId, undefined);
        const catalog = await request(app).get('/api/item-taxonomy').expect(200);
        assert.equal(catalog.body.categories.length, 6);
    });
    it('publishes and edits common and Other types with safe additive custom metadata, retaining legacy values', async function () {
        const groups = require('../data/item-taxonomy.json').categories;
        for (const id of ['television', 'monitor', 'rug', 'curtains', 'bicycle', 'fan', 'heater', 'vacuum-cleaner', 'bedding']) {
            const group = groups.find(row => row.itemTypes.some(type => type.id === id));
            const result = await create({ categoryId: group.id, itemTypeId: id, description: 'Household item.', publish: true }).expect(201);
            assert.equal(result.body.item.classification.itemType.id, id);
        }
        const original = (await create({ category: 'Legacy Craft', categoryId: 'other-household', itemTypeId: 'other', customItemType: '  Sewing   machine  ', description: 'Useful equipment.', publish: true }).expect(201)).body.item;
        assert.equal(original.classification.customItemType, 'Sewing machine');
        assert.equal((await publicGet(original).expect(200)).body.item.classification.customItemType, 'Sewing machine');
        const unchanged = (await edit(original, { name: 'Renamed equipment' }).expect(200)).body.item;
        assert.equal(unchanged.classification.customItemType, 'Sewing machine'); assert.equal(unchanged.category, 'Legacy Craft');
        const before = await db.collection('items').findOne({ _id: new ObjectId(original.id) });
        for (const customItemType of [{ $ne: null }, '<script>', 'x'.repeat(61), 'bad\u0000text', 'private@example.test']) {
            await edit(unchanged, { customItemType }).expect(400);
            assert.deepEqual(await db.collection('items').findOne({ _id: before._id }), before);
        }
        await edit(unchanged, { customItemType: 'Changed' }, plan, other).expect(404);
        const changed = (await edit(unchanged, { categoryId: 'living-room', itemTypeId: 'television' }).expect(200)).body.item;
        assert.equal(changed.classification.customItemType, undefined); assert.equal(changed.category, 'Legacy Craft');
        await create({ categoryId: 'other-household', itemTypeId: 'other', customItemType: 'Firearm', description: 'Household item.', publish: true }).expect(400);
        const oldOther = (await create({ categoryId: 'other-household', itemTypeId: 'other', description: 'Existing fallback.', publish: true }).expect(201)).body.item;
        assert.equal(oldOther.classification.customItemType, undefined);
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
        assert.deepEqual((await request(app).get('/api/items?stateId=06&metroId=41860').expect(200)).body.items, []);
    });
    it('publishes with distinct first-publication time and future pickup dates, retaining the timestamp on relist', async function () {
        let item = (await create({ categoryId: 'other-household', itemTypeId: 'other', description: 'Household supplies.', availableFrom: day(5), availableUntil: day(10) })).body.item;
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
    it('keeps name-only drafts private and requires complete details for publication', async function () {
        const draft = (await create({ name: 'Spare plant pots' }).expect(201)).body.item;
        assert.equal(draft.description, ''); assert.equal(draft.status, 'draft');
        const response = await action(draft, 'publish').expect(400);
        assert.equal(response.body.error.code, 'PUBLICATION_DETAILS_REQUIRED');
        assert.deepEqual(response.body.error.fields.map(row => row.field), ['categoryId', 'itemTypeId', 'description']);
        assert.equal((await list()).body.items[0].version, 1); await publicGet(draft).expect(404);
    });
    it('rejects incomplete immediate publication without writing an item or plan revision', async function () {
        const full = { name: 'Chair', categoryId: 'office-lighting', itemTypeId: 'office-chair', description: 'A sturdy chair.', publish: true };
        const before = await db.collection('moveOutPlans').findOne({ _id: new ObjectId(plan.id) });
        for (const [field, value] of [['categoryId', null], ['itemTypeId', null], ['description', '   ']]) {
            const result = await create(Object.assign({}, full, { [field]: value }, field === 'categoryId' ? { itemTypeId: null } : {})).expect(400);
            assert.equal(result.body.error.code, 'PUBLICATION_DETAILS_REQUIRED');
            assert.ok(result.body.error.fields.some(row => row.field === field));
        }
        assert.equal(await db.collection('items').countDocuments(), 0);
        assert.deepEqual(await db.collection('moveOutPlans').findOne({ _id: before._id }), before);
    });
    it('edits and publishes a draft in one versioned transaction and protects posted required details', async function () {
        const draft = (await create().expect(201)).body.item;
        await edit(draft, { publish: true }).expect(400);
        let posted = (await edit(draft, { publish: true, categoryId: 'living-room', itemTypeId: 'sofa', description: 'Comfortable two-seat sofa.' }).expect(200)).body.item;
        assert.equal(posted.version, 2); assert.equal(posted.requiresPublicationDetails, true); assert.equal(posted.status, 'available');
        const before = await db.collection('items').findOne({ _id: new ObjectId(posted.id) });
        for (const data of [{ description: ' ' }, { categoryId: null, itemTypeId: null }, { itemTypeId: null }]) await edit(posted, data).expect(400);
        assert.deepEqual(await db.collection('items').findOne({ _id: before._id }), before);
        await edit(posted, { publicationRequirementsVersion: 0 }).expect(400);
        posted = (await edit(posted, { name: 'Updated sofa' }).expect(200)).body.item;
        assert.equal(posted.requiresPublicationDetails, true);
        const visible = (await publicGet(posted).expect(200)).body.item;
        assert.equal(visible.requiresPublicationDetails, undefined); assert.equal(visible.publicationRequirementsVersion, undefined);
    });
    it('keeps pre-existing incomplete public items editable, but requires details on explicit republication', async function () {
        let old = (await create({ category: 'Legacy Furniture' }).expect(201)).body.item;
        await db.collection('items').updateOne({ _id: new ObjectId(old.id) }, { $set: { status: 'available', publishedAt: new Date() } });
        await publicGet(old).expect(200);
        old = (await edit(old, { name: 'Renamed legacy item' }).expect(200)).body.item;
        assert.equal(old.requiresPublicationDetails, false); assert.equal(old.category, 'Legacy Furniture');
        old = (await action(old, 'unlist').expect(200)).body.item;
        await action(old, 'publish').expect(400);
        old = (await edit(old, { publish: true, categoryId: 'other-household', itemTypeId: 'other', description: 'An older household item.' }).expect(200)).body.item;
        assert.equal(old.category, 'Legacy Furniture'); assert.equal(old.requiresPublicationDetails, true);
        await publicGet(old).expect(200);
    });
    it('rejects new past calendar starts but preserves unchanged ongoing starts and current-day availability', async function () {
        await create({ availableFrom: day(-1) }).expect(400);
        const today = (await create({ availableFrom: day(0) }).expect(201)).body.item;
        assert.equal(today.availableFrom, day(0)); assert.equal(today.availableUntil, null);
        let old = (await create().expect(201)).body.item;
        await db.collection('items').updateOne({ _id: new ObjectId(old.id) }, { $set: { availableFrom: day(-5) } });
        old = (await edit(old, { name: 'Still available', availableFrom: day(-5) }).expect(200)).body.item;
        assert.equal(old.availableFrom, day(-5));
        const rejected = await edit(old, { availableFrom: day(-2) }).expect(400);
        assert.equal(rejected.body.error.fields[0].field, 'availableFrom');
        await edit(old, { availableFrom: null }).expect(200);
    });
    it('serializes competing atomic publications and retains ownership/version protection', async function () {
        const draft = (await create().expect(201)).body.item;
        const changes = { publish: true, categoryId: 'other-household', itemTypeId: 'other', description: 'Complete local listing.' };
        await edit(draft, changes, plan, other).expect(404);
        const replies = await Promise.all([edit(draft, changes), edit(draft, changes)]);
        assert.deepEqual(replies.map(row => row.status).sort(), [200, 409]);
        const posted = (await list()).body.items[0]; assert.equal(posted.version, 2);
        await edit(posted, { publish: true }).expect(409);
        await edit(posted, { publish: 'true' }).expect(400);
    });
    it('distinguishes unlisted from cleared and reopens clearance as a private draft', async function () {
        let item = (await create({ categoryId: "other-household", itemTypeId: "other", description: "A household item for local pickup.", publish: true })).body.item;
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
        const item = (await create({ categoryId: "other-household", itemTypeId: "other", description: "A household item for local pickup.", name: 'Box [kitchen]', publish: true })).body.item;
        await updatePlan({ city: 'Oakland', neighborhood: 'Temescal', moveOutDeadline: day(15) }).expect(200);
        const visible = (await publicGet(item).expect(200)).body.item;
        assert.equal(visible.city, 'Oakland'); assert.equal(visible.neighborhood, 'Temescal'); assert.equal(visible.effectiveAvailableUntil, day(15));
        assert.equal((await request(app).get('/api/items?stateId=06&metroId=41860').query({ q: '[kitchen]', city: 'oakland' }).expect(200)).body.items.length, 1);
        assert.equal((await request(app).get('/api/items?stateId=06&metroId=41860').query({ city: 'San Francisco' })).body.items.length, 0);
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
        await create({ categoryId: "other-household", itemTypeId: "other", description: "A household item for local pickup.", publish: true, availableUntil: day(-1) }).expect(400);
        await create({ categoryId: "other-household", itemTypeId: "other", description: "A household item for local pickup.", publish: true, availableUntil: day(0) }).expect(201);
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
        let item = (await create({ categoryId: "other-household", itemTypeId: "other", description: "A household item for local pickup.", publish: true })).body.item;
        const first = item.publishedAt;
        await db.collection('moveOutPlans').updateOne({ _id: new ObjectId(plan.id) }, { $set: { moveOutDeadline: day(-1) } });
        assert.equal((await list()).body.items[0].status, 'expired'); await publicGet(item).expect(404);
        assert.equal((await request(app).get('/api/items?stateId=06&metroId=41860')).body.items.length, 0);
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
        const item = (await create({ categoryId: "other-household", itemTypeId: "other", description: "A household item for local pickup.", publish: true })).body.item;
        await updatePlan({ status: 'completed' }).expect(200); await publicGet(item).expect(404);
        await create({ categoryId: "other-household", itemTypeId: "other", description: "A household item for local pickup.", publish: true }).expect(409); await create({ name: 'Private notes' }).expect(201);
        await updatePlan({ status: 'active' }).expect(200); await publicGet(item).expect(200);
    });
    it('checks item and plan ownership together, including inconsistent/orphaned references', async function () {
        const item = (await create({ categoryId: "other-household", itemTypeId: "other", description: "A household item for local pickup.", publish: true })).body.item;
        await list(plan, other).expect(404); await create({}, otherPlan, owner).expect(404);
        await edit(item, { name: 'Takeover' }, plan, other).expect(404); await action(item, 'clear', otherPlan, other).expect(404);
        await db.collection('items').updateOne({ _id: new ObjectId(item.id) }, { $set: { planId: new ObjectId(otherPlan.id) } });
        await publicGet(item).expect(404); assert.equal((await list(otherPlan, other)).body.items.length, 0);
        await edit(item, { name: 'Mismatch' }, otherPlan, other).expect(404);
        await edit(item, { name: 'Mismatch' }, otherPlan, owner).expect(404);
    });
    it('requires sessions and CSRF on management while public reads remain anonymous', async function () {
        const item = (await create({ categoryId: "other-household", itemTypeId: "other", description: "A household item for local pickup.", publish: true })).body.item;
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
        const item = (await create({ categoryId: "other-household", itemTypeId: "other", description: "A household item for local pickup.", publish: true })).body.item;
        await edit(item, { description: 'Contact private@example.test' }).expect(400);
    });
    it('allowlists public DTOs and prevents legacy APIs from retrieving private inventory', async function () {
        const visible = (await create({ categoryId: "other-household", itemTypeId: "other", description: "A household item for local pickup.", publish: true })).body.item;
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
        const item = (await create({ categoryId: "other-household", itemTypeId: "other", description: "A household item for local pickup.", publish: true })).body.item;
        const results = await Promise.all([action(item, 'unlist'), action(item, 'clear')]);
        assert.deepEqual(results.map(result => result.status).sort(), [200, 409]);
        assert.equal((await list()).body.items[0].version, 2);
    });
    it('serializes competing item creation and deadline edits so both cannot commit an invalid range', async function () {
        const results = await Promise.all([create({ categoryId: "other-household", itemTypeId: "other", description: "A household item for local pickup.", availableUntil: day(15), publish: true }), updatePlan({ moveOutDeadline: day(10) })]);
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
