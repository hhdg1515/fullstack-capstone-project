const { createHash } = require('node:crypto');
const { storageError } = require('./item-image-storage-error');

// Secrets and the live, read-only fixture verifier never enter a DTO/loggable config.
const bindings = new WeakMap();
const hex = /^[a-f0-9]{32}$/;
function digest(value) { return createHash('sha256').update(value).digest('hex'); }
function fail() { throw storageError('configuration', 'configure', 'not_attempted'); }

function localReceipt(receipt) {
    if (!receipt || receipt.version !== 1 || !hex.test(receipt.runId) ||
        !/^[a-f0-9]{64}$/.test(receipt.containerId) ||
        !/^sha256:[a-f0-9]{64}$/.test(receipt.imageId) ||
        receipt.containerName !== 'moveout-seaweed-' + receipt.runId ||
        receipt.volumeName !== 'moveout-seaweed-' + receipt.runId ||
        !Number.isInteger(receipt.port) || receipt.port < 1024 || receipt.port > 65535 ||
        receipt.endpoint !== 'http://127.0.0.1:' + receipt.port ||
        receipt.bucket !== 'moveout-test-' + receipt.runId ||
        receipt.namespace !== 'item-images-test-' + receipt.runId ||
        !/^[a-f0-9]{64}$/.test(receipt.credentialsSha256)) fail();
    return Object.freeze({ version: 1, runId: receipt.runId, containerId: receipt.containerId,
        imageId: receipt.imageId, containerName: receipt.containerName, volumeName: receipt.volumeName,
        port: receipt.port, endpoint: receipt.endpoint, bucket: receipt.bucket,
        namespace: receipt.namespace, credentialsSha256: receipt.credentialsSha256 });
}

function fingerprint(receipt) {
    const r = localReceipt(receipt);
    return digest(JSON.stringify(['seaweedfs-local', 'test', r.runId, r.containerId, r.imageId,
        r.volumeName, r.endpoint, r.bucket, r.namespace]));
}

// A MongoDB target, environment flag or caller-supplied receipt alone is NOT authority.
// The trusted fixture must additionally verify the live Docker target on every operation.
function readItemImageStorageConfig(env = process.env, localTarget = undefined) {
    if (env.ITEM_IMAGES_ENABLED === undefined || env.ITEM_IMAGES_ENABLED === 'false') {
        const config = Object.freeze({ enabled: false });
        bindings.set(config, null);
        return config;
    }
    if (env.ITEM_IMAGES_ENABLED !== 'true' || !localTarget || typeof localTarget.verify !== 'function') fail();
    const receipt = localReceipt(localTarget.receipt);
    if (env.ITEM_IMAGE_STORAGE_DRIVER !== 'seaweedfs-local' || env.ITEM_IMAGE_STORAGE_ENVIRONMENT !== 'test' ||
        env.ITEM_IMAGE_S3_REGION !== 'us-east-1' || env.ITEM_IMAGE_S3_ENDPOINT !== receipt.endpoint ||
        env.ITEM_IMAGE_S3_BUCKET !== receipt.bucket || env.ITEM_IMAGE_NAMESPACE !== receipt.namespace ||
        env.ITEM_IMAGE_STORAGE_TARGET !== fingerprint(receipt) ||
        !/^test[a-f0-9]{16}$/.test(env.ITEM_IMAGE_S3_ACCESS_KEY_ID) ||
        !/^[a-f0-9]{64}$/.test(env.ITEM_IMAGE_S3_SECRET_ACCESS_KEY) ||
        digest(env.ITEM_IMAGE_S3_ACCESS_KEY_ID + ':' + env.ITEM_IMAGE_S3_SECRET_ACCESS_KEY) !== receipt.credentialsSha256) fail();
    const config = Object.freeze({ enabled: true, driver: 'seaweedfs-local', environment: 'test',
        targetFingerprint: fingerprint(receipt) });
    bindings.set(config, Object.freeze({ receipt, verify: localTarget.verify,
        credentials: Object.freeze({ accessKeyId: env.ITEM_IMAGE_S3_ACCESS_KEY_ID,
            secretAccessKey: env.ITEM_IMAGE_S3_SECRET_ACCESS_KEY }) }));
    return config;
}

function storageBinding(config) {
    if (!bindings.has(config)) fail();
    return bindings.get(config);
}

module.exports = { readItemImageStorageConfig, storageBinding, fingerprint };
