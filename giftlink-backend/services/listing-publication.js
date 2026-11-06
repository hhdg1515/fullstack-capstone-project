const { ObjectId } = require('mongodb');
const { InventoryError } = require('./inventory-error');
const { validatePublication, listingPolicy } = require('./inventory');
const { resolveListingContext } = require('./listing-context');
const { originalParticipants, referenceVersion, confirmationRequired, rescheduleEvent } = require('./pickup-policy');
function publish(item, now) {
    validatePublication(item); listingPolicy(item);
    const fields = [];
    if (!item.stateId) fields.push({ field: 'stateId', message: 'Choose a state before publishing.' });
    if (!item.metroId) fields.push({ field: 'metroId', message: 'Choose a metro before publishing.' });
    if (!item.availableUntil) fields.push({ field: 'availableUntil', message: 'Choose a pickup deadline before publishing.' });
    if (!item.pickupTimeZone || !item.timeZoneConfirmedAt) fields.push({ field: 'pickupTimeZoneConfirmed', message: 'Confirm your pickup timezone before publishing.' });
    if (fields.length) throw new InventoryError(400, 'PUBLICATION_DETAILS_REQUIRED', 'Complete the highlighted details before publishing.', { fields });
    const saved = Object.assign({}, item, { status: 'available', publishedAt: item.publishedAt || now, publicationRequirementsVersion: 2 });
    const context = resolveListingContext(saved, null, saved.ownerId, now);
    if (context.expired) throw new InventoryError(400, 'PUBLICATION_DETAILS_REQUIRED', 'Choose a future pickup deadline.', {
        fields: [{ field: 'availableUntil', message: 'Choose today or a later date in the confirmed pickup timezone.' }]
    });
    if (!context.policyEligible) throw new InventoryError(409, 'LISTING_CONTEXT_INVALID', 'Check the listing before publishing.');
    return saved;
}
// Same item fence as accept, schedule, message, handoff and photo operations.
// No request is deleted or re-pointed. A reached accepted appointment requires
// an explicit request-level decision before withdrawal, rather than mass closure.
async function withdraw(db, session, item, actor, now, confirmed) {
    const rows = await db.collection('pickupRequests').find({ itemId: item._id, active: true }, { session }).toArray();
    for (const row of rows) {
        if (referenceVersion(row) !== 2 || !originalParticipants(row) || !row.giverId.equals(actor) || !['pending', 'accepted'].includes(row.status)) {
            throw new InventoryError(409, 'PICKUP_REFERENCE_INVALID', 'Resolve the affected pickup request before withdrawing.');
        }
        if (row.status === 'accepted' && (!(row.proposedAt instanceof Date) || row.proposedAt <= now)) {
            throw new InventoryError(409, 'PICKUP_RESOLUTION_REQUIRED', 'Resolve the accepted pickup in Incoming requests before withdrawing this listing.');
        }
    }
    if (rows.length && confirmed !== true) throw confirmationRequired(rows.length);
    for (const row of rows) {
        const reason = 'item_withdrawn', history = [];
        if (row.rescheduleProposal) history.push(rescheduleEvent(row, 'reschedule_invalidated', actor, 'giver', now, reason));
        history.push({ action: 'cancelled', actorId: actor, actorRole: 'giver', at: now, reason });
        const result = await db.collection('pickupRequests').updateOne({ _id: row._id, version: row.version, active: true }, {
            $set: { status: 'cancelled', active: false, cancelledAt: now, updatedAt: now, cancellationReason: reason },
            $unset: { rescheduleProposal: '' }, $inc: { version: 1 }, $push: { history: { $each: history } }
        }, { session });
        if (result.modifiedCount !== 1) throw new InventoryError(409, 'PICKUP_CHANGED', 'The pickup changed. Review it before withdrawing.');
    }
    return Object.assign({}, item, { status: 'unlisted', withdrawnAt: now });
}
// Relisting is not an undo: keep every completed/cancelled request, message,
// handoff reference, image operation and quota hold. Only create a private draft.
async function reopenAsDraft(db, session, item, actor, now, confirmed) {
    if (confirmed !== true) throw new InventoryError(409, 'RELIST_CONFIRMATION_REQUIRED', 'Confirm restoring this item as a private draft. Previous requests and conversations will remain closed.');
    const open = await db.collection('pickupRequests').findOne({ itemId: item._id,
        $or: [{ active: true }, { status: { $in: ['pending', 'accepted'] } }] }, { session, projection: { _id: 1 }, maxTimeMS: 2000 });
    if (open) throw new InventoryError(409, 'PICKUP_REQUESTS_OPEN', 'Resolve the open pickup records before relisting this item.');
    if (item.clearedByPickupRequestId !== undefined) {
        if (!(item.clearedByPickupRequestId instanceof ObjectId)) throw new InventoryError(409, 'PICKUP_REFERENCE_INVALID', 'The handoff record is unavailable.');
        const row = await db.collection('pickupRequests').findOne({ _id: item.clearedByPickupRequestId, itemId: item._id, giverId: actor }, { session, maxTimeMS: 2000 });
        const last = row && Array.isArray(row.history) && row.history[row.history.length - 1];
        if (!row || referenceVersion(row) !== 2 || Object.prototype.hasOwnProperty.call(row, 'planId') || !originalParticipants(row) ||
            row.status !== 'completed' || row.active !== false || !(row.completedAt instanceof Date) || !Number.isFinite(row.completedAt.getTime()) ||
            !last || last.action !== 'completed' || last.actorRole !== 'giver' || !(last.actorId instanceof ObjectId) || !last.actorId.equals(actor) ||
            !(last.at instanceof Date) || last.at.getTime() !== row.completedAt.getTime()) {
            throw new InventoryError(409, 'PICKUP_REFERENCE_INVALID', 'The handoff record is unavailable.');
        }
    }
    // Drafts must never retain a public publication marker. Preserve the
    // original timestamp separately; a later explicit publish gets a fresh one.
    return Object.assign({}, item, { status: 'draft', publishedAt: null, firstPublishedAt: item.firstPublishedAt || item.publishedAt, relistedAt: now });
}
module.exports = { publish, withdraw, reopenAsDraft };
