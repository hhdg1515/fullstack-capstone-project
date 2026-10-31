const { InventoryError } = require('./inventory-error');
const v2Fields = ['listingSchemaVersion', 'deadlinePolicyVersion', 'expiresAt', 'deadlineTimeZone', 'timeZoneConfirmedAt', 'timeZoneRulesVersion'];
const legacyMatch = () => Object.fromEntries(v2Fields.map(key => [key, { $exists: false }]));
const isLegacyItem = item => Boolean(item && v2Fields.every(key => !Object.prototype.hasOwnProperty.call(item, key)));
function modelVersion(item) {
    if (isLegacyItem(item)) return 1;
    if (item && item.listingSchemaVersion === 2) return 2;
    throw new InventoryError(409, 'LISTING_CONTEXT_INVALID', 'Listing context is unavailable.');
}
module.exports = { legacyMatch, isLegacyItem, modelVersion };
