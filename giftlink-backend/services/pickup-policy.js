const { Temporal } = require('@js-temporal/polyfill');
const { InventoryError } = require('./inventory-error');
const { todayUTC } = require('./calendar');

function validTimeZone(zone) {
    if (typeof zone !== 'string' || zone.length > 100 || !/^(?:[A-Za-z0-9_+-]+\/)+[A-Za-z0-9_+-]+$/.test(zone) && zone !== 'UTC') return false;
    try { new Intl.DateTimeFormat('en', { timeZone: zone }); return true; } catch (error) { return false; }
}
function appointment(localDateTime, timeZone, now) {
    if (!validTimeZone(timeZone)) throw new InventoryError(400, 'INVALID_TIME_ZONE', 'Choose an explicit IANA pickup timezone, such as America/Los_Angeles.');
    try {
        if (typeof localDateTime !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(localDateTime)) throw new Error();
        const local = Temporal.PlainDateTime.from(localDateTime, { overflow: 'reject' });
        const zoned = local.toZonedDateTime(timeZone, { disambiguation: 'reject' });
        const instant = new Date(zoned.epochMilliseconds);
        if (instant <= now) throw new InventoryError(400, 'APPOINTMENT_PAST', 'Choose a future pickup time.');
        return instant;
    } catch (error) {
        if (error instanceof InventoryError) throw error;
        throw new InventoryError(400, 'INVALID_APPOINTMENT', 'Use a real local date and time. Times skipped or repeated by daylight saving are not accepted; choose another time.');
    }
}
function fitsWindow(request, item, plan) {
    if (!validTimeZone(plan.pickupTimeZone) || request.timeZone !== plan.pickupTimeZone) return false;
    const end = item.availableUntil || plan.moveOutDeadline;
    const localDay = Temporal.Instant.from(request.proposedAt.toISOString()).toZonedDateTimeISO(request.timeZone).toPlainDate().toString();
    // Existing listing expiration remains at the end of its UTC calendar date.
    return (!item.availableFrom || localDay >= item.availableFrom) && localDay <= end &&
        request.proposedAt < new Date(end + 'T00:00:00Z').getTime() + 86400000;
}
function eligible(item, plan, now = new Date()) {
    const end = item.availableUntil || plan.moveOutDeadline;
    return item.status === 'available' && item.publishedAt instanceof Date && item.publishedAt <= now &&
        plan.status === 'active' && item.ownerId.equals(plan.ownerId) && end >= todayUTC(now) &&
        end <= plan.moveOutDeadline && (!item.availableFrom || item.availableFrom <= end);
}
// Read alongside items in the caller's snapshot. Only a boolean leaves the
// aggregation: participant IDs, appointment details and notes remain private.
function pickupReservationStages() {
    // Use the same item/status predicate as create/accept, including conservative
    // blocking for inconsistent legacy references. Reads never repair records.
    return [{ $lookup: { from: 'pickupRequests', let: { item: '$_id' }, pipeline: [
        { $match: { status: 'accepted', $expr: { $eq: ['$itemId', '$$item'] } } },
        { $limit: 1 }, { $project: { _id: 0, status: 1 } }
    ], as: 'pickupReservations' } },
    { $addFields: { isReserved: { $gt: [{ $size: '$pickupReservations' }, 0] } } },
    { $project: { pickupReservations: 0 } }];
}
// Called inside the same plan transaction as the consequential inventory edit.
const confirmationRequired = count => new InventoryError(409, 'PICKUP_CONFIRMATION_REQUIRED',
    'This change will cancel ' + count + ' outstanding pickup request(s), including any affected accepted appointment. Review and explicitly confirm cancellation before saving.', { affectedRequests: count });
async function invalidateRequests(db, session, item, plan, actorId, confirmed, forceReason, preview = false) {
    const rows = await db.collection('pickupRequests').find({ itemId: item._id, planId: plan._id, giverId: plan.ownerId, active: true }, { session }).toArray();
    const affected = rows.filter(row => forceReason || !fitsWindow(row, item, plan));
    if (preview) return affected.length;
    if (!affected.length) return;
    if (confirmed !== true) throw confirmationRequired(affected.length);
    const at = new Date();
    await db.collection('pickupRequests').updateMany({ _id: { $in: affected.map(row => row._id) }, active: true }, {
        $set: { status: 'cancelled', active: false, cancelledAt: at, updatedAt: at, cancellationReason: forceReason || 'availability_changed' },
        $inc: { version: 1 }, $push: { history: { action: 'cancelled', actorId, actorRole: 'giver', at, reason: forceReason || 'availability_changed' } }
    }, { session });
}
module.exports = { validTimeZone, appointment, fitsWindow, eligible, invalidateRequests, confirmationRequired, pickupReservationStages };
