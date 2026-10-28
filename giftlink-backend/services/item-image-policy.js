const { ObjectId } = require('mongodb');
const { InventoryError } = require('./inventory-error');
const { isCalendarDate } = require('./calendar');

const ceiling = Object.freeze({ photos: 5, inputBytes: 3 * 1024 * 1024,
    thumbnailBytes: 256 * 1024, displayBytes: 1024 * 1024, reservedBytes: 1280 * 1024,
    attempts: 50, successes: 20, accountBytes: 100 * 1024 * 1024, concurrent: 2, records: 1000, leaseMs: 120000 });
const uuid = value => typeof value === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(value);
const hash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const integer = value => Number.isSafeInteger(value) && value >= 0;
const date = value => value instanceof Date && Number.isFinite(value.getTime());
const nullableDate = value => value === null || date(value);
const fields = (value, names) => value && typeof value === 'object' && !Array.isArray(value) &&
    Object.keys(value).length === names.length && names.every(name => Object.prototype.hasOwnProperty.call(value, name));
const namespace = value => typeof value === 'string' && /^item-images-(test|development|staging|production)-[a-f0-9]{32}$/.test(value);
const states = Object.freeze(['reserved', 'processing', 'ready', 'failed', 'delete_pending', 'deleted']);
const unavailable = () => new InventoryError(404, 'IMAGE_UNAVAILABLE', 'Photo or item unavailable.');
const damaged = () => new InventoryError(409, 'IMAGE_METADATA_INVALID', 'Photo metadata needs review. No capacity was released.');

