const { ObjectId } = require('mongodb');
const { todayUTC, isCalendarDate } = require('./calendar');
const { planTransaction, dateConflicts, effectiveStatus, InventoryError } = require('./inventory');

const planProjection = { title: 1, moveOutDeadline: 1, city: 1, neighborhood: 1, status: 1, createdAt: 1, updatedAt: 1 };
function privatePlan(plan) {
    return { id: plan._id.toString(), title: plan.title, moveOutDeadline: plan.moveOutDeadline,
        city: plan.city, neighborhood: plan.neighborhood, status: plan.status,
        createdAt: plan.createdAt.toISOString(), updatedAt: plan.updatedAt.toISOString() };
}

function createPlanService({ connectToDatabase }) {
    const owned = (id, ownerId) => ({ _id: new ObjectId(id), ownerId });
    async function create(ownerId, data) {
        const db = await connectToDatabase();
        const now = new Date();
        const plan = { ownerId, title: data.title || '', moveOutDeadline: data.moveOutDeadline,
            city: data.city, neighborhood: data.neighborhood, status: 'active', createdAt: now, updatedAt: now };
        const result = await db.collection('moveOutPlans').insertOne(plan);
        plan._id = result.insertedId;
        return privatePlan(plan);
    }
    async function list(ownerId) {
        const db = await connectToDatabase();
        const plans = await db.collection('moveOutPlans').find({ ownerId }, {
            projection: planProjection, collation: { locale: 'simple' }
        }).sort({ moveOutDeadline: 1, _id: 1 }).toArray();
        return plans.map(privatePlan);
    }
    async function find(id, ownerId) {
        const db = await connectToDatabase();
        const plan = await db.collection('moveOutPlans').findOne(owned(id, ownerId), { projection: planProjection });
        return plan ? privatePlan(plan) : null;
    }
    async function update(id, ownerId, changes) {
        const db = await connectToDatabase();
        return planTransaction(db, ownerId, id, async (previous, session) => {
            const next = Object.assign({}, previous, changes);
            if (next.moveOutDeadline !== previous.moveOutDeadline && next.moveOutDeadline < todayUTC()) {
                throw new InventoryError(400, 'VALIDATION_FAILED', 'Choose today or a later deadline (UTC).');
            }
            const items = await db.collection('items').find({ planId: previous._id, ownerId }, { session }).toArray();
            const affected = items.filter(item => dateConflicts(item, next));
            if (affected.length) throw new InventoryError(409, 'ITEM_DATE_CONFLICT', 'Resolve the listed item dates before changing this deadline. Your plan was not changed.', {
                conflicts: affected.map(item => ({ id: item._id.toString(), name: item.name,
                    availableFrom: item.availableFrom, availableUntil: item.availableUntil }))
            });
            // An extension must not silently republish previously expired items.
            const expiredIds = items.filter(item => effectiveStatus(item, previous) === 'expired').map(item => item._id);
            if (expiredIds.length) await db.collection('items').updateMany({ _id: { $in: expiredIds }, ownerId, planId: previous._id },
                { $set: { status: 'expired', updatedAt: new Date() }, $inc: { version: 1 } }, { session });
            const plan = await db.collection('moveOutPlans').findOneAndUpdate(owned(id, ownerId), {
                $set: Object.assign({}, changes, { updatedAt: new Date() })
            }, { session, returnDocument: 'after', projection: planProjection });
            return privatePlan(plan);
        });
    }
    return { create, list, find, update };
}

module.exports = { createPlanService, isCalendarDate, todayUTC };
