/* jshint loopfunc: true */
const { ObjectId, BSON } = require('mongodb');
const { randomUUID, createHash } = require('node:crypto');
const { performance } = require('node:perf_hooks');
const policy = require('./item-image-policy');
const { storageBinding } = require('./item-image-storage-config');
const { createItemImageStorage } = require('./item-image-storage');
const { isStorageError } = require('./item-image-storage-error');
const { isLocalMaintenance } = require('../util/local-image-maintenance');
const names = ['thumbnail', 'display'];
const bounds = Object.freeze({ operations: 25, inspections: 100, deadlineMs: 120000, leaseMs: 60000, attempts: 5, manifestMs: 600000 });
const opts = session => ({ session, maxTimeMS: 2000, collation: { locale: 'simple' } });
function canonical(value) {
    if (Array.isArray(value)) return value.map(canonical);
    if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
    return value;
}
const digest = value => createHash('sha256').update(JSON.stringify(canonical(BSON.EJSON.serialize(value, { relaxed: false })))).digest('hex');
function failure(category) { const e = new Error('Photo recovery: ' + category); e.recoveryCategory = category; return e; }
function category(error) {
    const safe = ['unknown_write', 'authorization', 'target_missing', 'target_mismatch', 'integrity', 'timeout', 'provider', 'accounting', 'changed', 'budget'];
    const value = error.recoveryCategory || isStorageError(error) && error.category;
    return safe.includes(value) ? value : 'provider';
}

