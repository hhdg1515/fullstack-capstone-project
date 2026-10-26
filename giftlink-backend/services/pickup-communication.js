const { ObjectId } = require('mongodb');
const { InventoryError, planTransaction } = require('./inventory');
const { eligible, fitsWindow } = require('./pickup-policy');

const isId = value => typeof value === 'string' && /^[a-fA-F0-9]{24}$/.test(value);
const unavailable = () => new InventoryError(404, 'CONVERSATION_UNAVAILABLE', 'Pickup conversation unavailable');
const invalidQuery = () => new InventoryError(400, 'INVALID_MESSAGE_QUERY', 'Use a limit of 1 to 50 and the older-message cursor for this request.');
const scoped = (id, userId) => ({ _id: new ObjectId(id), $or: [{ giverId: userId }, { receiverId: userId }] });
const messageResponse = (message, row) => ({ id: message._id.toString(), sender: message.senderId.equals(row.giverId) ? 'giver' : 'receiver',
    text: message.text, createdAt: message.createdAt.toISOString() });

function messageQuery(query, requestId) {
    if (Object.keys(query).some(key => !['limit', 'before'].includes(key)) ||
        query.limit !== undefined && (typeof query.limit !== 'string' || !/^(?:[1-9]|[1-4][0-9]|50)$/.test(query.limit))) throw invalidQuery();
    const result = { limit: query.limit === undefined ? 20 : Number(query.limit) };
    if (query.before !== undefined) {
        try {
            if (typeof query.before !== 'string' || query.before.length > 256 || !/^[a-zA-Z0-9_-]+$/.test(query.before)) throw invalidQuery();
            const token = JSON.parse(Buffer.from(query.before, 'base64url').toString('utf8'));
            if (!token || token.requestId !== requestId.toString() || !isId(token.id) || typeof token.at !== 'string' ||
                !Number.isFinite(new Date(token.at).getTime()) || new Date(token.at).toISOString() !== token.at ||
                Object.keys(token).sort().join(',') !== 'at,id,requestId') throw invalidQuery();
            result.before = { at: new Date(token.at), id: new ObjectId(token.id) };
        } catch (error) { throw invalidQuery(); }
    }
    return result;
}

function createPickupCommunicationService({ connectToDatabase, now = () => new Date() }) {
    async function authorize(db, userId, id, session, sending = false) {
        const row = await db.collection('pickupRequests').findOne(scoped(id, userId), { session });
        const open = row && ['pending', 'accepted'].includes(row.status);
        const closed = row && ['declined', 'cancelled', 'completed', 'no_show'].includes(row.status);
        if (!row || !open && !closed || row.active !== open || sending && !open ||
            !['giverId', 'receiverId', 'itemId', 'planId'].every(field => row[field] instanceof ObjectId) || row.giverId.equals(row.receiverId)) throw unavailable();
        // Participants are immutable in the existing lifecycle. Fail closed if
        // the requester reference disagrees with the original creation event.
        const created = Array.isArray(row.history) && row.history[0];
        if (!created || created.action !== 'pending' || created.actorRole !== 'receiver' ||
            !(created.actorId instanceof ObjectId) || !created.actorId.equals(row.receiverId)) throw unavailable();
        const plan = await db.collection('moveOutPlans').findOne({ _id: row.planId, ownerId: row.giverId }, { session });
        const item = await db.collection('items').findOne({ _id: row.itemId, planId: row.planId, ownerId: row.giverId }, { session });
        if (!plan || !item) throw unavailable();
        // Closed history survives legitimate listing/plan/time changes; ownership
        // and participant checks still apply. Open requests retain their policy.
        const at = now();
        if (open && (!eligible(item, plan, at) || !(row.proposedAt instanceof Date) ||
            !fitsWindow(row, item, plan) || row.status === 'pending' && row.proposedAt <= at)) throw unavailable();
        const people = await db.collection('users').find({ _id: { $in: [row.giverId, row.receiverId] } }, { session, projection: { firstName: 1 } }).toArray();
        if (people.length !== 2) throw unavailable();
        return { row, people };
    }
    async function read(userId, id, operation) {
        if (!isId(id)) throw unavailable();
        const db = await connectToDatabase(); const session = db.client.startSession();
        try {
            return await session.withTransaction(async () => operation(db, await authorize(db, userId, id, session), session),
                { readConcern: { level: 'snapshot' }, readPreference: 'primary' });
        } catch (error) {
            if (error.code === 20) throw new InventoryError(503, 'TRANSACTIONS_REQUIRED', 'Pickup conversations require a MongoDB replica set.');
            throw error;
        } finally { await session.endSession(); }
    }
    async function detail(userId, id) {
        return read(userId, id, async (db, context) => {
            const row = context.row; const giver = userId.equals(row.giverId);
            const person = context.people.find(user => !user._id.equals(userId));
            return { conversation: { id: row._id.toString(), requestId: row._id.toString(), status: row.status,
                role: giver ? 'giver' : 'receiver', counterpart: { firstName: person.firstName } } };
        });
    }
    async function messages(userId, id, query) {
        return read(userId, id, async (db, context, session) => {
            const row = context.row; const paging = messageQuery(query, row._id);
            const filter = { requestId: row._id, senderId: { $in: [row.giverId, row.receiverId] } };
            if (paging.before) filter.$or = [{ createdAt: { $lt: paging.before.at } }, { createdAt: paging.before.at, _id: { $lt: paging.before.id } }];
            const rows = await db.collection('pickupMessages').find(filter, { session }).sort({ createdAt: -1, _id: -1 }).limit(paging.limit + 1).toArray();
            const selected = rows.slice(0, paging.limit); const oldest = selected[selected.length - 1];
            const nextCursor = rows.length > paging.limit ? Buffer.from(JSON.stringify({ requestId: row._id.toString(),
                at: oldest.createdAt.toISOString(), id: oldest._id.toString() })).toString('base64url') : null;
            return { messages: selected.reverse().map(message => messageResponse(message, row)), nextCursor };
        });
    }
    async function send(userId, id, text) {
        if (!isId(id)) throw unavailable();
        const db = await connectToDatabase();
        // Scope the initial lookup before acquiring the existing plan write boundary.
        const original = await db.collection('pickupRequests').findOne(scoped(id, userId));
        if (!original || !(original.giverId instanceof ObjectId) || !(original.planId instanceof ObjectId)) throw unavailable();
        try {
            return await planTransaction(db, original.giverId, original.planId.toString(), async (plan, session) => {
                const context = await authorize(db, userId, id, session, true);
                if (!context.row.planId.equals(plan._id) || !context.row.giverId.equals(plan.ownerId)) throw unavailable();
                const message = { _id: new ObjectId(), requestId: context.row._id, senderId: userId, text, createdAt: now() };
                await db.collection('pickupMessages').insertOne(message, { session });
                return { message: messageResponse(message, context.row) };
            });
        } catch (error) {
            if (error.code === 'ITEM_NOT_FOUND') throw unavailable();
            throw error;
        }
    }
    return { detail, messages, send };
}

module.exports = { createPickupCommunicationService };
