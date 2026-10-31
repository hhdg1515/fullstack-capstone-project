const { legacyMatch } = require('./listing-model');
const { createHash } = require('crypto');
const { ObjectId } = require('mongodb');
const { InventoryError } = require('./inventory');
const { todayUTC, isCalendarDate } = require('./calendar');
const { pickupReservationStages } = require('./pickup-policy');
const { classificationResponse, taxonomy, category, type, condition } = require('./item-taxonomy');
const { validateRegion, metro, regionResponse } = require('./regions');

const normalizeLabel = value => value.trim().replace(/\s+/g, ' ');
const escape = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const phrase = value => normalizeLabel(value).split(' ').map(escape).join('\\s+');
const invalid = message => new InventoryError(400, 'INVALID_DISCOVERY_QUERY', message);
const invalidCursor = () => new InventoryError(400, 'INVALID_CURSOR', 'This pagination link is invalid for the selected filters. Refresh results.');
const staleCursor = () => new InventoryError(409, 'STALE_CURSOR', 'These results have changed or the pagination link expired. Refresh results to start again.');
const cursorLifetime = 15 * 60 * 1000;
function parseQuery(raw, today, requireRegion = true) {
    const allowed = ['q', 'city', 'neighborhood', 'stateId', 'metroId', 'categoryId', 'itemTypeId', 'condition', 'availability', 'date', 'sort', 'limit', 'cursor'];
    if (Object.keys(raw).some(key => !allowed.includes(key) || typeof raw[key] !== 'string')) {
        throw invalid('Use only supported, single-value discovery parameters.');
    }
    const query = { q: '', city: '', neighborhood: '', availability: raw.availability || 'all',
        date: raw.date || '', sort: raw.sort || 'newest', limit: raw.limit === undefined ? 12 : Number(raw.limit),
        stateId: raw.stateId || '', metroId: raw.metroId || '', categoryId: raw.categoryId || '', itemTypeId: raw.itemTypeId || '', condition: raw.condition || '' };
    if (requireRegion && (!query.stateId || !query.metroId)) throw new InventoryError(400, 'REGION_REQUIRED', 'Choose a listed state and metro before browsing.');
    if (query.stateId || query.metroId) {
        validateRegion(query.stateId, query.metroId);
        if (!query.stateId || !query.metroId) throw new InventoryError(400, 'REGION_REQUIRED', 'Choose a listed state and metro before browsing.');
    }
    if (query.categoryId && !category(query.categoryId) || query.itemTypeId && !type(query.categoryId, query.itemTypeId) || query.condition && !condition(query.condition)) {
        throw invalid('Choose a listed category, a matching item type and a supported condition.');
    }
    for (const key of ['q', 'city', 'neighborhood']) {
        if ((raw[key] || '').length > 100) throw invalid('Search and location labels must be at most 100 characters.');
        query[key] = normalizeLabel(raw[key] || '');
        if (/[\u0000-\u001f\u007f]/.test(query[key])) throw invalid('Use plain search text and location labels.');
    }
    if (!['all', 'now', 'later', 'date'].includes(query.availability) || !['newest', 'deadline'].includes(query.sort)) {
        throw invalid('Choose a supported availability filter and sort order.');
    }
    if (raw.limit !== undefined && !/^(?:[1-9]|[1-4]\d|50)$/.test(raw.limit)) throw invalid('Page size must be an integer from 1 to 50.');
    if (query.availability === 'date') {
        if (!isCalendarDate(query.date) || query.date < today) throw invalid('Choose a valid pickup date of today or later (UTC).');
    } else if (query.date) throw invalid('A pickup date requires the date availability filter.');
    return query;
}
function fingerprint(query) {
    return createHash('sha256').update(JSON.stringify(Object.assign({}, query, {
        q: query.q.toLowerCase(), city: query.city.toLowerCase(), neighborhood: query.neighborhood.toLowerCase()
    }))).digest('hex');
}
function readCursor(token, query, now) {
    if (!token) return null;
    let value;
    try {
        if (token.length > 1024 || !/^[A-Za-z0-9_-]+$/.test(token)) throw invalidCursor();
        const decoded = Buffer.from(token, 'base64url');
        if (decoded.toString('base64url') !== token) throw invalidCursor();
        value = JSON.parse(decoded.toString('utf8'));
        if (!value || Array.isArray(value) || Object.keys(value).sort().join(',') !== 'at,filter,id,sort,v,value' ||
            value.v !== 1 || value.filter !== fingerprint(query) || value.sort !== query.sort ||
            !Number.isSafeInteger(value.at) || value.at > now.getTime() + 5000 ||
            typeof value.id !== 'string' || !/^[a-f0-9]{24}$/.test(value.id) || typeof value.value !== 'string') throw invalidCursor();
        if (query.sort === 'newest') {
            const date = new Date(value.value);
            if (Number.isNaN(date.getTime()) || date.toISOString() !== value.value || date.getTime() > value.at) throw invalidCursor();
        } else if (!isCalendarDate(value.value)) throw invalidCursor();
    } catch (error) { throw invalidCursor(); }
    if (now.getTime() - value.at > cursorLifetime || todayUTC(new Date(value.at)) !== todayUTC(now)) throw staleCursor();
    return value;
}
const projection = { planId: 1, name: 1, description: 1, category: 1, categoryId: 1, itemTypeId: 1, customItemType: 1, condition: 1, status: 1, availableFrom: 1, availableUntil: 1,
    publishedAt: 1, effectiveAvailableUntil: 1, isReserved: 1, ownerId: 1, 'plan.stateId': 1, 'plan.metroId': 1, 'plan.city': 1, 'plan.neighborhood': 1, 'plan.moveOutDeadline': 1, 'plan.pickupTimeZone': 1 };
