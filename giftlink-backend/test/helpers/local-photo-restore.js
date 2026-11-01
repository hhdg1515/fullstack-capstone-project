// Bounded logical backup/restore EXERCISE ONLY. Not a production restore service.
const { BSON } = require('mongodb');
const { performance } = require('node:perf_hooks');
const { digest } = require('../../services/item-image-recovery');
const policy = require('../../services/item-image-policy');
const control = require('../../services/photo-control');
const { isLocalMaintenance } = require('../../util/local-image-maintenance');
const { createItemImageStorage } = require('../../services/item-image-storage');
const { isStorageError } = require('../../services/item-image-storage-error');
const { readPrivateJson, writePrivateJson } = require('../../util/local-maintenance-receipt');
const collections = Object.freeze(['users', 'sessions', 'moveOutPlans', 'items', 'pickupRequests', 'pickupMessages', 'itemImages', 'photoControls']);
const bounds = Object.freeze({ rows: 500, operations: 25, objects: 50, bytes: 16 * 1024 * 1024, approvalMs: 600000 });
const fail = () => { throw Error('Local restore target, inventory, approval or quarantine refused'); };
const payload = v => Object.fromEntries(Object.entries(v).filter(([k]) => k !== 'digest'));
const seal = v => Object.assign({}, v, { digest: digest(v) });
const boundedSnapshot = value => { const snapshot = seal(value); return verifySnapshot(snapshot, value.target, value.kind); };
function verifySnapshot(s, target, kind) {
    if (!s || s.schemaVersion !== 1 || s.kind !== kind || digest(s.target) !== digest(target) || s.digest !== digest(payload(s))) fail();
    if (Buffer.byteLength(JSON.stringify(s)) > bounds.bytes) fail();
    if (kind === 'database' && (!s.data || Object.keys(s.data).sort().join(',') !== collections.slice().sort().join(',') ||
        !collections.every(n => Array.isArray(s.data[n])) || collections.reduce((n, k) => n + s.data[k].length, 0) > bounds.rows || s.data.itemImages.length > bounds.operations)) fail();
    if (kind === 'restore-plan' && (!Number.isFinite(Date.parse(s.issuedAt)) || !Number.isFinite(Date.parse(s.applyBefore)) ||
        new Date(s.issuedAt).toISOString() !== s.issuedAt || new Date(s.applyBefore).toISOString() !== s.applyBefore || Date.parse(s.applyBefore) - Date.parse(s.issuedAt) !== bounds.approvalMs)) fail();
    if (kind === 'objects' && (!Array.isArray(s.entries) || s.entries.length > bounds.objects)) fail(); return s;
}
async function databaseData(context, session) {
    if (!isLocalMaintenance(context)) fail(); await context.verifyDatabase();
    const names = (await context.db.listCollections({}, { nameOnly: true }).toArray()).map(c => c.name);
    if (names.some(n => !collections.includes(n))) fail();
    const result = {}; let count = 0;
    for (const name of collections) {
        result[name] = await context.db.collection(name).find({}, { session, maxTimeMS: 2000 }).sort({ _id: 1 }).limit(bounds.rows + 1).toArray();
        count += result[name].length; if (count > bounds.rows) fail();
    }
    if (result.itemImages.length > bounds.operations) fail();
    return BSON.EJSON.serialize(result, { relaxed: false });
}
async function databaseSnapshot(context) {
    const session = context.db.client.startSession();
    try { return await session.withTransaction(async () => boundedSnapshot({ schemaVersion: 1, kind: 'database', target: context.identity,
        capturedAt: new Date().toISOString(), data: await databaseData(context, session) }), { readConcern: { level: 'snapshot' }, readPreference: 'primary' }); }
    finally { await session.endSession(); }
}
function data(snapshot) { return BSON.EJSON.deserialize(snapshot.data); }
function specifications(context, snapshots) {
    const cfg = require('../../services/r2-image-storage-config'), account = 'a'.repeat(32);
    const expectedFingerprint = cfg.fingerprint(cfg.targetIdentity({ ITEM_IMAGE_R2_ACCOUNT_ID: account, ITEM_IMAGE_R2_ENDPOINT: 'https://' + account + '.r2.cloudflarestorage.com',
        ITEM_IMAGE_R2_REGION: 'auto', ITEM_IMAGE_R2_ENVIRONMENT: 'staging', ITEM_IMAGE_R2_BUCKET: context.identity.bucket, ITEM_IMAGE_R2_NAMESPACE: 'item-images-staging-' + context.receipts.storage.runId }));
    const keys = new Map();
    for (const snapshot of snapshots) {
        verifySnapshot(snapshot, context.identity, 'database');
        for (const row of data(snapshot).itemImages) {
            if (!policy.validOperation(row)) fail();
            // Logical R2 bridge target must be the exact namespace derived from this fixture.
            const logical = 'item-images-staging-' + context.receipts.storage.runId;
            if (row.storageBinding.namespace !== logical || row.storageBinding.fingerprint !== expectedFingerprint) fail();
            for (const name of ['thumbnail', 'display']) {
                const v = row.variants[name]; if (v.byteLength === null || !v.sha256) continue;
                const key = policy.variantKey(row, name).replace(logical + '/', context.identity.namespace + '/');
                const spec = { key, byteLength: v.byteLength, sha256: v.sha256 };
                if (keys.has(key) && digest(keys.get(key)) !== digest(spec)) fail(); keys.set(key, spec);
            }
        }
    }
    if (keys.size > bounds.objects) fail(); return Array.from(keys.values()).sort((a, b) => a.key.localeCompare(b.key));
}
async function objectSnapshot(context, snapshots) {
    if (!isLocalMaintenance(context)) fail(); await context.verifyDatabase();
    const storage = createItemImageStorage(context.storageConfig), entries = []; let bytes = 0;
    try {
        for (const spec of specifications(context, snapshots)) {
            try {
                const result = await storage.getVariant(spec); bytes += result.body.length; if (bytes > bounds.bytes) fail();
                entries.push(Object.assign({}, spec, { present: true, body: result.body.toString('base64') }));
            } catch (error) {
                if (!isStorageError(error) || error.category !== 'not_found' || error.outcome !== 'absent') throw error;
                entries.push(Object.assign({}, spec, { present: false }));
            }
        }
        return boundedSnapshot({ schemaVersion: 1, kind: 'objects', target: context.identity, capturedAt: new Date().toISOString(), entries });
    } finally { storage.close(); }
}
function securityAccounts(v) { return v.users.map(u => Object.fromEntries(Object.entries(u).filter(([k]) => k !== 'itemImageQuota'))); }
function assess(context, current, objects, checkpoint, ownerKey) {
    for (const s of [current, checkpoint]) verifySnapshot(s, context.identity, 'database'); verifySnapshot(objects, context.identity, 'objects');
    const now = data(current), known = data(checkpoint), findings = new Set(), byId = rows => new Map(rows.map(v => [String(v._id), v]));
    const rows = byId(now.itemImages), items = byId(now.items), plans = byId(now.moveOutPlans), users = byId(now.users), knownRows = byId(known.itemImages);
    const without = (rows, field) => rows.map(v => Object.fromEntries(Object.entries(v).filter(([k]) => k !== field)));
    if (digest(without(now.items, 'imageRevision')) !== digest(without(known.items, 'imageRevision')) || digest(without(now.moveOutPlans, 'inventoryRevision')) !== digest(without(known.moveOutPlans, 'inventoryRevision'))) findings.add('item_visibility_checkpoint_changed');
    if (digest(now.pickupRequests) !== digest(known.pickupRequests) || digest(now.pickupMessages) !== digest(known.pickupMessages)) findings.add('private_history_checkpoint_changed');
    const authSafe = digest(securityAccounts(now)) === digest(securityAccounts(known)); if (!authSafe) findings.add('account_security_changed');
    for (const old of known.itemImages) {
        const row = rows.get(String(old._id));
        if (!row) findings.add('missing_durable_operation');
        else if (old.state === 'deleted' && row.state !== 'deleted') findings.add('lost_tombstone');
        else if (digest(row) !== digest(old)) findings.add('operation_checkpoint_changed');
    }
    for (const old of known.itemImages.filter(r => r.state === 'deleted')) for (const name of ['thumbnail', 'display']) {
        const key = policy.variantKey(old, name).replace(old.storageBinding.namespace + '/', context.identity.namespace + '/');
        if (objects.entries.some(e => e.key === key && e.present)) findings.add('deleted_bytes_restored');
    }
    for (const row of now.itemImages) {
        if (!policy.validOperation(row)) { findings.add('invalid_operation'); continue; }
        if (!knownRows.has(String(row._id))) findings.add('unreviewed_operation');
        const item = items.get(String(row.itemId)), plan = row.schemaVersion === 1 ? plans.get(String(row.planId)) : null;
        // Schema 2 graph: owner -> independent v2 item, with no plan anywhere in the chain.
        const independent = row.schemaVersion === 2 && item && item.listingSchemaVersion === 2 && !Object.prototype.hasOwnProperty.call(item, 'planId');
        if (row.state !== 'deleted' && (!users.has(String(row.ownerId)) || !item || String(item.ownerId) !== String(row.ownerId) ||
            (row.schemaVersion === 2 ? !independent : !plan || String(plan.ownerId) !== String(row.ownerId) || String(item.planId) !== String(plan._id)))) findings.add('ownership_conflict');
        for (const name of ['thumbnail', 'display']) {
            const v = row.variants[name]; if (!v.sha256) continue;
            const key = policy.variantKey(row, name).replace(row.storageBinding.namespace + '/', context.identity.namespace + '/');
            const observed = objects.entries.find(e => e.key === key);
            if (!observed) findings.add('incomplete_object_inventory');
            else if (row.state === 'ready' && !observed.present) findings.add('ready_bytes_missing');
            else if (row.state === 'deleted' && observed.present) findings.add('deleted_bytes_restored');
        }
        if (['reserved', 'processing', 'failed', 'delete_pending'].includes(row.state)) findings.add('unresolved_operation');
    }
    for (const user of now.users) {
        const own = now.itemImages.filter(r => String(r.ownerId) === String(user._id)), q = user.itemImageQuota, prior = known.users.find(u => String(u._id) === String(user._id));
        if (digest(q || null) !== digest(prior && prior.itemImageQuota || null)) findings.add('quota_checkpoint_changed');
        if (!q && own.length) findings.add('quota_ledger_mismatch');
        if (q && (!policy.validQuota(q) || q.operationCount !== own.length ||
            q.reservedBytes !== own.reduce((n, r) => n + r.charge.reservedBytes, 0) || q.retainedBytes !== own.reduce((n, r) => n + r.charge.retainedBytes, 0) ||
            q.activeUploads !== own.filter(r => r.charge.concurrencyHeld).length)) findings.add('quota_ledger_mismatch');
    }
    if (now.photoControls.length !== 1 || known.photoControls.length !== 1) findings.add('control_inventory_invalid');
    else {
        try { control.validateState(now.photoControls[0], known.photoControls[0].target, ownerKey); }
        catch (error) { findings.add('control_untrusted'); }
        if (now.photoControls[0].controlId !== known.photoControls[0].controlId || now.photoControls[0].revision < known.photoControls[0].revision ||
            now.photoControls[0].revision === known.photoControls[0].revision && control.stateDigest(now.photoControls[0]) !== control.stateDigest(known.photoControls[0])) findings.add('control_rollback');
    }
    if (now.sessions.length) findings.add('restored_sessions_present');
    return { target: digest(context.identity), consistentWithinInventory: findings.size === 0, authSafe,
        findings: Array.from(findings).sort(), productionReady: false, permanentRevocation: false, inventoriedOperations: now.itemImages.length };
}
async function previewRestore(context, snapshot, inventories) {
    if (!['database', 'objects'].includes(snapshot.kind)) fail();
    verifySnapshot(snapshot, context.identity, snapshot.kind); const current = await databaseSnapshot(context);
    const objects = snapshot.kind === 'objects' ? await objectSnapshot(context, inventories) : null;
    const issuedAt = Date.now();
    return seal({ schemaVersion: 1, kind: 'restore-plan', target: context.identity, snapshotDigest: snapshot.digest,
        sourceDigest: current.digest, sourceDataDigest: digest(current.data), objectDigest: objects && digest(objects.entries),
        issuedAt: new Date(issuedAt).toISOString(), applyBefore: new Date(issuedAt + bounds.approvalMs).toISOString() });
}
async function executeRestore(context, input, afterCommit = async () => {}) {
    const started = performance.now(), snapshot = readPrivateJson(input.snapshot, bounds.bytes), plan = readPrivateJson(input.plan, 65536);
    verifySnapshot(snapshot, context.identity, snapshot.kind); verifySnapshot(plan, context.identity, 'restore-plan');
    if (!['database', 'objects'].includes(snapshot.kind) || input.confirmTarget !== digest(context.identity) || input.confirmPlan !== plan.digest ||
        plan.snapshotDigest !== snapshot.digest || input.quarantine !== 'all-managed-processes-stopped' ||
        !Array.isArray(input.inventories)) fail();
    const inventories = input.inventories.map(p => readPrivateJson(p, bounds.bytes));
    if (snapshot.kind === 'objects' && digest((await objectSnapshot(context, inventories)).entries) !== plan.objectDigest) fail();
    async function deadline(session) {
        const clock = await context.db.aggregate([{ $documents: [{}] }, { $project: { now: '$$NOW' } }], { session, maxTimeMS: 2000 }).next();
        if (!clock || !(clock.now instanceof Date) || Date.parse(plan.issuedAt) > clock.now.getTime() || Date.parse(plan.applyBefore) <= clock.now.getTime()) fail();
    }
    await deadline();
    const session = context.db.client.startSession();
    try {
        if (snapshot.kind === 'database') await session.withTransaction(async () => {
            if (digest(await databaseData(context, session)) !== plan.sourceDataDigest) fail();
            await deadline(session); const restored = data(snapshot); if (Object.keys(restored).sort().join(',') !== collections.slice().sort().join(',')) fail();
            for (const name of collections) {
                await context.db.collection(name).deleteMany({}, { session });
                if (name !== 'sessions' && restored[name].length) await context.db.collection(name).insertMany(restored[name], { session });
            }
        }, { readConcern: { level: 'snapshot' }, writeConcern: { w: 'majority' }, readPreference: 'primary', maxCommitTimeMS: 2000 });
        else {
            if (digest((await databaseSnapshot(context)).data) !== plan.sourceDataDigest) fail();
            const specs = specifications(context, inventories); if (specs.length !== snapshot.entries.length || digest(specs) !== digest(snapshot.entries.map(({ key, byteLength, sha256 }) => ({ key, byteLength, sha256 })))) fail();
            for (const entry of snapshot.entries) {
                if (typeof entry.present !== 'boolean') fail();
                if (entry.present) { const body = Buffer.from(entry.body, 'base64'); if (body.length !== entry.byteLength || require('node:crypto').createHash('sha256').update(body).digest('hex') !== entry.sha256) fail(); }
            }
            const storage = createItemImageStorage(context.storageConfig);
            try { for (const entry of snapshot.entries) {
                if (performance.now() - started > 120000) fail(); await deadline();
                // Explicit synthetic backup reconstruction, never an app upload replay or quota settlement.
                await storage.deleteVariant({ key: entry.key });
                if (entry.present) {
                    const body = Buffer.from(entry.body, 'base64');
                    if (body.length !== entry.byteLength || require('node:crypto').createHash('sha256').update(body).digest('hex') !== entry.sha256) fail();
                    await deadline(); await storage.putVariant({ key: entry.key, body });
                }
            } } finally { storage.close(); }
        }
        await afterCommit(); return { status: 'restored_under_quarantine', kind: snapshot.kind, elapsedMs: Math.round(performance.now() - started), sessionsReused: 0 };
    } finally { await session.endSession(); }
}
module.exports = { collections, bounds, databaseSnapshot, objectSnapshot, assess, previewRestore, executeRestore, verifySnapshot, data, seal, writePrivateJson };
