const { openLocalMaintenance, isLocalMaintenance } = require('./local-image-maintenance');
const { validOperation } = require('../services/item-image-policy');
const { assertDatabaseIndexes } = require('../services/database-indexes');
const { bounds } = require('../services/item-image-recovery');
function refusal(category) { const error = Error('Local photo summary refused.'); error.summaryCategory = category; throw error; }
async function summarize(context, limit = bounds.operations) {
    if (!isLocalMaintenance(context)) refusal('local_target_required');
    if (!Number.isInteger(limit) || limit < 1 || limit > bounds.operations) refusal('invalid_limit');
    await context.verifyDatabase();
    await assertDatabaseIndexes(context.db, { imageMetadataEnabled: true });
    const stamp = await context.db.aggregate([{ $documents: [{}] }, { $project: { _id: 0, now: '$$NOW' } }], { maxTimeMS: 2000 }).next();
    if (!stamp || !(stamp.now instanceof Date)) refusal('database_clock_invalid');
    // Existing partial index: bounded oldest-work page, never a global count or
    // account scan. Inspection performs no object GET/PUT/DELETE or ledger repair.
    const rows = await context.db.collection('itemImages').find({ needsMaintenance: true }, { maxTimeMS: 2000, collation: { locale: 'simple' } })
        .sort({ maintenanceDueAt: 1, _id: 1 }).hint({ maintenanceDueAt: 1, _id: 1 }).limit(limit + 1).toArray();
    const selected = rows.slice(0, limit), counts = { due: 0, future: 0, activeProducerLease: 0, activeRecoveryLease: 0,
        unknownWriteOperations: 0, unsettledOperations: 0, exhaustedCleanup: 0, backoff: 0 };
    const states = { reserved: 0, processing: 0, ready: 0, failed: 0, delete_pending: 0, deleted: 0 };
    for (const row of selected) {
        if (!validOperation(row)) refusal('operation_integrity');
        if (row.storageBinding.fingerprint !== context.identity.storageFingerprint || row.storageBinding.namespace !== context.identity.namespace) refusal('storage_target_mismatch');
        states[row.state]++;
        counts[row.maintenanceDueAt <= stamp.now ? 'due' : 'future']++;
        counts.activeProducerLease += Number(['reserved', 'processing'].includes(row.state) && row.lease.expiresAt > stamp.now);
        counts.activeRecoveryLease += Number(Boolean(row.cleanup.recovery && row.cleanup.recovery.status === 'leased' && row.cleanup.recovery.expiresAt > stamp.now));
        counts.unknownWriteOperations += Number(['thumbnail', 'display'].some(name => row.variants[name].outcome === 'unknown'));
        counts.unsettledOperations += Number(!row.charge.holdsSettled);
        counts.exhaustedCleanup += Number(row.cleanup.attempts >= bounds.attempts);
        counts.backoff += Number(Boolean(row.cleanup.nextAttemptAt && row.cleanup.nextAttemptAt > stamp.now));
    }
    await context.verifyDatabase();
    return { mode: 'local-read-only', scope: 'oldest-maintenance-page-not-global-totals',
        databaseFingerprint: context.identity.databaseFingerprint, storageFingerprint: context.identity.storageFingerprint,
        inspected: selected.length, limit, hasMore: rows.length > limit, counts, states,
        settlementVerified: false, objectPresenceVerified: false,
        next: 'Use a fresh guarded recovery dry-run for object and exact-ledger evidence. Never refund from this summary.' };
}
function parse(args) {
    const required = ['mongo-receipt', 'storage-receipt', 'database', 'environment', 'provider', 'bucket', 'namespace'], values = {};
    if (args[0] !== '--local') refusal('local_arguments_required');
    for (let i = 1; i < args.length; i += 2) {
        const key = args[i].slice(2);
        if (!args[i].startsWith('--') || !required.concat('limit').includes(key) || values[key] !== undefined || !args[i + 1] || args[i + 1].startsWith('--')) refusal('local_arguments_required');
        values[key] = args[i + 1];
    }
    if (!required.every(k => values[k]) || values.environment !== 'development' || values.provider !== 'seaweedfs-local' ||
        values.limit !== undefined && (!/^[1-9][0-9]*$/.test(values.limit) || Number(values.limit) > bounds.operations)) refusal('local_arguments_required');
    return values;
}
async function run(args, report = value => process.stdout.write(JSON.stringify(value) + '\n')) {
    const a = parse(args); let context;
    try {
        context = await openLocalMaintenance({ mongoReceiptPath: a['mongo-receipt'], storageReceiptPath: a['storage-receipt'],
            databaseName: a.database, environment: a.environment, provider: a.provider, bucket: a.bucket, namespace: a.namespace });
        report(await summarize(context, a.limit === undefined ? bounds.operations : Number(a.limit))); return 0;
    } finally { if (context) await context.close(); }
}
if (require.main === module) {
    const timer = setTimeout(() => { process.stderr.write('Local photo summary stopped: budget.\n'); process.exit(1); }, 30000);
    run(process.argv.slice(2)).then(code => { process.exitCode = code; }, error => {
        const safe = ['local_target_required', 'invalid_limit', 'database_clock_invalid', 'operation_integrity', 'storage_target_mismatch', 'local_arguments_required'];
        process.stderr.write('Local photo summary refused: ' + (safe.includes(error.summaryCategory) ? error.summaryCategory : 'local_identity_or_indexes') + '.\n'); process.exitCode = 1;
    }).finally(() => clearTimeout(timer));
}
module.exports = { parse, summarize, run };