function publicItem(row, today, viewerId) {
    return Object.assign({ id: row._id.toString(), name: row.name, description: row.description, category: row.category, classification: classificationResponse(row),
        status: 'available', isReserved: row.isReserved, availability: row.availableFrom && row.availableFrom > today ? 'later' : 'now',
        availableFrom: row.availableFrom || null, availableUntil: row.availableUntil || null,
        effectiveAvailableUntil: row.effectiveAvailableUntil, city: normalizeLabel(row.plan.city),
        neighborhood: normalizeLabel(row.plan.neighborhood), moveOutDeadline: row.plan.moveOutDeadline,
        publishedAt: row.publishedAt.toISOString(), pickupTimeZone: row.plan.pickupTimeZone || null,
        isOwner: Boolean(viewerId && row.ownerId.equals(viewerId)) }, regionResponse(row.plan));
}
function eligibilityStages(today) {
    return [{ $addFields: { effectiveAvailableUntil: { $ifNull: ['$availableUntil', '$plan.moveOutDeadline'] } } },
        { $match: legacyMatch() }, { $match: { 'plan.status': 'active', $expr: { $and: [
            { $regexMatch: { input: { $convert: { input: '$status', to: 'string', onError: '', onNull: '' } }, regex: '^available$' } },
            { $regexMatch: { input: { $convert: { input: '$plan.status', to: 'string', onError: '', onNull: '' } }, regex: '^active$' } },
            { $eq: [{ $type: '$publishedAt' }, 'date'] }, { $eq: [{ $type: '$ownerId' }, 'objectId'] },
            { $eq: ['$ownerId', '$plan.ownerId'] },
            { $gte: ['$effectiveAvailableUntil', today] },
            { $lte: ['$effectiveAvailableUntil', '$plan.moveOutDeadline'] },
            { $lte: [{ $ifNull: ['$availableFrom', '0000-01-01'] }, '$effectiveAvailableUntil'] }
        ] } } }];
}
function visibilityPipeline(match, today) {
    return [{ $match: match }, { $lookup: { from: 'moveOutPlans', localField: 'planId', foreignField: '_id', as: 'plan' } },
        { $unwind: '$plan' }].concat(eligibilityStages(today));
}
function regionalPipeline(query, terms, today) {
    return [{ $match: { metroId: query.metroId, stateId: { $in: metro(query.metroId).stateIds }, status: 'active', pickupTimeZone: { $type: 'string', $ne: '' },
        $expr: { $and: ['stateId', 'metroId', 'pickupTimeZone'].map(field => ({ $eq: [{ $type: '$' + field }, 'string'] })) } } },
        { $lookup: { from: 'items', let: { plan: '$_id', owner: '$ownerId' }, pipeline: [
            { $match: { $and: terms.concat([{ $expr: { $and: [{ $eq: ['$planId', '$$plan'] }, { $eq: ['$ownerId', '$$owner'] }] } }]) } }
        ], as: 'items' } }, { $unwind: '$items' },
        { $replaceRoot: { newRoot: { $mergeObjects: ['$items', { plan: { stateId: '$stateId', metroId: '$metroId', ownerId: '$ownerId', status: '$status',
            city: '$city', neighborhood: '$neighborhood', moveOutDeadline: '$moveOutDeadline', pickupTimeZone: '$pickupTimeZone' } }] } } }
    ].concat(eligibilityStages(today));
}
function textMatch(q) {
    const term = normalizeLabel(q).toLowerCase();
    const matched = taxonomy.categories.flatMap(category => category.itemTypes).filter(type => type.searchTerms.includes(term) || type.label.toLowerCase() === term);
    const alternatives = Array.from(new Set([q].concat(...matched.map(type => type.searchTerms))));
    const clauses = ['name', 'description', 'category', 'customItemType'].map(field => ({ [field]: { $regex: '(*UCP)(?:' + alternatives.map(phrase).join('|') + ')', $options: 'i' } }));
    if (matched.length) clauses.push({ itemTypeId: { $in: matched.map(type => type.id) } });
    const groups = taxonomy.categories.filter(category => category.label.toLowerCase() === term);
    if (groups.length) clauses.push({ categoryId: { $in: groups.map(category => category.id) } });
    return { $or: clauses };
}
const initialMatch = at => ({ status: 'available', publishedAt: { $type: 'date', $lte: new Date(at) } });
// Normalize existing labels at read time; no database normalization/migration.
const normalizedField = input => ({ $reduce: {
    input: { $regexFindAll: { input, regex: '(*UCP)\\S+' } }, initialValue: '',
    in: { $concat: ['$$value', { $cond: [{ $eq: ['$$value', ''] }, '', ' '] }, '$$this.match'] }
} });

