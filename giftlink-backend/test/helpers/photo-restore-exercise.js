const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { randomUUID, generateKeyPairSync } = require('node:crypto');
const { digest } = require('../../services/item-image-recovery');
const { readPrivateJson, writePrivateJson } = require('../../util/local-maintenance-receipt');
const { openLocalMaintenance } = require('../../util/local-image-maintenance');
const { createLocalControlOperator } = require('../../util/local-photo-control');
const { r2Environment } = require('./r2-fixture');
const controls = require('../../services/photo-control'), restore = require('./local-photo-restore');
const { createProcessRegistry } = require('./restore-processes');
async function createRestoreExercise(mongo, fixture) {
    const localTarget = { mongoReceiptPath: mongo.receiptPath, storageReceiptPath: fixture.receiptPath, databaseName: mongo.dbName,
        environment: 'development', provider: 'seaweedfs-local', bucket: fixture.receipt.bucket, namespace: fixture.receipt.namespace };
    const local = await openLocalMaintenance(localTarget), directory = fs.mkdtempSync(path.join(os.tmpdir(), 'moveout-disaster-'));
    const processes = createProcessRegistry(directory), files = new WeakMap(), envs = [];
    const keys = generateKeyPairSync('ed25519'), ownerPublic = keys.publicKey.export({ format: 'der', type: 'spki' }).toString('hex'),
        ownerPrivate = keys.privateKey.export({ format: 'der', type: 'pkcs8' }).toString('hex');
    const operator = await createLocalControlOperator(local, ownerPublic);
    const fresh = async role => { const source = await r2Environment({ mongo, fixture, role }); envs.push(source); return source; };
    let runtime = await fresh('runtime'), recovery = await fresh('recovery'), policy, phase = 'normal', restoredAt = Infinity;
    const proof = s => ({ approval: readPrivateJson(s.env.ITEM_IMAGE_R2_APPROVAL_FILE), key: s.env.ITEM_IMAGE_R2_APPROVAL_PUBLIC_KEY });
    async function change(action, r = runtime, c = recovery) {
        const before = (await operator.preview()).state, next = controls.signChange({ snapshot: before, target: operator.identity, action,
            runtime: proof(r), recovery: proof(c), privateKey: ownerPrivate });
        await operator.apply(next, { target: controls.targetId(next.target), change: controls.stateDigest(next), previous: next.previousDigest || 'absent', revision: next.revision }); policy = next; return next;
    }
    await change('initialize'); await change('resume');
    function settings(source) { return Object.assign({}, source.env, { ITEM_IMAGE_DISTRIBUTED_CONTROL_ENABLED: 'true', ITEM_IMAGE_CONTROL_OWNER_PUBLIC_KEY: ownerPublic,
        ITEM_IMAGE_CONTROL_ID: policy.controlId, ITEM_IMAGE_CONTROL_MIN_REVISION: String(policy.revision) }); }
    function save(v) { const file = path.join(directory, randomUUID() + '.json'); writePrivateJson(file, v); files.set(v, file); return v; }
    function file(v) { if (!files.has(v)) throw Error('Owned backup required'); return files.get(v); }
    async function quarantine() { phase = 'quarantine'; await processes.stop(); if (!processes.stopped()) throw Error('Quiescence refused'); }
    async function inspect(checkpoint) {
        file(checkpoint); const current = await restore.databaseSnapshot(local), objects = await restore.objectSnapshot(local, [current, checkpoint]);
        const report = Object.assign(restore.assess(local, current, objects, checkpoint, ownerPublic),
            { dataDigest: digest(current.data), objectsDigest: digest(objects.entries), checkpointDigest: checkpoint.digest });
        report.digest = digest(report); return report;
    }
    async function photo(source = runtime) {
        if (phase === 'quarantine') throw Error('Full photo outage');
        const env = settings(source); if (phase === 'read-only') env.ITEM_IMAGE_R2_UPLOADS_ENABLED = 'false';
        return processes.launch('distributed-photo-worker.js', { local: localTarget, env });
    }
    async function accept(checkpoint, report, confirmation, nextRuntime, nextRecovery) {
        if (phase !== 'quarantine' || !processes.stopped() || !report.consistentWithinInventory ||
            confirmation.target !== digest(local.identity) || confirmation.report !== report.digest ||
            (await inspect(checkpoint)).digest !== report.digest || [nextRuntime, nextRecovery].some(s => Date.parse(proof(s).approval.issuedAt) <= restoredAt)) throw Error('Independent reauthorization refused');
        // Fresh F1 approvals must actually be installed by separately owner-signed F4 changes.
        for (const [role, source] of [['runtime', nextRuntime], ['recovery', nextRecovery]]) {
            const row = (await operator.preview()).state;
            if (!row[role].enabled || row[role].approvalDigest !== digest(proof(source).approval) || row.uploadAdmission) throw Error('Fresh paused grants required');
        }
        runtime = nextRuntime; recovery = nextRecovery; phase = 'read-only';
    }
    return { local, localTarget, operator, ownerPublic, processes, fresh, settings, change, inspect, photo, quarantine, accept,
        runtime: () => runtime, recovery: () => recovery, phase: () => phase,
        captureDatabase: async () => save(await restore.databaseSnapshot(local)),
        captureObjects: async snapshots => save(await restore.objectSnapshot(local, snapshots)),
        plan: async (snapshot, inventories = []) => save(await restore.previewRestore(local, snapshot, inventories)),
        execute: async (snapshot, plan, confirmation, inventories = [], crashAfterCommit = false) => {
            if (phase !== 'quarantine' || !processes.stopped()) throw Error('Full quiescence required');
            const worker = await processes.launch('photo-restore-worker.js', { local: localTarget, mode: 'restore', snapshot: file(snapshot), plan: file(plan),
                inventories: inventories.map(file), confirmTarget: confirmation.target, confirmPlan: confirmation.plan,
                quarantine: 'all-managed-processes-stopped', crashAfterCommit });
            restoredAt = Date.now(); worker.child.send({ type: 'execute' });
            if (crashAfterCommit) { await worker.take('after_commit'); await worker.kill(); return { status: 'response_lost_inspect_required' }; }
            try { return (await worker.take('restored')).result; } finally { await worker.stop(); }
        },
        text: async checkpoint => {
            if (phase !== 'quarantine') throw Error('Quarantine profile only');
            const report = await inspect(checkpoint);
            return processes.launch('photo-restore-worker.js', { local: localTarget, mode: report.findings.some(f => ['item_visibility_checkpoint_changed', 'private_history_checkpoint_changed', 'ownership_conflict'].includes(f)) ? 'locked-maintenance' : report.authSafe ? 'text-quarantine' : 'anonymous-maintenance' });
        },
        recover: async source => {
            if (phase !== 'normal' && Date.parse(proof(source).approval.issuedAt) <= restoredAt) throw Error('Fresh recovery authorization required');
            return processes.launch('distributed-photo-worker.js', { local: localTarget, env: settings(source) });
        },
        close: async () => { await processes.stop(); await local.close(); for (const e of envs) e.close(); fs.rmSync(directory, { recursive: true }); }
    };
}
module.exports = { createRestoreExercise };
