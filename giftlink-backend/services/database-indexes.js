// Shared index definitions: startup checks only; the administration command
// explicitly inspects and creates indexes. Neither path imports demo fixtures.
class PreparationError extends Error {
    constructor(message) { super(message); this.name = 'PreparationError'; }
}

const definitions = [
    { collection: 'users', name: 'users_email_unique', key: { email: 1 }, options: { unique: true, collation: { locale: 'simple' } } },
    { collection: 'sessions', name: 'sessions_expiry', key: { expiresAt: 1 }, options: { expireAfterSeconds: 0, collation: { locale: 'simple' } } },
    { collection: 'moveOutPlans', name: 'move_out_plans_owner_deadline', key: { ownerId: 1, moveOutDeadline: 1, _id: 1 },
        options: { collation: { locale: 'simple' } } },
    { collection: 'items', name: 'items_owner_created', key: { ownerId: 1, createdAt: -1, _id: -1 }, options: { collation: { locale: 'simple' } } },
    { collection: 'items', name: 'items_plan_owner', key: { planId: 1, ownerId: 1, createdAt: 1, _id: 1 }, options: { collation: { locale: 'simple' } } },
    { collection: 'items', name: 'items_publication', key: { status: 1, publishedAt: -1, _id: -1 }, options: { collation: { locale: 'simple' } } },
    { collection: 'items', name: 'items_pickup_start', key: { status: 1, availableFrom: 1, publishedAt: -1, _id: -1 }, options: { collation: { locale: 'simple' } } },
    { collection: 'pickupRequests', name: 'pickup_received', key: { giverId: 1, _id: -1 }, options: { collation: { locale: 'simple' } } },
    { collection: 'pickupRequests', name: 'pickup_sent', key: { receiverId: 1, _id: -1 }, options: { collation: { locale: 'simple' } } },
    { collection: 'pickupRequests', name: 'pickup_one_accepted', key: { itemId: 1 }, options: { unique: true, partialFilterExpression: { status: 'accepted' }, collation: { locale: 'simple' } } },
    { collection: 'pickupRequests', name: 'pickup_active_receiver', key: { itemId: 1, receiverId: 1 }, options: { unique: true, partialFilterExpression: { active: true }, collation: { locale: 'simple' } } },
    { collection: 'pickupMessages', name: 'pickup_messages_request_time', key: { requestId: 1, createdAt: -1, _id: -1 }, options: { collation: { locale: 'simple' } } },
    { collection: 'moveOutPlans', name: 'plan_metro_discovery', key: { metroId: 1, status: 1, stateId: 1, _id: 1 }, options: { collation: { locale: 'simple' } } },
    { collection: 'itemImages', name: 'images_item_state_order', key: { itemId: 1, ownerId: 1, state: 1, sortPosition: 1, _id: 1 }, options: { collation: { locale: 'simple' } } },
    { collection: 'itemImages', name: 'images_item_upload_unique', key: { itemId: 1, clientUploadId: 1 }, options: { unique: true, collation: { locale: 'simple' } } },
    { collection: 'itemImages', name: 'images_due_work', key: { maintenanceDueAt: 1, _id: 1 }, options: { partialFilterExpression: { needsMaintenance: true }, collation: { locale: 'simple' } } },
    { collection: 'itemImages', name: 'images_owner_state', key: { ownerId: 1, state: 1, _id: 1 }, options: { collation: { locale: 'simple' } } }
];
const sameKey = (index, definition) => JSON.stringify(index.key) === JSON.stringify(definition.key);
function compatible(index, definition) {
    if (!sameKey(index, definition) || JSON.stringify(index.partialFilterExpression) !== JSON.stringify(definition.options.partialFilterExpression) || index.sparse ||
        (index.collation && index.collation.locale !== 'simple')) return false;
    return Boolean(index.unique) === Boolean(definition.options.unique) &&
        index.expireAfterSeconds === definition.options.expireAfterSeconds;
}
const hasCompatible = (indexes, definition) => indexes.some(index => compatible(index, definition));
const hasConflict = (indexes, definition) => indexes.some(index =>
    (index.name === definition.name || sameKey(index, definition)) && !compatible(index, definition));

async function listIndexes(db, collection) {
    try { return await db.collection(collection).indexes(); }
    catch (error) {
        if (error.code === 26) return []; // A new database needs no collection-creation write during preview.
        throw error;
    }
}

