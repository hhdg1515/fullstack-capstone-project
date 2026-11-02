const assert = require('node:assert/strict');
const { r2Environment, blockProviderNetwork } = require('./helpers/r2-fixture');
const { readR2ImageStorageConfig, r2StorageBinding } = require('../services/r2-image-storage-config');
const { hostedPhotoEnv } = require('../services/hosted-photo-config');
const { readServerConfig } = require('../config');
const refused = error => error.category === 'configuration';
describe('hosted demo photos with a standing approval, no provider access', function () {
    blockProviderNetwork();
    let f, env;
    beforeEach(async () => {
        f = await r2Environment();
        env = Object.assign({}, f.env, { ITEM_IMAGE_R2_APPROVAL_MODE: 'standing' });
        delete env.ITEM_IMAGE_R2_APPROVAL_FILE; delete env.ITEM_IMAGE_R2_APPROVAL_PUBLIC_KEY;
    });
    afterEach(() => f.close());
    it('ordinary startup still refuses R2; only the hosted entry accepts the standing mode, with metadata', function () {
        assert.throws(() => readServerConfig(env), /separate real-provider approval/);
        assert.equal(readServerConfig(env, { hostedPhotos: true }).hostedR2Photos, true);
        assert.throws(() => readServerConfig(f.env, { hostedPhotos: true }), /separate real-provider approval/);
        assert.throws(() => readServerConfig(Object.assign({}, env, { ITEM_IMAGE_METADATA_ENABLED: 'false' }), { hostedPhotos: true }), /ITEM_IMAGE_METADATA_ENABLED=true/);
        assert.equal(readServerConfig({ MONGO_URL: 'mongodb://127.0.0.1:1' }, { hostedPhotos: true }).hostedR2Photos, undefined);
    });
    it('derives the pinned endpoint and storage fingerprint, and refuses an explicit mismatch', function () {
        const minimal = Object.assign({}, env);
        for (const key of ['ITEM_IMAGE_R2_ENDPOINT', 'ITEM_IMAGE_R2_REGION', 'ITEM_IMAGE_R2_TARGET', 'ITEM_IMAGE_STORAGE_TARGET', 'ITEM_IMAGE_NAMESPACE']) delete minimal[key];
        const derived = hostedPhotoEnv(minimal);
        for (const key of ['ITEM_IMAGE_R2_ENDPOINT', 'ITEM_IMAGE_R2_REGION', 'ITEM_IMAGE_R2_TARGET', 'ITEM_IMAGE_STORAGE_TARGET', 'ITEM_IMAGE_NAMESPACE']) assert.equal(derived[key], f.env[key]);
        assert.equal(hostedPhotoEnv(f.env), f.env);
        assert.throws(() => hostedPhotoEnv(Object.assign({}, minimal, { ITEM_IMAGE_STORAGE_TARGET: 'c'.repeat(64) })), /does not match/);
        assert.throws(() => hostedPhotoEnv(Object.assign({}, minimal, { ITEM_IMAGE_R2_ACCOUNT_ID: 'NOT-A-HEX-ACCOUNT' })), refused);
    });
    it('needs no approval file but keeps the runtime role, database target and explicit mode checks', async function () {
        const config = readR2ImageStorageConfig(env, { standing: true }), binding = r2StorageBinding(config);
        assert.equal(config.enabled, true); assert.equal(config.role, 'runtime');
        assert.equal(binding.approval.approvalMode, 'standing'); assert.equal(binding.approval.databaseFingerprint, env.ITEM_IMAGE_R2_DATABASE_TARGET);
        assert.equal(await binding.verify(), true);
        assert.throws(() => readR2ImageStorageConfig(env), refused);
        assert.throws(() => readR2ImageStorageConfig(f.env, { standing: true }), refused);
        assert.throws(() => readR2ImageStorageConfig(Object.assign({}, env, { ITEM_IMAGE_R2_DATABASE_TARGET: 'short' }), { standing: true }), refused);
        assert.throws(() => readR2ImageStorageConfig(Object.assign({}, env, { ITEM_IMAGE_R2_ROLE: 'recovery', ITEM_IMAGE_R2_UPLOADS_ENABLED: 'false' }), { standing: true }), refused);
    });
});
