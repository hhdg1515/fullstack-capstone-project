const assert = require('node:assert/strict');
const request = require('supertest');
const { ObjectId, MongoServerError } = require('mongodb');
const pino = require('pino');
const createApp = require('../app');
const { createIsolatedMongo } = require('./helpers/isolated-mongo');
const { prepareDatabaseIndexes } = require('../services/database-indexes');
const write = operation => operation.set('Origin', 'http://localhost:3000').set('X-CSRF-Protection', '1');

describe('private pickup communication on verified isolated MongoDB', function () {
    this.timeout(180000);
    let isolated, db, app, clock, giver, receiver, stranger, plan, item, pickup;
    const day = n => new Date(clock.getTime() + n * 86400000).toISOString().slice(0, 10);
    const root = id => '/api/pickup-requests/' + (id || pickup.id) + '/conversation';
    const get = (suffix = '', user = giver, id = undefined) => request(app).get(root(id) + suffix).set('Cookie', user.cookie);
    const send = (data = { text: 'Meet near the public library.' }, user = receiver, id = undefined) => write(request(app).post(root(id) + '/messages')).set('Cookie', user.cookie).send(data);
    const act = (action, row = pickup, user = giver) => write(request(app).post('/api/pickup-requests/' + row.id + '/actions')).set('Cookie', user.cookie).send({ action, version: row.version });
    const unavailable = async id => {
        for (const user of [giver, receiver]) {
            for (const operation of [get('', user, id), get('/messages', user, id), send(undefined, user, id)]) {
                const result = await operation.expect(404);
                assert.deepEqual(result.body, { error: { code: 'CONVERSATION_UNAVAILABLE', message: 'Pickup conversation unavailable' } });
            }
        }
    };
    const readOnly = async (messages, id = pickup.id) => {
        const before = await db.collection('pickupRequests').findOne({ _id: new ObjectId(id) });
        const planBefore = await db.collection('moveOutPlans').findOne({ _id: before.planId });
        for (const user of [giver, receiver]) {
            const context = (await get('', user, id).expect(200)).body.conversation;
            assert.equal(context.id, id); assert.equal(context.status, before.status);
            const history = await get('/messages', user, id).expect(200);
            assert.equal(history.headers['cache-control'], 'no-store'); assert.deepEqual(history.body.messages, messages);
            assert.equal((await send(undefined, user, id).expect(404)).body.error.code, 'CONVERSATION_UNAVAILABLE');
        }
        await get('', stranger, id).expect(404); await get('/messages', stranger, id).expect(404); await send(undefined, stranger, id).expect(404);
        assert.deepEqual(await db.collection('pickupRequests').findOne({ _id: before._id }), before);
        assert.deepEqual(await db.collection('moveOutPlans').findOne({ _id: before.planId }), planBefore);
        assert.equal(await db.collection('pickupMessages').countDocuments({ requestId: before._id }), messages.length);
    };
    const build = (options = {}) => createApp(Object.assign({ connectToDatabase: async () => db, pickupNow: () => new Date(clock), logger: pino({ level: 'silent' }) }, options));
    const setQuota = async (minute, hour, minuteMs = 60000, hourMs = 3600000) => db.collection('users').updateOne({ _id: new ObjectId(receiver.id) },
        [{ $set: { pickupMessageQuota: { minute: { count: minute, expiresAt: { $add: ['$$NOW', minuteMs] } },
            hour: { count: hour, expiresAt: { $add: ['$$NOW', hourMs] } } } } }]);
    const quota = async (user = receiver) => (await db.collection('users').findOne({ _id: new ObjectId(user.id) })).pickupMessageQuota;
    const sendVia = (instance, text = 'Coordination', id = pickup.id) => write(request(instance).post(root(id) + '/messages')).set('Cookie', receiver.cookie).send({ text });
    before(async function () {
        isolated = await createIsolatedMongo(); db = isolated.db; await prepareDatabaseIndexes(db);
        app = build();
        const account = async firstName => {
            const result = await write(request(app).post('/api/auth/register')).send({ firstName, lastName: 'Private surname', email: firstName.toLowerCase() + '@example.test', password: 'isolated-communication-password' }).expect(201);
            return { id: result.body.user.id, cookie: result.headers['set-cookie'][0].split(';')[0] };
        };
        giver = await account('Giver'); receiver = await account('Receiver'); stranger = await account('Stranger');
    });
    after(async function () { if (isolated) await isolated.close(); });
    beforeEach(async function () {
        clock = new Date(); app = build();
        await db.collection('users').updateMany({}, { $unset: { pickupMessageQuota: '' } });
        for (const name of ['pickupMessages', 'pickupRequests', 'items', 'moveOutPlans']) await db.collection(name).deleteMany({});
        plan = (await write(request(app).post('/api/move-out-plans')).set('Cookie', giver.cookie)
            .send({ title: 'Private plan title', city: 'Oakland', neighborhood: 'Temescal', moveOutDeadline: day(30), pickupTimeZone: 'UTC' }).expect(201)).body.plan;
        item = (await write(request(app).post('/api/move-out-plans/' + plan.id + '/items')).set('Cookie', giver.cookie)
            .send({ categoryId: "other-household", itemTypeId: "other", name: 'Desk', description: 'One whole desk', publish: true }).expect(201)).body.item;
        clock = new Date();
        pickup = (await write(request(app).post('/api/pickup-requests')).set('Cookie', receiver.cookie)
            .send({ itemId: item.id, localDateTime: day(1) + 'T12:00', timeZone: 'UTC' }).expect(result => assert.equal(result.status, 201, result.body.error && result.body.error.code))).body.request;
    });
    it('provides one derived context to both participants without creating documents or changing requests', async function () {
        const before = await db.collection('pickupRequests').findOne({ _id: new ObjectId(pickup.id) });
        const originalPlan = await db.collection('moveOutPlans').findOne({ _id: new ObjectId(plan.id) });
        const results = await Promise.all(Array.from({ length: 8 }, (_, i) => get('', i % 2 ? giver : receiver).expect(200)));
        assert.ok(results.every(result => result.body.conversation.id === pickup.id));
        assert.equal(results[0].body.conversation.role, 'receiver'); assert.deepEqual(results[0].body.conversation.counterpart, { firstName: 'Giver' });
        assert.equal(results[1].body.conversation.role, 'giver');
        assert.equal(await db.collection('pickupMessages').countDocuments(), 0);
        assert.deepEqual(await db.collection('pickupRequests').findOne({ _id: before._id }), before);
        assert.deepEqual(await db.collection('moveOutPlans').findOne({ _id: originalPlan._id }), originalPlan);
        assert.ok(!(await db.listCollections().toArray()).some(value => /conversation/i.test(value.name)));
        await assert.rejects(db.collection('pickupRequests').insertOne(before), error => error.code === 11000);
    });
    it('requires a real session and existing CSRF protections on every operation', async function () {
        for (const suffix of ['', '/messages']) await request(app).get(root() + suffix).expect(401);
        await write(request(app).post(root() + '/messages')).send({ text: 'Hello' }).expect(401);
        await request(app).post(root() + '/messages').set('Cookie', receiver.cookie).send({ text: 'Hello' }).expect(403);
        await write(request(app).post(root() + '/messages')).set('Origin', 'https://unrelated.example').set('Cookie', receiver.cookie).send({ text: 'Hello' }).expect(403);
        await get('', { cookie: 'giftlink_session=' + 'a'.repeat(64) }).expect(401);
        assert.equal(await db.collection('pickupMessages').countDocuments(), 0);
    });
    it('hides context and history from unrelated users even with forged ownership and request identifiers', async function () {
        await send().expect(201);
        for (const suffix of ['', '/messages', '?ownerId=' + stranger.id, '/messages?requestId=' + pickup.id]) {
            await get(suffix, stranger).expect(404);
        }
        await send(undefined, stranger).expect(404);
        for (const id of ['not-an-id', new ObjectId().toString(), item.id, plan.id]) await unavailable(id);
        assert.equal(await db.collection('pickupMessages').countDocuments(), 1);
    });
    it('derives sender from the cookie, rejects impersonation and never redefines canonical participants', async function () {
        for (const field of ['sender', 'senderId', 'ownerId', 'giverId', 'receiverId', 'participants', 'requestId', 'conversationId', 'createdAt']) {
            const result = await send({ text: 'Safe text', [field]: giver.id }).expect(400);
            assert.ok(!JSON.stringify(result.body).includes(giver.id));
        }
        const result = await send({ text: '  Hello giver\nMeet at the library.  ' }).expect(201);
        assert.deepEqual(Object.keys(result.body.message).sort(), ['createdAt', 'id', 'sender', 'text']);
        assert.equal(result.body.message.sender, 'receiver'); assert.equal(result.body.message.text, 'Hello giver\nMeet at the library.');
        const stored = await db.collection('pickupMessages').findOne({ _id: new ObjectId(result.body.message.id) });
        assert.ok(stored.senderId.equals(new ObjectId(receiver.id))); assert.ok(stored.requestId.equals(new ObjectId(pickup.id)));
        assert.deepEqual(Object.keys(stored).sort(), ['_id', 'createdAt', 'requestId', 'senderId', 'text']);
        assert.equal((await send({ text: 'Hello receiver' }, giver).expect(201)).body.message.sender, 'giver');
        assert.equal((await get('/messages').expect(200)).body.messages.length, 2);
    });
    it('keeps message bodies and private account fields out of public responses and structured request logs', async function () {
        const logs = []; app = build({ logger: pino({ level: 'info' }, { write: line => logs.push(line) }) });
        const text = 'Private communication marker ' + new ObjectId(); await send({ text }).expect(201);
        const publicResult = await request(app).get('/api/items/' + item.id).expect(200);
        const context = await get().expect(200); const history = await get('/messages', receiver).expect(200);
        assert.equal(context.headers['cache-control'], 'no-store'); assert.equal(history.headers['cache-control'], 'no-store');
        for (const value of [JSON.stringify(context.body), JSON.stringify(history.body), logs.join('')]) {
            for (const secret of ['giver@example.test', 'receiver@example.test', 'Private surname', giver.cookie, receiver.cookie, 'password']) assert.ok(!value.includes(secret));
        }
        assert.ok(!JSON.stringify(publicResult.body).includes(text)); assert.ok(!logs.join('').includes(text));
        assert.ok(!logs.join('').includes(pickup.id)); assert.ok(!logs.join('').includes(receiver.id));
    });
    it('returns chronological pages without gaps or duplicates when timestamps tie', async function () {
        const sent = [];
        for (let i = 0; i < 7; i++) sent.push((await send({ text: 'Message ' + i }, i % 2 ? giver : receiver).expect(201)).body.message);
        assert.equal(new Set(sent.map(row => row.createdAt)).size, 1);
        let cursor, pages = [];
        do {
            const page = (await get('/messages?limit=3' + (cursor ? '&before=' + cursor : '')).expect(200)).body;
            assert.ok(page.messages.length <= 3); pages = page.messages.concat(pages); cursor = page.nextCursor;
        } while (cursor);
        assert.deepEqual(pages, sent); assert.equal(new Set(pages.map(row => row.id)).size, 7);
        assert.equal((await get('/messages?limit=50').expect(200)).body.messages.length, 7);
    });
    it('bounds default pages and lets an old cursor skip newly arrived latest messages', async function () {
        for (let i = 0; i < 23; i++) { clock = new Date(clock.getTime() + 1); await send({ text: 'Message ' + i }, i % 2 ? giver : receiver).expect(201); }
        const first = (await get('/messages').expect(200)).body; assert.equal(first.messages.length, 20); assert.ok(first.nextCursor);
        clock = new Date(clock.getTime() + 1); await send({ text: 'New arrival' }).expect(201);
        const older = (await get('/messages?before=' + first.nextCursor).expect(200)).body;
        assert.equal(older.messages.length, 3); assert.equal(older.nextCursor, null);
        assert.ok(!older.messages.some(row => row.text === 'New arrival'));
        assert.ok(!older.messages.some(row => first.messages.some(value => value.id === row.id)));
    });
    it('isolates simultaneous requesters for the same item and binds older-message cursors to one request', async function () {
        const other = (await write(request(app).post('/api/pickup-requests')).set('Cookie', stranger.cookie)
            .send({ itemId: item.id, localDateTime: day(1) + 'T13:00', timeZone: 'UTC' }).expect(201)).body.request;
        await send({ text: 'First private thread' }).expect(201); await send({ text: 'Second message' }).expect(201);
        const cursor = (await get('/messages?limit=1', receiver).expect(200)).body.nextCursor;
        await get('', stranger, other.id).expect(200);
        assert.deepEqual((await get('/messages', stranger, other.id).expect(200)).body.messages, []);
        await get('/messages?before=' + cursor, stranger, other.id).expect(400);
        await get('/messages?before=' + cursor, stranger).expect(404);
        await send({ text: 'Different requester thread' }, stranger, other.id).expect(201);
        const first = (await get('/messages', receiver).expect(200)).body.messages;
        assert.equal(first.length, 2); assert.ok(!JSON.stringify(first).includes('Different requester thread'));
    });
    it('rejects invalid query/cursor input and cannot use another request cursor to read its messages', async function () {
        const foreign = Buffer.from(JSON.stringify({ requestId: new ObjectId().toString(), id: new ObjectId().toString(), at: clock.toISOString() })).toString('base64url');
        for (const query of ['limit=0', 'limit=51', 'limit=-1', 'limit=1.5', 'limit=01', 'limit[]=2', 'before[]=abc', 'before=not-json', 'before=' + 'a'.repeat(257), 'before=' + foreign, 'sort=oldest']) {
            const result = await get('/messages?' + query).expect(400); assert.equal(result.body.error.code, 'INVALID_MESSAGE_QUERY');
        }
    });
    it('rejects missing, oversized, non-text, markup, controls and unsupported input without echoing it', async function () {
        for (const data of [{}, [], { text: '' }, { text: '   ' }, { text: null }, { text: { $gt: '' } }, { text: ['a'] }, { text: 'x'.repeat(2001) }, { text: '😀'.repeat(2001) }, { text: '<private-script>' }, { text: 'private\u0000marker' }]) {
            const result = await send(data).expect(400); assert.ok(!JSON.stringify(result.body).includes('private-script'));
        }
        assert.equal(await db.collection('pickupMessages').countDocuments(), 0);
        await send({ text: '😀'.repeat(2000) }).expect(201);
        await send({ text: 'x'.repeat(40000) }).expect(413);
        assert.equal(await db.collection('pickupMessages').countDocuments(), 1);
    });
    it('applies a per-authenticated-user send limit independently of the existing request-wide limiter', async function () {
        app = build({ messageLimit: 2 }); await send().expect(201); await send().expect(201);
        assert.equal((await send().expect(429)).body.error.code, 'MESSAGE_RATE_LIMIT');
        await send(undefined, giver).expect(201); await get('/messages').expect(200);
        assert.equal(await db.collection('pickupMessages').countDocuments(), 3);
    });
    it('enforces one message budget across independent application instances', async function () {
        for (let i = 0; i < 30; i++) await send({ text: 'Coordination ' + i }).expect(201);
        app = build(); // A new warm instance has an independent memory limiter.
        assert.equal((await send().expect(429)).body.error.code, 'MESSAGE_QUOTA_EXCEEDED');
        assert.equal(await db.collection('pickupMessages').countDocuments(), 30);
    });
    it('shares the account budget across conversations and sessions without blocking the other participant', async function () {
        const nextItem = (await write(request(app).post('/api/move-out-plans/' + plan.id + '/items')).set('Cookie', giver.cookie)
            .send({ categoryId: "other-household", itemTypeId: "other", description: "A household item for local pickup.", name: 'Chair', publish: true }).expect(201)).body.item;
        clock = new Date();
        const nextRequest = (await write(request(app).post('/api/pickup-requests')).set('Cookie', receiver.cookie)
            .send({ itemId: nextItem.id, localDateTime: day(1) + 'T13:00', timeZone: 'UTC' }).expect(201)).body.request;
        await setQuota(29, 29); await send().expect(201);
        const loggedIn = await write(request(app).post('/api/auth/login')).send({ email: 'receiver@example.test', password: 'isolated-communication-password' }).expect(200);
        const secondSession = { cookie: loggedIn.headers['set-cookie'][0].split(';')[0] };
        const limited = await send(undefined, secondSession, nextRequest.id).expect(429);
        assert.equal(limited.body.error.code, 'MESSAGE_QUOTA_EXCEEDED');
        assert.ok(Number(limited.headers['retry-after']) > 0 && Number(limited.headers['retry-after']) <= 60);
        assert.equal(limited.body.error.retryAfterSeconds, Number(limited.headers['retry-after']));
        await send(undefined, giver, nextRequest.id).expect(201); await get('/messages').expect(200);
        assert.equal((await quota()).minute.count, 30); assert.equal((await quota(giver)).minute.count, 1);
    });
    it('enforces the longer budget after a minute reset and restores capacity only when its window expires', async function () {
        await setQuota(30, 299, -1);
        await send().expect(201); assert.equal((await quota()).minute.count, 1); assert.equal((await quota()).hour.count, 300);
        const before = await quota(); const planBefore = await db.collection('moveOutPlans').findOne({ _id: new ObjectId(plan.id) });
        const limited = await send().expect(429);
        assert.ok(Number(limited.headers['retry-after']) > 60 && Number(limited.headers['retry-after']) <= 3600);
        assert.deepEqual(await quota(), before); assert.deepEqual(await db.collection('moveOutPlans').findOne({ _id: planBefore._id }), planBefore);
        await setQuota(30, 300, -1, -1); await send().expect(201);
        assert.equal((await quota()).minute.count, 1); assert.equal((await quota()).hour.count, 1);
    });
    it('does not reset an exhausted minute when the hour window expires', async function () {
        await setQuota(30, 300, 60000, -1); const before = await quota();
        await send().expect(429); assert.deepEqual(await quota(), before);
        assert.equal(await db.collection('pickupMessages').countDocuments(), 0);
    });
    it('reserves only the remaining capacity across concurrent instances and different plan transactions', async function () {
        const nextPlan = (await write(request(app).post('/api/move-out-plans')).set('Cookie', giver.cookie)
            .send({ city: 'Oakland', neighborhood: 'Temescal', moveOutDeadline: day(30), pickupTimeZone: 'UTC' }).expect(201)).body.plan;
        const nextItem = (await write(request(app).post('/api/move-out-plans/' + nextPlan.id + '/items')).set('Cookie', giver.cookie)
            .send({ categoryId: "other-household", itemTypeId: "other", description: "A household item for local pickup.", name: 'Other plan chair', publish: true }).expect(201)).body.item;
        clock = new Date();
        const nextRequest = (await write(request(app).post('/api/pickup-requests')).set('Cookie', receiver.cookie)
            .send({ itemId: nextItem.id, localDateTime: day(1) + 'T13:00', timeZone: 'UTC' }).expect(201)).body.request;
        await setQuota(29, 299); const instances = [build({ messageLimit: 1000 }), build({ messageLimit: 1000 })];
        const plansBefore = await db.collection('moveOutPlans').find({}).toArray();
        const results = await Promise.all(Array.from({ length: 6 }, (_, i) => sendVia(instances[i % 2], 'Race ' + i, i % 2 ? nextRequest.id : pickup.id)));
        assert.equal(results.filter(result => result.status === 201).length, 1);
        assert.equal(results.filter(result => result.status === 429 && result.body.error.code === 'MESSAGE_QUOTA_EXCEEDED').length, 5);
        assert.equal((await quota()).minute.count, 30); assert.equal((await quota()).hour.count, 300);
        assert.equal(await db.collection('pickupMessages').countDocuments(), 1);
        const plansAfter = await db.collection('moveOutPlans').find({}).toArray();
        assert.equal(plansAfter.reduce((sum, row) => sum + row.inventoryRevision, 0), plansBefore.reduce((sum, row) => sum + row.inventoryRevision, 0) + 1);
        const histories = await Promise.all([pickup.id, nextRequest.id].map(id => get('/messages', receiver, id).expect(200)));
        assert.deepEqual(histories.flatMap(result => result.body.messages), results.filter(result => result.status === 201).map(result => result.body.message));
    });
    it('does not charge invalid, unauthorized or closed sends and checks authorization before quota disclosure', async function () {
        await send({ text: '<invalid>' }).expect(400); await send(undefined, stranger).expect(404);
        assert.equal(await quota(), undefined); assert.equal(await quota(stranger), undefined);
        await setQuota(30, 300); const before = await quota();
        await send(undefined, receiver, new ObjectId().toString()).expect(404);
        await act('decline').expect(200); await send().expect(404);
        assert.deepEqual(await quota(), before); assert.equal(await db.collection('pickupMessages').countDocuments(), 0);
    });
    it('does not trust a function pickup clock or client profile fields to reset message budgets', async function () {
        app = build({ pickupNow: () => new Date(clock.getTime() + 3600000) });
        await send().expect(201); const stored = await quota();
        const dbNow = (await db.command({ hello: 1 })).localTime;
        assert.ok(Math.abs(stored.minute.expiresAt.getTime() - dbNow.getTime() - 60000) < 5000);
        await write(request(app).patch('/api/me')).set('Cookie', receiver.cookie).send({ pickupMessageQuota: null }).expect(400);
        assert.deepEqual(await quota(), stored);
    });
    [false, true].forEach(transient => it('rolls quota back with a failed insert' + (transient ? ' and charges once after transaction retry' : ''), async function () {
        let attempts = 0;
        const wrapped = { client: db.client, collection: name => name !== 'pickupMessages' ? db.collection(name) : {
            insertOne: async (message, options) => {
                attempts++;
                if (!transient || attempts === 1) {
                    const error = new MongoServerError({ message: 'private-insert-marker', code: transient ? 112 : 12345 });
                    if (transient) error.addErrorLabel('TransientTransactionError');
                    throw error;
                }
                return db.collection(name).insertOne(message, options);
            }
        } };
        app = build({ connectToDatabase: async () => wrapped });
        const result = await send().expect(transient ? 201 : 500);
        assert.ok(!JSON.stringify(result.body).includes('private-insert-marker'));
        assert.equal(await db.collection('pickupMessages').countDocuments(), transient ? 1 : 0);
        assert.equal((await quota()) && (await quota()).minute.count, transient ? 1 : undefined);
        if (transient) assert.equal(attempts, 2);
    }));
    it('keeps explicit repeated POSTs distinct rather than silently dropping matching text', async function () {
        const first = (await send().expect(201)).body.message, second = (await send().expect(201)).body.message;
        assert.notEqual(first.id, second.id); assert.equal(first.text, second.text);
        assert.equal((await quota()).minute.count, 2); assert.equal(await db.collection('pickupMessages').countDocuments(), 2);
    });
    it('keeps quota metadata out of account, participant, public and log responses', async function () {
        const logs = []; app = build({ logger: pino({ level: 'info' }, { write: line => logs.push(line) }) });
        const before = await db.collection('users').findOne({ _id: new ObjectId(receiver.id) });
        await send().expect(201); assert.ok(await quota());
        const after = await db.collection('users').findOne({ _id: before._id }); delete after.pickupMessageQuota;
        assert.deepEqual(after, before);
        const responses = await Promise.all([request(app).get('/api/me').set('Cookie', receiver.cookie), get(), get('/messages'), request(app).get('/api/items/' + item.id)]);
        assert.ok(responses.every(result => result.status === 200));
        assert.ok(!JSON.stringify(responses.map(result => result.body)).includes('pickupMessageQuota'));
        assert.ok(!logs.join('').includes('pickupMessageQuota'));
    });
    it('bounds history query execution and returns a sanitized busy error without modifying messages', async function () {
        const original = (await send().expect(201)).body.message; let options;
        const wrapped = { client: db.client, collection: name => name !== 'pickupMessages' ? db.collection(name) : {
            find: (filter, config) => { options = config; return { sort() { return this; }, limit() { return this; },
                toArray: async () => { throw Object.assign(new Error('private-history-query'), { code: 50 }); } }; }
        } };
        app = build({ connectToDatabase: async () => wrapped });
        const result = await get('/messages').expect(503);
        assert.equal(result.body.error.code, 'CONVERSATION_BUSY'); assert.equal(options.maxTimeMS, 5000);
        assert.deepEqual(options.projection, { _id: 1, senderId: 1, text: 1, createdAt: 1 });
        assert.ok(!JSON.stringify(result.body).includes('private-history-query'));
        app = build(); assert.deepEqual((await get('/messages').expect(200)).body.messages, [original]);
    });
    it('keeps accepted conversations open through the appointment, without changing reservation/version state', async function () {
        const accepted = (await act('accept').expect(200)).body.request;
        clock = new Date(new Date(accepted.proposedAt).getTime() + 1);
        await get().expect(200); await send().expect(201);
        const row = await db.collection('pickupRequests').findOne({ _id: new ObjectId(pickup.id) });
        assert.equal(row.status, 'accepted'); assert.equal(row.version, accepted.version);
    });
    ['decline', 'cancel', 'complete', 'no_show'].forEach(action => it('preserves both participants’ read-only history after ' + action, async function () {
        const message = (await send().expect(201)).body.message; let row = pickup;
        if (['complete', 'no_show'].includes(action)) { row = (await act('accept').expect(200)).body.request; clock = new Date(new Date(row.proposedAt).getTime() + 1); }
        await act(action, row).expect(200); await readOnly([message]);
        assert.equal(await db.collection('pickupMessages').countDocuments(), 1);
    }));
    it('keeps withdrawn history read-only and isolated from a later request for the same item', async function () {
        const message = (await send().expect(201)).body.message;
        await write(request(app).post('/api/move-out-plans/' + plan.id + '/items/' + item.id + '/actions')).set('Cookie', giver.cookie)
            .send({ action: 'unlist', version: item.version, confirmCancelRequests: true }).expect(200);
        await readOnly([message]);
        await write(request(app).post('/api/move-out-plans/' + plan.id + '/items/' + item.id + '/actions')).set('Cookie', giver.cookie)
            .send({ action: 'publish', version: item.version + 1 }).expect(200);
        const next = (await write(request(app).post('/api/pickup-requests')).set('Cookie', receiver.cookie)
            .send({ itemId: item.id, localDateTime: day(1) + 'T12:00', timeZone: 'UTC' }).expect(result => assert.equal(result.status, 201, result.body.error && result.body.error.code))).body.request;
        assert.notEqual(next.id, pickup.id); assert.deepEqual((await get('/messages', receiver, next.id).expect(200)).body.messages, []);
        await readOnly([message]);
    });
    it('keeps an empty closed history read-only without creating messages or reopening the request', async function () {
        await act('cancel', pickup, receiver).expect(200); await readOnly([]);
    });
    it('retains closed history after legitimate plan closure, timezone changes and expiration', async function () {
        const message = (await send().expect(201)).body.message;
        await write(request(app).patch('/api/move-out-plans/' + plan.id)).set('Cookie', giver.cookie)
            .send({ status: 'completed', pickupTimeZone: 'Asia/Kolkata', confirmCancelRequests: true }).expect(200);
        clock = new Date(clock.getTime() + 40 * 86400000);
        await readOnly([message]);
        const context = (await get().expect(200)).body.conversation; assert.equal(context.status, 'cancelled');
    });
    it('keeps closed history paginated and accepts an earlier cursor without granting send permission', async function () {
        const sent = [];
        for (let i = 0; i < 5; i++) sent.push((await send({ text: 'History ' + i }, i % 2 ? giver : receiver).expect(201)).body.message);
        const beforeClosure = (await get('/messages?limit=2').expect(200)).body;
        await act('decline').expect(200);
        for (const user of [giver, receiver]) {
            const latest = (await get('/messages?limit=2', user).expect(200)).body; assert.deepEqual(latest, beforeClosure);
            const older = (await get('/messages?limit=2&before=' + latest.nextCursor, user).expect(200)).body;
            const oldest = (await get('/messages?limit=2&before=' + older.nextCursor, user).expect(200)).body;
            assert.deepEqual(oldest.messages.concat(older.messages, latest.messages), sent); assert.equal(oldest.nextCursor, null);
        }
        await readOnly(sent);
    });
    it('refuses closed history when canonical participant or request references are compromised', async function () {
        await send().expect(201); await act('cancel').expect(200);
        const original = await db.collection('pickupRequests').findOne({ _id: new ObjectId(pickup.id) });
        for (const change of [{ receiverId: new ObjectId(stranger.id) }, { giverId: new ObjectId(stranger.id) },
            { itemId: new ObjectId() }, { planId: new ObjectId() }, { history: [] }, { active: true }, { status: 'unknown' }]) {
            const compromised = Object.assign({}, original, change);
            await db.collection('pickupRequests').replaceOne({ _id: original._id }, compromised);
            await unavailable(); await get('', stranger).expect(404); await get('/messages', stranger).expect(404); await send(undefined, stranger).expect(404);
            assert.deepEqual(await db.collection('pickupRequests').findOne({ _id: original._id }), compromised);
        }
        assert.equal(await db.collection('pickupMessages').countDocuments(), 1);
    });
    it('refuses closed history after deleted references, account deletion or ownership changes', async function () {
        await send().expect(201); await act('cancel').expect(200);
        const itemBefore = await db.collection('items').findOne({ _id: new ObjectId(item.id) });
        const planBefore = await db.collection('moveOutPlans').findOne({ _id: new ObjectId(plan.id) });
        await db.collection('items').updateOne({ _id: itemBefore._id }, { $set: { ownerId: new ObjectId(stranger.id) } });
        await unavailable(); await db.collection('items').replaceOne({ _id: itemBefore._id }, itemBefore);
        await db.collection('moveOutPlans').updateOne({ _id: planBefore._id }, { $set: { ownerId: new ObjectId(stranger.id) } });
        await unavailable(); await db.collection('moveOutPlans').replaceOne({ _id: planBefore._id }, planBefore);
        await db.collection('items').deleteOne({ _id: itemBefore._id }); await unavailable(); await db.collection('items').insertOne(itemBefore);
        await db.collection('moveOutPlans').deleteOne({ _id: planBefore._id }); await unavailable(); await db.collection('moveOutPlans').insertOne(planBefore);
        const person = await db.collection('users').findOne({ _id: new ObjectId(receiver.id) });
        try {
            await db.collection('users').deleteOne({ _id: person._id });
            await get().expect(404); await get('/messages').expect(404); await send(undefined, giver).expect(404);
        } finally { await db.collection('users').insertOne(person); }
        await db.collection('pickupRequests').deleteOne({ _id: new ObjectId(pickup.id) }); await unavailable();
        assert.equal(await db.collection('pickupMessages').countDocuments(), 1);
    });
    it('fails closed on unknown/invalid request state and malformed participant references without repairing them', async function () {
        await send().expect(201); const original = await db.collection('pickupRequests').findOne({ _id: new ObjectId(pickup.id) });
        for (const change of [{ status: 'withdrawn' }, { status: 'rejected' }, { active: false }, { receiverId: original.giverId }, { itemId: 'invalid' }, { planId: new ObjectId() }, { giverId: new ObjectId(stranger.id) }]) {
            const row = Object.assign({}, original, change); await db.collection('pickupRequests').replaceOne({ _id: row._id }, row);
            await unavailable(); assert.deepEqual(await db.collection('pickupRequests').findOne({ _id: row._id }), row);
        }
    });
    it('denies changed/deleted items and owners, missing participants, expired windows and past pending appointments', async function () {
        await send().expect(201); const itemRow = await db.collection('items').findOne({ _id: new ObjectId(item.id) });
        for (const change of [{ ownerId: new ObjectId(stranger.id) }, { planId: new ObjectId() }, { status: 'unlisted' }, { availableUntil: day(-1) }]) {
            await db.collection('items').replaceOne({ _id: itemRow._id }, Object.assign({}, itemRow, change)); await unavailable();
        }
        await db.collection('items').deleteOne({ _id: itemRow._id }); await unavailable(); await db.collection('items').insertOne(itemRow);
        const person = await db.collection('users').findOne({ _id: new ObjectId(receiver.id) });
        try { await db.collection('users').deleteOne({ _id: person._id }); await get().expect(404); await send(undefined, giver).expect(404); }
        finally { await db.collection('users').insertOne(person); }
        clock = new Date(new Date(pickup.proposedAt).getTime() + 1); await unavailable();
        clock = new Date(); await db.collection('pickupRequests').deleteOne({ _id: new ObjectId(pickup.id) }); await unavailable();
    });
    it('denies changed, inactive or deleted parent plans without exposing or rewriting their history', async function () {
        await send().expect(201); const original = await db.collection('moveOutPlans').findOne({ _id: new ObjectId(plan.id) });
        for (const change of [{ ownerId: new ObjectId(stranger.id) }, { status: 'completed' }, { pickupTimeZone: 'Asia/Kolkata' }]) {
            await db.collection('moveOutPlans').replaceOne({ _id: original._id }, Object.assign({}, original, change)); await unavailable();
        }
        await db.collection('moveOutPlans').deleteOne({ _id: original._id }); await unavailable();
        assert.equal(await db.collection('pickupMessages').countDocuments(), 1);
    });
    it('locks expired accepted conversations while preserving the existing reportable pickup record', async function () {
        const accepted = (await act('accept').expect(200)).body.request; await send().expect(201);
        clock = new Date(clock.getTime() + 40 * 86400000); await unavailable();
        const existing = (await request(app).get('/api/pickup-requests/' + pickup.id).set('Cookie', giver.cookie).expect(200)).body.request;
        assert.equal(existing.status, 'accepted'); assert.equal(existing.version, accepted.version);
        assert.equal(await db.collection('pickupMessages').countDocuments(), 1);
    });
    it('serializes a send against cancellation and never accepts a message after closure', async function () {
        const [message, cancelled] = await Promise.all([send(), act('cancel', pickup, receiver)]);
        assert.equal(cancelled.status, 200); assert.ok([201, 404].includes(message.status));
        assert.equal(await db.collection('pickupMessages').countDocuments(), message.status === 201 ? 1 : 0);
        await readOnly(message.status === 201 ? [message.body.message] : []); assert.equal(await db.collection('pickupMessages').countDocuments(), message.status === 201 ? 1 : 0);
    });
    it('preserves handoff, item clearance and competing request cancellation when messaging races completion', async function () {
        const competitor = (await write(request(app).post('/api/pickup-requests')).set('Cookie', stranger.cookie)
            .send({ itemId: item.id, localDateTime: day(1) + 'T13:00', timeZone: 'UTC' }).expect(201)).body.request;
        const accepted = (await act('accept').expect(200)).body.request; clock = new Date(new Date(accepted.proposedAt).getTime() + 1);
        const [message, completed] = await Promise.all([send(), act('complete', accepted)]);
        assert.equal(completed.status, 200); assert.ok([201, 404].includes(message.status)); await readOnly(message.status === 201 ? [message.body.message] : []);
        const owned = (await request(app).get('/api/move-out-plans/' + plan.id + '/items').set('Cookie', giver.cookie).expect(200)).body;
        assert.equal(owned.progress.cleared, 1); assert.equal(owned.items[0].status, 'cleared'); assert.equal(owned.items[0].isReserved, false);
        assert.equal((await request(app).get('/api/pickup-requests/' + competitor.id).set('Cookie', stranger.cookie).expect(200)).body.request.status, 'cancelled');
        await get('', stranger, competitor.id).expect(200);
        assert.deepEqual((await get('/messages', stranger, competitor.id).expect(200)).body.messages, []);
        await send(undefined, stranger, competitor.id).expect(404);
    });
});
