/* jshint esversion: 9 */
const { Temporal } = require('@js-temporal/polyfill');
const { InventoryError } = require('./inventory-error');
const { isCalendarDate } = require('./calendar');
const rulesVersion = 'temporal-0.5.1/tz-' + process.versions.tz;
const invalid = () => new InventoryError(409, 'LISTING_DEADLINE_INVALID', 'Pickup deadline context is unavailable.');
function start(date, zone) {
    if (!isCalendarDate(date) || typeof zone !== 'string' || zone.length > 100 ||
        !(zone === 'UTC' || /^[A-Za-z0-9_+-]+\/(?:[A-Za-z0-9_+-]+\/)*[A-Za-z0-9_+-]+$/.test(zone))) throw invalid();
    const day = Temporal.PlainDate.from(date);
    const value = day.toZonedDateTime(zone);
    if (value.toPlainDate().toString() !== date) throw invalid();
    return value;
}
// Internal derivation only: routes never accept this tuple as client authority.
function deriveDeadline(date, zone) {
    try {
        const day = start(date, zone).toPlainDate();
        const next = day.add({ days: 1 }).toZonedDateTime(zone);
        return { deadlinePolicyVersion: 2, deadlineTimeZone: zone, timeZoneRulesVersion: rulesVersion,
            expiresAt: new Date(next.epochMilliseconds) };
    } catch (_) { throw invalid(); }
}
// A Node patch release can ship newer tz data and so a different recorded rules
// label. The stored tuple stays authoritative only while the current rules
// reproduce exactly the same exclusive expiry (checked below); a real rules
// change for that zone/date still fails closed instead of being reinterpreted.
const recordedRules = value => typeof value === 'string' && value.length <= 64 && /^temporal-\d+\.\d+\.\d+\/tz-\d{4}[a-z]+$/.test(value);
function resolveDeadline(item, now) {
    try {
        if (!(now instanceof Date) || !Number.isFinite(now.getTime()) || item.deadlinePolicyVersion !== 2 ||
            typeof process.versions.tz !== 'string' || !recordedRules(item.timeZoneRulesVersion) || item.pickupTimeZone !== item.deadlineTimeZone ||
            !(item.timeZoneConfirmedAt instanceof Date) || !Number.isFinite(item.timeZoneConfirmedAt.getTime()) || item.timeZoneConfirmedAt > now ||
            !(item.expiresAt instanceof Date)) throw invalid();
        const derived = deriveDeadline(item.availableUntil, item.pickupTimeZone);
        if (derived.expiresAt.getTime() !== item.expiresAt.getTime()) throw invalid();
        let startsAt = null;
        if (item.availableFrom != null) {
            if (item.availableFrom > item.availableUntil) throw invalid();
            startsAt = new Date(start(item.availableFrom, item.pickupTimeZone).epochMilliseconds);
        }
        return { ...derived, startsAt, expired: now >= item.expiresAt, pickupAvailable: (!startsAt || now >= startsAt) && now < item.expiresAt };
    } catch (_) { throw invalid(); }
}
module.exports = { deriveDeadline, resolveDeadline, rulesVersion };
