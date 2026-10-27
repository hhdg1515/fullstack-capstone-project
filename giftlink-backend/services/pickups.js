const { ObjectId } = require('mongodb');
const { planTransaction, InventoryError, endDate } = require('./inventory');
const { appointment, fitsWindow, eligible, originalParticipants, validProposal, appointmentState, appointmentResponse,
    rescheduleEvent, proposalResponse, rescheduleProblem, proposalProblem } = require('./pickup-policy');

const missing = () => new InventoryError(404, 'PICKUP_NOT_FOUND', 'Pickup request unavailable');
const conflict = (code, message) => new InventoryError(409, code, message);
const isId = value => typeof value === 'string' && /^[a-fA-F0-9]{24}$/.test(value);
const participant = (id, userId) => ({ _id: new ObjectId(id), $or: [{ giverId: userId }, { receiverId: userId }] });

function createPickupService({ connectToDatabase, now = () => new Date() }) {
    async function serialize(db, row, userId, session) {
        const giver = row.giverId.equals(userId);
        const options = session ? { session } : {};
        const item = await db.collection('items').findOne({ _id: row.itemId, planId: row.planId, ownerId: row.giverId }, options);
        const plan = await db.collection('moveOutPlans').findOne({ _id: row.planId, ownerId: row.giverId }, options);
        const person = await db.collection('users').findOne({ _id: giver ? row.receiverId : row.giverId }, Object.assign({}, options, { projection: { firstName: 1 } }));
        const result = { id: row._id.toString(), role: giver ? 'giver' : 'receiver', status: row.status, version: row.version,
            proposedAt: row.proposedAt.toISOString(), localDateTime: row.localDateTime, timeZone: row.timeZone, note: row.note,
            counterpart: { firstName: person ? person.firstName : 'Former member' },
            item: item && plan ? { id: item._id.toString(), name: item.name, description: item.description, category: item.category,
                city: plan.city, neighborhood: plan.neighborhood, status: item.status,
                availableFrom: item.availableFrom, effectiveAvailableUntil: endDate(item, plan) } : null,
            createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(),
            cancellationReason: row.cancellationReason || null,
            history: row.history.map(entry => {
                const event = { action: entry.action, actor: entry.actorRole, at: entry.at.toISOString(), reason: entry.reason || null };
                if (entry.proposal && validProposal(Object.assign({}, row, { rescheduleProposal: entry.proposal })) && entry.previousAppointment &&
                    entry.previousAppointment.proposedAt instanceof Date) event.reschedule = {
                    proposal: proposalResponse(row, entry.proposal), previousAppointment: appointmentResponse(entry.previousAppointment)
                };
                return event;
            }) };
        const references = originalParticipants(row) && item && plan && person && item.ownerId instanceof ObjectId && item.planId instanceof ObjectId;
        const problem = references ? rescheduleProblem(row, item, plan, now()) : 'unavailable';
        const hasProposal = row.rescheduleProposal != null;
        const proposal = references && row.status === 'accepted' && row.active === true && validProposal(row) ? row.rescheduleProposal : null;
        const other = proposal && !proposal.proposedById.equals(userId);
        const proposalIssue = proposal ? proposalProblem(row, item, plan, now()) : hasProposal ? 'proposal_unavailable' : null;
        result.rescheduling = { proposal: proposal ? proposalResponse(row, proposal) : null,
            canPropose: !problem && !hasProposal, canAccept: Boolean(!problem && other && !proposalIssue),
            canDecline: Boolean(references && row.status === 'accepted' && row.active === true && other),
            reason: problem || proposalIssue || (hasProposal ? (other ? 'proposal_pending' : 'waiting_for_other') : null) };
        if (giver && plan) result.plan = { id: plan._id.toString(), title: plan.title };
        for (const field of ['acceptedAt', 'declinedAt', 'cancelledAt', 'completedAt', 'noShowAt']) result[field] = row[field] ? row[field].toISOString() : null;
        return result;
    }
    async function create(userId, itemId, input) {
        if (!isId(itemId)) throw conflict('LISTING_UNAVAILABLE', 'This listing is no longer accepting pickup requests.');
        const db = await connectToDatabase();
        const original = await db.collection('items').findOne({ _id: new ObjectId(itemId) });
        if (!original || !(original.ownerId instanceof ObjectId) || !(original.planId instanceof ObjectId)) throw conflict('LISTING_UNAVAILABLE', 'This listing is no longer accepting pickup requests.');
        try {
            return await planTransaction(db, original.ownerId, original.planId.toString(), async (plan, session) => {
                const item = await db.collection('items').findOne({ _id: original._id, planId: plan._id, ownerId: plan.ownerId }, { session });
                const at = now();
                if (!item || !eligible(item, plan, at)) throw conflict('LISTING_UNAVAILABLE', 'This listing is no longer accepting pickup requests.');
                if (userId.equals(plan.ownerId)) throw conflict('OWN_ITEM', 'You cannot request your own item.');
                if (!plan.pickupTimeZone) throw conflict('PICKUP_TIMEZONE_REQUIRED', 'The giver must set the plan pickup timezone before requests can be submitted.');
                if (input.timeZone !== plan.pickupTimeZone) throw conflict('PICKUP_TIMEZONE_CHANGED', 'The pickup timezone changed. Reload the listing and review the appointment.');
                const row = { _id: new ObjectId(), itemId: item._id, planId: plan._id, giverId: plan.ownerId, receiverId: userId,
                    proposedAt: appointment(input.localDateTime, plan.pickupTimeZone, at), localDateTime: input.localDateTime,
                    timeZone: plan.pickupTimeZone, note: input.note || '', status: 'pending', active: true, version: 1,
                    createdAt: at, updatedAt: at, history: [{ action: 'pending', actorId: userId, actorRole: 'receiver', at }] };
                if (!fitsWindow(row, item, plan)) throw new InventoryError(400, 'OUTSIDE_PICKUP_WINDOW', 'Choose a local pickup date within the listing window and a time before its UTC expiration.');
                if (await db.collection('pickupRequests').findOne({ itemId: item._id, receiverId: userId, active: true }, { session })) throw conflict('DUPLICATE_PICKUP', 'You already have an outstanding request for this item. Open My requests.');
                if (await db.collection('pickupRequests').findOne({ itemId: item._id, status: 'accepted' }, { session })) throw conflict('ITEM_RESERVED', 'The giver has accepted another pickup. Try again if that appointment is released.');
                await db.collection('pickupRequests').insertOne(row, { session });
                return { request: await serialize(db, row, userId, session) };
            });
        } catch (error) {
            if (error.code === 11000) throw conflict('PICKUP_CONFLICT', 'An outstanding request or reservation changed. Reload your requests.');
            if (error.code === 'ITEM_NOT_FOUND') throw conflict('LISTING_UNAVAILABLE', 'This listing is no longer accepting pickup requests.');
            throw error;
        }
    }
    async function list(userId, role, query) {
        if (Object.keys(query).some(key => !['cursor', 'status'].includes(key)) || query.cursor !== undefined && (typeof query.cursor !== 'string' || !/^[a-f0-9]{24}$/.test(query.cursor)) ||
            query.status !== undefined && !['pending', 'accepted', 'declined', 'cancelled', 'completed', 'no_show'].includes(query.status)) {
            throw new InventoryError(400, 'INVALID_PICKUP_QUERY', 'Use the continuation from the previous request page.');
        }
        const db = await connectToDatabase();
        const filter = { [role === 'giver' ? 'giverId' : 'receiverId']: userId };
        if (query.status) filter.status = query.status;
        if (query.cursor) filter._id = { $lt: new ObjectId(query.cursor) };
        const rows = await db.collection('pickupRequests').find(filter).sort({ _id: -1 }).limit(26).toArray();
        const selected = rows.slice(0, 25);
        return { requests: await Promise.all(selected.map(row => serialize(db, row, userId))),
            nextCursor: rows.length > 25 ? selected[24]._id.toString() : null };
    }
    async function detail(userId, id) {
        if (!isId(id)) throw missing();
        const db = await connectToDatabase(); const row = await db.collection('pickupRequests').findOne(participant(id, userId));
        if (!row) throw missing();
        return { request: await serialize(db, row, userId) };
    }
    async function act(userId, id, input) {
        if (!isId(id)) throw missing();
        const db = await connectToDatabase(); const original = await db.collection('pickupRequests').findOne(participant(id, userId));
        if (!original) throw missing();
        try {
            return await planTransaction(db, original.giverId, original.planId.toString(), async (plan, session) => {
                const row = await db.collection('pickupRequests').findOne(participant(id, userId), { session });
                if (!row) throw missing();
                if (row.version !== input.version) throw conflict('PICKUP_CHANGED', 'This request changed. Reload and review its current status.');
                const giver = row.giverId.equals(userId); const action = input.action; const at = now();
                const allowed = action === 'cancel' ? ['pending', 'accepted'].includes(row.status) : giver &&
                    (['accept', 'decline'].includes(action) ? row.status === 'pending' : ['complete', 'no_show'].includes(action) && row.status === 'accepted');
                if (!allowed) throw conflict('INVALID_PICKUP_TRANSITION', 'This action is unavailable for your role and the current request status.');
                const item = await db.collection('items').findOne({ _id: row.itemId, ownerId: plan.ownerId, planId: plan._id }, { session });
                if (action === 'accept') {
                    if (!item || !eligible(item, plan, at) || !fitsWindow(row, item, plan)) throw conflict('LISTING_UNAVAILABLE', 'The listing or pickup window changed. Decline or cancel this request.');
                    if (row.proposedAt <= at) throw conflict('APPOINTMENT_PAST', 'That pickup time has passed. Decline this request so the receiver can propose a new time.');
                    if (await db.collection('pickupRequests').findOne({ itemId: row.itemId, status: 'accepted' }, { session })) throw conflict('ITEM_RESERVED', 'Another pickup is already accepted for this item.');
                }
                if (['complete', 'no_show'].includes(action)) {
                    if (row.proposedAt > at || action === 'no_show' && row.proposedAt.getTime() === at.getTime()) throw conflict('APPOINTMENT_NOT_REACHED', 'Wait until the scheduled appointment before recording a handoff or no-show.');
                    if (!item || !['available', 'expired'].includes(item.status) || plan.status !== 'active') throw conflict('LISTING_UNAVAILABLE', 'This listing changed. Reload and review the request.');
                }
                const state = { accept: 'accepted', decline: 'declined', cancel: 'cancelled', complete: 'completed', no_show: 'no_show' }[action];
                const stamp = { accept: 'acceptedAt', decline: 'declinedAt', cancel: 'cancelledAt', complete: 'completedAt', no_show: 'noShowAt' }[action];
                if (row.rescheduleProposal && ['cancel', 'complete', 'no_show'].includes(action)) {
                    row.history.push(rescheduleEvent(row, 'reschedule_invalidated', userId, giver ? 'giver' : 'receiver', at, 'request_' + state));
                    delete row.rescheduleProposal;
                }
                Object.assign(row, { status: state, active: state === 'accepted', updatedAt: at, version: row.version + 1, [stamp]: at });
                if (action === 'cancel') row.cancellationReason = 'cancelled_by_' + (giver ? 'giver' : 'receiver');
                row.history.push({ action: state, actorId: userId, actorRole: giver ? 'giver' : 'receiver', at });
                await db.collection('pickupRequests').replaceOne({ _id: row._id }, row, { session });
                if (action === 'complete') {
                    await db.collection('items').updateOne({ _id: item._id }, { $set: { status: 'cleared', updatedAt: at, clearedByPickupRequestId: row._id }, $inc: { version: 1 } }, { session });
                    await db.collection('pickupRequests').updateMany({ itemId: item._id, active: true }, {
                        $set: { status: 'cancelled', active: false, cancelledAt: at, updatedAt: at, cancellationReason: 'item_handed_over' },
                        $unset: { rescheduleProposal: '' },
                        $inc: { version: 1 }, $push: { history: { action: 'cancelled', actorId: userId, actorRole: 'giver', at, reason: 'item_handed_over' } }
                    }, { session });
                }
                return { request: await serialize(db, row, userId, session) };
            });
        } catch (error) {
            if (error.code === 11000) throw conflict('ITEM_RESERVED', 'Another pickup was accepted. Reload requests.');
            throw error;
        }
    }
    async function schedule(userId, id, input, proposalId) {
        if (!isId(id) || proposalId !== undefined && !isId(proposalId)) throw missing();
        const db = await connectToDatabase(); const original = await db.collection('pickupRequests').findOne(participant(id, userId));
        if (!original || !originalParticipants(original)) throw missing();
        try {
            return await planTransaction(db, original.giverId, original.planId.toString(), async (plan, session) => {
                const row = await db.collection('pickupRequests').findOne(participant(id, userId), { session });
                if (!row || !originalParticipants(row) || !row.giverId.equals(plan.ownerId) || !row.planId.equals(plan._id)) throw missing();
                if (row.version !== input.version) throw conflict('PICKUP_CHANGED', 'This request changed. Reload and review its current status.');
                if (row.status !== 'accepted' || row.active !== true) throw conflict('RESCHEDULE_UNAVAILABLE', 'Only an accepted pickup can change time. Reload the request.');
                const item = await db.collection('items').findOne({ _id: row.itemId, ownerId: plan.ownerId, planId: plan._id }, { session });
                const people = await db.collection('users').countDocuments({ _id: { $in: [row.giverId, row.receiverId] } }, { session });
                if (!item || !(item.ownerId instanceof ObjectId) || !(item.planId instanceof ObjectId) || people !== 2) throw missing();
                const giver = row.giverId.equals(userId); const role = giver ? 'giver' : 'receiver'; const at = now();
                if (proposalId === undefined || input.action === 'accept') {
                    if (rescheduleProblem(row, item, plan, at)) throw conflict('RESCHEDULE_UNAVAILABLE', 'The confirmed appointment or listing is no longer eligible for a time change. Reload the request.');
                    if (await db.collection('pickupRequests').findOne({ itemId: row.itemId, status: 'accepted', _id: { $ne: row._id } }, { session })) throw conflict('ITEM_RESERVED', 'Another accepted pickup exists. Reload and review this request.');
                }
                if (proposalId === undefined) {
                    if (row.rescheduleProposal != null) throw conflict('RESCHEDULE_PENDING', 'A time change is already waiting for a response. It cannot be overwritten.');
                    if (input.timeZone !== plan.pickupTimeZone || input.timeZone !== row.timeZone) throw conflict('PICKUP_TIMEZONE_CHANGED', 'The pickup timezone changed. Reload the request.');
                    const proposed = appointment(input.localDateTime, plan.pickupTimeZone, at);
                    const proposal = { _id: new ObjectId(), proposedById: userId, proposedAt: proposed, localDateTime: input.localDateTime,
                        timeZone: plan.pickupTimeZone, createdAt: at };
                    if (!fitsWindow(proposal, item, plan)) throw new InventoryError(400, 'OUTSIDE_PICKUP_WINDOW', 'Choose a local pickup date within the listing window and a time before its UTC expiration.');
                    if (proposed.getTime() === row.proposedAt.getTime()) throw new InventoryError(400, 'UNCHANGED_APPOINTMENT', 'Choose a different pickup time.');
                    row.rescheduleProposal = proposal;
                    row.history.push(rescheduleEvent(row, 'reschedule_proposed', userId, role, at));
                } else {
                    if (!validProposal(row) || !row.rescheduleProposal._id.equals(new ObjectId(proposalId))) throw conflict('PROPOSAL_CHANGED', 'This time-change proposal is no longer available. Reload the request.');
                    if (row.rescheduleProposal.proposedById.equals(userId)) throw conflict('OWN_PROPOSAL', 'Only the other participant can accept or decline your proposal.');
                    if (input.action === 'accept' && proposalProblem(row, item, plan, at)) throw conflict('PROPOSAL_UNAVAILABLE', 'The proposed time is no longer valid. Decline it and review the confirmed appointment.');
                    row.history.push(rescheduleEvent(row, input.action === 'accept' ? 'reschedule_accepted' : 'reschedule_declined', userId, role, at));
                    if (input.action === 'accept') Object.assign(row, appointmentState(row.rescheduleProposal));
                    delete row.rescheduleProposal;
                }
                row.updatedAt = at; row.version++;
                await db.collection('pickupRequests').replaceOne({ _id: row._id }, row, { session });
                return { request: await serialize(db, row, userId, session) };
            });
        } catch (error) {
            if (error.code === 'ITEM_NOT_FOUND') throw missing();
            if (error.code === 11000) throw conflict('ITEM_RESERVED', 'Another pickup is accepted. Reload the request.');
            throw error;
        }
    }
    return { create, list, detail, act, schedule };
}
module.exports = { createPickupService };
