const { createPrivateKey, createPublicKey, sign, verify, randomUUID, createHash } = require('node:crypto');
const { digest } = require('./item-image-recovery');
const { publicKey, verifyApproval } = require('./r2-photo-approval');
const { hash, uuid } = require('./item-image-policy');
const { InventoryError } = require('./inventory-error');
const collection = 'photoControls';
const fields = (v, names) => v && Object.getPrototypeOf(v) === Object.prototype && Object.keys(v).sort().join(',') === names.slice().sort().join(',');
const integer = v => Number.isSafeInteger(v) && v >= 1;
const iso = v => typeof v === 'string' && Number.isFinite(Date.parse(v)) && new Date(v).toISOString() === v;
const keyHash = key => { publicKey(key); return createHash('sha256').update(key).digest('hex'); };
const targetId = target => digest({ photoControlTarget: target });
const statePart = value => Object.fromEntries(Object.entries(value).filter(([key]) => !['signature', 'fence'].includes(key)));
const stateDigest = value => digest(statePart(value));
const message = value => Buffer.from('moveout-photo-control-v1:' + stateDigest(value));
const fail = category => { const error = new InventoryError(503, 'IMAGE_CONTROL_UNAVAILABLE', 'Photo authority unavailable. Check status before continuing.'); error.controlCategory = category; error.recoveryCategory = 'target_mismatch'; throw error; };
function validTarget(t) {
    return fields(t, ['database', 'environment', 'databaseFingerprint', 'provider', 'storageFingerprint', 'bucket', 'namespace']) && Object.values(t).every(v => typeof v === 'string') &&
        /^[A-Za-z0-9_-]{1,63}$/.test(t.database) && !['admin', 'local', 'config'].includes(t.database.toLowerCase()) &&
        ['staging', 'production'].includes(t.environment) && t.provider === 'r2-private' && hash(t.databaseFingerprint) && hash(t.storageFingerprint) &&
        /^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(t.bucket) && new RegExp('^item-images-' + t.environment + '-[a-f0-9]{32}$').test(t.namespace);
}
function validGrant(g) { return fields(g, ['enabled', 'epoch', 'keyHash', 'approvalDigest', 'issuedAt']) && typeof g.enabled === 'boolean' && integer(g.epoch) && hash(g.keyHash) && hash(g.approvalDigest) && iso(g.issuedAt); }
function validateState(s, target, ownerKey) {
    if (!validTarget(target) || !fields(s, ['_id', 'schemaVersion', 'target', 'controlId', 'revision', 'uploadAdmission', 'runtime', 'recovery', 'previousDigest', 'issuedAt', 'applyBefore', 'signature', 'fence']) ||
        s.schemaVersion !== 1 || s._id !== targetId(target) || digest(s.target) !== digest(target) || !uuid(s.controlId) || !integer(s.revision) ||
        typeof s.uploadAdmission !== 'boolean' || !validGrant(s.runtime) || !validGrant(s.recovery) ||
        !(s.previousDigest === null || hash(s.previousDigest)) || !iso(s.issuedAt) || !iso(s.applyBefore) ||
        Date.parse(s.applyBefore) - Date.parse(s.issuedAt) !== 600000 || !Number.isSafeInteger(s.fence) || s.fence < 0 ||
        s.uploadAdmission && !s.runtime.enabled || typeof s.signature !== 'string' || !/^[a-f0-9]{128}$/.test(s.signature)) fail('invalid_state');
    if (s.runtime.epoch > s.revision || s.recovery.epoch > s.revision || [s.runtime.keyHash, s.recovery.keyHash].includes(keyHash(ownerKey))) fail('owner_key_or_epoch');
    try { if (!verify(null, message(s), publicKey(ownerKey), Buffer.from(s.signature, 'hex'))) fail('untrusted_state'); }
    catch (error) { fail('untrusted_state'); }
    return s;
}
function grant(approval, key, target, role, epoch) {
    verifyApproval(approval, { role, database: target.database, environment: target.environment,
        databaseFingerprint: target.databaseFingerprint, storageFingerprint: target.storageFingerprint }, key);
    return { enabled: true, epoch, keyHash: keyHash(key), approvalDigest: digest(approval), issuedAt: approval.issuedAt };
}
// Offline owner operation. No database/client/key is consulted implicitly.
function signChange({ snapshot, target, action, runtime, recovery, privateKey, time = Date.now() }) {
    let signer, ownerKey;
    try {
        if (typeof privateKey !== 'string' || !/^302e020100300506032b657004220420[a-f0-9]{64}$/.test(privateKey)) fail('signing_key');
        signer = createPrivateKey({ key: Buffer.from(privateKey, 'hex'), type: 'pkcs8', format: 'der' });
        ownerKey = createPublicKey(signer).export({ format: 'der', type: 'spki' }).toString('hex');
    } catch (error) { fail('signing_key'); }
    if (!validTarget(target)) fail('target_mismatch');
    const at = new Date(time), prior = snapshot && validateState(snapshot, target, ownerKey);
    let s;
    if (!prior) {
        if (action !== 'initialize') fail('initialization_required');
        s = { _id: targetId(target), schemaVersion: 1, target, controlId: randomUUID(), revision: 1, uploadAdmission: false,
            runtime: grant(runtime.approval, runtime.key, target, 'runtime', 1), recovery: grant(recovery.approval, recovery.key, target, 'recovery', 1), previousDigest: null, fence: 0 };
    } else {
        if (!integer(prior.revision + 1)) fail('revision_exhausted');
        s = JSON.parse(JSON.stringify(prior)); s.revision++; s.previousDigest = stateDigest(prior); s.fence = 0;
        if (action === 'pause') s.uploadAdmission = false;
        else if (action === 'resume') { if (!s.runtime.enabled) fail('authority_revoked'); s.uploadAdmission = true; }
        else if (['revoke-runtime', 'revoke-recovery', 'revoke-all'].includes(action)) {
            for (const role of ['runtime', 'recovery']) if (action === 'revoke-all' || action === 'revoke-' + role) {
                if (!integer(s[role].epoch + 1)) fail('epoch_exhausted'); s[role].enabled = false; s[role].epoch++;
            }
            if (!s.runtime.enabled) s.uploadAdmission = false;
        } else if (['rotate-runtime', 'rotate-recovery'].includes(action)) {
            const role = action.slice(7), proof = role === 'runtime' ? runtime : recovery;
            const next = grant(proof.approval, proof.key, target, role, s[role].epoch + 1);
            if (next.approvalDigest === s[role].approvalDigest || Date.parse(next.issuedAt) <= Date.parse(s[role].issuedAt)) fail('stale_approval');
            s[role] = next; if (role === 'runtime') s.uploadAdmission = false;
        } else fail('invalid_action');
    }
    s.issuedAt = at.toISOString(); s.applyBefore = new Date(at.getTime() + 600000).toISOString();
    s.signature = sign(null, message(s), signer).toString('hex'); validateState(s, target, ownerKey); return s;
}
function validateTransition(prior, next) {
    if (!prior) {
        if (next.revision !== 1 || next.previousDigest !== null || next.uploadAdmission || next.runtime.epoch !== 1 || next.recovery.epoch !== 1 || !next.runtime.enabled || !next.recovery.enabled) fail('invalid_initial_state');
        return;
    }
    if (next.controlId !== prior.controlId || next.revision !== prior.revision + 1 || next.previousDigest !== stateDigest(prior) ||
        Date.parse(next.issuedAt) < Date.parse(prior.issuedAt)) fail('changed');
    for (const role of ['runtime', 'recovery']) {
        const old = prior[role], now = next[role];
        if (digest(now) === digest(old)) continue;
        if (now.epoch !== old.epoch + 1) fail('invalid_epoch');
        const same = now.keyHash === old.keyHash && now.approvalDigest === old.approvalDigest && now.issuedAt === old.issuedAt;
        if (same) { if (now.enabled) fail('stale_approval'); }
        else if (!now.enabled || now.approvalDigest === old.approvalDigest || Date.parse(now.issuedAt) <= Date.parse(old.issuedAt)) fail('stale_approval');
    }
}
const opts = session => Object.assign({ maxTimeMS: 2000, collation: { locale: 'simple' } }, session ? { session } : { readConcern: { level: 'linearizable' }, readPreference: 'primary' });
async function assertControlIndex(db, allowAbsent = false) {
    let indexes;
    try { indexes = await db.collection(collection).indexes({ maxTimeMS: 2000 }); }
    catch (error) { if (error.code === 26 && allowAbsent) return; fail('control_index'); }
    if (indexes.length !== 1 || indexes[0].name !== '_id_' || JSON.stringify(indexes[0].key) !== '{"_id":1}' ||
        indexes[0].expireAfterSeconds !== undefined || indexes[0].sparse || indexes[0].partialFilterExpression ||
        indexes[0].collation && indexes[0].collation.locale !== 'simple') fail('control_index');
}
// Called only by the independently receipt-verified local operator boundary.
async function applyChange(db, target, ownerKey, change, confirmation, verifyTarget) {
    validateState(change, target, ownerKey);
    if (db.databaseName !== target.database) fail('target_mismatch');
    if (!confirmation || confirmation.target !== targetId(target) || confirmation.change !== stateDigest(change) ||
        confirmation.previous !== (change.previousDigest || 'absent') || confirmation.revision !== change.revision) fail('confirmation_mismatch');
    await verifyTarget(); await assertControlIndex(db, true); const session = db.client.startSession(); let attempts = 0;
    try {
        return await session.withTransaction(async () => {
            if (++attempts > 3) fail('transaction_budget'); await verifyTarget();
            const stamp = await db.aggregate([{ $documents: [{}] }, { $project: { _id: 0, now: '$$NOW' } }], opts(session)).next();
            if (!stamp || !(stamp.now instanceof Date) || Date.parse(change.issuedAt) > stamp.now.getTime() || Date.parse(change.applyBefore) <= stamp.now.getTime()) fail('approval_expired_or_future');
            const current = await db.collection(collection).findOne({ _id: targetId(target) }, opts(session));
            if (current) validateState(current, target, ownerKey); validateTransition(current, change);
            const next = Object.assign({}, change, { fence: current ? current.fence + 1 : 0 });
            if (!Number.isSafeInteger(next.fence)) fail('fence_exhausted');
            if (!current) await db.collection(collection).insertOne(next, { session });
            else {
                const result = await db.collection(collection).replaceOne({ _id: current._id, revision: current.revision, signature: current.signature, fence: current.fence }, next, { session });
                if (result.matchedCount !== 1) fail('changed');
            }
            return { controlId: next.controlId, revision: next.revision, stateDigest: stateDigest(next) };
        }, { readConcern: { level: 'snapshot' }, writeConcern: { w: 'majority', wtimeoutMS: 2000 }, readPreference: 'primary', maxCommitTimeMS: 2000 });
    } finally { await session.endSession(); }
}
function createGuard({ db, target, ownerKey, controlId, minimumRevision, approval, verificationKey, verifyBase, admissionCeiling = false }) {
    if (!validTarget(target) || !uuid(controlId) || !integer(minimumRevision) || typeof admissionCeiling !== 'boolean') fail('configuration'); publicKey(ownerKey);
    const role = approval.role, expectedDigest = digest(approval), expectedKey = keyHash(verificationKey);
    if (!['runtime', 'recovery'].includes(role)) fail('role');
    let highRevision = minimumRevision, highDigest = null;
    async function check(session, admission = false) {
        await verifyBase(); const row = await db.collection(collection).findOne({ _id: targetId(target) }, opts(session));
        validateState(row, target, ownerKey);
        if (Date.parse(row.issuedAt) > Date.now()) fail('future_state');
        const currentDigest = stateDigest(row);
        if (row.controlId !== controlId || row.revision < highRevision || row.revision === highRevision && highDigest && highDigest !== currentDigest) fail('rollback_or_changed');
        highRevision = row.revision; highDigest = currentDigest;
        const authority = row[role];
        if (!authority.enabled || authority.approvalDigest !== expectedDigest || authority.keyHash !== expectedKey) fail('authority_revoked');
        if (admission && (role !== 'runtime' || !admissionCeiling || !row.uploadAdmission)) {
            const error = new InventoryError(503, 'IMAGE_UPLOADS_PAUSED', 'Photo uploads are paused. Check status before continuing.'); error.recoveryCategory = 'target_mismatch'; throw error;
        }
        return row;
    }
    async function fence(session, admission = false) {
        if (!session || !session.inTransaction()) fail('transaction_required');
        const row = await check(session, admission);
        if (row.fence >= Number.MAX_SAFE_INTEGER) fail('fence_exhausted');
        const result = await db.collection(collection).updateOne({ _id: row._id, revision: row.revision, signature: row.signature, fence: row.fence }, { $inc: { fence: 1 } }, { session, maxTimeMS: 2000 });
        if (result.matchedCount !== 1) fail('changed');
    }
    return Object.freeze({ check, fence, identity: Object.freeze({ controlId, approvalDigest: expectedDigest, keyHash: expectedKey }) });
}
module.exports = { collection, targetId, stateDigest, validateState, signChange, applyChange, createGuard, keyHash, assertControlIndex };
