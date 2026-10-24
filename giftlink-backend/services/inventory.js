const { ObjectId } = require('mongodb');
const { todayUTC } = require('./calendar');

class InventoryError extends Error {
    constructor(status, code, message, details = {}) {
        super(message); Object.assign(this, { status, code, details });
    }
}
const notFound = () => new InventoryError(404, 'ITEM_NOT_FOUND', 'Item or plan not found');
const endDate = (item, plan) => item.availableUntil || plan.moveOutDeadline;
const effectiveStatus = (item, plan) => item.status === 'available' && endDate(item, plan) < todayUTC() ? 'expired' : item.status;
function dateConflicts(item, plan) {
    const end = endDate(item, plan);
    return end > plan.moveOutDeadline || Boolean(item.availableFrom && item.availableFrom > end);
}
function validateDates(item, plan, publishing = false) {
    if (dateConflicts(item, plan) || (publishing && endDate(item, plan) < todayUTC())) {
        throw new InventoryError(400, 'INVALID_AVAILABILITY', 'Pickup dates must be in order and end by the plan deadline. Publication or reopening also needs an end date of today or later (UTC).');
    }
}
function listingPolicy(item) {
    const text = item.name + '\n' + item.description + '\n' + item.category;
    if (/\b(firearms?|ammunition|explosives?|heroin|cocaine|fentanyl)\b/i.test(text) || /[^\s@]+@[^\s@]+\.[^\s@]+/.test(text)) {
        throw new InventoryError(400, 'LISTING_POLICY', 'Offer safe, lawful household goods and remove email/contact details before publishing. Restricted goods cannot be listed.');
    }
}
async function planTransaction(db, ownerId, planId, operation) {
    const session = db.client.startSession();
    try {
        return await session.withTransaction(async () => {
            const filter = { _id: new ObjectId(planId), ownerId };
            const plan = await db.collection('moveOutPlans').findOne(filter, { session });
            if (!plan) throw notFound();
            // All plan and item writes touch this record. Snapshot isolation plus
            // the write conflict/retry prevents deadline/item write skew.
            await db.collection('moveOutPlans').updateOne(filter, { $inc: { inventoryRevision: 1 } }, { session });
            return operation(plan, session);
        }, { readConcern: { level: 'snapshot' }, writeConcern: { w: 'majority' }, readPreference: 'primary' });
    } catch (error) {
        if (error.code === 20) throw new InventoryError(503, 'TRANSACTIONS_REQUIRED', 'Inventory updates require a MongoDB replica set. Check the documented local setup.');
        throw error;
    } finally { await session.endSession(); }
}
function itemResponse(item, plan, privateResponse = true) {
    const result = { id: item._id.toString(), name: item.name, description: item.description, category: item.category,
        status: effectiveStatus(item, plan), availableFrom: item.availableFrom, availableUntil: item.availableUntil,
        effectiveAvailableUntil: endDate(item, plan), city: plan.city, neighborhood: plan.neighborhood,
        moveOutDeadline: plan.moveOutDeadline, publishedAt: item.publishedAt ? item.publishedAt.toISOString() : null };
    if (privateResponse) Object.assign(result, { planId: plan._id.toString(), version: item.version,
        createdAt: item.createdAt.toISOString(), updatedAt: item.updatedAt.toISOString(),
        isPublic: effectiveStatus(item, plan) === 'available' && plan.status === 'active' && Boolean(item.publishedAt) });
    return result;
}
function createInventoryService({ connectToDatabase }) {
    async function list(ownerId, planId) {
        const db = await connectToDatabase();
        const rows = await db.collection('moveOutPlans').aggregate([
            { $match: { _id: new ObjectId(planId), ownerId } },
            { $lookup: { from: 'items', let: { parent: '$_id', owner: '$ownerId' }, pipeline: [
                { $match: { $expr: { $and: [{ $eq: ['$planId', '$$parent'] }, { $eq: ['$ownerId', '$$owner'] }] } } },
                { $sort: { createdAt: 1, _id: 1 } }
            ], as: 'items' } }
        ], { readConcern: { level: 'snapshot' } }).toArray();
        const plan = rows[0];
        if (!plan) throw notFound();
        const items = plan.items.map(item => itemResponse(item, plan));
        return { items, plan: { id: plan._id.toString(), title: plan.title, city: plan.city, neighborhood: plan.neighborhood,
            moveOutDeadline: plan.moveOutDeadline, status: plan.status },
            progress: { total: items.length, cleared: items.filter(item => item.status === 'cleared').length } };
    }
    async function create(ownerId, planId, input) {
        const db = await connectToDatabase();
        return planTransaction(db, ownerId, planId, async (plan, session) => {
            const now = new Date();
            const item = { _id: new ObjectId(), planId: plan._id, ownerId, name: input.name,
                description: input.description || '', category: input.category || '', availableFrom: input.availableFrom || null,
                availableUntil: input.availableUntil || null, status: input.publish ? 'available' : 'draft',
                version: 1, createdAt: now, updatedAt: now, publishedAt: input.publish ? now : null };
            validateDates(item, plan, input.publish);
            if (input.publish) {
                if (plan.status !== 'active') throw new InventoryError(409, 'PLAN_INACTIVE', 'Activate this plan before publishing items.');
                listingPolicy(item);
            }
            await db.collection('items').insertOne(item, { session });
            return { item: itemResponse(item, plan) };
        });
    }
    async function mutate(ownerId, planId, itemId, input, action) {
        const db = await connectToDatabase();
        return planTransaction(db, ownerId, planId, async (plan, session) => {
            const filter = { _id: new ObjectId(itemId), planId: plan._id, ownerId };
            const existing = await db.collection('items').findOne(filter, { session });
            if (!existing) throw notFound();
            if (input.version !== existing.version) throw new InventoryError(409, 'ITEM_CHANGED', 'This item changed. Reload the inventory and review it before trying again.');
            const item = Object.assign({}, existing);
            if (action) {
                const status = effectiveStatus(existing, plan);
                if (action === 'publish' && ['draft', 'unlisted', 'expired'].includes(status)) {
                    if (plan.status !== 'active') throw new InventoryError(409, 'PLAN_INACTIVE', 'Activate this plan before publishing items.');
                    validateDates(item, plan, true); listingPolicy(item);
                    item.status = 'available'; item.publishedAt = item.publishedAt || new Date();
                } else if (action === 'unlist' && ['available', 'expired'].includes(status)) item.status = 'unlisted';
                else if (action === 'clear' && status !== 'cleared') item.status = 'cleared';
                else if (action === 'reopen' && status === 'cleared') { validateDates(item, plan, true); item.status = 'draft'; }
                else throw new InventoryError(409, 'INVALID_TRANSITION', 'This action is unavailable for the current item state. Reload the inventory.');
            } else {
                for (const field of ['name', 'description', 'category', 'availableFrom', 'availableUntil']) {
                    if (Object.prototype.hasOwnProperty.call(input, field)) item[field] = input[field];
                }
                validateDates(item, plan);
                if (effectiveStatus(existing, plan) === 'expired' || (item.status === 'available' && endDate(item, plan) < todayUTC())) item.status = 'expired';
                if (item.status === 'available') listingPolicy(item);
            }
            item.updatedAt = new Date(); item.version++;
            await db.collection('items').replaceOne(filter, item, { session });
            return { item: itemResponse(item, plan) };
        });
    }

    return { list, create, mutate };
}
module.exports = { createInventoryService, InventoryError, planTransaction, dateConflicts, endDate, effectiveStatus };
