const { openLocalMaintenance } = require('./local-image-maintenance');
const { readPrivateJson, writePrivateJson } = require('./local-maintenance-receipt');
const { createLocalImageRecovery, bounds } = require('../services/item-image-recovery');

function parse(args) {
    const allowed = ['mongo-receipt', 'storage-receipt', 'database', 'environment', 'provider', 'bucket', 'namespace', 'manifest',
        'confirm-database', 'confirm-environment', 'confirm-database-target', 'confirm-storage-target', 'confirm-provider', 'confirm-bucket', 'confirm-namespace', 'confirm-manifest', 'after', 'limit'];
    const result = {};
    for (let i = 0; i < args.length; i++) {
        const name = args[i].slice(2);
        if (!args[i].startsWith('--') || result[name] !== undefined) throw new Error('Invalid maintenance arguments.');
        if (['dry-run', 'apply'].includes(name)) result[name] = true;
        else {
            if (!allowed.includes(name) || !args[i + 1] || args[i + 1].startsWith('--')) throw new Error('Invalid maintenance arguments.');
            result[name] = args[++i];
        }
    }
    if (Boolean(result['dry-run']) === Boolean(result.apply) ||
        !['mongo-receipt', 'storage-receipt', 'database', 'environment', 'provider', 'bucket', 'namespace', 'manifest'].every(k => result[k]) ||
        result.environment !== 'development' || result.provider !== 'seaweedfs-local' ||
        result.limit !== undefined && (!/^[1-9][0-9]*$/.test(result.limit) || Number(result.limit) > bounds.operations) ||
        result.apply && (result.after !== undefined || result.limit !== undefined)) throw new Error('Use separate guarded local dry-run or apply arguments.');
    return result;
}
async function run(args, report = value => process.stdout.write(JSON.stringify(value) + '\n')) {
    const a = parse(args); let context, recovery;
    try {
        context = await openLocalMaintenance({ mongoReceiptPath: a['mongo-receipt'], storageReceiptPath: a['storage-receipt'],
            databaseName: a.database, environment: a.environment, provider: a.provider, bucket: a.bucket, namespace: a.namespace });
        recovery = createLocalImageRecovery(context);
        if (a['dry-run']) {
            const manifest = await recovery.preview({ after: a.after || null, limit: a.limit === undefined ? bounds.operations : Number(a.limit) });
            writePrivateJson(a.manifest, manifest);
            // Identities are nonsecret. The detailed private manifest stays on
            // disk; never print keys, input/output hashes, account IDs or bodies.
            report({ mode: 'dry-run', database: context.identity.database, environment: context.identity.environment,
                databaseFingerprint: context.identity.databaseFingerprint, provider: context.identity.provider,
                storageFingerprint: context.identity.storageFingerprint, bucket: context.identity.bucket, namespace: context.identity.namespace,
                manifestDigest: manifest.digest, operations: manifest.operations.length, checks: manifest.operations.map(op => ({ action: op.action, observed: op.observed })),
                nextCursor: manifest.nextCursor });
            return 0;
        }
        const manifest = readPrivateJson(a.manifest);
        const result = await recovery.apply(manifest, { database: a['confirm-database'], environment: a['confirm-environment'],
            databaseFingerprint: a['confirm-database-target'], storageFingerprint: a['confirm-storage-target'], provider: a['confirm-provider'],
            bucket: a['confirm-bucket'], namespace: a['confirm-namespace'], manifest: a['confirm-manifest'] });
        report(Object.assign({ mode: 'apply' }, result));
        return result.results.some(r => r.status !== 'deleted') ? 2 : 0;
    } finally { if (recovery) recovery.close(); if (context) await context.close(); }
}
if (require.main === module) {
    // Hard CLI lifetime bounds driver commit uncertainty too. Abrupt exit leaves
    // durable leases/journals and conservatively charged capacity for review.
    const deadline = setTimeout(() => { process.stderr.write('Photo recovery stopped: budget. Inspect durable state with a fresh dry-run.\n'); process.exit(1); }, bounds.deadlineMs);
    run(process.argv.slice(2)).then(code => { process.exitCode = code; }, error => {
        const safe = ['unknown_write', 'authorization', 'target_missing', 'target_mismatch', 'integrity', 'timeout', 'provider', 'accounting', 'changed', 'budget'];
        process.stderr.write('Photo recovery refused: ' + (safe.includes(error.recoveryCategory) ? error.recoveryCategory : 'configuration_or_local_identity') + '.\n');
        process.exitCode = 1;
    }).finally(() => clearTimeout(deadline));
}
module.exports = { parse, run };
