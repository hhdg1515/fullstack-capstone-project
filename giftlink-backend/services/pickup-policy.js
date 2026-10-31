const { isLegacyItem } = require('./listing-model');
const { Temporal } = require('@js-temporal/polyfill');
const { ObjectId } = require('mongodb');
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
    return isLegacyItem(item) && item.status === 'available' && item.publishedAt instanceof Date && item.publishedAt <= now &&
        plan.status === 'active' && item.ownerId.equals(plan.ownerId) && end >= todayUTC(now) &&
        end <= plan.moveOutDeadline && (!item.availableFrom || item.availableFrom <= end);
}
function originalParticipants(row) {
    const created = row && Array.isArray(row.history) && row.history[0];
    return Boolean(row && ['giverId', 'receiverId', 'itemId', 'planId'].every(field => row[field] instanceof ObjectId) &&
        !row.giverId.equals(row.receiverId) && created && created.action === 'pending' && created.actorRole === 'receiver' &&
        created.actorId instanceof ObjectId && created.actorId.equals(row.receiverId));
}
function validProposal(row) {
    if (!originalParticipants(row)) return false;
    const proposal = row.rescheduleProposal;
    return Boolean(proposal && proposal._id instanceof ObjectId && proposal.proposedById instanceof ObjectId &&
        [row.giverId, row.receiverId].some(id => id.equals(proposal.proposedById)) &&
        proposal.proposedAt instanceof Date && Number.isFinite(proposal.proposedAt.getTime()) &&
        proposal.createdAt instanceof Date && Number.isFinite(proposal.createdAt.getTime()) &&
        typeof proposal.localDateTime === 'string' && validTimeZone(proposal.timeZone));
}
const appointmentState = value => ({ proposedAt: value.proposedAt, localDateTime: value.localDateTime, timeZone: value.timeZone });
const appointmentResponse = value => Object.assign({}, appointmentState(value), { proposedAt: value.proposedAt.toISOString() });
function rescheduleEvent(row, action, actorId, actorRole, at, reason = null) {
    const event = { action, actorId, actorRole, at, reason };
    if (validProposal(row)) Object.assign(event, { proposal: Object.assign({}, row.rescheduleProposal), previousAppointment: appointmentState(row) });
    return event;
}
function proposalResponse(row, proposal) {
    return Object.assign(appointmentResponse(proposal), { id: proposal._id.toString(),
        proposedBy: proposal.proposedById.equals(row.giverId) ? 'giver' : 'receiver', createdAt: proposal.createdAt.toISOString() });
}
function rescheduleProblem(row, item, plan, now) {
    if (row.status !== 'accepted' || row.active !== true) return 'request_not_accepted';
    if (!(row.proposedAt instanceof Date) || !Number.isFinite(row.proposedAt.getTime())) return 'unavailable';
    if (row.proposedAt <= now) return 'appointment_passed';
    if (!eligible(item, plan, now) || !fitsWindow(row, item, plan)) return 'listing_unavailable';
    return null;
}
function proposalProblem(row, item, plan, now) {
    if (!validProposal(row)) return 'proposal_unavailable';
    try {
        const proposal = row.rescheduleProposal;
        if (proposal.timeZone !== plan.pickupTimeZone || appointment(proposal.localDateTime, plan.pickupTimeZone, now).getTime() !== proposal.proposedAt.getTime() ||
            !fitsWindow(proposal, item, plan)) return 'proposal_unavailable';
        return null;
    } catch (error) { return 'proposal_unavailable'; }
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
    if (affected.length && confirmed !== true) throw confirmationRequired(affected.length);
    const at = new Date();
    const operations = [];
    for (const row of rows) {
        const cancelling = affected.some(value => value._id.equals(row._id));
        const invalidProposal = row.rescheduleProposal && (!validProposal(row) || !fitsWindow(row.rescheduleProposal, item, plan));
        if (!cancelling && !invalidProposal) continue;
        const reason = cancelling ? forceReason || 'availability_changed' : 'proposal_window_changed';
        const history = row.rescheduleProposal ? [rescheduleEvent(row, 'reschedule_invalidated', actorId, 'giver', at, reason)] : [];
        const changes = { updatedAt: at };
        if (cancelling) {
            Object.assign(changes, { status: 'cancelled', active: false, cancelledAt: at, cancellationReason: reason });
            history.push({ action: 'cancelled', actorId, actorRole: 'giver', at, reason });
        }
        operations.push({ updateOne: { filter: { _id: row._id, active: true }, update: {
            $set: changes, $unset: { rescheduleProposal: '' }, $inc: { version: 1 }, $push: { history: { $each: history } }
        } } });
    }
    if (operations.length) await db.collection('pickupRequests').bulkWrite(operations, { session });
}
module.exports = { validTimeZone, appointment, fitsWindow, eligible, invalidateRequests, confirmationRequired, pickupReservationStages,
    originalParticipants, validProposal, appointmentState, appointmentResponse, rescheduleEvent, proposalResponse, rescheduleProblem, proposalProblem };
