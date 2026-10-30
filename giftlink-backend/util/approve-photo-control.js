const { signChange, validateState, stateDigest, targetId } = require('../services/photo-control');
const { readPrivateJson, writePrivateJson } = require('./local-maintenance-receipt');
function run(args, report = v => process.stdout.write(JSON.stringify(v) + '\n'), env = process.env) {
    const allowed = ['snapshot', 'action', 'output', 'confirm-target', 'confirm-previous', 'confirm-revision', 'runtime-approval', 'runtime-key', 'recovery-approval', 'recovery-key'], a = {};
    for (let i = 0; i < args.length; i += 2) {
        const key = args[i].slice(2);
        if (!args[i].startsWith('--') || !allowed.includes(key) || a[key] !== undefined || !args[i + 1] || args[i + 1].startsWith('--')) throw Error('Explicit offline approval required.'); a[key] = args[i + 1];
    }
    if (!allowed.slice(0, 6).every(k => a[k]) || !/^[1-9][0-9]*$/.test(a['confirm-revision'])) throw Error('Explicit offline approval required.');
    const snapshot = readPrivateJson(a.snapshot);
    if (Object.keys(snapshot).sort().join(',') !== 'schemaVersion,state,target' || snapshot.schemaVersion !== 1 ||
        a['confirm-target'] !== targetId(snapshot.target) || a['confirm-previous'] !== (snapshot.state ? stateDigest(snapshot.state) : 'absent') ||
        Number(a['confirm-revision']) !== (snapshot.state ? snapshot.state.revision + 1 : 1)) throw Error('Offline target/revision mismatch.');
    const proof = role => ({ approval: readPrivateJson(a[role + '-approval'], 4096), key: a[role + '-key'] });
    const change = signChange({ snapshot: snapshot.state, target: snapshot.target, action: a.action, privateKey: env.PHOTO_CONTROL_OWNER_PRIVATE_KEY,
        runtime: a.action === 'initialize' || a.action === 'rotate-runtime' ? proof('runtime') : null,
        recovery: a.action === 'initialize' || a.action === 'rotate-recovery' ? proof('recovery') : null });
    validateState(change, snapshot.target, env.ITEM_IMAGE_CONTROL_OWNER_PUBLIC_KEY);
    writePrivateJson(a.output, change);
    report({ mode: 'offline-control-approval', target: targetId(change.target), change: stateDigest(change), previous: change.previousDigest || 'absent', revision: change.revision }); return 0;
}
if (require.main === module) {
    try { process.exitCode = run(process.argv.slice(2)); }
    catch (error) { process.stderr.write('Offline photo control approval refused: target_signature_or_confirmation.\n'); process.exitCode = 1; }
}
module.exports = { run };
