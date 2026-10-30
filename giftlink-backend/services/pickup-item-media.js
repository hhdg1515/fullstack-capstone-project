const { ObjectId } = require('mongodb');
const { originalParticipants } = require('./pickup-policy');
const { initialMatch, visibilityPipeline } = require('./discovery');
const { validateImageConfig } = require('./item-image-policy');
const { mediaSummary } = require('./public-item-media');
const states = ['pending', 'accepted', 'declined', 'cancelled', 'completed', 'no_show'];
const validRequest = row => originalParticipants(row) && states.includes(row.status) && row.active === ['pending', 'accepted'].includes(row.status);
const unavailable = () => ({ imageAvailability: 'unavailable', coverImage: null });

// Detail-only optional read. Request participation never grants image delivery
// authority: requester uses current public policy; giver uses actual ownership.
function createPickupItemMedia({ connectToDatabase, configuration }) {
    const binding = validateImageConfig(configuration).storageBinding;
    return async function cover(original, userId) {
        if (!validRequest(original) || !(userId instanceof ObjectId) || ![original.giverId, original.receiverId].some(id => id.equals(userId))) return unavailable();
        try {
            const db = await connectToDatabase(), owner = original.giverId.equals(userId), at = new Date();
            const itemStages = owner ? [
                { $lookup: { from: 'moveOutPlans', localField: 'planId', foreignField: '_id', as: 'plan' } }, { $unwind: '$plan' },
                { $match: { status: { $in: ['draft', 'available', 'unlisted', 'expired', 'cleared'] } } }
            ] : visibilityPipeline(initialMatch(at.getTime()), at.toISOString().slice(0, 10));
            const rows = await db.collection('pickupRequests').aggregate([
                { $match: { _id: original._id, giverId: original.giverId, receiverId: original.receiverId, itemId: original.itemId, planId: original.planId } },
                { $lookup: { from: 'users', localField: 'giverId', foreignField: '_id', pipeline: [{ $project: { _id: 1 } }, { $limit: 1 }], as: 'mediaGiver' } },
                { $lookup: { from: 'users', localField: 'receiverId', foreignField: '_id', pipeline: [{ $project: { _id: 1 } }, { $limit: 1 }], as: 'mediaReceiver' } },
                { $lookup: { from: 'items', let: { item: '$itemId', plan: '$planId', owner: '$giverId' }, pipeline: [
                    { $match: { $expr: { $and: [{ $eq: ['$_id', '$$item'] }, { $eq: ['$planId', '$$plan'] }, { $eq: ['$ownerId', '$$owner'] }] } } }
                ].concat(itemStages, [
                    { $lookup: { from: 'itemImages', let: { item: '$_id' }, pipeline: [
                        { $match: { state: 'ready', $expr: { $eq: ['$itemId', '$$item'] } } },
                        { $sort: { sortPosition: 1, _id: 1 } }, { $limit: 6 }
                    ], as: 'photos' } },
                    { $project: { _id: 1, ownerId: 1, planId: 1, status: 1, imageRevision: 1, photos: 1, 'plan._id': 1, 'plan.ownerId': 1 } }
                ]), as: 'mediaItem' } },
                { $project: { giverId: 1, receiverId: 1, itemId: 1, planId: 1, status: 1, active: 1, mediaGiver: 1, mediaReceiver: 1, mediaItem: 1,
                    history: { $slice: [{ $cond: [{ $isArray: '$history' }, '$history', []] }, 1] } } }
            ], { readConcern: { level: 'snapshot' }, collation: { locale: 'simple' }, maxTimeMS: 5000, allowDiskUse: false }).toArray();
            const current = rows[0], item = current && current.mediaItem[0];
            if (!validRequest(current) || current.mediaGiver.length !== 1 || current.mediaReceiver.length !== 1 || !item ||
                !(item.plan._id instanceof ObjectId) || !item.plan._id.equals(current.planId) ||
                !(item.plan.ownerId instanceof ObjectId) || !item.plan.ownerId.equals(current.giverId) ||
                !['draft', 'available', 'unlisted', 'expired', 'cleared'].includes(item.status)) return unavailable();
            return mediaSummary(item, { _id: current.itemId, planId: current.planId, ownerId: current.giverId }, binding);
        } catch (error) { return unavailable(); } // No raw provider errors or private metadata.
    };
}
module.exports = { createPickupItemMedia };
