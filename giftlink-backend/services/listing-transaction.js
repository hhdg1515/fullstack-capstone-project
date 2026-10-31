const { ObjectId } = require('mongodb');
const { resolveListingContext } = require('./listing-context');
const { modelVersion } = require('./listing-model');
const { InventoryError } = require('./inventory-error');
const conflict = () => new InventoryError(409, 'LISTING_CHANGED', 'Listing changed or is unavailable.');
// Internal foundation, not an HTTP publishing API. Callback must contain DB work
// only. No external PUT, automatic conversion, creation/upsert, or index DDL.
async function listingTransaction(db, ownerId, itemId, expectedVersion, operation) {
    if (!(ownerId instanceof ObjectId) || !(itemId instanceof ObjectId) || !Number.isSafeInteger(expectedVersion) || expectedVersion < 1) throw conflict();
    const session = db.client.startSession();
    try {
        return await session.withTransaction(async () => {
            const item = await db.collection('items').findOne({ _id: itemId, ownerId }, { session });
            if (!item || item.version !== expectedVersion) throw conflict();
            const version = modelVersion(item); let plan = null;
            if (version === 1) {
                if (!(item.planId instanceof ObjectId)) throw conflict();
                plan = await db.collection('moveOutPlans').findOneAndUpdate({ _id: item.planId, ownerId },
                    { $inc: { inventoryRevision: 1 } }, { session, returnDocument: 'after' });
                if (!plan) throw conflict();
            }
            const clock = await db.collection('items').aggregate([{ $match: { _id: itemId, ownerId } }, { $project: { now: '$$NOW' } }], { session }).next();
            const context = resolveListingContext(item, plan, ownerId, clock.now);
            const revision = item.coordinationRevision;
            if (revision !== undefined && (!Number.isSafeInteger(revision) || revision < 0 || revision >= Number.MAX_SAFE_INTEGER)) throw conflict();
            const filter = { _id: itemId, ownerId, version: expectedVersion,
                coordinationRevision: revision === undefined ? { $exists: false } : revision };
            const result = await db.collection('items').updateOne(filter, { $inc: { coordinationRevision: 1 } }, { session });
            if (result.modifiedCount !== 1) throw conflict();
            return operation(context, session);
        }, { readConcern: { level: 'snapshot' }, writeConcern: { w: 'majority' }, readPreference: 'primary', maxCommitTimeMS: 10000 });
    } finally { await session.endSession(); }
}
module.exports = { listingTransaction };
