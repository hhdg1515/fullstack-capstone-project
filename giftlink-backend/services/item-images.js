const { ObjectId } = require('mongodb');
const { randomUUID } = require('node:crypto');
const { InventoryError, planTransaction } = require('./inventory');
const policy = require('./item-image-policy');
const { ceiling, unavailable, damaged, assertOperation, quotaFor, variantKey } = policy;
const isId = value => typeof value === 'string' && /^[a-fA-F0-9]{24}$/.test(value);
const changed = () => new InventoryError(409, 'IMAGE_CHANGED', 'Photos changed. Reload their metadata before trying again.');
const options = session => ({ session, maxTimeMS: 5000, collation: { locale: 'simple' } });

function operationResponse(row, now) {
    assertOperation(row);
    return { id: row._id.toHexString(), state: row.state, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(),
        expiresAt: ['reserved', 'processing'].includes(row.state) ? row.lease.expiresAt.toISOString() : null,
        reservationExpired: row.state === 'reserved' && row.lease.expiresAt <= now,
        cleanupPending: row.state === 'delete_pending' || row.state === 'failed' && row.needsMaintenance };
}
function readyResponse(row, now) {
    const result = Object.assign(operationResponse(row, now), { sortPosition: row.sortPosition });
    for (const name of ['thumbnail', 'display']) {
        const v = row.variants[name]; result[name] = { width: v.width, height: v.height, byteLength: v.byteLength, contentType: v.contentType };
    }
    return result;
}
function reservationRow(ownerId, plan, item, input, identity, now, binding) {
    const day = now.toISOString().slice(0, 10);
    const expiry = new Date(Math.min(now.getTime() + ceiling.leaseMs, Date.parse(day + 'T00:00:00.000Z') + 86400000));
    const row = { schemaVersion: 1, _id: identity.id, itemId: item._id, planId: plan._id, ownerId,
        clientUploadId: input.clientUploadId, intent: { byteLength: input.byteLength, sha256: input.sha256 },
        state: 'reserved', sortPosition: null, generation: identity.generation, storageBinding: Object.assign({}, binding), variants: {},
        lease: { fenceToken: null, claimedAt: null, expiresAt: expiry }, version: 1,
        charge: { quotaDay: day, reservedBytes: ceiling.reservedBytes, retainedBytes: 0, heldSuccess: true,
            concurrencyHeld: true, slotHeld: true, dailySuccessCharged: false, holdsSettled: false, storageReleasedAt: null },
        cleanup: { reason: null, attempts: 0, nextAttemptAt: null }, needsMaintenance: true, maintenanceDueAt: expiry,
        createdAt: now, updatedAt: now, readyAt: null, deleteRequestedAt: null, deletedAt: null };
    for (const name of ['thumbnail', 'display']) row.variants[name] = { key: variantKey(row, name), outcome: 'not_started',
        byteLength: null, sha256: null, width: null, height: null, contentType: 'image/webp' };
    return assertOperation(row);
}

