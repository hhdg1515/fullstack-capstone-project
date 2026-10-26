const { createHash } = require('crypto');
const { ObjectId } = require('mongodb');
const { InventoryError } = require('./inventory');
const { todayUTC, isCalendarDate } = require('./calendar');
const { pickupReservationStages } = require('./pickup-policy');

const normalizeLabel = value => value.trim().replace(/\s+/g, ' ');
const escape = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const phrase = value => normalizeLabel(value).split(' ').map(escape).join('\\s+');
const invalid = message => new InventoryError(400, 'INVALID_DISCOVERY_QUERY', message);
const invalidCursor = () => new InventoryError(400, 'INVALID_CURSOR', 'This pagination link is invalid for the selected filters. Refresh results.');
const staleCursor = () => new InventoryError(409, 'STALE_CURSOR', 'These results have changed or the pagination link expired. Refresh results to start again.');
const cursorLifetime = 15 * 60 * 1000;
function parseQuery(raw, today) {
    const allowed = ['q', 'city', 'neighborhood', 'availability', 'date', 'sort', 'limit', 'cursor'];
    if (Object.keys(raw).some(key => !allowed.includes(key) || typeof raw[key] !== 'string')) {
        throw invalid('Use only supported, single-value discovery parameters.');
    }
    const query = { q: '', city: '', neighborhood: '', availability: raw.availability || 'all',
        date: raw.date || '', sort: raw.sort || 'newest', limit: raw.limit === undefined ? 12 : Number(raw.limit) };
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
const projection = { name: 1, description: 1, category: 1, status: 1, availableFrom: 1, availableUntil: 1,
    publishedAt: 1, effectiveAvailableUntil: 1, isReserved: 1, 'plan.city': 1, 'plan.neighborhood': 1, 'plan.moveOutDeadline': 1, 'plan.pickupTimeZone': 1 };
function publicItem(row, today) {
    return { id: row._id.toString(), name: row.name, description: row.description, category: row.category,
        status: 'available', isReserved: row.isReserved, availability: row.availableFrom && row.availableFrom > today ? 'later' : 'now',
        availableFrom: row.availableFrom || null, availableUntil: row.availableUntil || null,
        effectiveAvailableUntil: row.effectiveAvailableUntil, city: normalizeLabel(row.plan.city),
        neighborhood: normalizeLabel(row.plan.neighborhood), moveOutDeadline: row.plan.moveOutDeadline,
        publishedAt: row.publishedAt.toISOString(), pickupTimeZone: row.plan.pickupTimeZone || null };
}
function visibilityPipeline(match, today) {
    return [{ $match: match },
        { $lookup: { from: 'moveOutPlans', localField: 'planId', foreignField: '_id', as: 'plan' } },
        { $unwind: '$plan' },
        { $addFields: { effectiveAvailableUntil: { $ifNull: ['$availableUntil', '$plan.moveOutDeadline'] } } },
        { $match: { 'plan.status': 'active', $expr: { $and: [
            { $regexMatch: { input: { $convert: { input: '$status', to: 'string', onError: '', onNull: '' } }, regex: '^available$' } },
            { $regexMatch: { input: { $convert: { input: '$plan.status', to: 'string', onError: '', onNull: '' } }, regex: '^active$' } },
            { $eq: [{ $type: '$publishedAt' }, 'date'] }, { $eq: [{ $type: '$ownerId' }, 'objectId'] },
            { $eq: ['$ownerId', '$plan.ownerId'] },
            { $gte: ['$effectiveAvailableUntil', today] },
            { $lte: ['$effectiveAvailableUntil', '$plan.moveOutDeadline'] },
            { $lte: [{ $ifNull: ['$availableFrom', '0000-01-01'] }, '$effectiveAvailableUntil'] }
        ] } } }];
}
const initialMatch = at => ({ status: 'available', publishedAt: { $type: 'date', $lte: new Date(at) } });
// Normalize existing labels at read time; no database normalization/migration.
const normalizedField = input => ({ $reduce: {
    input: { $regexFindAll: { input, regex: '(*UCP)\\S+' } }, initialValue: '',
    in: { $concat: ['$$value', { $cond: [{ $eq: ['$$value', ''] }, '', ' '] }, '$$this.match'] }
} });

function createDiscoveryService({ connectToDatabase, now = () => new Date() }) {
    async function aggregate(pipeline, options = {}) {
        try {
            const db = await connectToDatabase();
            return await db.collection('items').aggregate(pipeline, Object.assign({ readConcern: { level: 'snapshot' },
                collation: { locale: 'simple' }, maxTimeMS: 5000, allowDiskUse: false }, options)).toArray();
        } catch (error) {
            if ([50, 292].includes(error.code)) throw new InventoryError(503, 'DISCOVERY_BUSY', 'This search is too broad or busy. Narrow the filters and retry.');
            throw error;
        }
    }
    async function browse(raw) {
        const current = now(); const today = todayUTC(current);
        const query = parseQuery(raw, today); const cursor = readCursor(raw.cursor, query, current);
        const at = cursor ? cursor.at : current.getTime();
        const terms = [initialMatch(at)];
        if (query.q) terms.push({ $or: ['name', 'description', 'category'].map(field => ({ [field]: { $regex: '(*UCP)' + phrase(query.q), $options: 'i' } })) });
        const start = query.availability === 'date' ? query.date : today;
        if (['now', 'date'].includes(query.availability)) terms.push({ $or: [{ availableFrom: null }, { availableFrom: { $lte: start } }] });
        if (query.availability === 'later') terms.push({ availableFrom: { $gt: today } });
        if (cursor && query.sort === 'newest') terms.push({ $or: [
            { publishedAt: { $lt: new Date(cursor.value) } }, { publishedAt: new Date(cursor.value), _id: { $lt: new ObjectId(cursor.id) } }
        ] });
        const pipeline = visibilityPipeline({ $and: terms }, today);
        for (const key of ['city', 'neighborhood']) {
            if (query[key]) pipeline.push({ $match: { ['plan.' + key]: { $regex: '(*UCP)^\\s*' + phrase(query[key]) + '\\s*$', $options: 'i' } } });
        }
        if (query.availability === 'date') pipeline.push({ $match: { effectiveAvailableUntil: { $gte: query.date } } });
        if (cursor && query.sort === 'deadline') pipeline.push({ $match: { $or: [
            { effectiveAvailableUntil: { $gt: cursor.value } }, { effectiveAvailableUntil: cursor.value, _id: { $gt: new ObjectId(cursor.id) } }
        ] } });
        pipeline.push({ $sort: query.sort === 'newest' ? { publishedAt: -1, _id: -1 } : { effectiveAvailableUntil: 1, _id: 1 } },
            { $limit: query.limit + 1 });
        pipeline.push(...pickupReservationStages(), { $project: projection });
        const rows = await aggregate(pipeline);
        const hasMore = rows.length > query.limit; const selected = rows.slice(0, query.limit);
        const last = selected[selected.length - 1];
        const nextCursor = hasMore ? Buffer.from(JSON.stringify({ v: 1, at, filter: fingerprint(query), sort: query.sort,
            id: last._id.toString(), value: query.sort === 'newest' ? last.publishedAt.toISOString() : last.effectiveAvailableUntil })).toString('base64url') : null;
        return { items: selected.map(row => publicItem(row, today)), today,
            page: { limit: query.limit, hasMore, nextCursor } };
    }
    async function detail(id, viewerId) {
        if (!/^[a-fA-F0-9]{24}$/.test(id)) throw new InventoryError(404, 'ITEM_NOT_FOUND', 'Listing unavailable');
        const current = now(); const today = todayUTC(current);
        const rows = await aggregate(visibilityPipeline(Object.assign(initialMatch(current.getTime()), { _id: new ObjectId(id) }), today)
            .concat(pickupReservationStages(), [{ $project: Object.assign({}, projection, { ownerId: 1 }) }]));
        if (!rows.length) throw new InventoryError(404, 'ITEM_NOT_FOUND', 'Listing unavailable');
        return { item: Object.assign(publicItem(rows[0], today), { isOwner: Boolean(viewerId && rows[0].ownerId.equals(viewerId)) }), today };
    }
    async function locations(raw) {
        if (Object.keys(raw).length) throw invalid('Location options do not accept query parameters.');
        const current = now(); const pipeline = visibilityPipeline(initialMatch(current.getTime()), todayUTC(current));
        pipeline.push({ $project: { city: normalizedField('$plan.city'), neighborhood: normalizedField('$plan.neighborhood') } },
            { $sort: { city: 1, neighborhood: 1, _id: 1 } }, { $group: { _id: { city: '$city', neighborhood: '$neighborhood' } } },
            { $sort: { '_id.city': 1, '_id.neighborhood': 1 } }, { $limit: 501 },
            { $facet: { locations: [{ $limit: 500 }, { $group: { _id: '$_id.city', neighborhoods: { $push: '$_id.neighborhood' } } },
                { $sort: { _id: 1 } }], overflow: [{ $skip: 500 }, { $count: 'pairs' }] } });
        // ICU case-insensitive grouping also deduplicates non-ASCII case variants.
        const rows = await aggregate(pipeline, { collation: { locale: 'en', strength: 2 } });
        return { locations: rows[0].locations.map(row => ({ city: row._id, neighborhoods: row.neighborhoods })),
            truncated: rows[0].overflow.length > 0 };
    }
    return { browse, detail, locations };
}
module.exports = { createDiscoveryService, normalizeLabel };
