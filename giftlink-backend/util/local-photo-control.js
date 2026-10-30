// Deliberately local simulation only. Never opens R2 or accepts a remote DB URI.
const { openLocalMaintenance, isLocalMaintenance } = require('./local-image-maintenance');
const { readPreparationTarget, inspectTarget } = require('./database-target');
const { targetIdentity, fingerprint } = require('../services/r2-image-storage-config');
const controls = require('../services/photo-control');
const { publicKey } = require('../services/r2-photo-approval');
const { readPrivateJson, writePrivateJson } = require('./local-maintenance-receipt');
async function createLocalControlOperator(context, ownerKey) {
    if (!isLocalMaintenance(context)) throw Error('Verified local receipts required.'); publicKey(ownerKey);
    const r = context.receipts, target = await readPreparationTarget({ MONGO_URL: 'mongodb://127.0.0.1:' + r.mongo.port + '/?directConnection=true',
        MONGO_DB_NAME: context.identity.database, DB_ENVIRONMENT: 'staging' }, false);
    const r2 = targetIdentity({ ITEM_IMAGE_R2_ACCOUNT_ID: 'a'.repeat(32), ITEM_IMAGE_R2_ENVIRONMENT: 'staging',
        ITEM_IMAGE_R2_ENDPOINT: 'https://' + 'a'.repeat(32) + '.r2.cloudflarestorage.com', ITEM_IMAGE_R2_REGION: 'auto',
        ITEM_IMAGE_R2_BUCKET: r.storage.bucket, ITEM_IMAGE_R2_NAMESPACE: 'item-images-staging-' + r.storage.runId });
    await context.verifyDatabase(); const dbTarget = await inspectTarget(context.db, target);
    const identity = Object.freeze({ database: context.identity.database, environment: 'staging', databaseFingerprint: dbTarget.fingerprint,
        provider: 'r2-private', storageFingerprint: fingerprint(r2), bucket: r2.bucket, namespace: r2.namespace });
    async function verifyTarget() { await context.verifyDatabase(); if ((await inspectTarget(context.db, target)).fingerprint !== identity.databaseFingerprint) throw Error('Local target changed.'); }
    async function preview() {
        await verifyTarget(); const state = await context.db.collection(controls.collection).findOne({ _id: controls.targetId(identity) },
            { maxTimeMS: 2000, readConcern: { level: 'majority' }, readPreference: 'primary' });
        await controls.assertControlIndex(context.db, true);
        if (state) controls.validateState(state, identity, ownerKey);
        return { schemaVersion: 1, target: identity, state };
    }
    return { identity, preview, apply: (change, confirmation) => controls.applyChange(context.db, identity, ownerKey, change, confirmation, verifyTarget) };
}
function parse(args) {
    const a = {}, values = ['mongo-receipt', 'storage-receipt', 'database', 'bucket', 'namespace', 'snapshot', 'change',
        'confirm-target', 'confirm-change', 'confirm-previous', 'confirm-revision'];
    for (let i = 0; i < args.length; i++) {
        const key = args[i].slice(2);
        if (!args[i].startsWith('--') || a[key] !== undefined) throw Error('Invalid local control arguments.');
        if (['local-fixture', 'dry-run', 'apply'].includes(key)) a[key] = true;
        else { if (!values.includes(key) || !args[i + 1] || args[i + 1].startsWith('--')) throw Error('Invalid local control arguments.'); a[key] = args[++i]; }
    }
    if (!a['local-fixture'] || Boolean(a['dry-run']) === Boolean(a.apply) || !['mongo-receipt', 'storage-receipt', 'database', 'bucket', 'namespace'].every(k => a[k]) ||
        a['dry-run'] && (!a.snapshot || a.change || values.filter(k => k.startsWith('confirm-')).some(k => a[k])) ||
        a.apply && (a.snapshot || !['change', 'confirm-target', 'confirm-change', 'confirm-previous', 'confirm-revision'].every(k => a[k]) || !/^[1-9][0-9]*$/.test(a['confirm-revision']))) throw Error('Separate explicit local control preview/apply required.');
    return a;
}
async function run(args, report = v => process.stdout.write(JSON.stringify(v) + '\n'), env = process.env) {
    const a = parse(args); let context;
    try {
        context = await openLocalMaintenance({ mongoReceiptPath: a['mongo-receipt'], storageReceiptPath: a['storage-receipt'], databaseName: a.database,
            environment: 'development', provider: 'seaweedfs-local', bucket: a.bucket, namespace: a.namespace });
        const operator = await createLocalControlOperator(context, env.ITEM_IMAGE_CONTROL_OWNER_PUBLIC_KEY);
        if (a['dry-run']) {
            const snapshot = await operator.preview(); writePrivateJson(a.snapshot, snapshot);
            report({ mode: 'local-control-dry-run', target: controls.targetId(snapshot.target), previous: snapshot.state ? controls.stateDigest(snapshot.state) : 'absent',
                revision: snapshot.state ? snapshot.state.revision : 0, initialized: Boolean(snapshot.state), schema: { collection: controls.collection, onInitialize: 'create_if_absent', indexes: 'native_unique_id_only', startupDDL: false } });
        } else report(Object.assign({ mode: 'local-control-apply' }, await operator.apply(readPrivateJson(a.change), {
            target: a['confirm-target'], change: a['confirm-change'], previous: a['confirm-previous'], revision: Number(a['confirm-revision']) })));
        return 0;
    } finally { if (context) await context.close(); }
}
if (require.main === module) {
    const timer = setTimeout(() => { process.stderr.write('Local photo control stopped: budget. Inspect a fresh snapshot.\n'); process.exit(1); }, 30000);
    run(process.argv.slice(2)).then(code => { process.exitCode = code; }, () => {
        process.stderr.write('Local photo control refused: target_approval_revision_or_receipt.\n'); process.exitCode = 1;
    }).finally(() => clearTimeout(timer));
}
module.exports = { createLocalControlOperator, parse, run };