function createDiscoveryService({ connectToDatabase, now = () => new Date(), imageMetadata = null, imageRead = false }) {
    const media = imageMetadata && imageRead ? require('./public-item-media').createPublicItemMedia({ connectToDatabase, configuration: imageMetadata, visibilityPipeline, initialMatch }) : null;
    async function aggregate(pipeline, options = {}, collection = 'items') {
        try {
            const db = await connectToDatabase();
            return await db.collection(collection).aggregate(pipeline, Object.assign({ readConcern: { level: 'snapshot' },
                collation: { locale: 'simple' }, maxTimeMS: 5000, allowDiskUse: false }, options)).toArray();
        } catch (error) {
            if ([50, 292].includes(error.code)) throw new InventoryError(503, 'DISCOVERY_BUSY', 'This search is too broad or busy. Narrow the filters and retry.');
            throw error;
        }
    }
    async function browse(raw, viewerId) {
        const current = now(); const today = todayUTC(current);
        const query = parseQuery(raw, today); const cursor = readCursor(raw.cursor, query, current);
        const at = cursor ? cursor.at : current.getTime();
        const terms = [initialMatch(at)];
        if (query.q) terms.push(textMatch(query.q));
        for (const field of ['categoryId', 'itemTypeId', 'condition']) if (query[field]) terms.push({ [field]: query[field] });
        const start = query.availability === 'date' ? query.date : today;
        if (['now', 'date'].includes(query.availability)) terms.push({ $or: [{ availableFrom: null }, { availableFrom: { $lte: start } }] });
        if (query.availability === 'later') terms.push({ availableFrom: { $gt: today } });
        const pipeline = regionalPipeline(query, terms, today);
        for (const key of ['city', 'neighborhood']) {
            if (query[key]) pipeline.push({ $match: { ['plan.' + key]: { $regex: '(*UCP)^\\s*' + phrase(query[key]) + '\\s*$', $options: 'i' } } });
        }
        if (query.availability === 'date') pipeline.push({ $match: { effectiveAvailableUntil: { $gte: query.date } } });
        pipeline.push(...pickupReservationStages());
        pipeline.push({ $match: { isReserved: false } });
        const page = [];
        if (cursor) {
            const newest = query.sort === 'newest', field = newest ? 'publishedAt' : 'effectiveAvailableUntil';
            const value = newest ? new Date(cursor.value) : cursor.value, comparison = newest ? '$lt' : '$gt';
            page.push({ $match: { $or: [{ [field]: { [comparison]: value } }, { [field]: value, _id: { [comparison]: new ObjectId(cursor.id) } }] } });
        }
        page.push({ $sort: query.sort === 'newest' ? { publishedAt: -1, _id: -1 } : { effectiveAvailableUntil: 1, _id: 1 } },
            { $limit: query.limit + 1 }, { $project: projection });
        pipeline.push({ $facet: { rows: page, total: [{ $count: 'value' }] } });
        const [result] = await aggregate(pipeline, {}, 'moveOutPlans');
        const rows = result.rows;
        const hasMore = rows.length > query.limit; const selected = rows.slice(0, query.limit);
        const last = selected[selected.length - 1];
        const nextCursor = hasMore ? Buffer.from(JSON.stringify({ v: 1, at, filter: fingerprint(query), sort: query.sort,
            id: last._id.toString(), value: query.sort === 'newest' ? last.publishedAt.toISOString() : last.effectiveAvailableUntil })).toString('base64url') : null;
        const summaries = media ? await media(selected, false, current) : [];
        return { items: selected.map((row, index) => Object.assign(publicItem(row, today, viewerId), summaries[index])), total: result.total.length ? result.total[0].value : 0, today,
            page: { limit: query.limit, hasMore, nextCursor } };
    }
    async function detail(id, viewerId) {
        if (!/^[a-fA-F0-9]{24}$/.test(id)) throw new InventoryError(404, 'ITEM_NOT_FOUND', 'Listing unavailable');
        const current = now(); const today = todayUTC(current);
        const rows = await aggregate(visibilityPipeline(Object.assign(initialMatch(current.getTime()), { _id: new ObjectId(id) }), today)
            .concat(pickupReservationStages(), [{ $project: Object.assign({}, projection, { ownerId: 1 }) }]));
        if (!rows.length) throw new InventoryError(404, 'ITEM_NOT_FOUND', 'Listing unavailable');
        const summaries = media ? await media(rows, true, current) : [];
        return { item: Object.assign(publicItem(rows[0], today, viewerId), summaries[0]), today };
    }
    async function locations(raw) {
        if (Object.keys(raw).some(key => !['stateId', 'metroId'].includes(key))) throw invalid('Location options accept only state and metro IDs.');
        const current = now(), today = todayUTC(current), query = parseQuery(raw, today, false);
        const regional = Boolean(query.metroId);
        const pipeline = regional ? regionalPipeline(query, [initialMatch(current.getTime())], today) : visibilityPipeline(initialMatch(current.getTime()), today);
        if (regional) pipeline.push(...pickupReservationStages(), { $match: { isReserved: false } });
        pipeline.push({ $project: { city: normalizedField('$plan.city'), neighborhood: normalizedField('$plan.neighborhood') } },
            { $sort: { city: 1, neighborhood: 1, _id: 1 } }, { $group: { _id: { city: '$city', neighborhood: '$neighborhood' } } },
            { $sort: { '_id.city': 1, '_id.neighborhood': 1 } }, { $limit: 501 },
            { $facet: { locations: [{ $limit: 500 }, { $group: { _id: '$_id.city', neighborhoods: { $push: '$_id.neighborhood' } } },
                { $sort: { _id: 1 } }], overflow: [{ $skip: 500 }, { $count: 'pairs' }] } });
        // ICU case-insensitive grouping also deduplicates non-ASCII case variants.
        const rows = await aggregate(pipeline, { collation: { locale: 'en', strength: 2 } }, regional ? 'moveOutPlans' : 'items');
        return { locations: rows[0].locations.map(row => ({ city: row._id, neighborhoods: row.neighborhoods })),
            truncated: rows[0].overflow.length > 0 };
    }
    return { browse, detail, locations };
}
module.exports = { createDiscoveryService, normalizeLabel, visibilityPipeline, initialMatch };
