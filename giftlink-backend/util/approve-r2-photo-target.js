const { approvalIdentity } = require('../services/r2-image-storage-config');
const { signApproval } = require('../services/r2-photo-approval');
const { writePrivateJson } = require('./local-maintenance-receipt');
function parse(args) {
    const allowed = ['output', 'minutes', 'confirm-environment', 'confirm-role', 'confirm-storage-target', 'confirm-database-target'];
    const result = {};
    for (let i = 0; i < args.length; i += 2) {
        const name = args[i].slice(2);
        if (!args[i].startsWith('--') || !allowed.includes(name) || result[name] !== undefined || !args[i + 1] || args[i + 1].startsWith('--')) throw Error('Invalid approval arguments.');
        result[name] = args[i + 1];
    }
    if (!allowed.filter(name => name !== 'minutes').every(name => result[name]) || result.minutes !== undefined && !/^[1-9][0-9]{0,3}$/.test(result.minutes)) throw Error('Explicit offline target approval required.');
    return result;
}
function run(args, report = value => process.stdout.write(JSON.stringify(value) + '\n'), env = process.env) {
    const a = parse(args), identity = approvalIdentity(env);
    if (a['confirm-environment'] !== identity.environment || a['confirm-role'] !== identity.role ||
        a['confirm-storage-target'] !== identity.storageFingerprint || a['confirm-database-target'] !== identity.databaseFingerprint) throw Error('Approval target mismatch.');
    const receipt = signApproval(identity, env.PHOTO_APPROVAL_PRIVATE_KEY, a.minutes === undefined ? 60 : Number(a.minutes));
    writePrivateJson(a.output, receipt);
    report({ mode: 'offline-approval', role: identity.role, environment: identity.environment, expiresAt: receipt.expiresAt });
    return 0;
}
if (require.main === module) {
    try { process.exitCode = run(process.argv.slice(2)); }
    catch (error) { process.stderr.write('R2 photo approval refused: configuration_or_confirmation.\n'); process.exitCode = 1; }
}
module.exports = { parse, run };