async function inspectDatabaseIndexes(db) {
    const operations = [];
    const conflicts = [];
    for (const definition of definitions) {
        const indexes = await listIndexes(db, definition.collection);
        const ready = hasCompatible(indexes, definition);
        if (hasConflict(indexes, definition)) {
            // Do not report arbitrary existing index names/definitions: partial filters can contain private data.
            conflicts.push({ collection: definition.collection, index: definition.name, problem: 'incompatible-index' });
        }
        operations.push({ collection: definition.collection, index: definition.name, key: definition.key,
            options: definition.options, action: ready ? 'keep' : 'create' });
    }

    const accounts = { invalidEmail: 0, nonNormalizedEmail: 0, duplicateGroups: 0, duplicateAccounts: 0 };
    const images = { invalidOperations: 0, duplicateGroups: 0, invalidQuotas: 0 };
    const { validOperation, validQuota } = require('./item-image-policy');
    const seen = new Map();
    const cursor = db.collection('users').find({}, { projection: { _id: 0, email: 1, itemImageQuota: 1 } });
    try {
        while (await cursor.hasNext()) {
            const user = await cursor.next();
            if (user.itemImageQuota !== undefined && !validQuota(user.itemImageQuota)) images.invalidQuotas++;
            if (typeof user.email !== 'string' || !user.email.trim()) { accounts.invalidEmail++; continue; }
            const normalized = user.email.trim().toLowerCase();
            if (user.email !== normalized) accounts.nonNormalizedEmail++;
            const count = seen.get(normalized) || 0;
            if (count === 1) accounts.duplicateGroups++;
            if (count === 1) accounts.duplicateAccounts += 2;
            else if (count > 1) accounts.duplicateAccounts++;
            seen.set(normalized, count + 1);
        }
    } finally { await cursor.close(); }
    if (Object.values(accounts).some(count => count > 0)) conflicts.push({ collection: 'users', problem: 'account-email-conflicts' });
    const pickups = { duplicateAcceptedGroups: 0, duplicateActiveReceiverGroups: 0 };
    for (const [field, match, group] of [
        ['duplicateAcceptedGroups', { status: 'accepted' }, '$itemId'],
        ['duplicateActiveReceiverGroups', { active: true }, { itemId: '$itemId', receiverId: '$receiverId' }]
    ]) {
        const rows = await db.collection('pickupRequests').aggregate([{ $match: match }, { $group: { _id: group, count: { $sum: 1 } } },
            { $match: { count: { $gt: 1 } } }, { $count: 'groups' }], { collation: { locale: 'simple' } }).toArray();
        pickups[field] = rows.length ? rows[0].groups : 0;
    }
    if (Object.values(pickups).some(count => count > 0)) conflicts.push({ collection: 'pickupRequests', problem: 'pickup-uniqueness-conflicts' });
    const imageCursor = db.collection('itemImages').find({});
    try { while (await imageCursor.hasNext()) if (!validOperation(await imageCursor.next())) images.invalidOperations++; }
    finally { await imageCursor.close(); }
    const duplicateImages = await db.collection('itemImages').aggregate([
        { $group: { _id: { itemId: '$itemId', clientUploadId: '$clientUploadId' }, count: { $sum: 1 } } },
        { $match: { count: { $gt: 1 } } }, { $count: 'groups' }
    ], { collation: { locale: 'simple' }, maxTimeMS: 5000 }).toArray();
    images.duplicateGroups = duplicateImages.length ? duplicateImages[0].groups : 0;
    if (Object.values(images).some(count => count > 0)) conflicts.push({ collection: 'itemImages', problem: 'image-metadata-conflicts' });
    return { operations, accounts, pickups, images, conflicts, ready: conflicts.length === 0 };
}

async function prepareDatabaseIndexes(db) {
    // Reinspect immediately before creating anything; never repair account data,
    // drop indexes, or change TTL options with collMod.
    const plan = await inspectDatabaseIndexes(db);
    if (!plan.ready) throw new PreparationError('Index preparation blocked. Review the preview counts and incompatible indexes; email conflicts require a separately reviewed normalization migration. No accounts were changed.');
    for (const operation of plan.operations) {
        if (operation.action === 'create') {
            try {
                await db.collection(operation.collection).createIndex(operation.key,
                    Object.assign({ name: operation.index }, operation.options));
            } catch (error) {
                // Native duplicate-key errors may include private email values.
                throw new PreparationError('Index creation failed. Pause writers and run a fresh preview; inspect permissions and concurrent data/index changes securely. Earlier index creations may have completed. No accounts were rewritten.');
            }
        }
    }
    return plan;
}

async function assertDatabaseIndexes(db, { imageMetadataEnabled = true, ownerListingsEnabled = true } = {}) {
    try {
        for (const definition of definitions) {
            // Explicit preparation/full-registry callers retain the default check.
            // Only startup with disabled metadata may omit the four photo indexes.
            if (definition.name === 'items_owner_created' && ownerListingsEnabled === false) continue;
            if (definition.collection === 'itemImages' && imageMetadataEnabled === false) continue;
            const indexes = await listIndexes(db, definition.collection);
            if (!hasCompatible(indexes, definition) || (definition.collection === 'itemImages' || definition.name === 'items_owner_created') && hasConflict(indexes, definition)) {
                throw new Error('Missing or incompatible index');
            }
        }
    } catch (error) {
        throw new Error('Database indexes are required. Verify the target and run npm run db:prepare; existing data was not changed');
    }
}

module.exports = { inspectDatabaseIndexes, prepareDatabaseIndexes, assertDatabaseIndexes, PreparationError };
