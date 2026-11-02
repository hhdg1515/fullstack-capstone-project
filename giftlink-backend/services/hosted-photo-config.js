// Hosted demo photos ("standing" approval). The deployment's own protected
// environment is the owner's approval: no daily signed approval file exists on a
// serverless host. The pinned endpoint and storage fingerprint are derived from
// the account, bucket and namespace; any explicit value must match exactly.
const { targetIdentity, fingerprint } = require('./r2-image-storage-config');
const standing = env => env.ITEM_IMAGE_R2_ENABLED === 'true' && env.ITEM_IMAGE_R2_APPROVAL_MODE === 'standing';
function hostedPhotoEnv(env) {
    if (!standing(env)) return env;
    const derived = Object.assign({}, env);
    if (derived.ITEM_IMAGE_R2_REGION === undefined) derived.ITEM_IMAGE_R2_REGION = 'auto';
    if (derived.ITEM_IMAGE_R2_ENDPOINT === undefined && typeof env.ITEM_IMAGE_R2_ACCOUNT_ID === 'string') {
        derived.ITEM_IMAGE_R2_ENDPOINT = 'https://' + env.ITEM_IMAGE_R2_ACCOUNT_ID + '.r2.cloudflarestorage.com';
    }
    const storage = fingerprint(targetIdentity(derived));
    for (const [key, value] of [['ITEM_IMAGE_R2_TARGET', storage], ['ITEM_IMAGE_STORAGE_TARGET', storage], ['ITEM_IMAGE_NAMESPACE', derived.ITEM_IMAGE_R2_NAMESPACE]]) {
        if (derived[key] === undefined) derived[key] = value;
        else if (derived[key] !== value) throw new Error('Hosted photo configuration does not match its derived storage target');
    }
    return derived;
}
module.exports = { hostedPhotoEnv, standing };
