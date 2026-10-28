/* jshint loopfunc: true */
const assert = require('node:assert/strict');
const { randomBytes, randomUUID, createHash } = require('node:crypto');
const { Readable } = require('node:stream');
const { execFileSync } = require('node:child_process');
const path = require('node:path');
const { readItemImageStorageConfig, fingerprint } = require('../services/item-image-storage-config');
const { createItemImageStorage } = require('../services/item-image-storage');
const { createIsolatedMinio, artifactReview } = require('./helpers/isolated-minio');

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const bytes = Buffer.from([0, 1, 255, 2, 0, 17, 33]); // Synthetic protocol bytes, not a decoded image.

function fixtureConfig(changes = {}) {
    const runId = randomBytes(16).toString('hex');
    const accessKeyId = 'test' + randomBytes(8).toString('hex');
    const secretAccessKey = randomBytes(32).toString('hex');
    const receipt = { version: 1, runId, containerId: randomBytes(32).toString('hex'),
        imageId: 'sha256:' + randomBytes(32).toString('hex'), containerName: 'moveout-seaweed-' + runId,
        volumeName: 'moveout-seaweed-' + runId, port: 19481, endpoint: 'http://127.0.0.1:19481',
        bucket: 'moveout-test-' + runId, namespace: 'item-images-test-' + runId,
        credentialsSha256: hash(accessKeyId + ':' + secretAccessKey) };
    const env = Object.assign({ ITEM_IMAGES_ENABLED: 'true', ITEM_IMAGE_STORAGE_DRIVER: 'seaweedfs-local',
        ITEM_IMAGE_STORAGE_ENVIRONMENT: 'test', ITEM_IMAGE_S3_REGION: 'us-east-1',
        ITEM_IMAGE_S3_ENDPOINT: receipt.endpoint, ITEM_IMAGE_S3_BUCKET: receipt.bucket,
        ITEM_IMAGE_NAMESPACE: receipt.namespace, ITEM_IMAGE_STORAGE_TARGET: fingerprint(receipt),
        ITEM_IMAGE_S3_ACCESS_KEY_ID: accessKeyId, ITEM_IMAGE_S3_SECRET_ACCESS_KEY: secretAccessKey }, changes);
    // These receipts/verifiers are test doubles, never authority for real Docker/network I/O.
    const target = { receipt, verify: async () => true };
    const key = receipt.namespace + '/' + randomBytes(12).toString('hex') + '/' + randomUUID() + '/display.webp';
    return { env, target, receipt, key };
}

// Exercises the actual pinned SDK's serialization/deserialization against a synthetic
// in-process transport. This is not a storage server; actual SeaweedFS contracts run in a separate suite.
class ProtocolTransport {
    constructor() { this.requests = []; this.objects = new Map(); this.closed = 0; }
    async handle(request, context) {
        this.requests.push(request);
        if (this.next) return this.next(request, context);
        const key = request.path;
        const object = this.objects.get(key);
        if (request.method === 'PUT') {
            if (object) return this.failure(412, 'PreconditionFailed');
            this.objects.set(key, { bytes: Buffer.from(request.body), headers: {
                'content-length': String(request.body.length), 'content-type': request.headers['content-type'],
                'cache-control': request.headers['cache-control'], 'x-amz-meta-sha256': request.headers['x-amz-meta-sha256'] } });
            return this.response(200);
        }
        if (request.method === 'DELETE') { this.objects.delete(key); return this.response(204); }
        if (!object) return request.method === 'HEAD' ? this.response(404) : this.failure(404, 'NoSuchKey');
        return this.response(200, object.headers, request.method === 'HEAD' ? Buffer.alloc(0) : object.bytes);
    }
    response(statusCode, headers = {}, body = Buffer.alloc(0)) {
        return { response: { statusCode, headers, body: Readable.from([body]) } };
    }
    failure(statusCode, code) {
        return this.response(statusCode, { 'content-type': 'application/xml' },
            Buffer.from('<Error><Code>' + code + '</Code><Message>private-provider-body</Message></Error>'));
    }
    destroy() { this.closed++; }
}

function category(name, outcome) {
    return error => {
        assert.equal(error.name, 'ItemImageStorageError');
        assert.equal(error.category, name);
        if (outcome) assert.equal(error.outcome, outcome);
        assert.ok(!String(error.stack).includes('private-provider'));
        assert.equal(error.cause, undefined);
        return true;
    };
}

