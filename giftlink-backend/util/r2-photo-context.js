const { createDatabase } = require('../models/db');
const { readPreparationTarget, inspectTarget } = require('./database-target');
const { assertDatabaseIndexes } = require('../services/database-indexes');
const { readImageMetadataConfig } = require('../services/item-image-policy');
const { readR2ImageStorageConfig, r2StorageBinding } = require('../services/r2-image-storage-config');
const { createR2ImageStorage } = require('../services/r2-image-storage');
const { InventoryError } = require('../services/inventory-error');
const contexts = new WeakSet();
const fail = () => { throw new Error('R2 photo target verification refused.'); };

// Explicit operator/runtime entry, never called by ordinary server startup.
// storageOptions is a trusted code-only test seam, not an env/CLI endpoint override.
async function openR2PhotoContext({ env, allowRemote = false, storageOptions = () => ({}) }) {
    if (![undefined, 'false', 'true'].includes(env.ITEM_IMAGE_DISTRIBUTED_CONTROL_ENABLED)) fail();
    if (env.ITEM_IMAGE_DISTRIBUTED_CONTROL_ENABLED === 'true' && (env.PHOTO_CONTROL_OWNER_PRIVATE_KEY !== undefined || env.PHOTO_APPROVAL_PRIVATE_KEY !== undefined)) fail();
    const storageConfig = readR2ImageStorageConfig(env), binding = r2StorageBinding(storageConfig);
    if (!binding) fail();
    const metadata = readImageMetadataConfig(env);
    if (!metadata || metadata.storageBinding.fingerprint !== storageConfig.targetFingerprint ||
        metadata.storageBinding.namespace !== binding.receipt.namespace) fail();
    const target = await readPreparationTarget(env, allowRemote);
    const database = createDatabase({ mongoUrl: target.mongoUrl, dbName: target.dbName,
        clientOptions: Object.assign({}, target.clientOptions, { serverSelectionTimeoutMS: 5000, connectTimeoutMS: 5000, socketTimeoutMS: 5000,
            maxPoolSize: 10, maxConnecting: 2, waitQueueTimeoutMS: 2000, maxIdleTimeMS: 30000 }) });
    let closed = false;
    try {
        const db = await database.connect();
        const identity = Object.freeze({ database: target.dbName, environment: target.environment,
            databaseFingerprint: binding.approval.databaseFingerprint, provider: 'r2-private',
            storageFingerprint: storageConfig.targetFingerprint, bucket: binding.receipt.bucket, namespace: binding.receipt.namespace });
        const verifyBase = async () => {
            try {
                if (closed || await binding.verify() !== true) fail();
                const inspected = await inspectTarget(db, target);
                if (!['replica-set', 'sharded'].includes(inspected.deployment) || inspected.fingerprint !== binding.approval.databaseFingerprint ||
                    env.ITEM_IMAGE_DISTRIBUTED_CONTROL_ENABLED === 'true' && inspected.deployment !== 'replica-set' ||
                    inspected.database !== binding.approval.database || inspected.environment !== binding.approval.environment) fail();
                return true;
            } catch (error) {
                const refusal = new InventoryError(503, 'IMAGE_TARGET_UNAVAILABLE', 'Photo service unavailable. Check status before continuing.');
                refusal.recoveryCategory = 'target_mismatch'; throw refusal;
            }
        };
        await verifyBase();
        // Read-only index verification, no preparation or DDL on this path.
        await assertDatabaseIndexes(db, { imageMetadataEnabled: true });
        const controls = require('../services/photo-control');
        if (env.ITEM_IMAGE_DISTRIBUTED_CONTROL_ENABLED === 'true') await controls.assertControlIndex(db);
        const control = env.ITEM_IMAGE_DISTRIBUTED_CONTROL_ENABLED === 'true' ? controls.createGuard({ db, target: identity,
            ownerKey: env.ITEM_IMAGE_CONTROL_OWNER_PUBLIC_KEY, controlId: env.ITEM_IMAGE_CONTROL_ID,
            minimumRevision: /^[1-9][0-9]*$/.test(env.ITEM_IMAGE_CONTROL_MIN_REVISION || '') ? Number(env.ITEM_IMAGE_CONTROL_MIN_REVISION) : NaN,
            approval: binding.approval, verificationKey: env.ITEM_IMAGE_R2_APPROVAL_PUBLIC_KEY, verifyBase,
            admissionCeiling: storageConfig.uploadsEnabled }) : null;
        const verifyDatabase = async () => {
            if (control) { await control.check(); return true; }
            await verifyBase();
            // Adoption requires stopping older/uncontrolled workers. New binaries
            // refuse legacy fallback once this exact target has a control record.
            if (await db.collection(controls.collection).findOne({ _id: controls.targetId(identity) },
                { projection: { _id: 1 }, maxTimeMS: 2000, readConcern: { level: 'majority' }, readPreference: 'primary' })) fail();
            return true;
        };
        await verifyDatabase();
        const clients = new Set();
        const context = Object.freeze({ db, metadata, storageConfig, verifyDatabase, control,
            // Text/auth can stay available when photo authority expires. The sealed
            // pipeline pins the app to this exact connection function, while photo
            // mutations/status/bytes always use the separately guarded connection.
            applicationConnectToDatabase: async () => { if (closed) fail(); return db; },
            connectToDatabase: async () => { await verifyDatabase(); return db; },
            identity,
            // Signature/identity only; no credentials, keys or provider response bodies.
            receipts: Object.freeze(Object.assign({ approval: binding.approval }, control ? { control: control.identity } : {})),
            createStorage: () => {
                if (closed) fail(); const client = createR2ImageStorage(storageConfig, storageOptions()); clients.add(client);
                const guarded = { close: () => { try { client.close(); } finally { clients.delete(client); } } };
                for (const operation of ['putVariant', 'getVariant', 'headVariant', 'deleteVariant']) guarded[operation] = async value => {
                    await verifyDatabase(); return client[operation](value);
                };
                return Object.freeze(guarded);
            },
            close: async () => { closed = true; for (const client of clients) client.close(); await database.close(); } });
        contexts.add(context); return context;
    } catch (error) { await database.close(); return fail(); }
}
module.exports = { openR2PhotoContext, isR2PhotoContext: value => contexts.has(value) };
