const { ObjectId } = require('mongodb');
const { createHash } = require('crypto');
const { InventoryError } = require('./inventory-error');
const { modelVersion } = require('./listing-model');
const { resolveListingContext } = require('./listing-context');
const { listingTransaction } = require('./listing-transaction');
const { editable, applyDraft } = require('./listing-draft');
const { classificationResponse } = require('./item-taxonomy');
const { regionResponse } = require('./regions');
const { pickupReservationStages } = require('./pickup-policy');
const { createInventoryService } = require('./inventory');
const feedIndex = 'items_owner_created';
const feedIndexKey = { ownerId: 1, createdAt: -1, _id: -1 };
const missing = () => new InventoryError(404, 'ITEM_NOT_FOUND', 'Item not found.');
const invalid = () => new InventoryError(400, 'INVALID_OWNER_QUERY', 'Use a supported status, page size and pagination link.');
const publicationDisabled = () => new InventoryError(409, 'V2_PUBLICATION_DISABLED', 'Independent listing publication is not available yet. Your draft was not published.');
const legacyWrite = () => new InventoryError(409, 'LEGACY_ITEM_ROUTE_REQUIRED', 'Use the existing plan inventory editor for this item.');
const lifecycleDisabled = () => new InventoryError(409, 'V2_LIFECYCLE_DISABLED', 'This listing action is not available yet. Nothing was changed.');
const id = value => typeof value === 'string' && /^[a-fA-F0-9]{24}$/.test(value);
const integer = value => Number.isSafeInteger(value) && value >= 1;
function checkInput(input, editing = false, action = false) {
    const allowed = action ? ['action', 'version'] : editable.concat('publish', editing ? ['version'] : []);
    if (!input || Array.isArray(input) || typeof input !== 'object' || !Object.keys(input).length || Object.keys(input).some(key => !allowed.includes(key))) {
        throw new InventoryError(400, 'VALIDATION_FAILED', 'Unsupported or missing fields.');
    }
    if (editing && !integer(input.version) || input.publish !== undefined && typeof input.publish !== 'boolean' ||
        input.confirmPickupTimeZone !== undefined && typeof input.confirmPickupTimeZone !== 'boolean' ||
        action && !['publish', 'withdraw', 'unlist', 'clear', 'reopen'].includes(input.action)) throw new InventoryError(400, 'VALIDATION_FAILED', 'Check the action, version and confirmation fields.');
}
function query(raw, ownerId) {
    if (Object.keys(raw).some(key => !['limit', 'status', 'cursor'].includes(key) || typeof raw[key] !== 'string')) throw invalid();
    const limit = raw.limit === undefined ? 20 : Number(raw.limit), status = raw.status || 'all';
    if (raw.limit !== undefined && !/^(?:[1-9]|[1-4]\d|50)$/.test(raw.limit) || !['all', 'draft', 'available', 'unlisted', 'expired', 'cleared'].includes(status)) throw invalid();
    const binding = createHash('sha256').update(ownerId.toHexString() + ':' + status).digest('hex');
    let cursor = null;
    if (raw.cursor !== undefined) try {
        if (!/^[A-Za-z0-9_-]{1,1000}$/.test(raw.cursor)) throw invalid();
        cursor = JSON.parse(Buffer.from(raw.cursor, 'base64url').toString('utf8'));
        if (!cursor || Object.keys(cursor).sort().join(',') !== 'at,binding,id,v' || cursor.v !== 1 || cursor.binding !== binding || !id(cursor.id) ||
            typeof cursor.at !== 'string' || !Number.isFinite(Date.parse(cursor.at)) || new Date(cursor.at).toISOString() !== cursor.at) throw invalid();
    } catch (_) { throw invalid(); }
    return { limit, status, binding, cursor };
}
function feedPipeline(ownerId, params, imageRead) {
    const match = { ownerId };
    if (params.cursor) {
        const at = new Date(params.cursor.at), oid = new ObjectId(params.cursor.id);
        match.$or = [{ createdAt: { $lt: at } }, { createdAt: at, _id: { $lt: oid } }];
    }
    if (params.status !== 'all') match.status = params.status === 'expired' ? { $in: ['available', 'expired'] } : params.status;
    const stages = [{ $match: match }, { $sort: { createdAt: -1, _id: -1 } },
        { $lookup: { from: 'moveOutPlans', let: { parent: '$planId', owner: '$ownerId' }, pipeline: [
            { $match: { $expr: { $and: [{ $eq: ['$_id', '$$parent'] }, { $eq: ['$ownerId', '$$owner'] }] } } }, { $limit: 1 }
        ], as: 'ownerPlan' } },
        { $set: { readNow: '$$NOW', ownerPlan: { $arrayElemAt: ['$ownerPlan', 0] } } },
        { $set: { ownerStatus: { $cond: [{ $and: [{ $eq: ['$status', 'available'] }, { $cond: [{ $eq: ['$listingSchemaVersion', 2] },
            { $lte: ['$expiresAt', '$$NOW'] }, { $lt: [{ $ifNull: ['$availableUntil', '$ownerPlan.moveOutDeadline'] }, { $dateToString: { date: '$$NOW', format: '%Y-%m-%d', timezone: 'UTC' } }] }] }] }, 'expired', '$status'] } } }];
    if (params.status !== 'all') stages.push({ $match: { ownerStatus: params.status } });
    stages.push({ $limit: params.limit + 1 });
    // Only this bounded page is enriched, in the same database snapshot.
    stages.push.apply(stages, pickupReservationStages());
    if (imageRead) stages.push({ $lookup: { from: 'itemImages', let: { item: '$_id' }, pipeline: [
        { $match: { $expr: { $and: [{ $eq: ['$itemId', '$$item'] }, { $eq: ['$state', 'ready'] }] } } },
        { $sort: { sortPosition: 1, _id: 1 } }, { $limit: 6 }
    ], as: 'ownerPhotos' } });
    return stages;
}
function createOwnerListingService({ connectToDatabase, imageMetadata = null, imageRead = false }) {
    const legacy = createInventoryService({ connectToDatabase, imageMetadata, imageRead });
    function response(item, plan, now) {
        const ctx = resolveListingContext(item, plan, item.ownerId, now, { operation: 'ownerDraft' });
        if (!integer(item.version) || ![item.createdAt, item.updatedAt].every(value => value instanceof Date && Number.isFinite(value.getTime()))) {
            throw new InventoryError(409, 'LISTING_CONTEXT_INVALID', 'Listing context is unavailable.');
        }
        const v2 = ctx.modelVersion === 2;
        const preview = v2 ? { availability: 'disabled', images: [] } : legacy.ownerPhotoPreview(item, plan);
        return { id: item._id.toHexString(), name: item.name, description: item.description || '', classification: classificationResponse(item),
            status: item.status === 'available' && ctx.expired ? 'expired' : item.status, version: item.version,
            location: Object.assign(regionResponse(v2 ? item : plan), { city: ctx.region.city || '', neighborhood: ctx.region.neighborhood || '' }),
            pickup: { availableFrom: ctx.availableFrom, availableUntil: ctx.availableUntil, timeZone: ctx.pickupTimeZone,
                timeZoneConfirmed: v2 ? Boolean(item.timeZoneConfirmedAt) : Boolean(plan.pickupTimeZone),
                datePolicy: v2 ? 'pickup-local' : 'utc-calendar', expiresAt: v2 && ctx.expiresAt ? ctx.expiresAt.toISOString() : null },
            photoPreview: { availability: preview.availability, images: preview.images },
            pickupSummary: v2 ? { supported: false, reserved: false } : { supported: true, reserved: Boolean(item.isReserved) },
            capabilities: { editDraft: v2 && item.status === 'draft', legacyEditor: !v2, publish: false, withdraw: false, photos: false },
            createdAt: item.createdAt.toISOString(), updatedAt: item.updatedAt.toISOString() };
    }
    async function owned(db, ownerId, itemId, session) {
        if (!id(itemId)) throw missing();
        const item = await db.collection('items').findOne({ _id: new ObjectId(itemId), ownerId }, { session, maxTimeMS: 2000 });
        if (!item) throw missing();
        return item;
    }
    async function create(ownerId, input) {
        checkInput(input); if (input.publish) throw publicationDisabled();
        const db = await connectToDatabase(), session = db.client.startSession(), itemId = new ObjectId();
        try {
            return await session.withTransaction(async () => {
                const clock = await db.collection('users').aggregate([{ $match: { _id: ownerId } }, { $project: { now: '$$NOW' } }], { session, maxTimeMS: 2000 }).next();
                if (!clock) throw missing();
                const now = clock.now;
                const item = applyDraft({ _id: itemId, ownerId, listingSchemaVersion: 2, status: 'draft', version: 1, coordinationRevision: 0, imageRevision: 0,
                    createdAt: now, updatedAt: now, publishedAt: null, name: '', description: '', categoryId: null, itemTypeId: null, customItemType: null, condition: null,
                    stateId: null, metroId: null, city: '', neighborhood: '', pickupTimeZone: null, timeZoneConfirmedAt: null, availableFrom: null, availableUntil: null }, input, now);
                const result = response(item, null, now);
                await db.collection('items').insertOne(item, { session });
                return { item: result };
            }, { readConcern: { level: 'snapshot' }, writeConcern: { w: 'majority' }, readPreference: 'primary', maxCommitTimeMS: 10000 });
        } finally { await session.endSession(); }
    }
    async function list(ownerId, raw) {
        const params = query(raw, ownerId), db = await connectToDatabase();
        let rows;
        try { rows = await db.collection('items').aggregate(feedPipeline(ownerId, params, Boolean(imageMetadata && imageRead)),
            { hint: feedIndexKey, readConcern: { level: 'snapshot' }, collation: { locale: 'simple' }, maxTimeMS: 5000 }).toArray(); }
        catch (_) { throw new InventoryError(503, 'OWNER_LISTINGS_UNAVAILABLE', 'Listings are temporarily unavailable. Try again later.'); }
        const hasMore = rows.length > params.limit, page = rows.slice(0, params.limit);
        const items = page.map(row => response(row, row.ownerPlan || null, row.readNow));
        const last = page[page.length - 1];
        const nextCursor = hasMore ? Buffer.from(JSON.stringify({ v: 1, binding: params.binding, at: last.createdAt.toISOString(), id: last._id.toHexString() })).toString('base64url') : null;
        return { items, nextCursor };
    }
    async function detail(ownerId, itemId) {
        const db = await connectToDatabase();
        if (!id(itemId)) throw missing();
        // Same bounded enrichment/snapshot as the feed, scoped to one exact item.
        const params = { limit: 1, status: 'all', cursor: null };
        const stages = feedPipeline(ownerId, params, Boolean(imageMetadata && imageRead));
        stages[0].$match._id = new ObjectId(itemId);
        const item = await db.collection('items').aggregate(stages, { readConcern: { level: 'snapshot' }, maxTimeMS: 5000 }).next();
        if (!item) throw missing();
        return { item: response(item, item.ownerPlan || null, item.readNow) };
    }
    async function mutate(ownerId, itemId, input, action = false) {
        checkInput(input, true, action);
        const db = await connectToDatabase(), item = await owned(db, ownerId, itemId);
        if (modelVersion(item) === 1) throw legacyWrite();
        return listingTransaction(db, ownerId, item._id, input.version, async (ctx, session, now) => {
            if (ctx.item.status !== 'draft') throw lifecycleDisabled();
            if (action || input.publish === true) {
                if (input.action === 'publish' || input.publish === true) throw publicationDisabled();
                throw lifecycleDisabled();
            }
            const saved = applyDraft(ctx.item, input, now);
            saved.coordinationRevision = ctx.item.coordinationRevision + 1; saved.version++; saved.updatedAt = now;
            const result = response(saved, null, now);
            const update = await db.collection('items').replaceOne({ _id: item._id, ownerId, version: input.version, coordinationRevision: saved.coordinationRevision }, saved, { session });
            if (update.modifiedCount !== 1) throw new InventoryError(409, 'LISTING_CHANGED', 'Listing changed. Reload it before editing.');
            return { item: result };
        }, { contextOperation: 'ownerDraft' });
    }
    return { create, list, detail, mutate };
}
module.exports = { createOwnerListingService, feedPipeline, feedIndex };
