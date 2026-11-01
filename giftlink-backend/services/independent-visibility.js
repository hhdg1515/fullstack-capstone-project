// Database-side eligibility before exact counts/cursors. No private candidate
// download, application filtering, hidden plan creation or index DDL.
const { taxonomy } = require('./item-taxonomy');
const { directory } = require('./regions');
const string = field => ({ $convert: { input: '$' + field, to: 'string', onError: '', onNull: '' } });
const typed = (field, type) => ({ $eq: [{ $type: '$' + field }, type] });
const text = (field, max, required, multiline = false) => ({ $and: [typed(field, 'string'),
    { $lte: [{ $strLenCP: string(field) }, max] },
    { $not: [{ $regexMatch: { input: string(field), regex: multiline ? '[<>\\x00-\\x08\\x0b\\x0c\\x0e-\\x1f\\x7f-\\x9f]' : '[<>\\x00-\\x1f\\x7f-\\x9f]' } }] },
    ...(required ? [{ $regexMatch: { input: string(field), regex: '\\S' } }] : [])] });
function independentVisibilityPipeline(match = {}, clock = '$$NOW') {
    const classification = taxonomy.categories.flatMap(category => category.itemTypes.map(type => ({ categoryId: category.id, itemTypeId: type.id })));
    const regions = directory.metros.flatMap(metro => metro.stateIds.map(stateId => ({ stateId, metroId: metro.id })));
    return [{ $match: Object.assign({}, match, { listingSchemaVersion: 2, publicationRequirementsVersion: 2, planId: { $exists: false }, status: 'available',
        deadlinePolicyVersion: 2, pickupTimeZone: { $type: 'string', $regex: '^(?:UTC|[A-Za-z0-9_+-]+/(?:[A-Za-z0-9_+-]+/)*[A-Za-z0-9_+-]+)$' }, $and: (match.$and || []).concat([{ $or: classification }, { $or: regions }]) }) },
    { $match: { $expr: { $and: [typed('ownerId', 'objectId'), typed('publishedAt', 'date'), { $lte: ['$publishedAt', clock] },
        typed('expiresAt', 'date'), typed('timeZoneConfirmedAt', 'date'), { $lte: ['$timeZoneConfirmedAt', clock] },
        { $eq: ['$deadlineTimeZone', '$pickupTimeZone'] }, { $gt: ['$expiresAt', clock] },
        { $gte: ['$version', 1] }, { $gte: ['$coordinationRevision', 0] },
        text('name', 160, true), text('description', 2000, true, true),
        typed('categoryId', 'string'), typed('itemTypeId', 'string'), typed('stateId', 'string'), typed('metroId', 'string'),
        { $or: [{ $eq: [{ $ifNull: ['$city', null] }, null] }, text('city', 100, false)] },
        { $or: [{ $eq: [{ $ifNull: ['$neighborhood', null] }, null] }, text('neighborhood', 100, false)] },
        { $or: [{ $eq: [{ $ifNull: ['$condition', null] }, null] }, { $in: ['$condition', taxonomy.conditions.map(condition => condition.id)] }] },
        { $or: [{ $eq: [{ $ifNull: ['$customItemType', null] }, null] }, text('customItemType', 60, false)] },
        { $or: [{ $eq: [{ $ifNull: ['$availableFrom', null] }, null] }, { $and: [typed('availableFrom', 'string'),
            { $ne: [{ $dateFromString: { dateString: string('availableFrom'), format: '%Y-%m-%d', onError: null, onNull: null } }, null] }] }] },
        { $regexMatch: { input: string('timeZoneRulesVersion'), regex: '^temporal-\\d+\\.\\d+\\.\\d+/tz-\\d{4}[a-z]+$' } },
        { $regexMatch: { input: string('availableUntil'), regex: '^\\d{4}-\\d{2}-\\d{2}$' } }
    ] } } },
    { $set: { readNow: clock, localToday: { $dateToString: { date: clock, format: '%Y-%m-%d', timezone: '$pickupTimeZone' } },
        localEnd: { $dateFromString: { dateString: '$availableUntil', timezone: '$pickupTimeZone', format: '%Y-%m-%d', onError: null, onNull: null } } } },
    { $match: { $expr: { $and: [
        { $ne: ['$localEnd', null] },
        { $eq: ['$expiresAt', { $dateAdd: { startDate: '$localEnd', unit: 'day', amount: 1, timezone: '$pickupTimeZone' } }] },
        { $lte: [{ $ifNull: ['$availableFrom', '0000-01-01'] }, '$availableUntil'] }
    ] } } },
    { $lookup: { from: 'users', localField: 'ownerId', foreignField: '_id', pipeline: [{ $project: { _id: 1 } }, { $limit: 1 }], as: 'publicOwner' } },
    { $match: { 'publicOwner.0': { $exists: true } } },
    { $set: { effectiveAvailableUntil: '$availableUntil', plan: { stateId: '$stateId', metroId: '$metroId', city: { $ifNull: ['$city', ''] },
        neighborhood: { $ifNull: ['$neighborhood', ''] }, pickupTimeZone: '$pickupTimeZone', moveOutDeadline: '$availableUntil' } } }];
}
module.exports = { independentVisibilityPipeline };