describe('private storage configuration and disabled boundary (no network)', function () {
    it('has no import/startup I/O, credentials lookup or SDK construction when disabled', async function () {
        const script = `
            const assert = require('node:assert/strict');
            const Module = require('node:module');
            const load = Module._load;
            Module._load = function (name) {
                if (name.startsWith('@aws-sdk/') || name.startsWith('@smithy/')) throw Error('SDK loaded while disabled');
                return load.apply(this, arguments);
            };
            const config = require('./services/item-image-storage-config').readItemImageStorageConfig({
                ITEM_IMAGE_S3_ENDPOINT: 'https://must-not-contact.invalid', AWS_ACCESS_KEY_ID: 'private-provider-key'
            });
            const storage = require('./services/item-image-storage').createItemImageStorage(config);
            storage.headVariant({}).then(() => process.exit(2), error => {
                assert.equal(error.category, 'disabled'); storage.close();
            });
        `;
        execFileSync(process.execPath, ['-e', script], { cwd: path.resolve(__dirname, '..'), timeout: 5000 });
        const storage = createItemImageStorage(readItemImageStorageConfig({ ITEM_IMAGES_ENABLED: 'false' }));
        for (const method of ['putVariant', 'getVariant', 'headVariant', 'deleteVariant']) {
            await assert.rejects(storage[method]({}), category('disabled', 'not_attempted'));
        }
        storage.close();
    });
    it('requires a trusted live storage verifier independently of MongoDB or a receipt', function () {
        const f = fixtureConfig({ MONGO_URL: 'mongodb://127.0.0.1:27017', DB_ENVIRONMENT: 'test' });
        assert.throws(() => readItemImageStorageConfig(f.env), category('configuration'));
        assert.throws(() => readItemImageStorageConfig(f.env, { receipt: f.receipt }), category('configuration'));
        assert.throws(() => createItemImageStorage({ enabled: true }), category('configuration'));
    });
    for (const [name, changes] of [
        ['R2 driver', { ITEM_IMAGE_STORAGE_DRIVER: 'r2' }],
        ['remote target', { ITEM_IMAGE_S3_ENDPOINT: 'https://example.r2.cloudflarestorage.com' }],
        ['AWS endpoint', { ITEM_IMAGE_S3_ENDPOINT: 'https://s3.amazonaws.com' }],
        ['DNS alias', { ITEM_IMAGE_S3_ENDPOINT: 'http://localhost:19481' }],
        ['URL user info', { ITEM_IMAGE_S3_ENDPOINT: 'http://test:private@127.0.0.1:19481' }],
        ['URL path', { ITEM_IMAGE_S3_ENDPOINT: 'http://127.0.0.1:19481/path' }],
        ['URL redirect query', { ITEM_IMAGE_S3_ENDPOINT: 'http://127.0.0.1:19481?next=https://external.invalid' }],
        ['staging tier', { ITEM_IMAGE_STORAGE_ENVIRONMENT: 'staging' }],
        ['production tier', { ITEM_IMAGE_STORAGE_ENVIRONMENT: 'production' }],
        ['wrong region', { ITEM_IMAGE_S3_REGION: 'auto' }],
        ['wrong bucket', { ITEM_IMAGE_S3_BUCKET: 'foreign-bucket' }],
        ['wrong namespace', { ITEM_IMAGE_NAMESPACE: '../foreign' }],
        ['wrong fingerprint', { ITEM_IMAGE_STORAGE_TARGET: '0'.repeat(64) }],
        ['default access key', { ITEM_IMAGE_S3_ACCESS_KEY_ID: 'minioadmin' }],
        ['missing secret', { ITEM_IMAGE_S3_SECRET_ACCESS_KEY: undefined }],
        ['wrong secret', { ITEM_IMAGE_S3_SECRET_ACCESS_KEY: 'a'.repeat(64) }],
        ['ambiguous enable flag', { ITEM_IMAGES_ENABLED: '1' }]
    ]) {
        it('rejects ' + name + ' before creating a client', function () {
            const f = fixtureConfig(changes);
            assert.throws(() => readItemImageStorageConfig(f.env, f.target), category('configuration', 'not_attempted'));
        });
    }
    it('rejects altered ownership receipts and hides secrets from config serialization', function () {
        const f = fixtureConfig();
        const config = readItemImageStorageConfig(f.env, f.target);
        assert.ok(Object.isFrozen(config));
        const publicConfig = JSON.stringify(config);
        for (const value of [f.env.ITEM_IMAGE_S3_SECRET_ACCESS_KEY, f.env.ITEM_IMAGE_S3_ACCESS_KEY_ID,
            f.receipt.bucket, f.receipt.endpoint]) assert.ok(!publicConfig.includes(value));
        for (const field of ['containerId', 'imageId', 'volumeName', 'containerName', 'port', 'bucket', 'runId', 'endpoint']) {
            const receipt = Object.assign({}, f.receipt, { [field]: 'wrong' });
            assert.throws(() => readItemImageStorageConfig(f.env, { receipt, verify: f.target.verify }), category('configuration'));
        }
    });
});

