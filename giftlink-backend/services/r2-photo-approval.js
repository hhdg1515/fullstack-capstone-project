const { createHash, createPublicKey, createPrivateKey, sign, verify, randomUUID } = require('node:crypto');
const { readPrivateJson } = require('../util/local-maintenance-receipt');
const { storageError } = require('./item-image-storage-error');
const hash = value => createHash('sha256').update(value).digest('hex');
const fail = () => { throw storageError('configuration', 'approve', 'not_attempted'); };
const fields = ['schemaVersion', 'approvalId', 'role', 'environment', 'database', 'databaseFingerprint',
    'storageFingerprint', 'credentialsFingerprint', 'issuedAt', 'expiresAt'];
const canonical = value => Buffer.from(JSON.stringify(fields.map(key => [key, value[key]])));
const validHash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
function publicKey(value) {
    try {
        if (typeof value !== 'string' || !/^302a300506032b6570032100[a-f0-9]{64}$/.test(value)) fail();
        const key = createPublicKey({ key: Buffer.from(value, 'hex'), format: 'der', type: 'spki' });
        if (key.asymmetricKeyType !== 'ed25519') fail(); return key;
    } catch (error) { return fail(); }
}
function validate(value, time) {
    if (!value || Object.getPrototypeOf(value) !== Object.prototype || !fields.filter(key => key !== 'schemaVersion').every(key => typeof value[key] === 'string') || Object.keys(value).sort().join(',') !== fields.concat('signature').sort().join(',') || value.schemaVersion !== 1 ||
        !require('./item-image-policy').uuid(value.approvalId) || !['runtime', 'recovery'].includes(value.role) ||
        !['staging', 'production'].includes(value.environment) || !/^[A-Za-z0-9_-]{1,63}$/.test(value.database) ||
        ['admin', 'config', 'local'].includes(value.database.toLowerCase()) ||
        !['databaseFingerprint', 'storageFingerprint', 'credentialsFingerprint'].every(key => validHash(value[key])) ||
        typeof value.signature !== 'string' || !/^[a-f0-9]{128}$/.test(value.signature)) fail();
    const start = Date.parse(value.issuedAt), end = Date.parse(value.expiresAt);
    if (!Number.isFinite(start) || !Number.isFinite(end) || new Date(start).toISOString() !== value.issuedAt ||
        new Date(end).toISOString() !== value.expiresAt || start > time || end <= time || end - start > 86400000 || end <= start) fail();
}
function verifyApproval(value, expected, verificationKey, time = Date.now()) {
    validate(value, time);
    if (!Object.keys(expected).every(key => fields.includes(key) && value[key] === expected[key]) ||
        !verify(null, canonical(value), publicKey(verificationKey), Buffer.from(value.signature, 'hex'))) fail();
    return value;
}
function readApproval(file, expected, verificationKey) {
    try { return Object.freeze(verifyApproval(readPrivateJson(file, 4096), expected, verificationKey)); }
    catch (error) { return fail(); }
}
// Offline owner operation. Private signing key never enters the runtime config.
function signApproval(identity, privateKeyHex, minutes = 60) {
    if (!Number.isInteger(minutes) || minutes < 1 || minutes > 1440) fail();
    let key;
    try {
        if (typeof privateKeyHex !== 'string' || !/^302e020100300506032b657004220420[a-f0-9]{64}$/.test(privateKeyHex)) fail();
        key = createPrivateKey({ key: Buffer.from(privateKeyHex, 'hex'), format: 'der', type: 'pkcs8' });
    } catch (error) { return fail(); }
    const at = Date.now(), value = Object.assign({}, identity, { schemaVersion: 1, approvalId: randomUUID(),
        issuedAt: new Date(at).toISOString(), expiresAt: new Date(at + minutes * 60000).toISOString() });
    value.signature = sign(null, canonical(value), key).toString('hex');
    validate(value, at); return value;
}
module.exports = { hash, publicKey, readApproval, verifyApproval, signApproval };
