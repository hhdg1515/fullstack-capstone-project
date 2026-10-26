const assert = require('node:assert/strict');
const request = require('supertest');
const { ObjectId } = require('mongodb');
const pino = require('pino');
const createApp = require('../app');
const { createIsolatedMongo } = require('./helpers/isolated-mongo');
const { prepareDatabaseIndexes } = require('../services/database-indexes');
const write = operation => operation.set('Origin', 'http://localhost:3000').set('X-CSRF-Protection', '1');

describe('transactional pickup rescheduling on verified disposable MongoDB', function () {
    this.timeout(180000);
    let isolated, db, app, clock, giver, receiver, outsider, plan, item, accepted, pendingOther;
    const day = n => new Date(clock.getTime() + n * 86400000).toISOString().slice(0, 10);
    const root = row => '/api/pickup-requests/' + row.id;
    const get = (row = accepted, user = giver) => request(app).get(root(row)).set('Cookie', user.cookie);
    const act = (row, action, user = giver) => write(request(app).post(root(row) + '/actions')).set('Cookie', user.cookie).send({ action, version: row.version });
    const propose = (user = giver, row = accepted, changes = {}) => write(request(app).post(root(row) + '/reschedule-proposals')).set('Cookie', user.cookie)
        .send(Object.assign({ version: row.version, localDateTime: day(4) + 'T15:00', timeZone: 'UTC' }, changes));
    const respond = (row, user, action, proposalId = row.rescheduling.proposal.id) => write(request(app).post(root(row) + '/reschedule-proposals/' + proposalId + '/actions'))
        .set('Cookie', user.cookie).send({ version: row.version, action });
    const planEdit = changes => write(request(app).patch('/api/move-out-plans/' + plan.id)).set('Cookie', giver.cookie).send(changes);
    const itemEdit = changes => write(request(app).patch('/api/move-out-plans/' + plan.id + '/items/' + item.id)).set('Cookie', giver.cookie).send(Object.assign({ version: item.version }, changes));
    const withdraw = () => write(request(app).post('/api/move-out-plans/' + plan.id + '/items/' + item.id + '/actions')).set('Cookie', giver.cookie)
        .send({ version: item.version, action: 'unlist', confirmCancelRequests: true });
    const snapshot = row => db.collection('pickupRequests').findOne({ _id: new ObjectId(row.id) });
    before(async function () {
        isolated = await createIsolatedMongo(); db = isolated.db; await prepareDatabaseIndexes(db);
        app = createApp({ connectToDatabase: async () => db, logger: pino({ level: 'silent' }) });
        const account = async firstName => {
            const result = await write(request(app).post('/api/auth/register')).send({ firstName, lastName: 'Private', email: firstName.toLowerCase() + '@example.invalid', password: 'isolated-rescheduling-password' }).expect(201);
            return { id: result.body.user.id, cookie: result.headers['set-cookie'][0].split(';')[0] };
        };
        giver = await account('Giver'); receiver = await account('Receiver'); outsider = await account('Outsider');
    });
    after(async function () { if (isolated) await isolated.close(); });
    beforeEach(async function () {
        clock = new Date(); app = createApp({ connectToDatabase: async () => db, pickupNow: () => new Date(clock), logger: pino({ level: 'silent' }) });
        for (const collection of ['pickupMessages', 'pickupRequests', 'items', 'moveOutPlans']) await db.collection(collection).deleteMany({});
        plan = (await write(request(app).post('/api/move-out-plans')).set('Cookie', giver.cookie)
            .send({ moveOutDeadline: day(30), city: 'Oakland', neighborhood: 'Temescal', pickupTimeZone: 'UTC' }).expect(201)).body.plan;
        item = (await write(request(app).post('/api/move-out-plans/' + plan.id + '/items')).set('Cookie', giver.cookie).send({ name: 'Local desk', publish: true }).expect(201)).body.item;
        clock = new Date();
        const create = async user => (await write(request(app).post('/api/pickup-requests')).set('Cookie', user.cookie)
            .send({ itemId: item.id, localDateTime: day(2) + 'T12:00', timeZone: 'UTC' }).expect(201)).body.request;
        const row = await create(receiver); pendingOther = await create(outsider); accepted = (await act(row, 'accept').expect(200)).body.request;
    });
    [true, false].forEach(ownerProposes => ['accept', 'decline'].forEach(action => it((ownerProposes ? 'giver' : 'requester') + ' proposes and the other participant can ' + action, async function () {
        const proposer = ownerProposes ? giver : receiver, other = ownerProposes ? receiver : giver;
        const proposed = (await propose(proposer).expect(201)).body.request; const proposal = proposed.rescheduling.proposal;
        assert.equal(proposed.status, 'accepted'); assert.equal(proposed.proposedAt, accepted.proposedAt); assert.equal(proposed.localDateTime, accepted.localDateTime);
        assert.equal(proposed.version, accepted.version + 1); assert.equal(proposal.proposedBy, ownerProposes ? 'giver' : 'receiver'); assert.equal(proposal.createdAt, clock.toISOString());
        assert.equal(proposed.rescheduling.canAccept, false); assert.equal(proposed.rescheduling.canDecline, false);
        const otherView = (await get(proposed, other).expect(200)).body.request; assert.equal(otherView.rescheduling.canAccept, true); assert.equal(otherView.rescheduling.canDecline, true);
        const result = (await respond(proposed, other, action).expect(200)).body.request;
        assert.equal(result.proposedAt, action === 'accept' ? proposal.proposedAt : accepted.proposedAt);
        assert.equal(result.version, proposed.version + 1); assert.equal(result.status, 'accepted'); assert.equal(result.rescheduling.proposal, null);
        const event = result.history[result.history.length - 1]; assert.equal(event.action, 'reschedule_' + (action === 'accept' ? 'accepted' : 'declined'));
        assert.equal(event.reschedule.previousAppointment.proposedAt, accepted.proposedAt); assert.equal(event.reschedule.proposal.id, proposal.id);
        assert.equal(result.acceptedAt, accepted.acceptedAt);
        const stored = await snapshot(result); assert.equal(stored.active, true); assert.equal(stored.rescheduleProposal, undefined);
        const text = JSON.stringify(result); for (const value of [giver.id, receiver.id, 'giver@example.invalid', 'receiver@example.invalid', 'proposedById', 'actorId']) assert.ok(!text.includes(value));
    })));
    [true, false].forEach(owner => it('refuses self-response by the ' + (owner ? 'giver' : 'requester'), async function () {
        const user = owner ? giver : receiver; const row = (await propose(user).expect(201)).body.request; const before = await snapshot(row);
        for (const action of ['accept', 'decline']) assert.equal((await respond(row, user, action).expect(409)).body.error.code, 'OWN_PROPOSAL');
        assert.deepEqual(await snapshot(row), before);
    }));
    it('requires sessions/CSRF and rejects client identity, unexpected fields, malformed IDs and nonnumeric versions', async function () {
        await write(request(app).post(root(accepted) + '/reschedule-proposals')).send({}).expect(401);
        await request(app).post(root(accepted) + '/reschedule-proposals').set('Cookie', giver.cookie).send({}).expect(403);
        for (const key of ['giverId', 'receiverId', 'proposedById', 'status', 'proposedAt', 'proposalId', 'ownerId']) await propose(giver, accepted, { [key]: outsider.id }).expect(400);
        await propose(giver, accepted, { version: String(accepted.version) }).expect(400);
        await propose(outsider).expect(404); await get(accepted, outsider).expect(404);
        const row = (await propose().expect(201)).body.request;
        await respond(row, outsider, 'accept').expect(404); await respond(row, receiver, 'accept', 'invalid-id').expect(404);
        await respond(row, receiver, 'approve').expect(400);
        await write(request(app).post(root(row) + '/reschedule-proposals/' + row.rescheduling.proposal.id + '/actions')).set('Cookie', receiver.cookie)
            .send({ action: 'accept', version: row.version, proposedById: receiver.id }).expect(400);
        await propose(giver, Object.assign({}, row, { id: item.id })).expect(404);
    });
    it('refuses overwrite, stale versions and an old proposal identity after a different proposal is created', async function () {
        const row = (await propose().expect(201)).body.request;
        assert.equal((await propose(receiver, row).expect(409)).body.error.code, 'RESCHEDULE_PENDING');
        assert.equal((await propose(receiver).expect(409)).body.error.code, 'PICKUP_CHANGED');
        const declined = (await respond(row, receiver, 'decline').expect(200)).body.request;
        const second = (await propose(giver, declined).expect(201)).body.request;
        assert.notEqual(second.rescheduling.proposal.id, row.rescheduling.proposal.id);
        assert.equal((await respond(second, receiver, 'accept', row.rescheduling.proposal.id).expect(409)).body.error.code, 'PROPOSAL_CHANGED');
        await respond(row, receiver, 'accept').expect(409);
    });
    it('rejects invalid calendar times, past times, offsets, mismatched zones, no-op changes and deadline/window violations', async function () {
        for (const localDateTime of ['2030-02-30T12:00', '2020-01-01T12:00', day(31) + 'T12:00', accepted.localDateTime]) await propose(giver, accepted, { localDateTime }).expect(400);
        for (const timeZone of ['+05:30', 'Not/A_Zone', 'Asia/Kolkata']) await propose(giver, accepted, { timeZone }).expect(409);
        await itemEdit({ availableFrom: day(1), availableUntil: day(5) }).expect(200);
        await propose(giver, accepted, { localDateTime: day(0) + 'T23:00' }).expect(400);
        await propose(giver, accepted, { localDateTime: day(6) + 'T12:00' }).expect(400);
        assert.equal((await snapshot(accepted)).rescheduleProposal, undefined);
    });
    it('preserves DST rejection and the existing UTC cutoff for explicit location timezones', async function () {
        clock = new Date('2030-03-01T00:00:00Z');
        const zonePlan = (await write(request(app).post('/api/move-out-plans')).set('Cookie', giver.cookie)
            .send({ moveOutDeadline: '2030-12-01', city: 'Oakland', neighborhood: 'Temescal', pickupTimeZone: 'America/Los_Angeles' }).expect(201)).body.plan;
        const zoneItem = (await write(request(app).post('/api/move-out-plans/' + zonePlan.id + '/items')).set('Cookie', giver.cookie).send({ name: 'DST desk', publish: true }).expect(201)).body.item;
        let row = (await write(request(app).post('/api/pickup-requests')).set('Cookie', receiver.cookie)
            .send({ itemId: zoneItem.id, localDateTime: '2030-03-15T12:00', timeZone: 'America/Los_Angeles' }).expect(201)).body.request;
        row = (await act(row, 'accept').expect(200)).body.request;
        for (const localDateTime of ['2030-03-10T02:30', '2030-11-03T01:30']) {
            const result = await propose(giver, row, { localDateTime, timeZone: 'America/Los_Angeles' }).expect(400); assert.equal(result.body.error.code, 'INVALID_APPOINTMENT');
        }
        await propose(giver, row, { localDateTime: '2030-12-01T23:00', timeZone: 'America/Los_Angeles' }).expect(400);
        const proposed = (await propose(giver, row, { localDateTime: '2030-03-16T12:00', timeZone: 'America/Los_Angeles' }).expect(201)).body.request;
        assert.equal(proposed.rescheduling.proposal.proposedAt, '2030-03-16T19:00:00.000Z');
    });
    it('rejects elapsed proposal acceptance but permits the other participant to decline without changing confirmation', async function () {
        const row = (await propose(giver, accepted, { localDateTime: day(1) + 'T12:00' }).expect(201)).body.request;
        clock = new Date(new Date(row.rescheduling.proposal.proposedAt).getTime() + 1);
        const dto = (await get(row, receiver).expect(200)).body.request; assert.equal(dto.rescheduling.canAccept, false); assert.equal(dto.rescheduling.canDecline, true);
        assert.equal((await respond(row, receiver, 'accept').expect(409)).body.error.code, 'PROPOSAL_UNAVAILABLE');
        assert.equal((await respond(row, receiver, 'decline').expect(200)).body.request.proposedAt, accepted.proposedAt);
    });
    it('cannot move an elapsed confirmed appointment or evade the established handoff/no-show boundary', async function () {
        const row = (await propose().expect(201)).body.request; clock = new Date(new Date(accepted.proposedAt).getTime() + 1);
        const before = await snapshot(row); await propose(receiver, row).expect(409); await respond(row, receiver, 'accept').expect(409);
        assert.deepEqual(await snapshot(row), before); assert.equal((await get(row).expect(200)).body.request.rescheduling.reason, 'appointment_passed');
        const result = (await respond(row, receiver, 'decline').expect(200)).body.request; assert.equal(result.proposedAt, accepted.proposedAt);
        await act(result, 'no_show').expect(200);
    });
    it('serializes concurrent proposals and preserves exactly one outstanding proposal and event', async function () {
        const results = await Promise.all([propose(giver), propose(receiver)]); assert.deepEqual(results.map(value => value.status).sort(), [201, 409]);
        const row = await snapshot(accepted); assert.ok(row.rescheduleProposal); assert.equal(row.version, accepted.version + 1);
        assert.equal(row.history.filter(event => event.action === 'reschedule_proposed').length, 1);
    });
    it('serializes acceptance against cancellation using the same request version without resurrecting a request', async function () {
        const row = (await propose().expect(201)).body.request;
        const results = await Promise.all([respond(row, receiver, 'accept'), act(row, 'cancel', giver)]);
        assert.deepEqual(results.map(value => value.status).sort(), [200, 409]);
        const final = (await get().expect(200)).body.request; assert.equal(final.rescheduling.proposal, null); assert.equal(final.version, row.version + 1);
        if (final.status === 'cancelled') { assert.equal(final.proposedAt, accepted.proposedAt); await propose(giver, final).expect(409); }
        else assert.equal(final.proposedAt, row.rescheduling.proposal.proposedAt);
    });
    it('records only one winning response to concurrent accept/decline decisions', async function () {
        const row = (await propose().expect(201)).body.request; const results = await Promise.all([respond(row, receiver, 'accept'), respond(row, receiver, 'decline')]);
        assert.deepEqual(results.map(value => value.status).sort(), [200, 409]);
        const final = await snapshot(row); assert.equal(final.history.filter(event => ['reschedule_accepted', 'reschedule_declined'].includes(event.action)).length, 1);
    });
    it('cannot survive or resurrect an accepted reservation after concurrent confirmed withdrawal', async function () {
        const row = (await propose().expect(201)).body.request; const results = await Promise.all([respond(row, receiver, 'accept'), withdraw()]);
        assert.ok([200, 409].includes(results[0].status)); assert.equal(results[1].status, 200);
        const final = (await get().expect(200)).body.request; assert.equal(final.status, 'cancelled'); assert.equal(final.rescheduling.proposal, null);
        await respond(final, receiver, 'accept', row.rescheduling.proposal.id).expect(409);
        assert.ok(final.history.some(event => event.action === 'reschedule_invalidated' || event.action === 'reschedule_accepted'));
    });
    it('clears a proposal atomically on plan closure or timezone change with the existing cancellation confirmation', async function () {
        const row = (await propose().expect(201)).body.request;
        await planEdit({ pickupTimeZone: 'Asia/Kolkata' }).expect(409);
        assert.ok((await snapshot(row)).rescheduleProposal);
        await planEdit({ pickupTimeZone: 'Asia/Kolkata', status: 'completed', confirmCancelRequests: true }).expect(200);
        const final = (await get().expect(200)).body.request; assert.equal(final.status, 'cancelled'); assert.equal(final.rescheduling.proposal, null);
        assert.equal(final.history[final.history.length - 2].action, 'reschedule_invalidated');
    });
    it('clears only a proposal invalidated by a shorter plan deadline, without cancelling valid pickups', async function () {
        const row = (await propose(giver, accepted, { localDateTime: day(10) + 'T12:00' }).expect(201)).body.request;
        const unrelated = await snapshot(pendingOther); await planEdit({ moveOutDeadline: day(5) }).expect(200);
        const final = (await get().expect(200)).body.request; assert.equal(final.status, 'accepted'); assert.equal(final.proposedAt, accepted.proposedAt);
        assert.equal(final.rescheduling.proposal, null); assert.equal(final.version, row.version + 1);
        assert.equal(final.history[final.history.length - 1].reason, 'proposal_window_changed'); assert.deepEqual(await snapshot(pendingOther), unrelated);
    });
    it('clears only a proposal outside edited item availability and retains the confirmed appointment', async function () {
        const row = (await propose().expect(201)).body.request; await itemEdit({ availableUntil: day(3) }).expect(200);
        const final = (await get().expect(200)).body.request; assert.equal(final.proposedAt, accepted.proposedAt); assert.equal(final.status, 'accepted');
        assert.equal(final.rescheduling.proposal, null); assert.equal(final.version, row.version + 1);
    });
    ['cancel', 'complete', 'no_show'].forEach(action => it('clears pending proposals on ' + action + ' without waiting for an unconfirmed time', async function () {
        const row = (await propose().expect(201)).body.request;
        if (action !== 'cancel') clock = new Date(new Date(accepted.proposedAt).getTime() + 1);
        const final = (await act(row, action).expect(200)).body.request; assert.equal(final.rescheduling.proposal, null);
        assert.equal(final.proposedAt, accepted.proposedAt); assert.equal(final.version, row.version + 1);
        assert.equal(final.history[final.history.length - 2].action, 'reschedule_invalidated');
        assert.equal(final.rescheduling.canPropose, false); assert.equal(final.rescheduling.canAccept, false); assert.equal(final.rescheduling.canDecline, false);
        await propose(giver, final).expect(409); await respond(final, receiver, 'accept', row.rescheduling.proposal.id).expect(409);
    }));
    it('declined and pending requests cannot create or respond to a time change', async function () {
        await propose(outsider, pendingOther).expect(409);
        const declined = (await act(pendingOther, 'decline').expect(200)).body.request;
        await propose(outsider, declined).expect(409); await respond(declined, giver, 'accept', new ObjectId().toString()).expect(409);
    });
    it('preserves reservation exclusivity while a proposal waits and after acceptance', async function () {
        const row = (await propose().expect(201)).body.request;
        await write(request(app).post('/api/pickup-requests')).set('Cookie', outsider.cookie)
            .send({ itemId: item.id, localDateTime: day(5) + 'T12:00', timeZone: 'UTC' }).expect(409);
        await act(pendingOther, 'accept').expect(409); await respond(row, receiver, 'accept').expect(200);
        assert.equal(await db.collection('pickupRequests').countDocuments({ itemId: new ObjectId(item.id), status: 'accepted' }), 1);
    });
    it('rejects deleted, invalid or substituted participant/ownership references without repairing records', async function () {
        await act(pendingOther, 'decline').expect(200);
        const original = await snapshot(accepted);
        for (const change of [{ receiverId: new ObjectId(outsider.id) }, { planId: new ObjectId() }, { itemId: new ObjectId() }, { history: [] }]) {
            const corrupted = Object.assign({}, original, change); await db.collection('pickupRequests').replaceOne({ _id: original._id }, corrupted);
            await propose().expect(404); await propose(outsider).expect(404); assert.deepEqual(await snapshot(accepted), corrupted);
        }
        await db.collection('pickupRequests').replaceOne({ _id: original._id }, original);
        await db.collection('items').updateOne({ _id: new ObjectId(item.id) }, { $set: { ownerId: new ObjectId(outsider.id) } }); await propose().expect(404);
        await db.collection('items').deleteOne({ _id: new ObjectId(item.id) }); await propose().expect(404);
        await db.collection('moveOutPlans').deleteOne({ _id: new ObjectId(plan.id) }); await propose().expect(404);
    });
    it('serializes proposal acceptance against plan closure without resurrecting the pickup', async function () {
        const row = (await propose().expect(201)).body.request;
        const results = await Promise.all([respond(row, receiver, 'accept'), planEdit({ status: 'completed', confirmCancelRequests: true })]);
        assert.ok([200, 409].includes(results[0].status)); assert.equal(results[1].status, 200);
        const final = (await get().expect(200)).body.request; assert.equal(final.status, 'cancelled'); assert.equal(final.rescheduling.proposal, null);
        await propose(receiver, final).expect(409);
    });
    it('preserves the existing confirmation when a deadline change invalidates confirmed pickups', async function () {
        const row = (await propose().expect(201)).body.request; const before = await snapshot(row);
        const failure = await planEdit({ moveOutDeadline: day(1) }).expect(409);
        assert.equal(failure.body.error.code, 'PICKUP_CONFIRMATION_REQUIRED'); assert.equal(failure.body.error.affectedRequests, 2);
        assert.deepEqual(await snapshot(row), before);
        await planEdit({ moveOutDeadline: day(1), confirmCancelRequests: true }).expect(200);
        const final = (await get().expect(200)).body.request; assert.equal(final.status, 'cancelled'); assert.equal(final.rescheduling.proposal, null);
    });
    it('does not reinterpret a proposal after a separately confirmed timezone change', async function () {
        const row = (await propose().expect(201)).body.request;
        await planEdit({ pickupTimeZone: 'Asia/Kolkata', confirmCancelRequests: true }).expect(200);
        const final = (await get().expect(200)).body.request; assert.equal(final.status, 'cancelled'); assert.equal(final.proposedAt, accepted.proposedAt);
        assert.equal(final.history[final.history.length - 2].reason, 'timezone_changed');
        await respond(final, receiver, 'accept', row.rescheduling.proposal.id).expect(409);
    });
    it('rejects inconsistent stored proposal times/proposers rather than confirming or silently repairing them', async function () {
        const row = (await propose().expect(201)).body.request; const before = await snapshot(row);
        const corrupted = Object.assign({}, before, { rescheduleProposal: Object.assign({}, before.rescheduleProposal, { proposedAt: new Date(before.rescheduleProposal.proposedAt.getTime() + 60000) }) });
        await db.collection('pickupRequests').replaceOne({ _id: before._id }, corrupted); await respond(row, receiver, 'accept').expect(409);
        assert.deepEqual(await snapshot(row), corrupted);
        corrupted.rescheduleProposal.proposedById = new ObjectId(outsider.id);
        await db.collection('pickupRequests').replaceOne({ _id: before._id }, corrupted); await respond(row, receiver, 'accept').expect(409);
        assert.equal((await get().expect(200)).body.request.rescheduling.proposal, null); assert.deepEqual(await snapshot(row), corrupted);
    });
    it('refuses scheduling when the other original account no longer exists', async function () {
        const person = await db.collection('users').findOne({ _id: new ObjectId(receiver.id) });
        try { await db.collection('users').deleteOne({ _id: person._id }); await propose().expect(404); }
        finally { await db.collection('users').insertOne(person); }
    });
    it('uses the newly confirmed appointment for existing handoff and no-show eligibility', async function () {
        const proposed = (await propose().expect(201)).body.request; const row = (await respond(proposed, receiver, 'accept').expect(200)).body.request;
        clock = new Date(new Date(accepted.proposedAt).getTime() + 1);
        await act(row, 'complete').expect(409); await act(row, 'no_show').expect(409);
        clock = new Date(new Date(row.proposedAt).getTime() + 1);
        const final = (await act(row, 'no_show').expect(200)).body.request; assert.equal(final.status, 'no_show'); assert.equal(final.proposedAt, row.proposedAt);
    });
    it('does not change unrelated requests, inventory or private messages, and maintains historical appointment snapshots', async function () {
        const unrelated = await snapshot(pendingOther); const inventory = await db.collection('items').find({}).toArray();
        const endpoint = root(accepted) + '/conversation/messages';
        await write(request(app).post(endpoint)).set('Cookie', receiver.cookie).send({ text: 'Private discussion stays separate.' }).expect(201);
        const messages = await db.collection('pickupMessages').find({}).toArray();
        const row = (await propose().expect(201)).body.request; const final = (await respond(row, receiver, 'accept').expect(200)).body.request;
        assert.deepEqual(await snapshot(pendingOther), unrelated); assert.deepEqual(await db.collection('items').find({}).toArray(), inventory);
        assert.deepEqual(await db.collection('pickupMessages').find({}).toArray(), messages);
        assert.equal((await request(app).get(endpoint).set('Cookie', giver.cookie).expect(200)).body.messages.length, 1);
        const events = final.history.filter(event => event.action.startsWith('reschedule_')); assert.equal(events.length, 2);
        assert.ok(events.every(event => event.reschedule.previousAppointment.proposedAt === accepted.proposedAt));
        const snapshotBefore = await snapshot(final); await get(final).expect(200); assert.deepEqual(await snapshot(final), snapshotBefore);
    });
});