function createItemImagesService({ connectToDatabase, configuration, control = null }) {
    const config = policy.validateImageConfig(configuration);
    const limits = Object.freeze(Object.assign({ photos: ceiling.photos, inputBytes: ceiling.inputBytes, reservedBytes: ceiling.reservedBytes }, config.limits));
    async function connect() {
        const db = await connectToDatabase();
        // An accidentally metadata-only/new-binary fallback must not bypass an
        // adopted target's transaction guard. Explicit F4 contexts additionally
        // refuse missing/corrupt control state, even when this lookup cannot match.
        if (!control && await db.collection('photoControls').findOne({ 'target.database': db.databaseName,
            'target.storageFingerprint': config.storageBinding.fingerprint, 'target.namespace': config.storageBinding.namespace },
            { projection: { _id: 1 }, maxTimeMS: 2000, readConcern: { level: 'majority' }, readPreference: 'primary' })) {
            throw new InventoryError(503, 'IMAGE_CONTROL_REQUIRED', 'Photo operations require approved shared authority.');
        }
        return db;
    }
    function inputIds(ownerId, planId, itemId, imageId) {
        if (!(ownerId instanceof ObjectId) || !isId(planId) || !isId(itemId) || imageId !== undefined && !isId(imageId)) throw unavailable();
    }
    function scope(ownerId, planId, itemId) {
        return { ownerId, planId: new ObjectId(planId), itemId: new ObjectId(itemId),
            'storageBinding.fingerprint': config.storageBinding.fingerprint, 'storageBinding.namespace': config.storageBinding.namespace };
    }
    async function context(db, ownerId, plan, itemId, session) {
        const account = await db.collection('users').aggregate([{ $match: { _id: ownerId } },
            { $project: { itemImageQuota: 1, serverNow: '$$NOW' } }], options(session)).next();
        if (!account) throw unavailable();
        const item = await db.collection('items').findOne({ _id: new ObjectId(itemId), planId: plan._id, ownerId }, options(session));
        if (!item || !['draft', 'available', 'unlisted', 'expired', 'cleared'].includes(item.status)) throw unavailable();
        if (!(plan.ownerId instanceof ObjectId) || !plan.ownerId.equals(ownerId) || !(item.ownerId instanceof ObjectId) ||
            !item.ownerId.equals(ownerId) || !(item.planId instanceof ObjectId) || !item.planId.equals(plan._id)) throw unavailable();
        // Configuration/reference changes must not hide old slots or upload IDs.
        // Moving existing media to another target requires a separately reviewed migration.
        const inconsistent = await db.collection('itemImages').findOne({ itemId: item._id, $or: [
            { ownerId: { $ne: ownerId } }, { planId: { $ne: plan._id } },
            { 'storageBinding.fingerprint': { $ne: config.storageBinding.fingerprint } },
            { 'storageBinding.namespace': { $ne: config.storageBinding.namespace } }
        ] }, options(session));
        if (inconsistent) {
            if (!(inconsistent.ownerId instanceof ObjectId) || !inconsistent.ownerId.equals(ownerId) ||
                !(inconsistent.planId instanceof ObjectId) || !inconsistent.planId.equals(plan._id)) throw unavailable();
            throw damaged();
        }
        const revision = item.imageRevision === undefined ? 0 : item.imageRevision;
        if (!policy.integer(revision) || !(account.serverNow instanceof Date)) throw damaged();
        return { account, item, revision, now: account.serverNow };
    }
    async function write(ownerId, planId, itemId, operation, admission = false) {
        inputIds(ownerId, planId, itemId);
        const db = await connect();
        try {
            return await planTransaction(db, ownerId, planId, async (plan, session) => {
                if (control) await control.fence(session, admission);
                return operation(db, plan, await context(db, ownerId, plan, itemId, session), session);
            });
        } catch (error) { if (error.code === 'ITEM_NOT_FOUND') throw unavailable(); throw error; }
    }
    async function read(ownerId, planId, itemId, operation) {
        inputIds(ownerId, planId, itemId);
        const db = await connect(); const session = db.client.startSession();
        try {
            return await session.withTransaction(async () => {
                if (control) await control.check(session);
                const plan = await db.collection('moveOutPlans').findOne({ _id: new ObjectId(planId), ownerId }, options(session));
                if (!plan) throw unavailable();
                return operation(db, plan, await context(db, ownerId, plan, itemId, session), session);
            }, { readConcern: { level: 'snapshot' }, readPreference: 'primary' });
        } finally { await session.endSession(); }
    }
    async function readyRows(db, filter, session) {
        const rows = await db.collection('itemImages').find(Object.assign({}, filter, { state: 'ready' }), options(session))
            .sort({ sortPosition: 1, _id: 1 }).limit(ceiling.photos + 1).toArray();
        if (rows.length > ceiling.photos) throw damaged();
        rows.forEach((row, index) => { assertOperation(row); if (row.sortPosition !== index) throw damaged(); });
        return rows;
    }
    async function ownedRow(db, filter, imageId, session) {
        const row = await db.collection('itemImages').findOne(Object.assign({}, filter, { _id: new ObjectId(imageId) }), options(session));
        if (!row) throw unavailable();
        return assertOperation(row);
    }
    function checkRevision(actual, expected) { if (!policy.integer(expected) || expected !== actual) throw changed(); }
    async function bumpRevision(db, ownerId, planId, item, revision, session) {
        if (!Number.isSafeInteger(revision + 1)) throw changed();
        await db.collection('items').updateOne({ _id: item._id, ownerId, planId: new ObjectId(planId) },
            { $set: { imageRevision: revision + 1 } }, { session });
        return revision + 1;
    }
    async function saveQuota(db, userId, quota, session) {
        if (!policy.validQuota(quota)) throw damaged();
        const result = await db.collection('users').updateOne({ _id: userId }, { $set: { itemImageQuota: quota } }, { session });
        if (result.matchedCount !== 1) throw unavailable(); // No upsert/recreated account.
    }
    function settleNeverClaimed(row, quota, now) {
        // A full validated reserved row has no producer, claim or possible object PUT.
        // Processing, failed/unknown and already-deleting rows never use this shortcut.
        if (row.state !== 'reserved' || !policy.validOperation(row)) throw damaged();
        const c = row.charge;
        if (quota.activeUploads < 1 || quota.reservedBytes < c.reservedBytes || c.quotaDay === quota.utcDay && quota.heldSuccess < 1) throw damaged();
        quota.activeUploads--; quota.reservedBytes -= c.reservedBytes;
        if (c.quotaDay === quota.utcDay) quota.heldSuccess--;
        row.charge = Object.assign({}, c, { reservedBytes: 0, heldSuccess: false, concurrencyHeld: false,
            slotHeld: false, holdsSettled: true, storageReleasedAt: now });
    }
    async function reap(db, ownerId, quota, now, tokens, session, preview = false) {
        const settled = [];
        const rows = await db.collection('itemImages').find({ ownerId, state: 'reserved', 'charge.concurrencyHeld': true,
            'lease.expiresAt': { $lte: now }, 'storageBinding.fingerprint': config.storageBinding.fingerprint,
            'storageBinding.namespace': config.storageBinding.namespace }, options(session)).sort({ _id: 1 }).limit(2).toArray();
        for (const row of rows) {
            assertOperation(row);
            const parent = await db.collection('moveOutPlans').findOne({ _id: row.planId, ownerId }, options(session));
            const item = await db.collection('items').findOne({ _id: row.itemId, planId: row.planId, ownerId }, options(session));
            if (!parent || !item) continue; // Orphan/corrupt references require operator review, never a blind refund.
            settleNeverClaimed(row, quota, now);
            settled.push(row._id.toHexString());
            if (preview) continue; // Admission projection only; GET never writes/reaps.
            if (!tokens.has(row._id.toHexString())) tokens.set(row._id.toHexString(), randomUUID());
            Object.assign(row, { state: 'failed', updatedAt: now, version: row.version + 1,
                needsMaintenance: false, maintenanceDueAt: null });
            row.cleanup = { reason: 'reservation_expired', attempts: 0, nextAttemptAt: null };
            row.lease = Object.assign({}, row.lease, { fenceToken: tokens.get(row._id.toHexString()) });
            assertOperation(row);
            const result = await db.collection('itemImages').replaceOne({ _id: row._id, state: 'reserved', version: row.version - 1,
                'lease.expiresAt': { $lte: now } }, row, { session });
            if (result.matchedCount !== 1) throw damaged();
        }
        return settled;
    }
    function quotaLimit(quota, now) {
        const dailyDelay = Math.max(1, Math.min(86400, Math.ceil((Date.parse(quota.utcDay + 'T00:00:00.000Z') + 86400000 - now.getTime()) / 1000)));
        const reject = (code, message, daily = false) => { throw new InventoryError(429, code, message, daily ? { retryAfterSeconds: dailyDelay } : {}); };
        if (quota.operationCount >= limits.records) reject('IMAGE_RECORD_LIMIT', 'Photo operation limit reached. Contact support for review.');
        if (quota.attempts >= limits.attempts) reject('IMAGE_DAILY_ATTEMPTS', 'Daily photo reservation limit reached. Try again after the UTC day ends.', true);
        if (quota.successful + quota.heldSuccess >= limits.successes) reject('IMAGE_DAILY_UPLOADS', 'Daily photo allowance is used or reserved. Review existing operations or wait until the next UTC day.', true);
        if (quota.activeUploads >= limits.concurrent) reject('IMAGE_UPLOAD_CAPACITY', 'Upload capacity is reserved or pending cleanup. Review existing operation status.');
        if (quota.reservedBytes + quota.retainedBytes + ceiling.reservedBytes > limits.accountBytes) reject('IMAGE_STORAGE_CAPACITY', 'Photo storage capacity is reserved or in use. Resolve existing operations before reserving more.');
    }
    async function list(ownerId, planId, itemId) {
        return read(ownerId, planId, itemId, async (db, plan, ctx, session) => {
            const filter = scope(ownerId, planId, itemId);
            const ready = await readyRows(db, filter, session);
            const active = await db.collection('itemImages').find(Object.assign({}, filter, { state: { $ne: 'ready' },
                $or: [{ 'charge.slotHeld': true }, { 'charge.concurrencyHeld': true }] }), options(session)).sort({ createdAt: -1, _id: -1 }).limit(6).toArray();
            if (active.length + ready.length > ceiling.photos) throw damaged();
            const recent = await db.collection('itemImages').find(Object.assign({}, filter, { state: { $ne: 'ready' },
                _id: { $nin: active.map(row => row._id) } }), options(session)).sort({ updatedAt: -1, _id: -1 }).limit(20).toArray();
            active.concat(recent).forEach(assertOperation);
            if (ctx.account.itemImageQuota === undefined && await db.collection('itemImages').findOne({ ownerId }, options(session))) throw damaged();
            const quota = quotaFor(ctx.account.itemImageQuota, ctx.now);
            const unused = await reap(db, ownerId, quota, ctx.now, new Map(), session, true);
            const calendar = require('./calendar'), day = ctx.now.toISOString().slice(0, 10);
            const end = ctx.item.availableUntil || plan.moveOutDeadline;
            const allowance = { itemSlots: Math.max(0, ceiling.photos - ready.length - active.filter(row => !unused.includes(row._id.toHexString())).length),
                attempts: Math.max(0, limits.attempts - quota.attempts), successes: Math.max(0, limits.successes - quota.successful - quota.heldSuccess),
                storageBytes: Math.max(0, limits.accountBytes - quota.reservedBytes - quota.retainedBytes),
                concurrent: Math.max(0, limits.concurrent - quota.activeUploads), records: Math.max(0, limits.records - quota.operationCount),
                newUploadsAllowed: plan.status === 'active' && ctx.item.status !== 'cleared' && calendar.isCalendarDate(plan.moveOutDeadline) &&
                    calendar.isCalendarDate(end) && end >= day && end <= plan.moveOutDeadline && plan.moveOutDeadline >= day };
            return { imageRevision: ctx.revision, images: ready.map(row => readyResponse(row, ctx.now)),
                uploads: active.concat(recent).map(row => operationResponse(row, ctx.now)), limits, allowance, binaryUploadsEnabled: false };
        });
    }
    async function status(ownerId, planId, itemId, imageId) {
        inputIds(ownerId, planId, itemId, imageId);
        return read(ownerId, planId, itemId, async (db, plan, ctx, session) => ({ imageRevision: ctx.revision,
            upload: operationResponse(await ownedRow(db, scope(ownerId, planId, itemId), imageId, session), ctx.now), binaryUploadsEnabled: false }));
    }
    async function lookup(ownerId, planId, itemId, clientUploadId) {
        if (!policy.uuid(clientUploadId)) throw unavailable();
        return read(ownerId, planId, itemId, async (db, plan, ctx, session) => {
            const row = await db.collection('itemImages').findOne(Object.assign(scope(ownerId, planId, itemId), { clientUploadId }), options(session));
            if (!row) throw unavailable();
            return { imageRevision: ctx.revision, upload: operationResponse(row, ctx.now), binaryUploadsEnabled: false };
        });
    }
    async function reserve(ownerId, planId, itemId, input) {
        if (!input || !policy.uuid(input.clientUploadId) || !policy.hash(input.sha256) ||
            !policy.integer(input.byteLength) || input.byteLength < 1 || input.byteLength > ceiling.inputBytes || !policy.integer(input.imageRevision)) {
            throw new InventoryError(400, 'VALIDATION_FAILED', 'Use a valid upload ID, SHA-256, byte length and photo revision.');
        }
        const identity = { id: new ObjectId(), generation: randomUUID() }; const tokens = new Map();
        return write(ownerId, planId, itemId, async (db, plan, ctx, session) => {
            const filter = scope(ownerId, planId, itemId);
            const existing = await db.collection('itemImages').findOne(Object.assign({}, filter, { clientUploadId: input.clientUploadId }), options(session));
            if (existing) {
                assertOperation(existing);
                if (existing.intent.byteLength !== input.byteLength || existing.intent.sha256 !== input.sha256) {
                    throw new InventoryError(409, 'IMAGE_INTENT_CHANGED', 'This upload ID has different contents. Review its existing status.');
                }
                return { created: false, body: { imageRevision: ctx.revision, upload: operationResponse(existing, ctx.now), limits, binaryUploadsEnabled: false } };
            }
            checkRevision(ctx.revision, input.imageRevision);
            if (plan.status !== 'active' || ctx.item.status === 'cleared') throw new InventoryError(409, 'IMAGE_UPLOAD_UNAVAILABLE', 'New photo reservations require an active plan and an uncleared item.');
            if (ctx.account.itemImageQuota === undefined && await db.collection('itemImages').findOne({ ownerId }, options(session))) throw damaged();
            const quota = quotaFor(ctx.account.itemImageQuota, ctx.now);
            await reap(db, ownerId, quota, ctx.now, tokens, session);
            await readyRows(db, filter, session);
            const active = await db.collection('itemImages').find(Object.assign({}, filter, { $or: [
                { state: { $in: ['ready', 'reserved', 'processing'] } }, { 'charge.slotHeld': true }, { 'charge.concurrencyHeld': true }
            ] }), options(session)).limit(6).toArray();
            active.forEach(assertOperation);
            if (active.length >= ceiling.photos) throw new InventoryError(409, 'IMAGE_ITEM_LIMIT', 'An item can have at most five active photos, including pending uploads.');
            quotaLimit(quota, ctx.now);
            const row = reservationRow(ownerId, plan, ctx.item, input, identity, ctx.now, config.storageBinding);
            quota.attempts++; quota.heldSuccess++; quota.reservedBytes += ceiling.reservedBytes; quota.activeUploads++; quota.operationCount++;
            await saveQuota(db, ownerId, quota, session);
            await db.collection('itemImages').insertOne(row, { session });
            return { created: true, body: { imageRevision: ctx.revision, upload: operationResponse(row, ctx.now), limits, binaryUploadsEnabled: false } };
        }, true);
    }
    async function reorder(ownerId, planId, itemId, input) {
        if (!input || !Array.isArray(input.imageIds) || input.imageIds.length > ceiling.photos ||
            !input.imageIds.every(isId) || new Set(input.imageIds.map(id => id.toLowerCase())).size !== input.imageIds.length) {
            throw new InventoryError(400, 'VALIDATION_FAILED', 'Use each ready photo ID exactly once.');
        }
        return write(ownerId, planId, itemId, async (db, plan, ctx, session) => {
            checkRevision(ctx.revision, input.imageRevision);
            const rows = await readyRows(db, scope(ownerId, planId, itemId), session);
            const ids = input.imageIds.map(id => id.toLowerCase());
            if (rows.length !== ids.length || rows.some(row => !ids.includes(row._id.toHexString()))) throw changed();
            let revision = ctx.revision;
            if (rows.some((row, index) => row._id.toHexString() !== ids[index])) {
                for (const row of rows) {
                    row.sortPosition = ids.indexOf(row._id.toHexString()); row.updatedAt = ctx.now; row.version++;
                    assertOperation(row);
                    await db.collection('itemImages').replaceOne({ _id: row._id, version: row.version - 1 }, row, { session });
                }
                revision = await bumpRevision(db, ownerId, planId, ctx.item, ctx.revision, session);
            }
            return { imageRevision: revision, images: rows.sort((a, b) => a.sortPosition - b.sortPosition).map(row => readyResponse(row, ctx.now)), binaryUploadsEnabled: false };
        });
    }
    async function remove(ownerId, planId, itemId, imageId, input) {
        inputIds(ownerId, planId, itemId, imageId);
        if (!input || input.action !== 'delete') throw new InventoryError(400, 'VALIDATION_FAILED', 'Use the delete action.');
        const fenceToken = randomUUID();
        return write(ownerId, planId, itemId, async (db, plan, ctx, session) => {
            const filter = scope(ownerId, planId, itemId);
            const row = await ownedRow(db, filter, imageId, session);
            if (['delete_pending', 'deleted'].includes(row.state)) return { status: row.state === 'deleted' ? 200 : 202,
                body: { imageRevision: ctx.revision, upload: operationResponse(row, ctx.now), binaryUploadsEnabled: false } };
            checkRevision(ctx.revision, input.imageRevision);
            const ready = await readyRows(db, filter, session);
            if (row.state === 'reserved') {
                const quota = quotaFor(ctx.account.itemImageQuota, ctx.now); settleNeverClaimed(row, quota, ctx.now);
                await saveQuota(db, ownerId, quota, session);
            } else if (row.state === 'ready') row.charge = Object.assign({}, row.charge, { slotHeld: false });
            Object.assign(row, { state: 'delete_pending', sortPosition: null, updatedAt: ctx.now, version: row.version + 1,
                deleteRequestedAt: ctx.now, needsMaintenance: true, maintenanceDueAt: ctx.now });
            row.cleanup = { reason: 'owner_delete', attempts: 0, nextAttemptAt: ctx.now };
            row.lease = Object.assign({}, row.lease, { fenceToken });
            assertOperation(row);
            await db.collection('itemImages').replaceOne({ _id: row._id, version: row.version - 1 }, row, { session });
            // Removal can leave a gap. This is a deliberate write, never repair-on-read.
            const remaining = ready.filter(image => !image._id.equals(row._id));
            for (const [index, image] of remaining.entries()) {
                if (image.sortPosition === index) continue;
                assertOperation(image); image.sortPosition = index; image.updatedAt = ctx.now; image.version++;
                await db.collection('itemImages').replaceOne({ _id: image._id, version: image.version - 1 }, image, { session });
            }
            const revision = await bumpRevision(db, ownerId, planId, ctx.item, ctx.revision, session);
            return { status: 202, body: { imageRevision: revision, upload: operationResponse(row, ctx.now), binaryUploadsEnabled: false } };
        });
    }
    function contentEligible(plan, ctx, row) {
        const day = ctx.now.toISOString().slice(0, 10);
        if (plan.status !== 'active' || ctx.item.status === 'cleared' ||
            !require('./calendar').isCalendarDate(plan.moveOutDeadline) || plan.moveOutDeadline < day ||
            !require('./calendar').isCalendarDate(ctx.item.availableUntil || plan.moveOutDeadline) ||
            (ctx.item.availableUntil || plan.moveOutDeadline) < day || (ctx.item.availableUntil || plan.moveOutDeadline) > plan.moveOutDeadline ||
            row.lease.expiresAt <= ctx.now || row.charge.quotaDay !== day) {
            throw new InventoryError(409, 'IMAGE_UPLOAD_UNAVAILABLE', 'This reservation is no longer eligible. Review its status.');
        }
    }
    function contentResult(row, ctx) {
        return { imageRevision: ctx.revision, upload: operationResponse(row, ctx.now), binaryUploadsEnabled: false };
    }
    async function inspectUpload(ownerId, planId, itemId, imageId) {
        inputIds(ownerId, planId, itemId, imageId);
        return read(ownerId, planId, itemId, async (db, plan, ctx, session) => {
            const row = await ownedRow(db, scope(ownerId, planId, itemId), imageId, session);
            if (row.state === 'reserved') contentEligible(plan, ctx, row);
            return { row, body: contentResult(row, ctx) };
        });
    }
    async function claim(ownerId, planId, itemId, imageId) {
        inputIds(ownerId, planId, itemId, imageId); const token = randomUUID();
        return write(ownerId, planId, itemId, async (db, plan, ctx, session) => {
            const row = await ownedRow(db, scope(ownerId, planId, itemId), imageId, session);
            if (row.state !== 'reserved') return { claimed: false, body: contentResult(row, ctx) };
            contentEligible(plan, ctx, row);
            const quota = quotaFor(ctx.account.itemImageQuota, ctx.now);
            if (ctx.account.itemImageQuota === undefined || quota.activeUploads < 1 || quota.reservedBytes < ceiling.reservedBytes || quota.heldSuccess < 1) throw damaged();
            row.state = 'processing'; row.lease.claimedAt = ctx.now; row.lease.fenceToken = token; row.updatedAt = ctx.now; row.version++;
            assertOperation(row);
            const claimed = await db.collection('itemImages').replaceOne({ _id: row._id, state: 'reserved', version: row.version - 1,
                $expr: { $gt: ['$lease.expiresAt', '$$NOW'] } }, row, { session });
            if (claimed.matchedCount !== 1) throw changed();
            return { claimed: true, row, body: contentResult(row, ctx) };
        }, true);
    }
    async function processingWrite(ticket, operation, eligible = true) {
        return write(ticket.ownerId, ticket.planId.toHexString(), ticket.itemId.toHexString(), async (db, plan, ctx, session) => {
            const row = await ownedRow(db, scope(ticket.ownerId, ticket.planId.toHexString(), ticket.itemId.toHexString()), ticket._id.toHexString(), session);
            if (row.state !== 'processing' || row.generation !== ticket.generation || row.lease.fenceToken !== ticket.lease.fenceToken) throw changed();
            if (eligible) contentEligible(plan, ctx, row);
            const result = await operation(db, ctx, row, session);
            row.updatedAt = ctx.now; row.version++; assertOperation(row);
            const filter = { _id: row._id, state: 'processing', version: row.version - 1, 'lease.fenceToken': ticket.lease.fenceToken };
            if (eligible) filter.$expr = { $gt: ['$lease.expiresAt', '$$NOW'] };
            const replaced = await db.collection('itemImages').replaceOne(filter, row, { session });
            if (replaced.matchedCount !== 1) throw changed();
            return result === undefined ? row : result;
        });
    }
    async function prepareVariants(ticket, variants) {
        return processingWrite(ticket, async (db, ctx, row) => {
            for (const name of ['thumbnail', 'display']) {
                if (row.variants[name].outcome !== 'not_started') throw changed();
                const v = variants[name];
                row.variants[name] = { key: variantKey(row, name), outcome: 'prepared', byteLength: v.byteLength,
                    sha256: v.sha256, width: v.width, height: v.height, contentType: 'image/webp' };
            }
        });
    }
    async function beginPut(ticket, name) {
        if (!['thumbnail', 'display'].includes(name)) throw damaged();
        return processingWrite(ticket, async (db, ctx, row) => {
            if (row.variants[name].outcome !== 'prepared') throw changed();
            row.variants[name].outcome = 'unknown';
            return Object.assign({}, row.variants[name]);
        });
    }
    async function stored(ticket, name) {
        if (!['thumbnail', 'display'].includes(name)) throw damaged();
        return processingWrite(ticket, async (db, ctx, row) => {
            if (row.variants[name].outcome !== 'unknown') throw changed(); row.variants[name].outcome = 'stored';
        });
    }
    async function fail(ticket) {
        return processingWrite(ticket, async (db, ctx, row, session) => {
            const certain = Object.values(row.variants).every(v => ['not_started', 'prepared', 'rejected'].includes(v.outcome));
            if (certain) {
                if (ctx.account.itemImageQuota === undefined) throw damaged();
                const quota = quotaFor(ctx.account.itemImageQuota, ctx.now), c = row.charge;
                if (quota.activeUploads < 1 || quota.reservedBytes < c.reservedBytes || c.quotaDay === quota.utcDay && quota.heldSuccess < 1) throw damaged();
                quota.activeUploads--; quota.reservedBytes -= c.reservedBytes;
                if (c.quotaDay === quota.utcDay) quota.heldSuccess--;
                row.charge = Object.assign({}, c, { reservedBytes: 0, heldSuccess: false, concurrencyHeld: false,
                    slotHeld: false, holdsSettled: true, storageReleasedAt: ctx.now });
                await saveQuota(db, ticket.ownerId, quota, session);
            }
            row.state = 'failed'; row.cleanup = { reason: 'pipeline_failed', attempts: 0, nextAttemptAt: certain ? null : ctx.now };
            row.needsMaintenance = !certain; row.maintenanceDueAt = certain ? null : ctx.now;
        }, false);
    }
    async function finalize(ticket) {
        return processingWrite(ticket, async (db, ctx, row, session) => {
            if (!Object.values(row.variants).every(v => v.outcome === 'stored') || ctx.account.itemImageQuota === undefined) throw damaged();
            const quota = quotaFor(ctx.account.itemImageQuota, ctx.now), c = row.charge;
            if (quota.activeUploads < 1 || quota.heldSuccess < 1 || quota.reservedBytes < c.reservedBytes || c.holdsSettled) throw damaged();
            const ready = await readyRows(db, scope(ticket.ownerId, ticket.planId.toHexString(), ticket.itemId.toHexString()), session);
            if (ready.length >= ceiling.photos) throw damaged();
            const size = row.variants.thumbnail.byteLength + row.variants.display.byteLength;
            quota.activeUploads--; quota.heldSuccess--; quota.successful++; quota.reservedBytes -= c.reservedBytes; quota.retainedBytes += size;
            row.charge = Object.assign({}, c, { reservedBytes: 0, retainedBytes: size, heldSuccess: false,
                concurrencyHeld: false, dailySuccessCharged: true, holdsSettled: true });
            row.state = 'ready'; row.sortPosition = ready.length; row.readyAt = ctx.now; row.needsMaintenance = false; row.maintenanceDueAt = null;
            row.updatedAt = ctx.now;
            await saveQuota(db, ticket.ownerId, quota, session);
            const revision = await bumpRevision(db, ticket.ownerId, ticket.planId.toHexString(), ctx.item, ctx.revision, session);
            return { imageRevision: revision, image: readyResponse(row, ctx.now), binaryUploadsEnabled: false };
        });
    }
    return { list, status, lookup, reserve, reorder, remove, inspectUpload, claim, prepareVariants, beginPut, stored, fail, finalize };
}
module.exports = { createItemImagesService };