function validateImageConfig(value) {
    if (!value || !fields(value, ['storageBinding', 'limits']) ||
        !fields(value.storageBinding, ['fingerprint', 'namespace']) || !hash(value.storageBinding.fingerprint) || !namespace(value.storageBinding.namespace) ||
        !fields(value.limits, ['attempts', 'successes', 'accountBytes', 'concurrent', 'records'])) throw new Error('Invalid image metadata configuration');
    for (const key of Object.keys(value.limits)) {
        const min = key === 'accountBytes' ? ceiling.reservedBytes : 1;
        if (!Number.isSafeInteger(value.limits[key]) || value.limits[key] < min || value.limits[key] > ceiling[key]) throw new Error('Invalid image quota configuration');
    }
    return Object.freeze({ storageBinding: Object.freeze(Object.assign({}, value.storageBinding)), limits: Object.freeze(Object.assign({}, value.limits)) });
}
function readImageMetadataConfig(env = process.env) {
    if (env.ITEM_IMAGE_METADATA_ENABLED === undefined || env.ITEM_IMAGE_METADATA_ENABLED === 'false') return null;
    if (env.ITEM_IMAGE_METADATA_ENABLED !== 'true') throw new Error('ITEM_IMAGE_METADATA_ENABLED must be true or false');
    const names = { attempts: 'DAILY_ATTEMPTS', successes: 'DAILY_SUCCESSES', accountBytes: 'ACCOUNT_BYTES', concurrent: 'CONCURRENT', records: 'RECORDS' };
    const limits = {};
    for (const key of Object.keys(names)) {
        const raw = env['ITEM_IMAGE_QUOTA_' + names[key]];
        limits[key] = raw === undefined ? ceiling[key] : (/^[1-9][0-9]*$/.test(raw) ? Number(raw) : NaN);
    }
    return validateImageConfig({ storageBinding: { fingerprint: env.ITEM_IMAGE_STORAGE_TARGET, namespace: env.ITEM_IMAGE_NAMESPACE }, limits });
}
function variantKey(row, variant) { return row.storageBinding.namespace + '/' + row._id.toHexString() + '/' + row.generation + '/' + variant + '.webp'; }
function validOperation(row) {
    if (!fields(row, ['schemaVersion', '_id', 'itemId', 'planId', 'ownerId', 'clientUploadId', 'intent', 'state', 'sortPosition', 'generation',
        'storageBinding', 'variants', 'lease', 'version', 'charge', 'cleanup', 'needsMaintenance', 'maintenanceDueAt', 'createdAt', 'updatedAt', 'readyAt', 'deleteRequestedAt', 'deletedAt']) ||
        row.schemaVersion !== 1 || !['_id', 'itemId', 'planId', 'ownerId'].every(key => row[key] instanceof ObjectId) ||
        !uuid(row.clientUploadId) || !uuid(row.generation) || !states.includes(row.state) ||
        !fields(row.intent, ['byteLength', 'sha256']) || !integer(row.intent.byteLength) || row.intent.byteLength < 1 || row.intent.byteLength > ceiling.inputBytes || !hash(row.intent.sha256) ||
        !fields(row.storageBinding, ['fingerprint', 'namespace']) || !hash(row.storageBinding.fingerprint) || !namespace(row.storageBinding.namespace) ||
        !integer(row.version) || row.version < 1 || !(row.sortPosition === null || integer(row.sortPosition) && row.sortPosition < ceiling.photos) ||
        !date(row.createdAt) || !date(row.updatedAt) || !['readyAt', 'deleteRequestedAt', 'deletedAt'].every(key => nullableDate(row[key])) ||
        typeof row.needsMaintenance !== 'boolean' || !nullableDate(row.maintenanceDueAt) || row.needsMaintenance !== date(row.maintenanceDueAt) ||
        !fields(row.lease, ['fenceToken', 'claimedAt', 'expiresAt']) || !(row.lease.fenceToken === null || uuid(row.lease.fenceToken)) ||
        !nullableDate(row.lease.claimedAt) || !date(row.lease.expiresAt) ||
        !(fields(row.cleanup, ['reason', 'attempts', 'nextAttemptAt']) || fields(row.cleanup, ['reason', 'attempts', 'nextAttemptAt', 'recovery'])) ||
        ![null, 'owner_delete', 'reservation_expired', 'pipeline_failed'].includes(row.cleanup.reason) ||
        !integer(row.cleanup.attempts) || !nullableDate(row.cleanup.nextAttemptAt) ||
        !fields(row.charge, ['quotaDay', 'reservedBytes', 'retainedBytes', 'heldSuccess', 'concurrencyHeld', 'slotHeld', 'dailySuccessCharged', 'holdsSettled', 'storageReleasedAt'])) return false;
    const charge = row.charge;
    if (!isCalendarDate(charge.quotaDay) || !integer(charge.reservedBytes) || !integer(charge.retainedBytes) ||
        charge.reservedBytes + charge.retainedBytes > ceiling.reservedBytes || !nullableDate(charge.storageReleasedAt) ||
        !['heldSuccess', 'concurrencyHeld', 'slotHeld', 'dailySuccessCharged', 'holdsSettled'].every(key => typeof charge[key] === 'boolean') ||
        !fields(row.variants, ['thumbnail', 'display'])) return false;
    for (const name of ['thumbnail', 'display']) {
        const v = row.variants[name];
        if (!fields(v, ['key', 'outcome', 'byteLength', 'sha256', 'width', 'height', 'contentType']) || v.key !== variantKey(row, name) ||
            !['not_started', 'prepared', 'unknown', 'stored', 'rejected', 'delete_unknown', 'delete_acknowledged', 'deleted'].includes(v.outcome) || v.contentType !== 'image/webp') return false;
        if (v.outcome === 'not_started') {
            if (![v.byteLength, v.sha256, v.width, v.height].every(value => value === null)) return false;
        } else if (!integer(v.byteLength) || v.byteLength < 1 || v.byteLength > ceiling[name + 'Bytes'] || !hash(v.sha256) ||
            !integer(v.width) || !integer(v.height) || v.width < 1 || v.height < 1 || Math.max(v.width, v.height) > (name === 'thumbnail' ? 400 : 1280)) return false;
    }
    const recovery = row.cleanup.recovery;
    if (recovery !== undefined && (!fields(recovery, ['fenceToken', 'claimedAt', 'expiresAt', 'status', 'category', 'manifestDigest', 'unknownWrites', 'absent']) ||
        !uuid(recovery.fenceToken) || !date(recovery.claimedAt) || !date(recovery.expiresAt) || !hash(recovery.manifestDigest) ||
        !['leased', 'blocked', 'retry', 'complete'].includes(recovery.status) ||
        ![null, 'unknown_write', 'authorization', 'target_missing', 'target_mismatch', 'integrity', 'timeout', 'provider', 'accounting', 'changed', 'budget'].includes(recovery.category) ||
        !Array.isArray(recovery.unknownWrites) || recovery.unknownWrites.length > 2 || new Set(recovery.unknownWrites).size !== recovery.unknownWrites.length ||
        !recovery.unknownWrites.every(name => ['thumbnail', 'display'].includes(name)) ||
        !fields(recovery.absent, ['thumbnail', 'display']) || !Object.values(recovery.absent).every(value => typeof value === 'boolean') ||
        !['delete_pending', 'deleted'].includes(row.state) || recovery.status === 'complete' && row.state !== 'deleted')) return false;
    if (row.state === 'reserved') return row.sortPosition === null && row.readyAt === null && row.lease.claimedAt === null && row.lease.fenceToken === null &&
        Object.values(row.variants).every(v => v.outcome === 'not_started') && charge.reservedBytes === ceiling.reservedBytes && charge.retainedBytes === 0 &&
        charge.heldSuccess && charge.concurrencyHeld && charge.slotHeld && !charge.dailySuccessCharged && !charge.holdsSettled && charge.storageReleasedAt === null;
    if (row.state === 'processing') return row.sortPosition === null && row.readyAt === null && date(row.lease.claimedAt) && uuid(row.lease.fenceToken) &&
        charge.reservedBytes === ceiling.reservedBytes && charge.concurrencyHeld && charge.heldSuccess && charge.slotHeld && !charge.holdsSettled;
    if (row.state === 'ready') return integer(row.sortPosition) && date(row.readyAt) && date(row.lease.claimedAt) && uuid(row.lease.fenceToken) &&
        Object.values(row.variants).every(v => v.outcome === 'stored') && charge.reservedBytes === 0 &&
        charge.retainedBytes === row.variants.thumbnail.byteLength + row.variants.display.byteLength && charge.dailySuccessCharged &&
        !charge.concurrencyHeld && !charge.heldSuccess && charge.holdsSettled && charge.slotHeld && charge.storageReleasedAt === null;
    if (row.sortPosition !== null) return false;
    if (Object.values(row.variants).some(v => v.outcome === 'unknown') && (!charge.concurrencyHeld || !charge.slotHeld || charge.holdsSettled)) return false;
    if (charge.holdsSettled && (charge.heldSuccess || charge.concurrencyHeld)) return false;
    if (charge.storageReleasedAt && (charge.reservedBytes || charge.retainedBytes || !charge.holdsSettled)) return false;
    if (row.state === 'deleted') return !charge.reservedBytes && !charge.retainedBytes && !charge.slotHeld && charge.holdsSettled && date(charge.storageReleasedAt) &&
        recovery && recovery.status === 'complete' && Object.values(recovery.absent).every(Boolean) && !row.needsMaintenance && date(row.deletedAt);
    return true;
}
function assertOperation(row) { if (!validOperation(row)) throw damaged(); return row; }
function validQuota(q) {
    return fields(q, ['schemaVersion', 'utcDay', 'attempts', 'successful', 'heldSuccess', 'reservedBytes', 'retainedBytes', 'activeUploads', 'operationCount', 'updatedAt']) &&
        q.schemaVersion === 1 && isCalendarDate(q.utcDay) && date(q.updatedAt) &&
        ['attempts', 'successful', 'heldSuccess', 'reservedBytes', 'retainedBytes', 'activeUploads', 'operationCount'].every(key => integer(q[key])) &&
        Number.isSafeInteger(q.reservedBytes + q.retainedBytes);
}
function quotaFor(q, now) {
    const day = now.toISOString().slice(0, 10);
    if (q !== undefined && !validQuota(q)) throw damaged();
    if (q === undefined) return { schemaVersion: 1, utcDay: day, attempts: 0, successful: 0, heldSuccess: 0,
        reservedBytes: 0, retainedBytes: 0, activeUploads: 0, operationCount: 0, updatedAt: now };
    const next = Object.assign({}, q, { updatedAt: now });
    if (q.utcDay !== day) Object.assign(next, { utcDay: day, attempts: 0, successful: 0, heldSuccess: 0 });
    return next;
}
module.exports = { ceiling, uuid, hash, integer, states, unavailable, damaged, variantKey,
    validOperation, assertOperation, validQuota, quotaFor, validateImageConfig, readImageMetadataConfig };
