// Offline only: no clients, DNS, provider inspection or .env loading.
const { targetIdentity, fingerprint, approvalIdentity, readR2ImageStorageConfig } = require('../services/r2-image-storage-config');
const { verifyApproval, publicKey } = require('../services/r2-photo-approval');
const { readPrivateJson } = require('./local-maintenance-receipt');
const { readImageMetadataConfig, uuid } = require('../services/item-image-policy');

function receiptCheck(env, expected, time = Date.now()) {
    let receipt;
    try { publicKey(env.ITEM_IMAGE_R2_APPROVAL_PUBLIC_KEY); }
    catch (error) { return { status: 'failed', category: 'verification_key_invalid' }; }
    try { receipt = readPrivateJson(env.ITEM_IMAGE_R2_APPROVAL_FILE, 4096); }
    catch (error) { return { status: 'failed', category: 'receipt_unreadable' }; }
    try {
        verifyApproval(receipt, expected, env.ITEM_IMAGE_R2_APPROVAL_PUBLIC_KEY, time);
        return { status: 'passed', category: 'receipt_valid', role: receipt.role, environment: receipt.environment,
            expiresAt: receipt.expiresAt, remainingSeconds: Math.floor((Date.parse(receipt.expiresAt) - time) / 1000) };
    } catch (error) {
        // Only report dates as authoritative after validating the signature and
        // exact schema/identity at its issue time. Never print untrusted fields.
        try {
            verifyApproval(receipt, expected, env.ITEM_IMAGE_R2_APPROVAL_PUBLIC_KEY, Date.parse(receipt.issuedAt));
            return { status: 'failed', category: Date.parse(receipt.issuedAt) > time ? 'receipt_not_yet_valid' : 'receipt_expired' };
        } catch (ignored) {
            return { status: 'failed', category: 'receipt_identity_or_signature_invalid' };
        }
    }
}
function inspect(env = process.env) {
    const checks = [], fingerprints = {};
    const check = (name, status, category) => checks.push({ name, status, category });
    check('node_runtime', process.versions.node.split('.')[0] === '22' ? 'passed' : 'failed', 'node_22_required');
    let native;
    try { const versions = require('sharp').versions; native = { sharp: versions.sharp, vips: versions.vips }; check('sharp_load', 'passed', 'native_module_loaded'); }
    catch (error) { check('sharp_load', 'failed', 'native_module_unavailable'); }
    if (env.PHOTO_APPROVAL_PRIVATE_KEY !== undefined || env.PHOTO_CONTROL_OWNER_PRIVATE_KEY !== undefined) check('signing_key_custody', 'failed', 'offline_signing_key_must_not_be_in_runtime_configuration');
    for (const name of ['ITEM_IMAGE_METADATA_ENABLED', 'ITEM_IMAGE_PIPELINE_ENABLED', 'ITEM_IMAGES_ENABLED', 'ITEM_IMAGE_R2_ENABLED', 'ITEM_IMAGE_R2_UPLOADS_ENABLED', 'ITEM_IMAGE_DISTRIBUTED_CONTROL_ENABLED']) {
        if (![undefined, 'false', 'true'].includes(env[name])) check(name.toLowerCase(), 'failed', 'invalid_boolean');
    }
    let metadata;
    try { metadata = readImageMetadataConfig(env); check('metadata_configuration', 'passed', metadata ? 'configured' : 'disabled'); }
    catch (error) { check('metadata_configuration', 'failed', 'metadata_binding_or_limits_invalid'); }
    if (env.ITEM_IMAGE_R2_ENABLED === 'true') {
        let expected;
        try {
            const target = targetIdentity(env); fingerprints.storage = fingerprint(target);
            if (fingerprints.storage !== env.ITEM_IMAGE_R2_TARGET) throw Error();
            check('storage_target', 'passed', 'offline_fingerprint_matches');
        } catch (error) { check('storage_target', 'failed', 'storage_identity_or_confirmation_invalid'); }
        try { expected = approvalIdentity(env); fingerprints.database = expected.databaseFingerprint; check('credential_target_binding', 'passed', 'offline_shape_valid'); }
        catch (error) { check('credential_target_binding', 'failed', 'credentials_role_or_target_invalid'); }
        if (expected) checks.push(Object.assign({ name: 'approval_receipt' }, receiptCheck(env, expected)));
        try { readR2ImageStorageConfig(env); check('authoritative_r2_configuration', 'passed', 'existing_validator_accepts'); }
        catch (error) { check('authoritative_r2_configuration', 'failed', 'existing_r2_validator_refused'); }
        if (!metadata || metadata.storageBinding.fingerprint !== fingerprints.storage || metadata.storageBinding.namespace !== env.ITEM_IMAGE_R2_NAMESPACE) {
            check('metadata_target_binding', 'failed', 'metadata_target_mismatch');
        } else check('metadata_target_binding', 'passed', 'offline_binding_matches');
        if (env.ITEM_IMAGES_ENABLED === 'true') check('local_remote_separation', 'failed', 'local_and_r2_configuration_mixed');
    } else check('r2_candidate', 'not_configured', 'disabled');
    if (env.ITEM_IMAGE_DISTRIBUTED_CONTROL_ENABLED === 'true') {
        try {
            publicKey(env.ITEM_IMAGE_CONTROL_OWNER_PUBLIC_KEY);
            if (env.ITEM_IMAGE_R2_ENABLED !== 'true' || env.ITEM_IMAGE_CONTROL_OWNER_PUBLIC_KEY === env.ITEM_IMAGE_R2_APPROVAL_PUBLIC_KEY ||
                !uuid(env.ITEM_IMAGE_CONTROL_ID) || !/^[1-9][0-9]*$/.test(env.ITEM_IMAGE_CONTROL_MIN_REVISION || '') ||
                !Number.isSafeInteger(Number(env.ITEM_IMAGE_CONTROL_MIN_REVISION))) throw Error();
            check('distributed_control_configuration', 'passed', 'offline_shape_only');
        } catch (error) { check('distributed_control_configuration', 'failed', 'control_owner_id_or_checkpoint_invalid'); }
    }
    // A copy/paste mistake must not turn an expected fingerprint into a printed
    // credential. Even otherwise correctly signed candidate settings are inputs.
    const secrets = [env.ITEM_IMAGE_R2_ACCESS_KEY_ID, env.ITEM_IMAGE_R2_SECRET_ACCESS_KEY, env.PHOTO_APPROVAL_PRIVATE_KEY, env.PHOTO_CONTROL_OWNER_PRIVATE_KEY];
    for (const name of Object.keys(fingerprints)) if (secrets.includes(fingerprints[name])) {
        delete fingerprints[name]; check('fingerprint_output', 'failed', 'fingerprint_collides_with_sensitive_input');
    }
    return { mode: 'offline', configurationValid: !checks.some(c => c.status === 'failed'), hostedTrialReady: false,
        productionActivation: 'blocked_by_ordinary_startup_policy', fingerprints, runtime: { node: process.versions.node, native }, checks,
        unverified: ['database_connectivity_topology_indexes_and_fingerprint', 'live_control_state_revision_and_role_proofs', 'r2_iam_bucket_and_contracts', 'hosted_packaging_body_memory_and_cost',
            'fleet_admission_revocation_and_restore', 'physical_windows_and_ios'],
        next: 'Owner approval and a separately reviewed hosted trial are required; this command authorizes no network access or mutations.' };
}
function run(args, report = value => process.stdout.write(JSON.stringify(value) + '\n'), env = process.env) {
    if (args.length !== 1 || args[0] !== '--offline') throw Error('Use --offline only. No remote or apply mode exists.');
    const result = inspect(env); report(result); return result.configurationValid ? 0 : 1;
}
if (require.main === module) {
    try { process.exitCode = run(process.argv.slice(2)); }
    catch (error) { process.stderr.write('Photo preflight refused: offline_arguments_or_configuration.\n'); process.exitCode = 1; }
}
module.exports = { inspect, receiptCheck, run };