describe('private object adapter using the pinned SDK and synthetic transport only', function () {
    let f, transport, storage, verifications;
    beforeEach(function () {
        f = fixtureConfig(); transport = new ProtocolTransport(); verifications = 0;
        f.target.verify = async receipt => { verifications++; assert.equal(receipt.containerId, f.receipt.containerId); return true; };
        storage = createItemImageStorage(readItemImageStorageConfig(f.env, f.target), { requestHandler: transport, timeoutMs: 100 });
    });
    afterEach(function () { storage.close(); });
    const getInput = key => ({ key, byteLength: bytes.length, sha256: hash(bytes) });

    it('serializes exact PUT/HEAD/GET/DELETE with private metadata and byte integrity', async function () {
        const stored = await storage.putVariant({ key: f.key, body: bytes });
        assert.equal(stored.outcome, 'stored');
        assert.equal(stored.sha256, hash(bytes));
        const head = await storage.headVariant({ key: f.key });
        assert.equal(head.byteLength, bytes.length); assert.equal(head.contentType, 'image/webp');
        const read = await storage.getVariant(getInput(f.key));
        assert.deepEqual(read.body, bytes); assert.equal(read.sha256, hash(bytes));
        const put = transport.requests[0];
        assert.equal(put.hostname, '127.0.0.1'); assert.equal(put.port, f.receipt.port);
        assert.equal(put.path, '/' + f.receipt.bucket + '/' + f.key);
        assert.equal(put.headers['if-none-match'], '*');
        assert.equal(put.headers['cache-control'], 'no-store');
        assert.equal(put.headers['content-disposition'], 'inline; filename="item.webp"');
        assert.equal(put.headers['content-md5'], createHash('md5').update(bytes).digest('base64'));
        assert.equal(put.headers['x-amz-acl'], undefined);
        assert.equal(put.query['X-Amz-Signature'], undefined);
        assert.match(put.headers.authorization, /^AWS4-HMAC-SHA256 /);
        assert.equal((await storage.deleteVariant({ key: f.key })).outcome, 'delete_acknowledged');
        assert.equal((await storage.deleteVariant({ key: f.key })).outcome, 'delete_acknowledged');
        await assert.rejects(storage.getVariant(getInput(f.key)), category('not_found', 'absent'));
        assert.equal(verifications, 6);
        assert.equal(transport.objects.size, 0);
        assert.deepEqual(Object.keys(storage).sort(), ['close', 'deleteVariant', 'getVariant', 'headVariant', 'putVariant']);
    });
    it('keeps other exact keys intact during deletion', async function () {
        const other = f.key.replace('/display.webp', '/thumbnail.webp');
        await storage.putVariant({ key: f.key, body: bytes }); await storage.putVariant({ key: other, body: bytes });
        await storage.deleteVariant({ key: f.key });
        assert.deepEqual((await storage.getVariant(getInput(other))).body, bytes);
        assert.equal(transport.objects.size, 1);
    });
    it('distinguishes explicit NoSuchKey from an ambiguous HEAD 404 and a missing bucket', async function () {
        await assert.rejects(storage.getVariant(getInput(f.key)), category('not_found', 'absent'));
        await assert.rejects(storage.headVariant({ key: f.key }), category('unconfirmed_absence', 'unknown'));
        transport.next = () => transport.failure(404, 'NoSuchBucket');
        await assert.rejects(storage.getVariant(getInput(f.key)), category('target_missing', 'unknown'));
    });
    it('never treats a mutation error as confirmed object absence', async function () {
        transport.next = () => transport.failure(404, 'NoSuchKey');
        await assert.rejects(storage.putVariant({ key: f.key, body: bytes }), category('unconfirmed_absence', 'indeterminate'));
        await assert.rejects(storage.deleteVariant({ key: f.key }), category('unconfirmed_absence', 'indeterminate'));
    });
    it('rejects invalid keys, namespace escapes and caller-supplied targets without I/O', async function () {
        for (const key of ['', '../foreign', f.key + '?token=x', '/' + f.key, f.key.replace('/display.webp', '/original.jpg'),
            f.key.replace('/', '/../../'), f.key.replace('/', '/%2e%2e/'), f.key.replace('/', '\\'),
            f.key.replace(f.receipt.namespace, 'item-images-test-' + '0'.repeat(32)), 'https://external.invalid/file.webp']) {
            await assert.rejects(storage.headVariant({ key }), category('invalid_input', 'not_attempted'));
            await assert.rejects(storage.deleteVariant({ key }), category('invalid_input', 'not_attempted'));
        }
        for (const extra of [{ Bucket: 'foreign' }, { endpoint: 'https://external.invalid' }, { ACL: 'public-read' }]) {
            await assert.rejects(storage.putVariant(Object.assign({ key: f.key, body: bytes }, extra)), category('invalid_input'));
        }
        assert.equal(transport.requests.length, 0); assert.equal(verifications, 0);
    });
    it('bounds synthetic variant bytes and expected reads before I/O', async function () {
        for (const body of [Buffer.alloc(0), Buffer.alloc(1024 * 1024 + 1), 'text', Readable.from([bytes])]) {
            await assert.rejects(storage.putVariant({ key: f.key, body }), category('invalid_input'));
        }
        await assert.rejects(storage.putVariant({ key: f.key.replace('/display.webp', '/thumbnail.webp'),
            body: Buffer.alloc(256 * 1024 + 1) }), category('invalid_input'));
        for (const data of [{ byteLength: 0 }, { byteLength: 1024 * 1024 + 1 }, { sha256: 'bad' }]) {
            await assert.rejects(storage.getVariant(Object.assign(getInput(f.key), data)), category('invalid_input'));
        }
        assert.equal(transport.requests.length, 0);
    });
    it('rechecks the live target before every I/O and sanitizes verification failures', async function () {
        storage.close();
        let matches = true;
        f.target.verify = async () => { if (!matches) throw new Error('private-provider-receipt'); return true; };
        storage = createItemImageStorage(readItemImageStorageConfig(f.env, f.target), { requestHandler: transport });
        await storage.headVariant({ key: f.key }).catch(() => {});
        matches = false;
        await assert.rejects(storage.putVariant({ key: f.key, body: bytes }), category('target_mismatch', 'not_attempted'));
        await assert.rejects(storage.deleteVariant({ key: f.key }), category('target_mismatch', 'not_attempted'));
        assert.equal(transport.requests.length, 1);
    });
    for (const [status, code, expected] of [[403, 'AccessDenied', 'authorization'], [403, 'SignatureDoesNotMatch', 'authorization'],
        [500, 'InternalError', 'provider'], [503, 'SlowDown', 'provider'], [412, 'PreconditionFailed', 'conflict']]) {
        it('categorizes HTTP ' + status + '/' + code + ' without leaking or replaying PUT', async function () {
            transport.next = () => transport.failure(status, code);
            await assert.rejects(storage.putVariant({ key: f.key, body: bytes }), category(expected));
            assert.equal(transport.requests.length, 1);
            await assert.rejects(storage.putVariant({ key: f.key, body: bytes }), category('put_already_attempted'));
            assert.equal(transport.requests.length, 1);
        });
    }
    it('treats a lost PUT response as indeterminate, with no unsafe automatic or explicit replay', async function () {
        transport.next = async request => {
            transport.objects.set(request.path, { bytes: Buffer.from(request.body) });
            throw Object.assign(new Error('private-provider-connection'), { code: 'ECONNRESET' });
        };
        await assert.rejects(storage.putVariant({ key: f.key, body: bytes }), category('provider', 'indeterminate'));
        assert.equal(transport.objects.size, 1); assert.equal(transport.requests.length, 1);
        await assert.rejects(storage.putVariant({ key: f.key, body: bytes }), category('put_already_attempted'));
        assert.equal(transport.requests.length, 1);
    });
    it('does not trust a provider error named like an application storage error', async function () {
        transport.next = () => { throw Object.assign(new Error('private-provider-token-and-response'),
            { name: 'ItemImageStorageError', category: 'not_found', outcome: 'absent' }); };
        await assert.rejects(storage.deleteVariant({ key: f.key }), category('provider', 'indeterminate'));
    });
    it('bounds provider error bodies before the SDK can collect them', async function () {
        transport.next = () => transport.response(500, { 'content-type': 'application/xml' }, Buffer.alloc(16 * 1024 + 1, 65));
        await assert.rejects(storage.getVariant(getInput(f.key)), category('integrity'));
        assert.equal(transport.requests.length, 1);
    });
    it('keeps an acknowledged PUT with an invalid response indeterminate', async function () {
        transport.next = () => transport.response(200, {}, Buffer.alloc(16 * 1024 + 1));
        await assert.rejects(storage.putVariant({ key: f.key, body: bytes }), category('integrity', 'indeterminate'));
        await assert.rejects(storage.putVariant({ key: f.key, body: bytes }), category('put_already_attempted'));
        assert.equal(transport.requests.length, 1);
    });
    it('keeps an unknown PUT blocked even if its object appears after an earlier missing read', async function () {
        let finish;
        transport.next = request => {
            const promise = new Promise(resolve => { finish = () => {
                transport.objects.set(request.path, { bytes: Buffer.from(request.body), headers: {
                    'content-length': String(bytes.length), 'content-type': 'image/webp',
                    'cache-control': 'no-store', 'x-amz-meta-sha256': hash(bytes) } });
                resolve(transport.response(200));
            }; });
            return promise;
        };
        await assert.rejects(storage.putVariant({ key: f.key, body: bytes }), category('timeout', 'indeterminate'));
        transport.next = undefined;
        await assert.rejects(storage.getVariant(getInput(f.key)), category('not_found', 'absent'));
        finish();
        assert.deepEqual((await storage.getVariant(getInput(f.key))).body, bytes);
        await assert.rejects(storage.putVariant({ key: f.key, body: bytes }), category('put_already_attempted'));
        assert.equal(transport.requests.filter(request => request.method === 'PUT').length, 1);
    });
    it('caps in-flight operations without an unbounded client queue', async function () {
        transport.next = (request, context) => new Promise((resolve, reject) => {
            context.abortSignal.addEventListener('abort', () => reject(Object.assign(new Error('test abort'), { name: 'AbortError' })), { once: true });
        });
        const pending = [];
        for (let count = 0; count < 8; count++) pending.push(storage.headVariant({ key: f.key }).catch(error => error));
        await assert.rejects(storage.headVariant({ key: f.key }), category('busy', 'not_attempted'));
        storage.close();
        const results = await Promise.all(pending);
        assert.ok(results.every(error => error.category === 'timeout'));
    });
    it('makes client PUT tracking finite without forgetting and replaying old keys', async function () {
        for (let count = 0; count < 256; count++) {
            const key = f.key.replace(/\/[a-f0-9]{24}\//, '/' + count.toString(16).padStart(24, '0') + '/');
            await storage.putVariant({ key, body: bytes });
        }
        await assert.rejects(storage.putVariant({ key: f.key, body: bytes }), category('busy', 'not_attempted'));
        assert.equal(transport.requests.length, 256);
    });
    it('aborts a timed-out PUT and reports an unknown write outcome without replay', async function () {
        transport.next = (request, context) => new Promise((resolve, reject) => {
            context.abortSignal.addEventListener('abort', () => reject(Object.assign(new Error('private-provider-timeout'), { name: 'AbortError' })), { once: true });
        });
        await assert.rejects(storage.putVariant({ key: f.key, body: bytes }), category('timeout', 'indeterminate'));
        assert.equal(transport.requests.length, 1);
    });
    it('bounds a stalled target verifier without sending anything', async function () {
        storage.close(); f.target.verify = () => new Promise(() => {});
        storage = createItemImageStorage(readItemImageStorageConfig(f.env, f.target), { requestHandler: transport, timeoutMs: 100 });
        await assert.rejects(storage.deleteVariant({ key: f.key }), category('timeout', 'not_attempted'));
        assert.equal(transport.requests.length, 0);
    });
    it('rejects corrupt hashes, MIME, lengths and oversized or truncated streamed responses', async function () {
        await storage.putVariant({ key: f.key, body: bytes });
        const object = transport.objects.values().next().value;
        const original = Buffer.from(object.bytes);
        for (const changed of [Buffer.alloc(bytes.length), Buffer.concat([original, original]), original.subarray(1)]) {
            object.bytes = changed;
            await assert.rejects(storage.getVariant(getInput(f.key)), category('integrity'));
        }
        object.bytes = original;
        for (const [name, value] of [['content-type', 'text/html'], ['content-length', '1048577'],
            ['x-amz-meta-sha256', 'a'.repeat(64)], ['cache-control', 'public']]) {
            const previous = object.headers[name]; object.headers[name] = value;
            await assert.rejects(storage.getVariant(getInput(f.key)), category('integrity'));
            object.headers[name] = previous;
        }
    });
    it('times out and destroys a stalled GET body after headers', async function () {
        const body = new Readable({ read() {} });
        transport.next = () => ({ response: { statusCode: 200, headers: { 'content-length': String(bytes.length),
            'content-type': 'image/webp', 'cache-control': 'no-store', 'x-amz-meta-sha256': hash(bytes) }, body } });
        await assert.rejects(storage.getVariant(getInput(f.key)), category('timeout'));
        assert.equal(body.destroyed, true);
    });
    it('closes a GET source rejected before body iteration starts', async function () {
        const body = new Readable({ read() {} });
        transport.next = () => ({ response: { statusCode: 200, headers: { 'content-length': String(bytes.length),
            'content-type': 'text/html', 'cache-control': 'no-store', 'x-amz-meta-sha256': hash(bytes) }, body } });
        await assert.rejects(storage.getVariant(getInput(f.key)), category('integrity'));
        await new Promise(resolve => setImmediate(resolve));
        assert.equal(body.destroyed, true);
    });
    it('does not follow a provider redirect or fall back to another endpoint', async function () {
        transport.next = () => transport.response(307, { location: 'https://external.invalid/private-provider' });
        await assert.rejects(storage.getVariant(getInput(f.key)), category('provider'));
        assert.equal(transport.requests.length, 1); assert.equal(transport.requests[0].hostname, '127.0.0.1');
    });
    it('ignores inherited AWS credentials, endpoint, retry and proxy configuration', async function () {
        const names = ['AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'AWS_ENDPOINT_URL', 'AWS_ENDPOINT_URL_S3', 'AWS_REGION', 'AWS_MAX_ATTEMPTS', 'HTTP_PROXY'];
        const saved = names.map(name => process.env[name]);
        try {
            for (const name of names) process.env[name] = 'https://private-provider.invalid';
            process.env.AWS_MAX_ATTEMPTS = '10';
            await storage.putVariant({ key: f.key, body: bytes });
            const request = transport.requests[0];
            assert.equal(request.hostname, '127.0.0.1');
            assert.ok(request.headers.authorization.includes(f.env.ITEM_IMAGE_S3_ACCESS_KEY_ID + '/'));
            assert.ok(!request.headers.authorization.includes('private-provider'));
        } finally {
            names.forEach((name, index) => { if (saved[index] === undefined) delete process.env[name]; else process.env[name] = saved[index]; });
        }
    });
    it('closes the client once and denies subsequent reads and deletes', async function () {
        storage.close(); storage.close(); assert.equal(transport.closed, 1);
        await assert.rejects(storage.headVariant({ key: f.key }), category('closed', 'not_attempted'));
        await assert.rejects(storage.deleteVariant({ key: f.key }), category('closed', 'not_attempted'));
        assert.equal(transport.requests.length, 0);
    });
});

describe('MinIO artifact safety gate', function () {
    it('records the exact unapproved Community provenance and advisory', function () {
        assert.equal(artifactReview.approved, false);
        assert.equal(artifactReview.license, 'AGPL-3.0-or-later');
        assert.equal(artifactReview.blocker, 'GHSA-hv4r-mvr4-25vw');
        assert.match(artifactReview.commit, /^[a-f0-9]{40}$/);
        assert.match(artifactReview.sourceArchiveSha256, /^[a-f0-9]{64}$/);
    });
    it('refuses provisioning, adoption, bucket operations and cleanup regardless of overrides', async function () {
        // No Docker/container/volume/bucket/list/delete API is reachable through this helper.
        assert.deepEqual(Object.keys(require('./helpers/isolated-minio')).sort(), ['artifactReview', 'createIsolatedMinio']);
        for (const options of [undefined, { approved: true }, { image: 'minio/minio:latest' },
            { receipt: { containerId: 'foreign' }, cleanup: true }, { endpoint: 'https://external.invalid' }]) {
            await assert.rejects(createIsolatedMinio(options), category('artifact_unapproved', 'not_attempted'));
        }
    });
});
