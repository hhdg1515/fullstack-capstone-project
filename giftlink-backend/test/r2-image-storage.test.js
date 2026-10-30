/* jshint loopfunc: true */
const assert = require('node:assert/strict');
const { randomUUID, randomBytes, generateKeyPairSync } = require('node:crypto');
const fs = require('node:fs'), path = require('node:path');
const { execFileSync } = require('node:child_process');
const { r2Environment, blockProviderNetwork } = require('./helpers/r2-fixture');
const { readR2ImageStorageConfig, targetIdentity, fingerprint, approvalIdentity, r2StorageBinding } = require('../services/r2-image-storage-config');
const { createR2ImageStorage } = require('../services/r2-image-storage');
const { readItemImageStorageConfig } = require('../services/item-image-storage-config');
const { createItemImageStorage } = require('../services/item-image-storage');
const { verifyApproval, signApproval } = require('../services/r2-photo-approval');
const { readServerConfig } = require('../config');
const approvalCli = require('../util/approve-r2-photo-target');
const cleanupCli = require('../util/reconcile-r2-item-images');
const refused = error => error.category === 'configuration';
describe('R2 explicit configuration and offline approval, no provider access', function () {
    blockProviderNetwork();
    let f;
    beforeEach(async () => { f = await r2Environment(); });
    afterEach(() => f.close());
    it('defaults disabled without loading SDK, credentials or files; normal startup cannot activate R2', async function () {
        execFileSync(process.execPath, ['-e', `
            const Module = require('node:module'), original = Module._load;
            Module._load = function(name) { if (name.startsWith('@aws-sdk/') || name.startsWith('@smithy/')) throw Error('SDK imported'); return original.apply(this, arguments); };
            const config = require('./services/r2-image-storage-config').readR2ImageStorageConfig({ ITEM_IMAGE_R2_ENDPOINT: 'https://must-not-contact.invalid' });
            const storage = require('./services/r2-image-storage').createR2ImageStorage(config);
            storage.getVariant({}).then(() => process.exit(2), e => { if(e.category !== 'disabled') process.exit(3); });
        `], { cwd: path.resolve(__dirname, '..'), timeout: 5000 });
        readServerConfig({ MONGO_URL: 'mongodb://127.0.0.1:1', ITEM_IMAGE_R2_ENABLED: 'false' });
        for (const value of ['true', '1', '', 'TRUE']) assert.throws(() => readServerConfig(Object.assign({}, f.env, { ITEM_IMAGE_R2_ENABLED: value })), /separate real-provider approval/);
        assert.throws(() => createR2ImageStorage({ enabled: true }), refused);
    });
    for (const [name, changes] of [
        ['ambiguous enabled', { ITEM_IMAGE_R2_ENABLED: '1' }], ['local environment', { ITEM_IMAGE_R2_ENVIRONMENT: 'test' }],
        ['wrong DB environment', { DB_ENVIRONMENT: 'production' }], ['wrong database', { MONGO_DB_NAME: 'foreign' }],
        ['missing database', { MONGO_DB_NAME: undefined }], ['system database', { MONGO_DB_NAME: 'admin' }],
        ['wrong account', { ITEM_IMAGE_R2_ACCOUNT_ID: 'c'.repeat(32) }], ['missing account', { ITEM_IMAGE_R2_ACCOUNT_ID: undefined }],
        ['HTTP', { ITEM_IMAGE_R2_ENDPOINT: 'http://' + 'a'.repeat(32) + '.r2.cloudflarestorage.com' }],
        ['local URL', { ITEM_IMAGE_R2_ENDPOINT: 'http://127.0.0.1:8333' }], ['foreign host', { ITEM_IMAGE_R2_ENDPOINT: 'https://s3.amazonaws.com' }],
        ['suffix attack', { ITEM_IMAGE_R2_ENDPOINT: 'https://' + 'a'.repeat(32) + '.r2.cloudflarestorage.com.invalid' }],
        ['query', { ITEM_IMAGE_R2_ENDPOINT: 'https://' + 'a'.repeat(32) + '.r2.cloudflarestorage.com?x=1' }],
        ['port', { ITEM_IMAGE_R2_ENDPOINT: 'https://' + 'a'.repeat(32) + '.r2.cloudflarestorage.com:443' }],
        ['region', { ITEM_IMAGE_R2_REGION: 'us-east-1' }], ['wrong bucket', { ITEM_IMAGE_R2_BUCKET: 'foreign-bucket' }],
        ['unsafe bucket', { ITEM_IMAGE_R2_BUCKET: 'test.example' }], ['wrong prefix', { ITEM_IMAGE_R2_NAMESPACE: 'item-images-staging-' + '0'.repeat(32) }],
        ['cross-tier prefix', { ITEM_IMAGE_R2_NAMESPACE: 'item-images-production-' + '0'.repeat(32) }],
        ['path escape', { ITEM_IMAGE_R2_NAMESPACE: '../foreign' }], ['wrong target', { ITEM_IMAGE_R2_TARGET: '0'.repeat(64) }],
        ['wrong DB target', { ITEM_IMAGE_R2_DATABASE_TARGET: '0'.repeat(64) }], ['missing credentials', { ITEM_IMAGE_R2_SECRET_ACCESS_KEY: undefined }],
        ['credential rotation without approval', { ITEM_IMAGE_R2_ACCESS_KEY_ID: 'f'.repeat(32) }], ['AWS fallback', { ITEM_IMAGE_R2_ACCESS_KEY_ID: undefined, AWS_ACCESS_KEY_ID: 'f'.repeat(32) }],
        ['wrong role', { ITEM_IMAGE_R2_ROLE: 'recovery' }], ['ambiguous upload gate', { ITEM_IMAGE_R2_UPLOADS_ENABLED: '1' }],
        ['missing receipt', { ITEM_IMAGE_R2_APPROVAL_FILE: '/tmp/nonexistent-r2-receipt' }], ['missing public key', { ITEM_IMAGE_R2_APPROVAL_PUBLIC_KEY: undefined }]
    ]) it('refuses ' + name + ' before opening any client', () => assert.throws(() => readR2ImageStorageConfig(Object.assign({}, f.env, changes)), refused));
    it('uses different brands, targets and credentials for local and R2 factories', function () {
        const config = readR2ImageStorageConfig(f.env);
        assert.throws(() => createItemImageStorage(config), refused);
        assert.throws(() => createR2ImageStorage(readItemImageStorageConfig({})), refused);
        assert.throws(() => readItemImageStorageConfig(Object.assign({}, f.env, { ITEM_IMAGES_ENABLED: 'true' })), refused);
        const serialized = JSON.stringify(config);
        for (const key of ['ITEM_IMAGE_R2_ACCESS_KEY_ID', 'ITEM_IMAGE_R2_SECRET_ACCESS_KEY', 'ITEM_IMAGE_R2_APPROVAL_FILE', 'ITEM_IMAGE_R2_BUCKET']) assert.ok(!serialized.includes(f.env[key]));
        assert.ok(!serialized.includes(f.privateKey));
    });
    it('rejects coerced credential, fingerprint and signed receipt field types before client construction', function () {
        for (const key of ['ITEM_IMAGE_R2_ACCESS_KEY_ID', 'ITEM_IMAGE_R2_SECRET_ACCESS_KEY', 'ITEM_IMAGE_R2_DATABASE_TARGET']) {
            assert.throws(() => readR2ImageStorageConfig(Object.assign({}, f.env, { [key]: [f.env[key]] })), refused);
        }
        for (const key of ['database', 'role', 'issuedAt', 'expiresAt', 'credentialsFingerprint']) {
            assert.throws(() => verifyApproval(Object.assign({}, f.approval, { [key]: [f.approval[key]] }), approvalIdentity(f.env), f.env.ITEM_IMAGE_R2_APPROVAL_PUBLIC_KEY), refused);
        }
    });
    it('rejects signature tampering, wrong signer, expiration and future receipts', async function () {
        const expected = approvalIdentity(f.env), key = f.env.ITEM_IMAGE_R2_APPROVAL_PUBLIC_KEY;
        verifyApproval(f.approval, expected, key);
        assert.throws(() => verifyApproval(Object.assign({}, f.approval, { database: 'foreign' }), expected, key), refused);
        assert.throws(() => verifyApproval(f.approval, expected, key, Date.parse(f.approval.expiresAt)), refused);
        assert.throws(() => verifyApproval(f.approval, expected, key, Date.parse(f.approval.issuedAt) - 1), refused);
        const other = await r2Environment();
        try { assert.throws(() => verifyApproval(f.approval, expected, other.env.ITEM_IMAGE_R2_APPROVAL_PUBLIC_KEY), refused); } finally { other.close(); }
        assert.throws(() => signApproval(expected, f.privateKey, 1441), refused);
        assert.throws(() => signApproval(Object.assign({}, expected, { extra: true }), f.privateKey), refused);
    });
    it('refuses symlink/broadly-readable approval files and revokes clients when the receipt changes', async function () {
        const config = readR2ImageStorageConfig(f.env); let calls = 0;
        const storage = createR2ImageStorage(config, { requestHandler: { handle: async () => { calls++; throw Error('private-body'); }, destroy() {} } });
        fs.writeFileSync(f.env.ITEM_IMAGE_R2_APPROVAL_FILE, '{}');
        await assert.rejects(storage.headVariant({ key: f.env.ITEM_IMAGE_R2_NAMESPACE + '/' + randomBytes(12).toString('hex') + '/' + randomUUID() + '/display.webp' }), e => e.category === 'target_mismatch');
        assert.equal(calls, 0); storage.close(); f.approve();
        const link = path.join(f.directory, 'link.json'); fs.symlinkSync(f.env.ITEM_IMAGE_R2_APPROVAL_FILE, link);
        assert.throws(() => readR2ImageStorageConfig(Object.assign({}, f.env, { ITEM_IMAGE_R2_APPROVAL_FILE: link })), refused);
        if (process.platform !== 'win32') { fs.chmodSync(f.env.ITEM_IMAGE_R2_APPROVAL_FILE, 0o644); assert.throws(() => readR2ImageStorageConfig(f.env), refused); }
    });
    it('signs only an exactly confirmed offline target, never overwrites a receipt, and emits no credentials', function () {
        const output = path.join(f.directory, 'signed.json'), args = ['--output', output, '--confirm-environment', 'staging', '--confirm-role', 'runtime',
            '--confirm-storage-target', f.env.ITEM_IMAGE_R2_TARGET, '--confirm-database-target', f.env.ITEM_IMAGE_R2_DATABASE_TARGET];
        const reports = [];
        assert.throws(() => approvalCli.run(args.slice(0, -1).concat('0'.repeat(64)), r => reports.push(r), Object.assign({}, f.env, { PHOTO_APPROVAL_PRIVATE_KEY: f.privateKey })));
        approvalCli.run(args, r => reports.push(r), Object.assign({}, f.env, { PHOTO_APPROVAL_PRIVATE_KEY: f.privateKey }));
        verifyApproval(JSON.parse(fs.readFileSync(output)), approvalIdentity(f.env), f.env.ITEM_IMAGE_R2_APPROVAL_PUBLIC_KEY);
        assert.throws(() => approvalCli.run(args, () => {}, Object.assign({}, f.env, { PHOTO_APPROVAL_PRIVATE_KEY: f.privateKey })));
        assert.equal(reports.length, 1); assert.ok(!JSON.stringify(reports).includes(f.privateKey));
        assert.ok(!JSON.stringify(reports).includes(f.env.ITEM_IMAGE_R2_ACCESS_KEY_ID));
    });
    it('requires separate explicit CLI operations and refuses remote writes without confirmations', function () {
        const args = ['--dry-run', '--allow-remote', '--approval-receipt', f.env.ITEM_IMAGE_R2_APPROVAL_FILE, '--database', f.env.MONGO_DB_NAME,
            '--environment', 'staging', '--provider', 'r2-private', '--bucket', f.env.ITEM_IMAGE_R2_BUCKET, '--namespace', f.env.ITEM_IMAGE_R2_NAMESPACE, '--manifest', path.join(f.directory, 'preview.json')];
        cleanupCli.parse(args);
        for (const bad of [args.filter(x => x !== '--allow-remote'), args.concat('--apply'), args.concat('--limit', '26'), args.concat('--provider', 'r2-private'), ['--apply'].concat(args.slice(1))]) assert.throws(() => cleanupCli.parse(bad));
        assert.notEqual(fingerprint(targetIdentity(f.env)), f.env.ITEM_IMAGE_R2_DATABASE_TARGET);
    });
    it('pins receipt renewal to a fresh worker configuration and never silently refreshes an existing approval', async function () {
        const before = r2StorageBinding(readR2ImageStorageConfig(f.env)), old = f.approval;
        assert.equal(await before.verify(), true); const renewed = f.approve(); assert.notEqual(renewed.signature, old.signature);
        assert.equal(await before.verify(), false);
        const after = r2StorageBinding(readR2ImageStorageConfig(f.env)); assert.equal(await after.verify(), true);
        verifyApproval(renewed, approvalIdentity(f.env), f.env.ITEM_IMAGE_R2_APPROVAL_PUBLIC_KEY);
        assert.throws(() => verifyApproval(renewed, approvalIdentity(f.env), f.env.ITEM_IMAGE_R2_APPROVAL_PUBLIC_KEY, Date.parse(renewed.expiresAt)), refused);
    });
    it('refuses an old signer after explicit key rotation but documents that old independent trust has no global revocation authority', async function () {
        const old = r2StorageBinding(readR2ImageStorageConfig(f.env)), oldReceipt = f.approval;
        const keys = generateKeyPairSync('ed25519'), publicKey = keys.publicKey.export({ format: 'der', type: 'spki' }).toString('hex');
        const privateKey = keys.privateKey.export({ format: 'der', type: 'pkcs8' }).toString('hex'), expected = approvalIdentity(f.env);
        const renewed = signApproval(expected, privateKey), rotated = Object.assign({}, f.env, { ITEM_IMAGE_R2_APPROVAL_PUBLIC_KEY: publicKey });
        fs.writeFileSync(f.env.ITEM_IMAGE_R2_APPROVAL_FILE, JSON.stringify(renewed));
        await assert.rejects(old.verify()); const current = r2StorageBinding(readR2ImageStorageConfig(rotated)); assert.equal(await current.verify(), true);
        assert.throws(() => verifyApproval(oldReceipt, expected, publicKey), refused);
        fs.writeFileSync(f.env.ITEM_IMAGE_R2_APPROVAL_FILE, JSON.stringify(oldReceipt));
        await assert.rejects(current.verify()); assert.throws(() => readR2ImageStorageConfig(rotated), refused);
        // Honest boundary: a worker still trusting the old key/file can accept an
        // unexpired old receipt again. Production stays blocked; this is not a
        // distributed, permanent revocation mechanism or a new authorization.
        assert.equal(await old.verify(), true);
    });
    it('allows a valid target-bound receipt to be reused after restart only within its lifetime, not as a one-time PUT permit', function () {
        const expected = approvalIdentity(f.env), key = f.env.ITEM_IMAGE_R2_APPROVAL_PUBLIC_KEY;
        verifyApproval(f.approval, expected, key); verifyApproval(f.approval, expected, key);
        readR2ImageStorageConfig(f.env); readR2ImageStorageConfig(f.env);
        for (const changes of [{ role: 'recovery' }, { environment: 'production' }, { databaseFingerprint: '0'.repeat(64) }, { storageFingerprint: '0'.repeat(64) }]) {
            assert.throws(() => verifyApproval(f.approval, Object.assign({}, expected, changes), key), refused);
        }
        assert.throws(() => verifyApproval(f.approval, expected, key, Date.parse(f.approval.expiresAt)), refused);
        // Actual duplicate PUT denial is ledger-backed and covered across fresh
        // pipelines by photo-capacity.test.js; signatures are not consumable tokens.
    });
});
