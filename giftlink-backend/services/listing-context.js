/* jshint esversion: 9 */
const { ObjectId } = require('mongodb');
const { InventoryError } = require('./inventory-error');
const { modelVersion } = require('./listing-model');
const { resolveDeadline } = require('./listing-deadline');
const { validateRegion } = require('./regions');
const { eligible } = require('./pickup-policy');
const { classificationResponse, classificationChanges } = require('./item-taxonomy');
const { validatePublication, listingPolicy } = require('./inventory');
const { isCalendarDate, todayUTC } = require('./calendar');
const invalid = () => new InventoryError(409, 'LISTING_CONTEXT_INVALID', 'Listing context is unavailable.');
function resolveListingContext(item, plan, ownerId, now, { operation = 'strict' } = {}) {
    if (!item || !(item._id instanceof ObjectId) || !(ownerId instanceof ObjectId) ||
        !(item.ownerId instanceof ObjectId) || !item.ownerId.equals(ownerId) ||
        !(now instanceof Date) || !Number.isFinite(now.getTime())) throw invalid();
    const version = modelVersion(item);
    if (version === 1) {
        if (!plan || !(item.planId instanceof ObjectId) || !(plan._id instanceof ObjectId) || !item.planId.equals(plan._id) ||
            !(plan.ownerId instanceof ObjectId) || !plan.ownerId.equals(ownerId)) throw invalid();
        const end = item.availableUntil || plan.moveOutDeadline;
        if (!isCalendarDate(end) || !isCalendarDate(plan.moveOutDeadline) || end > plan.moveOutDeadline) throw invalid();
        return { modelVersion: 1, item, ownerId, plan, region: { stateId: plan.stateId || null, metroId: plan.metroId || null,
            city: plan.city, neighborhood: plan.neighborhood }, pickupTimeZone: plan.pickupTimeZone || null,
            availableFrom: item.availableFrom || null, availableUntil: end, deadlinePolicyVersion: 1,
            expired: end < todayUTC(now), status: item.status, fence: 'plan-then-item', publicEnabled: true, policyEligible: eligible(item, plan, now) };
    }
    try {
        if (Object.prototype.hasOwnProperty.call(item, 'planId') || !['draft', 'available', 'unlisted', 'expired', 'cleared'].includes(item.status) ||
            !Number.isSafeInteger(item.version) || item.version < 1 || !Number.isSafeInteger(item.coordinationRevision) || item.coordinationRevision < 0) throw invalid();
        if (operation === 'ownerDraft' && item.status === 'draft') {
            const deadline = require('./listing-draft').draftContext(item, now);
            return Object.assign({ modelVersion: 2, item, ownerId, region: { stateId: item.stateId, metroId: item.metroId, city: item.city, neighborhood: item.neighborhood },
                pickupTimeZone: item.pickupTimeZone, availableFrom: item.availableFrom, availableUntil: item.availableUntil,
                status: 'draft', fence: 'item', policyEligible: false, publicEnabled: false, disabledReason: 'V2_NOT_ACTIVATED' }, deadline);
        }
        if (!item.stateId || !item.metroId) throw invalid();
        validateRegion(item.stateId, item.metroId);
        if (typeof item.name !== 'string' || !item.name.trim() || Array.from(item.name).length > 160 || /[<>\u0000-\u001f\u007f]/.test(item.name) ||
            typeof item.description !== 'string' || Array.from(item.description).length > 2000 || /[<>\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(item.description)) throw invalid();
        const fields = { categoryId: item.categoryId || null, itemTypeId: item.itemTypeId || null, condition: item.condition || null };
        if (Object.prototype.hasOwnProperty.call(item, 'customItemType')) fields.customItemType = item.customItemType;
        classificationChanges({}, fields);
        for (const field of ['city', 'neighborhood']) if (item[field] != null && (typeof item[field] !== 'string' ||
            Array.from(item[field]).length > 100 || /[<>\u0000-\u001f\u007f]/.test(item[field]))) throw invalid();
        if (item.status === 'available') { validatePublication(item); listingPolicy(item); }
        const deadline = resolveDeadline(item, now), classification = classificationResponse(item);
        const policyEligible = item.status === 'available' && item.publishedAt instanceof Date && item.publishedAt <= now &&
            typeof item.name === 'string' && Boolean(item.name.trim()) && typeof item.description === 'string' && Boolean(item.description.trim()) &&
            Boolean(classification.category && classification.itemType) && !deadline.expired;
        return { modelVersion: 2, item, ownerId, region: { stateId: item.stateId, metroId: item.metroId, city: item.city || '', neighborhood: item.neighborhood || '' },
            pickupTimeZone: item.pickupTimeZone, availableFrom: item.availableFrom || null, availableUntil: item.availableUntil,
            deadlinePolicyVersion: 2, ...deadline, status: item.status, fence: 'item', policyEligible,
            publicEnabled: false, disabledReason: 'V2_NOT_ACTIVATED' };
    } catch (_) { throw invalid(); }
}
module.exports = { resolveListingContext };