function createLocalImageRecovery(context) {
    if (!isLocalMaintenance(context)) throw failure('target_mismatch');
    const { db, verifyDatabase, storageConfig, identity, receipts } = context;
    const binding = storageBinding(storageConfig);
    if (!binding || storageConfig.driver !== 'seaweedfs-local' || identity.environment !== 'development' ||
        identity.namespace !== binding.receipt.namespace || identity.storageFingerprint !== storageConfig.targetFingerprint) throw failure('target_mismatch');
    const storage = createItemImageStorage(storageConfig);
    const started = performance.now(); let inspections = 0;
    function budget() { if (performance.now() - started >= bounds.deadlineMs) throw failure('budget'); }
    async function now(session) {
        const value = await db.aggregate([{ $documents: [{}] }, { $project: { _id: 0, now: '$$NOW' } }], opts(session)).next();
        if (!value || !(value.now instanceof Date)) throw failure('accounting'); return value.now;
    }
    function validate(row) {
        if (!policy.validOperation(row) || row.storageBinding.fingerprint !== identity.storageFingerprint ||
            row.storageBinding.namespace !== identity.namespace) throw failure('integrity');
    }
    async function inspectVariant(row, name) {
        budget(); const v = row.variants[name];
        if (v.outcome === 'not_started') return 'never_started';
        if (++inspections > bounds.inspections) throw failure('budget');
        try {
            await storage.getVariant({ key: policy.variantKey(row, name), byteLength: v.byteLength, sha256: v.sha256 });
            return v.outcome === 'prepared' || v.outcome === 'rejected' ? 'unexpected_object' : 'verified_present';
        } catch (error) {
            if (isStorageError(error) && error.category === 'not_found' && error.outcome === 'absent') return 'verified_absent';
            return category(error);
        }
    }
    async function inspect(row) {
        const observed = {};
        // Sequential, at most two bounded GETs. A bare HEAD 404 is never proof.
        for (const name of names) observed[name] = await inspectVariant(row, name);
        return observed;
    }
    function decision(row, observed, time) {
        if (!['reserved', 'processing', 'failed', 'delete_pending'].includes(row.state)) return 'ineligible_state';
        if (row.cleanup.attempts >= bounds.attempts) return 'retry_budget_exhausted';
        if (row.state === 'processing' && row.lease.expiresAt > time || row.state === 'reserved' && row.lease.expiresAt > time ||
            row.cleanup.recovery && row.cleanup.recovery.status === 'leased' && row.cleanup.recovery.expiresAt > time) return 'lease_active';
        if (row.cleanup.nextAttemptAt && row.cleanup.nextAttemptAt > time) return 'backoff';
        for (const name of names) {
            if (!['never_started', 'verified_present', 'verified_absent'].includes(observed[name])) return 'storage_unresolved';
            if (row.variants[name].outcome === 'unknown' && observed[name] !== 'verified_present') return 'unknown_write';
        }
        return 'cleanup';
    }
    async function ledger(row, session, time) {
        // Bounded, exact ledger reconciliation prevents releasing a damaged or
        // missing aggregate. Tombstones remain in operationCount permanently.
        const account = await db.collection('users').findOne({ _id: row.ownerId }, opts(session));
        if (!account || !policy.validQuota(account.itemImageQuota)) throw failure('accounting');
        const rows = await db.collection('itemImages').find({ ownerId: row.ownerId }, opts(session)).limit(policy.ceiling.records + 1).toArray();
        if (rows.length > policy.ceiling.records || rows.some(r => !policy.validOperation(r))) throw failure('accounting');
        const q = account.itemImageQuota;
        const total = { attempts: 0, successful: 0, heldSuccess: 0, reservedBytes: 0, retainedBytes: 0, activeUploads: 0, operationCount: rows.length };
        for (const r of rows) {
            const c = r.charge;
            total.reservedBytes += c.reservedBytes; total.retainedBytes += c.retainedBytes; total.activeUploads += Number(c.concurrencyHeld);
            if (c.quotaDay === q.utcDay) { total.attempts++; total.successful += Number(c.dailySuccessCharged); total.heldSuccess += Number(c.heldSuccess); }
        }
        if (Object.keys(total).some(key => total[key] !== q[key])) throw failure('accounting');
        // Missing parents are supported orphans; conflicting live ownership is not.
        const plan = await db.collection('moveOutPlans').findOne({ _id: row.planId }, opts(session));
        const item = await db.collection('items').findOne({ _id: row.itemId }, opts(session));
        if (plan && (!(plan.ownerId instanceof ObjectId) || !plan.ownerId.equals(row.ownerId)) ||
            item && (!(item.ownerId instanceof ObjectId) || !item.ownerId.equals(row.ownerId) || !(item.planId instanceof ObjectId) || !item.planId.equals(row.planId))) throw failure('integrity');
        return policy.quotaFor(q, time);
    }
    async function transaction(callback) {
        budget(); await verifyDatabase(); const session = db.client.startSession(); let attempts = 0;
        try {
            return await session.withTransaction(async () => {
                budget(); if (++attempts > 3) throw failure('budget');
                return callback(session, await now(session));
            }, { readConcern: { level: 'snapshot' }, writeConcern: { w: 'majority', wtimeoutMS: 2000 }, readPreference: 'primary', maxCommitTimeMS: 2000 });
        } finally { await session.endSession(); }
    }
    function target() { return Object.assign({}, identity, { receiptDigest: digest(receipts) }); }
    async function preview({ after = null, limit = bounds.operations } = {}) {
        if (!Number.isInteger(limit) || limit < 1 || limit > bounds.operations || after !== null && !/^[a-f0-9]{24}$/.test(after)) throw failure('budget');
        budget(); await verifyDatabase();
        const time = await now();
        const filter = { needsMaintenance: true, maintenanceDueAt: { $lte: time } };
        if (after) filter._id = { $gt: new ObjectId(after) };
        const rows = await db.collection('itemImages').find(filter, opts()).sort({ _id: 1 }).limit(limit + 1).toArray();
        const selected = rows.slice(0, limit), operations = [];
        for (const row of selected) {
            validate(row); const observed = await inspect(row);
            let action = decision(row, observed, time);
            // Read-only snapshot, including aggregate validation; no repair-on-read.
            await transaction(async (session, timestamp) => { await ledger(row, session, timestamp); });
            operations.push({ id: row._id.toHexString(), version: row.version, state: row.state, rowDigest: digest(row), observed, action });
        }
        const manifest = { schemaVersion: 1, target: target(), createdAt: time.toISOString(), expiresAt: new Date(time.getTime() + bounds.manifestMs).toISOString(),
            operations, nextCursor: rows.length > limit && selected.length ? selected[selected.length - 1]._id.toHexString() : null };
        manifest.digest = digest(manifest);
        return manifest;
    }
    async function validateManifest(manifest, confirmations) {
        budget(); await verifyDatabase();
        if (!manifest || Object.keys(manifest).sort().join(',') !== 'createdAt,digest,expiresAt,nextCursor,operations,schemaVersion,target' ||
            manifest.schemaVersion !== 1 || !policy.hash(manifest.digest) ||
            manifest.digest !== digest(Object.fromEntries(Object.entries(manifest).filter(([key]) => key !== 'digest'))) ||
            digest(manifest.target) !== digest(target()) || !Array.isArray(manifest.operations) || manifest.operations.length > bounds.operations ||
            new Set(manifest.operations.map(o => o.id)).size !== manifest.operations.length ||
            !confirmations || confirmations.manifest !== manifest.digest || confirmations.database !== identity.database ||
            confirmations.environment !== identity.environment || confirmations.databaseFingerprint !== identity.databaseFingerprint ||
            confirmations.storageFingerprint !== identity.storageFingerprint || confirmations.provider !== identity.provider ||
            confirmations.bucket !== identity.bucket || confirmations.namespace !== identity.namespace) throw failure('target_mismatch');
        const time = await now(), created = Date.parse(manifest.createdAt), expires = Date.parse(manifest.expiresAt);
        if (!Number.isFinite(created) || !Number.isFinite(expires) || created > time.getTime() || expires <= time.getTime() ||
            expires - created !== bounds.manifestMs) throw failure('changed');
        // Validate the entire batch before its first mutation. A partial previous
        // run needs a fresh preview, never reuse an old operation list.
        for (const op of manifest.operations) {
            if (!op || Object.keys(op).sort().join(',') !== 'action,id,observed,rowDigest,state,version' ||
                !/^[a-f0-9]{24}$/.test(op.id) || !policy.hash(op.rowDigest) || !Number.isSafeInteger(op.version) ||
                !op.observed || Object.keys(op.observed).sort().join(',') !== 'display,thumbnail' ||
                !names.every(name => ['never_started', 'verified_present', 'verified_absent', 'unexpected_object', 'authorization', 'target_missing', 'target_mismatch',
                    'integrity', 'timeout', 'provider', 'budget'].includes(op.observed[name]))) throw failure('integrity');
            const row = await db.collection('itemImages').findOne({ _id: new ObjectId(op.id) }, opts());
            validate(row);
            if (digest(row) !== op.rowDigest || row.version !== op.version || row.state !== op.state ||
                !row.needsMaintenance || row.maintenanceDueAt > time || decision(row, op.observed, time) !== op.action) throw failure('changed');
            await transaction(async (session, timestamp) => { await ledger(row, session, timestamp); });
        }
    }
    async function claim(op, manifestDigest) {
        const token = randomUUID();
        return transaction(async (session, time) => {
            const row = await db.collection('itemImages').findOne({ _id: new ObjectId(op.id) }, opts(session)); validate(row);
            if (digest(row) !== op.rowDigest || row.version !== op.version || decision(row, op.observed, time) !== 'cleanup') throw failure('changed');
            await ledger(row, session, time);
            const old = row.cleanup.recovery;
            row.cleanup.recovery = { fenceToken: token, claimedAt: time, expiresAt: new Date(time.getTime() + bounds.leaseMs),
                status: 'leased', category: null, manifestDigest, unknownWrites: names.filter(name => row.variants[name].outcome === 'unknown' || old && old.unknownWrites.includes(name)),
                absent: { thumbnail: false, display: false } };
            row.cleanup.reason = row.cleanup.reason || (row.state === 'reserved' ? 'reservation_expired' : 'pipeline_failed');
            row.cleanup.attempts++; row.cleanup.nextAttemptAt = null; row.state = 'delete_pending'; row.sortPosition = null;
            row.lease.fenceToken = token; row.updatedAt = time; row.version++; row.maintenanceDueAt = row.cleanup.recovery.expiresAt;
            if (!row.deleteRequestedAt) row.deleteRequestedAt = time;
            validate(row);
            const updated = await db.collection('itemImages').replaceOne({ _id: row._id, version: op.version }, row, { session });
            if (updated.matchedCount !== 1) throw failure('changed');
            return row;
        });
    }
    async function transition(ticket, callback) {
        return transaction(async (session, time) => {
            const row = await db.collection('itemImages').findOne({ _id: ticket._id }, opts(session)); validate(row);
            if (row.generation !== ticket.generation || !row.ownerId.equals(ticket.ownerId) || !row.planId.equals(ticket.planId) ||
                !row.itemId.equals(ticket.itemId) || digest(row.intent) !== digest(ticket.intent)) throw failure('integrity');
            const r = row.cleanup.recovery;
            if (row.state !== 'delete_pending' || !r || r.status !== 'leased' || r.fenceToken !== ticket.cleanup.recovery.fenceToken || r.expiresAt <= time) throw failure('changed');
            const oldVersion = row.version;
            await callback(row, session, time); row.version++; row.updatedAt = time; validate(row);
            const saved = await db.collection('itemImages').replaceOne({ _id: row._id, version: oldVersion,
                'cleanup.recovery.fenceToken': r.fenceToken, $expr: { $gt: ['$cleanup.recovery.expiresAt', '$$NOW'] } }, row, { session });
            if (saved.matchedCount !== 1) throw failure('changed'); return row;
        });
    }
    async function settle(ticket) {
        return transition(ticket, async (row, session, time) => {
            if (!names.every(name => row.cleanup.recovery.absent[name]) || names.some(name => row.variants[name].outcome === 'unknown')) throw failure('unknown_write');
            const quota = await ledger(row, session, time), c = row.charge;
            quota.reservedBytes -= c.reservedBytes; quota.retainedBytes -= c.retainedBytes;
            quota.activeUploads -= Number(c.concurrencyHeld);
            if (c.quotaDay === quota.utcDay) quota.heldSuccess -= Number(c.heldSuccess);
            if (!policy.validQuota(quota)) throw failure('accounting');
            const saved = await db.collection('users').updateOne({ _id: row.ownerId }, { $set: { itemImageQuota: quota } }, { session });
            if (saved.matchedCount !== 1) throw failure('accounting');
            row.charge = Object.assign({}, c, { reservedBytes: 0, retainedBytes: 0, heldSuccess: false, concurrencyHeld: false, slotHeld: false,
                holdsSettled: true, storageReleasedAt: c.storageReleasedAt || time });
            row.state = 'deleted'; row.deletedAt = time; row.needsMaintenance = false; row.maintenanceDueAt = null;
            row.cleanup.nextAttemptAt = null; row.cleanup.recovery.status = 'complete';
        });
    }
    async function clean(ticket, expected) {
        // Fence the producer first. A permit committed just before this claim is
        // durable unknown and cannot be mistaken for an unissued PUT.
        const observed = await inspect(ticket);
        for (const name of names) {
            if (!['never_started', 'verified_present', 'verified_absent'].includes(observed[name])) throw failure(observed[name] === 'unexpected_object' ? 'integrity' : observed[name]);
            if (ticket.variants[name].outcome === 'unknown' && observed[name] !== 'verified_present') throw failure('unknown_write');
        }
        if (digest(observed) !== digest(expected)) throw failure('changed');
        for (const name of names) {
            const v = ticket.variants[name];
            if (['not_started', 'prepared', 'rejected'].includes(v.outcome)) {
                if (observed[name] === 'verified_present') throw failure('integrity');
                ticket = await transition(ticket, async row => { row.cleanup.recovery.absent[name] = true; }); continue;
            }
            // Persist settled-writer evidence BEFORE DELETE. On crash, a future
            // negative GET is safe for these deletion outcomes, unlike unknown.
            ticket = await transition(ticket, async row => { row.variants[name].outcome = 'delete_unknown'; });
            budget(); await storage.deleteVariant({ key: policy.variantKey(ticket, name) });
            ticket = await transition(ticket, async row => { row.variants[name].outcome = 'delete_acknowledged'; });
            if (await inspectVariant(ticket, name) !== 'verified_absent') throw failure('integrity');
            ticket = await transition(ticket, async row => { row.variants[name].outcome = 'deleted'; row.cleanup.recovery.absent[name] = true; });
        }
        return settle(ticket);
    }
    async function apply(manifest, confirmations) {
        await validateManifest(manifest, confirmations); const results = [];
        for (const op of manifest.operations) {
            budget();
            if (op.action !== 'cleanup') { results.push({ status: 'unresolved', category: op.action }); continue; }
            let ticket;
            try { ticket = await claim(op, manifest.digest); await clean(ticket, op.observed); results.push({ status: 'deleted', category: null }); }
            catch (error) {
                const safe = category(error);
                // Best effort metadata only. Process/commit uncertainty leaves the
                // lease/journal intact; never infer success or refund from HTTP.
                if (ticket) try {
                    await transition(ticket, async (row, session, time) => {
                        row.cleanup.recovery.status = ['unknown_write', 'integrity', 'accounting', 'target_mismatch'].includes(safe) ? 'blocked' : 'retry';
                        row.cleanup.recovery.category = safe;
                        row.cleanup.nextAttemptAt = new Date(time.getTime() + Math.min(300000, 30000 * Math.pow(2, row.cleanup.attempts - 1)));
                        row.maintenanceDueAt = row.cleanup.nextAttemptAt;
                    });
                } catch (ignored) { /* Persisted fence and charge survive. */ }
                results.push({ status: 'unresolved', category: safe });
            }
        }
        return { operations: results.length, inspections, results };
    }
    return { preview, apply, close: () => storage.close() };
}
module.exports = { createLocalImageRecovery, digest, bounds };
