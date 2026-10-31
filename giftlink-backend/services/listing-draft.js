// Owner-only incomplete-draft contract. Never used to authorize public/media access.
const { Temporal } = require('@js-temporal/polyfill');
const { InventoryError } = require('./inventory-error');
const { classificationChanges } = require('./item-taxonomy');
const { validateRegion } = require('./regions');
const { validTimeZone } = require('./pickup-policy');
const { isCalendarDate } = require('./calendar');
const { deriveDeadline, resolveDeadline } = require('./listing-deadline');
const editable = ['name', 'description', 'categoryId', 'itemTypeId', 'customItemType', 'condition', 'stateId', 'metroId',
    'city', 'neighborhood', 'pickupTimeZone', 'confirmPickupTimeZone', 'availableFrom', 'availableUntil'];
const tuple = ['deadlinePolicyVersion', 'expiresAt', 'deadlineTimeZone', 'timeZoneRulesVersion'];
const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const bad = (field, message) => new InventoryError(400, 'INVALID_LISTING_DRAFT', 'Check the listing details.', { fields: [{ field, message }] });
function text(value, field, max, required, multiline = false) {
    if (typeof value !== 'string' || Array.from(value).length > max || (required && !value.trim()) ||
        (multiline ? /[<>\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/ : /[<>\u0000-\u001f\u007f-\u009f]/).test(value)) {
        throw bad(field, 'Use ' + (required ? '1 to ' : 'up to ') + max + ' plain-text characters.');
    }
    const normalized = value.trim();
    if (['city', 'neighborhood'].includes(field) && /[^\s@]+@[^\s@]+\.[^\s@]+/.test(normalized)) throw bad(field, 'Use a general location without contact details.');
    return normalized;
}
function validateOptional(item) {
    text(item.name, 'name', 160, true); text(item.description, 'description', 2000, false, true);
    for (const field of ['city', 'neighborhood']) text(item[field], field, 100, false);
    classificationChanges({}, { categoryId: item.categoryId, itemTypeId: item.itemTypeId, customItemType: item.customItemType, condition: item.condition });
    validateRegion(item.stateId, item.metroId);
    if (item.pickupTimeZone !== null && !validTimeZone(item.pickupTimeZone)) throw bad('pickupTimeZone', 'Choose a valid IANA pickup timezone.');
    for (const field of ['availableFrom', 'availableUntil']) {
        if (item[field] !== null) {
            if (!isCalendarDate(item[field])) throw bad(field, 'Use a real YYYY-MM-DD date.');
            if (item.pickupTimeZone) try { deriveDeadline(item[field], item.pickupTimeZone); }
            catch (_) { throw bad(field, 'Choose a date that exists in this pickup timezone.'); }
        }
    }
    if (item.availableFrom && item.availableUntil && item.availableFrom > item.availableUntil) throw bad('availableUntil', 'End pickup on or after the start date.');
}
function applyDraft(previous, input, now) {
    const item = Object.assign({}, previous);
    for (const [field, max, required, multiline] of [['name', 160, true, false], ['description', 2000, false, true], ['city', 100, false, false], ['neighborhood', 100, false, false]]) {
        if (has(input, field)) item[field] = text(input[field], field, max, required, multiline);
    }
    Object.assign(item, classificationChanges(previous, input));
    for (const field of ['stateId', 'metroId', 'pickupTimeZone', 'availableFrom', 'availableUntil']) if (has(input, field)) item[field] = input[field];
    validateOptional(item);
    const contextChanged = ['stateId', 'metroId', 'city', 'neighborhood', 'pickupTimeZone'].some(field => item[field] !== previous[field]);
    if (contextChanged || input.confirmPickupTimeZone === false) item.timeZoneConfirmedAt = null;
    if (input.confirmPickupTimeZone === true) {
        if (!item.pickupTimeZone) throw bad('pickupTimeZone', 'Select a timezone before confirming it.');
        item.timeZoneConfirmedAt = now;
    }
    if (item.pickupTimeZone && item.availableFrom && (item.availableFrom !== previous.availableFrom || item.pickupTimeZone !== previous.pickupTimeZone)) {
        const today = Temporal.Instant.from(now.toISOString()).toZonedDateTimeISO(item.pickupTimeZone).toPlainDate().toString();
        if (item.availableFrom < today) throw bad('availableFrom', 'Choose today or a later date in the pickup timezone.');
    }
    for (const key of tuple) delete item[key];
    if (item.timeZoneConfirmedAt && item.availableUntil) Object.assign(item, deriveDeadline(item.availableUntil, item.pickupTimeZone));
    return item;
}
function draftContext(item, now) {
    validateOptional(item);
    if (item.publishedAt !== null || !(item.createdAt instanceof Date) || !Number.isFinite(item.createdAt.getTime()) ||
        !(item.updatedAt instanceof Date) || !Number.isFinite(item.updatedAt.getTime()) ||
        !Number.isSafeInteger(item.imageRevision) || item.imageRevision < 0 ||
        !(item.timeZoneConfirmedAt === null || item.timeZoneConfirmedAt instanceof Date && Number.isFinite(item.timeZoneConfirmedAt.getTime()) && item.timeZoneConfirmedAt <= now && item.pickupTimeZone)) throw new Error('Invalid draft metadata');
    const completeDeadline = Boolean(item.timeZoneConfirmedAt && item.availableUntil);
    if (completeDeadline) return Object.assign({ deadlineComplete: true }, resolveDeadline(item, now));
    if (tuple.some(key => has(item, key))) throw new Error('Partial deadline tuple');
    return { deadlineComplete: false, expiresAt: null, expired: false, pickupAvailable: false, startsAt: null };
}
module.exports = { editable, applyDraft, draftContext };
