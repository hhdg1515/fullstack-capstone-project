const { storageError } = require('./item-image-storage-error');
const { hash, readApproval, publicKey } = require('./r2-photo-approval');
const bindings = new WeakMap();
const fail = () => { throw storageError('configuration', 'configure', 'not_attempted'); };
function targetIdentity(env) {
    const account = env.ITEM_IMAGE_R2_ACCOUNT_ID, environment = env.ITEM_IMAGE_R2_ENVIRONMENT;
    const endpoint = env.ITEM_IMAGE_R2_ENDPOINT, bucket = env.ITEM_IMAGE_R2_BUCKET, namespace = env.ITEM_IMAGE_R2_NAMESPACE;
    if (typeof account !== 'string' || !/^[a-f0-9]{32}$/.test(account) || !['staging', 'production'].includes(environment) ||
        endpoint !== 'https://' + account + '.r2.cloudflarestorage.com' || env.ITEM_IMAGE_R2_REGION !== 'auto' ||
        typeof bucket !== 'string' || !/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(bucket) ||
        typeof namespace !== 'string' || !new RegExp('^item-images-' + environment + '-[a-f0-9]{32}$').test(namespace)) fail();
    return Object.freeze({ provider: 'r2-private', account, environment, endpoint, bucket, namespace, region: 'auto' });
}
const fingerprint = identity => hash(JSON.stringify(['r2-private-v1', identity.account, identity.environment,
    identity.endpoint, identity.region, identity.bucket, identity.namespace]));
function approvalIdentity(env) {
    const target = targetIdentity(env), storageFingerprint = fingerprint(target), role = env.ITEM_IMAGE_R2_ROLE;
    if (!['runtime', 'recovery'].includes(role) || env.DB_ENVIRONMENT !== target.environment ||
        typeof env.MONGO_DB_NAME !== 'string' || !/^[A-Za-z0-9_-]{1,63}$/.test(env.MONGO_DB_NAME) ||
        ['admin', 'config', 'local'].includes(env.MONGO_DB_NAME.toLowerCase()) ||
        typeof env.ITEM_IMAGE_R2_DATABASE_TARGET !== 'string' || !/^[a-f0-9]{64}$/.test(env.ITEM_IMAGE_R2_DATABASE_TARGET) || env.ITEM_IMAGE_R2_TARGET !== storageFingerprint ||
        typeof env.ITEM_IMAGE_R2_ACCESS_KEY_ID !== 'string' || typeof env.ITEM_IMAGE_R2_SECRET_ACCESS_KEY !== 'string' ||
        !/^[a-f0-9]{32}$/.test(env.ITEM_IMAGE_R2_ACCESS_KEY_ID) || !/^[a-f0-9]{64}$/.test(env.ITEM_IMAGE_R2_SECRET_ACCESS_KEY)) fail();
    return { role, environment: target.environment, database: env.MONGO_DB_NAME,
        databaseFingerprint: env.ITEM_IMAGE_R2_DATABASE_TARGET, storageFingerprint,
        credentialsFingerprint: hash(env.ITEM_IMAGE_R2_ACCESS_KEY_ID + ':' + env.ITEM_IMAGE_R2_SECRET_ACCESS_KEY) };
}
function readR2ImageStorageConfig(env = process.env) {
    if (env.ITEM_IMAGE_R2_ENABLED === undefined || env.ITEM_IMAGE_R2_ENABLED === 'false') {
        const disabled = Object.freeze({ enabled: false }); bindings.set(disabled, null); return disabled;
    }
    if (env.ITEM_IMAGE_R2_ENABLED !== 'true' || ![undefined, 'true', 'false'].includes(env.ITEM_IMAGE_R2_UPLOADS_ENABLED)) fail();
    const target = targetIdentity(env), expected = approvalIdentity(env);
    if (expected.role === 'recovery' && env.ITEM_IMAGE_R2_UPLOADS_ENABLED === 'true') fail();
    publicKey(env.ITEM_IMAGE_R2_APPROVAL_PUBLIC_KEY);
    const file = env.ITEM_IMAGE_R2_APPROVAL_FILE, key = env.ITEM_IMAGE_R2_APPROVAL_PUBLIC_KEY;
    const initial = readApproval(file, expected, key), expectedSignature = initial.signature;
    const config = Object.freeze({ enabled: true, driver: 'r2-private', environment: target.environment,
        role: expected.role, targetFingerprint: expected.storageFingerprint, uploadsEnabled: env.ITEM_IMAGE_R2_UPLOADS_ENABLED === 'true' });
    bindings.set(config, Object.freeze({ receipt: target, approval: initial,
        credentials: Object.freeze({ accessKeyId: env.ITEM_IMAGE_R2_ACCESS_KEY_ID, secretAccessKey: env.ITEM_IMAGE_R2_SECRET_ACCESS_KEY }),
        role: expected.role, region: 'auto', protocol: 'https:', hostname: target.account + '.r2.cloudflarestorage.com', port: undefined,
        verify: async () => readApproval(file, expected, key).signature === expectedSignature }));
    return config;
}
function r2StorageBinding(config) { if (!bindings.has(config)) fail(); return bindings.get(config); }
module.exports = { targetIdentity, fingerprint, approvalIdentity, readR2ImageStorageConfig, r2StorageBinding };
