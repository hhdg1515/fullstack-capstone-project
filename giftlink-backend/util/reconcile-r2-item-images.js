const { openR2PhotoContext } = require('./r2-photo-context');
const { readPrivateJson, writePrivateJson } = require('./local-maintenance-receipt');
const { readR2ImageStorageConfig, r2StorageBinding } = require('../services/r2-image-storage-config');
const { createR2ImageRecovery, bounds } = require('../services/item-image-recovery');
function parse(args) {
    const allowed = ['approval-receipt', 'database', 'environment', 'provider', 'bucket', 'namespace', 'manifest',
        'confirm-database', 'confirm-environment', 'confirm-database-target', 'confirm-storage-target', 'confirm-provider', 'confirm-bucket', 'confirm-namespace', 'confirm-manifest', 'after', 'limit'];
    const result = {};
    for (let i = 0; i < args.length; i++) {
        const name = args[i].slice(2);
        if (!args[i].startsWith('--') || result[name] !== undefined) throw Error('Invalid R2 maintenance arguments.');
        if (['dry-run', 'apply', 'allow-remote'].includes(name)) result[name] = true;
        else {
            if (!allowed.includes(name) || !args[i + 1] || args[i + 1].startsWith('--')) throw Error('Invalid R2 maintenance arguments.');
            result[name] = args[++i];
        }
    }
    if (Boolean(result['dry-run']) === Boolean(result.apply) || !result['allow-remote'] ||
        !['approval-receipt', 'database', 'environment', 'provider', 'bucket', 'namespace', 'manifest'].every(k => result[k]) ||
        !['staging', 'production'].includes(result.environment) || result.provider !== 'r2-private' ||
        result.limit !== undefined && (!/^[1-9][0-9]*$/.test(result.limit) || Number(result.limit) > bounds.operations) ||
        result.after !== undefined && !/^[a-f0-9]{24}$/.test(result.after) ||
        result.apply && (result.after !== undefined || result.limit !== undefined || !allowed.filter(k => k.startsWith('confirm-')).every(k => result[k]))) throw Error('Explicit guarded R2 dry-run or apply required.');
    return result;
}
async function run(args, report = value => process.stdout.write(JSON.stringify(value) + '\n'), { env = process.env, storageOptions } = {}) {
    const a = parse(args), settings = Object.assign({}, env, { ITEM_IMAGE_R2_APPROVAL_FILE: a['approval-receipt'] });
    // Check confirmations/receipt offline BEFORE opening a database or S3 client.
    const config = readR2ImageStorageConfig(settings), binding = r2StorageBinding(config);
    if (!binding || config.role !== 'recovery' || a.database !== binding.approval.database || a.environment !== config.environment ||
        a.bucket !== binding.receipt.bucket || a.namespace !== binding.receipt.namespace) throw Error('R2 target mismatch.');
    const identity = { database: a.database, environment: a.environment, databaseFingerprint: binding.approval.databaseFingerprint,
        storageFingerprint: config.targetFingerprint, provider: 'r2-private', bucket: a.bucket, namespace: a.namespace };
    const confirmations = {};
    for (const [key, name] of Object.entries({ database: 'database', environment: 'environment', databaseFingerprint: 'database-target',
        storageFingerprint: 'storage-target', provider: 'provider', bucket: 'bucket', namespace: 'namespace', manifest: 'manifest' })) confirmations[key] = a['confirm-' + name];
    if (a.apply && Object.keys(identity).some(key => identity[key] !== confirmations[key])) throw Error('R2 confirmation mismatch.');
    const manifest = a.apply ? readPrivateJson(a.manifest) : null;
    if (manifest && manifest.digest !== confirmations.manifest) throw Error('R2 manifest mismatch.');
    let context, recovery;
    try {
        context = await openR2PhotoContext({ env: settings, allowRemote: true, storageOptions });
        recovery = createR2ImageRecovery(context);
        if (a['dry-run']) {
            const preview = await recovery.preview({ after: a.after || null, limit: a.limit === undefined ? bounds.operations : Number(a.limit) });
            writePrivateJson(a.manifest, preview);
            report({ mode: 'dry-run', environment: a.environment, databaseFingerprint: identity.databaseFingerprint,
                storageFingerprint: identity.storageFingerprint, manifestDigest: preview.digest, operations: preview.operations.length,
                checks: preview.operations.map(op => ({ action: op.action, observed: op.observed })), hasMore: preview.nextCursor !== null });
            return 0;
        }
        const result = await recovery.apply(manifest, confirmations); report(Object.assign({ mode: 'apply' }, result));
        return result.results.some(row => row.status !== 'deleted') ? 2 : 0;
    } finally { if (recovery) recovery.close(); if (context) await context.close(); }
}
if (require.main === module) {
    const timer = setTimeout(() => { process.stderr.write('R2 photo recovery stopped: budget. Fresh approved preview required.\n'); process.exit(1); }, bounds.deadlineMs);
    run(process.argv.slice(2)).then(code => { process.exitCode = code; }, error => {
        const safe = ['unknown_write', 'authorization', 'target_missing', 'target_mismatch', 'integrity', 'timeout', 'provider', 'accounting', 'changed', 'budget'];
        process.stderr.write('R2 photo recovery refused: ' + (safe.includes(error.recoveryCategory) ? error.recoveryCategory : 'configuration_or_target') + '.\n'); process.exitCode = 1;
    }).finally(() => clearTimeout(timer));
}
module.exports = { parse, run };
