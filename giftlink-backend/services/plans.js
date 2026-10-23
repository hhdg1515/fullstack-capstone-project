const { ObjectId } = require('mongodb');

const planProjection = { title: 1, moveOutDeadline: 1, city: 1, neighborhood: 1, status: 1, createdAt: 1, updatedAt: 1 };
function privatePlan(plan) {
    return { id: plan._id.toString(), title: plan.title, moveOutDeadline: plan.moveOutDeadline,
        city: plan.city, neighborhood: plan.neighborhood, status: plan.status,
        createdAt: plan.createdAt.toISOString(), updatedAt: plan.updatedAt.toISOString() };
}
const todayUTC = (now = new Date()) => now.toISOString().slice(0, 10);
function isCalendarDate(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const date = new Date(value + 'T00:00:00.000Z');
    return !Number.isNaN(date.getTime()) && todayUTC(date) === value;
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
        const plan = await db.collection('moveOutPlans').findOneAndUpdate(owned(id, ownerId), {
            $set: Object.assign({}, changes, { updatedAt: new Date() })
        }, { returnDocument: 'after', projection: planProjection });
        return plan ? privatePlan(plan) : null;
    }
    return { create, list, find, update };
}

module.exports = { createPlanService, isCalendarDate, todayUTC };
