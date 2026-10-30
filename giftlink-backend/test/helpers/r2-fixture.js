const assert = require('node:assert/strict');
const { randomBytes, generateKeyPairSync, createHmac, createHash } = require('node:crypto');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { NodeHttpHandler } = require('@smithy/node-http-handler');
const { targetIdentity, fingerprint, approvalIdentity } = require('../../services/r2-image-storage-config');
const { signApproval } = require('../../services/r2-photo-approval');
const { storageBinding } = require('../../services/item-image-storage-config');
const { readPreparationTarget, inspectTarget } = require('../../util/database-target');

async function r2Environment({ mongo, fixture, role = 'runtime' } = {}) {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'moveout-r2-synthetic-'));
    const keys = generateKeyPairSync('ed25519'), run = fixture ? fixture.receipt.runId : randomBytes(16).toString('hex');
    const env = { ITEM_IMAGE_R2_ENABLED: 'true', ITEM_IMAGE_R2_ENVIRONMENT: 'staging', DB_ENVIRONMENT: 'staging',
        MONGO_DB_NAME: mongo ? mongo.dbName : 'giftdb_test_synthetic', MONGO_URL: mongo ? mongo.mongoUrl : 'mongodb://127.0.0.1:1',
        ITEM_IMAGE_R2_ACCOUNT_ID: 'a'.repeat(32), ITEM_IMAGE_R2_ENDPOINT: 'https://' + 'a'.repeat(32) + '.r2.cloudflarestorage.com',
        ITEM_IMAGE_R2_REGION: 'auto', ITEM_IMAGE_R2_BUCKET: fixture ? fixture.receipt.bucket : 'synthetic-photo-test',
        ITEM_IMAGE_R2_NAMESPACE: 'item-images-staging-' + run, ITEM_IMAGE_R2_ROLE: role,
        ITEM_IMAGE_R2_ACCESS_KEY_ID: randomBytes(16).toString('hex'), ITEM_IMAGE_R2_SECRET_ACCESS_KEY: randomBytes(32).toString('hex'),
        ITEM_IMAGE_R2_DATABASE_TARGET: 'b'.repeat(64), ITEM_IMAGE_R2_UPLOADS_ENABLED: role === 'runtime' ? 'true' : 'false',
        ITEM_IMAGE_R2_APPROVAL_FILE: path.join(directory, 'approval.json'), ITEM_IMAGE_METADATA_ENABLED: 'true',
        ITEM_IMAGE_R2_APPROVAL_PUBLIC_KEY: keys.publicKey.export({ format: 'der', type: 'spki' }).toString('hex') };
    if (mongo) env.ITEM_IMAGE_R2_DATABASE_TARGET = (await inspectTarget(mongo.db, await readPreparationTarget(env, false))).fingerprint;
    env.ITEM_IMAGE_R2_TARGET = fingerprint(targetIdentity(env));
    env.ITEM_IMAGE_STORAGE_TARGET = env.ITEM_IMAGE_R2_TARGET; env.ITEM_IMAGE_NAMESPACE = env.ITEM_IMAGE_R2_NAMESPACE;
    const privateKey = keys.privateKey.export({ format: 'der', type: 'pkcs8' }).toString('hex');
    const approve = () => {
        const approval = signApproval(approvalIdentity(env), privateKey);
        fs.writeFileSync(env.ITEM_IMAGE_R2_APPROVAL_FILE, JSON.stringify(approval), { mode: 0o600 }); return approval;
    };
    const approval = approve();
    return { env, approval, approve, privateKey, directory, close: () => fs.rmSync(directory, { recursive: true, force: true }) };
}
const hash = value => createHash('sha256').update(value).digest('hex');
const hmac = (key, value) => createHmac('sha256', key).update(value).digest();

// Test-only bridge: validates the synthetic R2 wire request, then re-signs it
// for the *live receipt-verified loopback fixture*, mapping its owned namespace.
// It cannot contact R2. This does NOT verify Cloudflare TLS/auth/region behavior.
function seaweedR2Bridge(fixture, env) {
    const local = storageBinding(fixture.config), requests = [];
    const transport = new NodeHttpHandler({ connectionTimeout: 500, requestTimeout: 5000, throwOnRequestTimeout: true, socketTimeout: 5000 });
    const bridge = { requests, destroy: () => transport.destroy(), next: null, handle: async (request, context) => {
        assert.ok(request.hostname === 'a'.repeat(32) + '.r2.cloudflarestorage.com' && request.protocol === 'https:' && request.port === undefined);
        assert.ok(request.path.startsWith('/' + fixture.receipt.bucket + '/' + env.ITEM_IMAGE_R2_NAMESPACE + '/'));
        assert.ok(request.headers.authorization.includes('/auto/s3/aws4_request'));
        assert.ok(request.headers.authorization.includes(env.ITEM_IMAGE_R2_ACCESS_KEY_ID));
        requests.push({ method: request.method, path: request.path });
        await fixture.verify();
        const send = async () => {
            const headers = Object.assign({}, request.headers, { host: '127.0.0.1:' + fixture.receipt.port }); delete headers.authorization;
            const targetPath = request.path.replace('/' + env.ITEM_IMAGE_R2_NAMESPACE + '/', '/' + fixture.receipt.namespace + '/');
            const date = headers['x-amz-date'].slice(0, 8), scope = date + '/us-east-1/s3/aws4_request';
            const names = Object.keys(headers).map(name => name.toLowerCase()).sort();
            const canonicalHeaders = names.map(name => name + ':' + String(headers[name]).trim().replace(/\s+/g, ' ') + '\n').join('');
            const query = Object.entries(request.query || {}).sort().map(([key, value]) => encodeURIComponent(key) + '=' + encodeURIComponent(value)).join('&');
            const canonical = [request.method, targetPath, query, canonicalHeaders, names.join(';'), headers['x-amz-content-sha256']].join('\n');
            const key = hmac(hmac(hmac(hmac('AWS4' + local.credentials.secretAccessKey, date), 'us-east-1'), 's3'), 'aws4_request');
            const signature = hmac(key, ['AWS4-HMAC-SHA256', headers['x-amz-date'], scope, hash(canonical)].join('\n')).toString('hex');
            headers.authorization = 'AWS4-HMAC-SHA256 Credential=' + local.credentials.accessKeyId + '/' + scope + ', SignedHeaders=' + names.join(';') + ', Signature=' + signature;
            return transport.handle(Object.assign({}, request, { protocol: 'http:', hostname: '127.0.0.1', port: fixture.receipt.port, path: targetPath, headers }), context);
        };
        return bridge.next ? bridge.next(request, context, send) : send();
    } };
    return bridge;
}
function blockProviderNetwork() {
    const http = require('node:http'), https = require('node:https');
    let originalHttp, originalHttps, refused = 0;
    before(function () {
        originalHttp = http.request; originalHttps = https.request;
        https.request = () => { refused++; throw Error('Provider HTTPS is prohibited in isolated F1 tests.'); };
        http.request = function (value, ...rest) {
            const options = typeof value === 'string' ? new URL(value) : value;
            if (!['127.0.0.1', '::1', '[::1]'].includes(options.hostname || options.host)) {
                refused++; throw Error('Nonloopback HTTP is prohibited in isolated F1 tests.');
            }
            return originalHttp.call(this, value, ...rest);
        };
    });
    after(function () { http.request = originalHttp; https.request = originalHttps; assert.equal(refused, 0, 'No real provider connection may even be attempted'); });
}
module.exports = { r2Environment, seaweedR2Bridge, blockProviderNetwork };
