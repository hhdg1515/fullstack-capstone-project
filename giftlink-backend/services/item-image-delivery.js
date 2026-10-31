const { legacyMatch } = require('./listing-model');
const { ObjectId } = require('mongodb');
const { assertOperation, unavailable } = require('./item-image-policy');
const { visibilityPipeline, initialMatch } = require('./discovery');
function createImageAuthorization({ connectToDatabase, configuration }) {
    return async function authorize(imageId, variant, viewerId) {
        if (!/^[a-fA-F0-9]{24}$/.test(imageId) || !['thumbnail', 'display'].includes(variant)) throw unavailable();
        const db = await connectToDatabase(), session = db.client.startSession();
        try { return await session.withTransaction(async () => {
            const options = { session, maxTimeMS: 5000, collation: { locale: 'simple' } };
            const row = await db.collection('itemImages').findOne({ _id: new ObjectId(imageId), state: 'ready',
                'storageBinding.fingerprint': configuration.storageBinding.fingerprint, 'storageBinding.namespace': configuration.storageBinding.namespace }, options);
            if (!row) throw unavailable();
            try { assertOperation(row); } catch (error) { throw unavailable(); }
            const account = await db.collection('users').aggregate([{ $match: { _id: row.ownerId } }, { $project: { now: '$$NOW' } }], options).next();
            const plan = await db.collection('moveOutPlans').findOne({ _id: row.planId, ownerId: row.ownerId }, options);
            const item = await db.collection('items').findOne(Object.assign(legacyMatch(), { _id: row.itemId, planId: row.planId, ownerId: row.ownerId }), options);
            if (!account || !plan || !item || !['draft', 'available', 'unlisted', 'expired', 'cleared'].includes(item.status)) throw unavailable();
            if (!(plan.ownerId instanceof ObjectId) || !plan.ownerId.equals(row.ownerId) || !(item.ownerId instanceof ObjectId) ||
                !item.ownerId.equals(row.ownerId) || !(item.planId instanceof ObjectId) || !item.planId.equals(row.planId)) throw unavailable();
            if (!(viewerId instanceof ObjectId && viewerId.equals(row.ownerId))) {
                const match = Object.assign(initialMatch(account.now.getTime()), { _id: row.itemId, planId: row.planId, ownerId: row.ownerId });
                const eligible = await db.collection('items').aggregate(visibilityPipeline(match, account.now.toISOString().slice(0, 10)), options).next();
                if (!eligible) throw unavailable();
            }
            return { row, variant: Object.assign({}, row.variants[variant]) };
        }, { readConcern: { level: 'snapshot' }, readPreference: 'primary' }); }
        finally { await session.endSession(); }
    };
}
module.exports = { createImageAuthorization };
