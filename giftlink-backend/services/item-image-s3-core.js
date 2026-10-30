/* jshint esversion: 9 */
const { createHash } = require('node:crypto');
const { Readable } = require('node:stream');
const { storageError, isStorageError } = require('./item-image-storage-error');

const limits = Object.freeze({ thumbnail: 256 * 1024, display: 1024 * 1024, inFlight: 8, putKeys: 256 });
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const md5 = bytes => createHash('md5').update(bytes).digest('base64');
const uuid = '[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}';

function providerFailure(error, operation, aborted) {
    error = error || {};
    const outcome = operation === 'put' || operation === 'delete' ? 'indeterminate' : 'unknown';
    if (aborted || ['TimeoutError', 'AbortError'].includes(error.name) || error.code === 'ETIMEDOUT') {
        return storageError('timeout', operation, outcome);
    }
    const status = error.$metadata && error.$metadata.httpStatusCode;
    if (error.name === 'NoSuchBucket') return storageError('target_missing', operation, outcome);
    // Bare HEAD 404 does not distinguish a missing key from a missing bucket.
    if ((operation === 'get' || operation === 'head') && error.name === 'NoSuchKey' && status === 404) {
        return storageError('not_found', operation, 'absent');
    }
    if (status === 404) return storageError('unconfirmed_absence', operation, outcome);
    if (status === 401 || status === 403) return storageError('authorization', operation, outcome);
    if (status === 409 || status === 412) return storageError('conflict', operation, 'rejected');
    return storageError('provider', operation, outcome);
}

// No SDK/client is constructed until an enabled adapter is explicitly requested.
// Internal protocol core: public local/R2 factories independently validate/brand targets.
function createBoundedImageStorage(binding, options = {}) {
    let closed = false;
    let client;
    const active = new Set();
    const attemptedPuts = new Set();
    if (!binding) {
        const disabled = async () => { throw storageError('disabled', 'access', 'not_attempted'); };
        return Object.freeze({ putVariant: disabled, getVariant: disabled, headVariant: disabled,
            deleteVariant: disabled, close: () => { closed = true; } });
    }
    const timeoutMs = options.timeoutMs === undefined ? 5000 : options.timeoutMs;
    if (!Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 5000 ||
        Object.keys(options).some(key => !['timeoutMs', 'requestHandler'].includes(key))) {
        throw storageError('configuration', 'configure', 'not_attempted');
    }
    const { S3Client, PutObjectCommand, GetObjectCommand, HeadObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');
    const { NodeHttpHandler } = require('@smithy/node-http-handler');
    const http = require('node:http'), https = require('node:https');
    const transport = options.requestHandler || new NodeHttpHandler({ connectionTimeout: 1000,
        requestTimeout: timeoutMs, throwOnRequestTimeout: true, socketTimeout: timeoutMs,
        httpAgent: new http.Agent({ keepAlive: true, maxSockets: limits.inFlight, maxFreeSockets: 2 }),
        httpsAgent: new https.Agent({ keepAlive: true, maxSockets: limits.inFlight, maxFreeSockets: 2, rejectUnauthorized: true }) });
    const operations = { PUT: 'PutObject', GET: 'GetObject', HEAD: 'HeadObject', DELETE: 'DeleteObject' };
    const keyPattern = binding.receipt.namespace + '/[a-f0-9]{24}/' + uuid + '/(thumbnail|display)\\.webp';
    const requestPath = new RegExp('^/' + binding.receipt.bucket + '/' + keyPattern + '$');
    const boundedTransport = {
        destroy: () => transport.destroy(),
        handle: async (request, context) => {
            if (request.protocol !== binding.protocol || request.hostname !== binding.hostname ||
                request.port !== binding.port || !operations[request.method] ||
                !requestPath.test(request.path) || Object.keys(request.query || {}).some(key =>
                    key !== 'x-id' || request.query[key] !== operations[request.method])) {
                throw storageError('target_mismatch', 'transport', 'not_attempted');
            }
            const result = await transport.handle(request, context);
            const response = result.response;
            const source = response.body;
            if (!(source instanceof Readable)) throw storageError('integrity', 'transport', 'unknown');
            // Bound SDK error-XML collection too, not just successful object bodies.
            const maximum = request.method === 'GET' && response.statusCode === 200 ? limits.display : 16 * 1024;
            const abort = () => source.destroy();
            context.abortSignal.addEventListener('abort', abort, { once: true });
            if (context.abortSignal.aborted) abort();
            function release() {
                source.destroy();
                context.abortSignal.removeEventListener('abort', abort);
            }
            const bounded = Readable.from((async function* () {
                let size = 0;
                try {
                    for await (const chunk of source) {
                        size += chunk.length;
                        if (size > maximum) throw storageError('integrity', 'transport', 'unknown');
                        yield chunk;
                    }
                } finally {
                    release();
                }
            })());
            // A metadata mismatch can destroy the wrapper before iteration starts.
            bounded.once('close', release);
            if (request.method !== 'GET' && response.statusCode >= 200 && response.statusCode < 300) {
                // Metadata-only successes have no usable payload; drain within the cap.
                for await (const unused of bounded) { /* discard bounded protocol bytes */ }
                response.body = Readable.from([]);
            } else response.body = bounded;
            return result;
        }
    };
    // Explicit credentials, endpoint, region and non-proxy agent; no credential chain,
    // region redirects, virtual-host routing, acceleration, FIPS or environment defaults.
    client = new S3Client({ endpoint: binding.receipt.endpoint, region: binding.region,
        credentials: Object.assign({}, binding.credentials), forcePathStyle: true, followRegionRedirects: false,
        useArnRegion: false, useAccelerateEndpoint: false, useDualstackEndpoint: false, useFipsEndpoint: false,
        maxAttempts: 1, retryMode: 'standard', ignoreConfiguredEndpointUrls: true,
        requestChecksumCalculation: 'WHEN_REQUIRED',
        responseChecksumValidation: 'WHEN_REQUIRED', logger: {},
        requestHandler: boundedTransport });

    function input(value, allowed, operation) {
        if (!value || Object.getPrototypeOf(value) !== Object.prototype ||
            Object.keys(value).some(key => !allowed.includes(key))) throw storageError('invalid_input', operation, 'not_attempted');
        const pattern = new RegExp('^' + keyPattern + '$');
        if (typeof value.key !== 'string' || value.key.length > 200 || !pattern.test(value.key)) throw storageError('invalid_input', operation, 'not_attempted');
        return value.key.endsWith('/thumbnail.webp') ? limits.thumbnail : limits.display;
    }
    function metadata(result, maximum, operation) {
        if (!Number.isSafeInteger(result.ContentLength) || result.ContentLength < 1 || result.ContentLength > maximum ||
            result.ContentType !== 'image/webp' || result.CacheControl !== 'no-store' ||
            !result.Metadata || !/^[a-f0-9]{64}$/.test(result.Metadata.sha256)) {
            throw storageError('integrity', operation, 'unknown');
        }
        return { byteLength: result.ContentLength, contentType: 'image/webp', sha256: result.Metadata.sha256 };
    }
    async function execute(operation, command, consume) {
        if (closed) throw storageError('closed', operation, 'not_attempted');
        if (active.size >= limits.inFlight) throw storageError('busy', operation, 'not_attempted');
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        active.add(controller);
        let body;
        const abortBody = () => { if (body && typeof body.destroy === 'function') body.destroy(); };
        controller.signal.addEventListener('abort', abortBody);
        let rejectAbort;
        const aborted = new Promise((resolve, reject) => { rejectAbort = reject; });
        const abortOperation = () => rejectAbort(storageError('timeout', operation,
            operation === 'put' || operation === 'delete' ? 'indeterminate' : 'unknown'));
        controller.signal.addEventListener('abort', abortOperation);
        try {
            // Verifier is read-only and must honor this signal/bound its own subprocesses.
            let verified;
            try { verified = await Promise.race([binding.verify(binding.receipt, controller.signal), aborted]); }
            catch (error) {
                if (controller.signal.aborted) throw storageError('timeout', operation, 'not_attempted');
                throw storageError('target_mismatch', operation, 'not_attempted');
            }
            if (verified !== true) throw storageError('target_mismatch', operation, 'not_attempted');
            if (controller.signal.aborted || closed) throw storageError('timeout', operation, 'not_attempted');
            const result = await Promise.race([client.send(command, { abortSignal: controller.signal }), aborted]);
            body = result.Body;
            return await Promise.race([consume(result, controller.signal), aborted]);
        } catch (error) {
            if (isStorageError(error)) {
                if (error.category === 'integrity' && (operation === 'put' || operation === 'delete')) {
                    throw storageError('integrity', operation, 'indeterminate');
                }
                throw error;
            }
            throw providerFailure(error, operation, controller.signal.aborted);
        } finally {
            if (body && typeof body.destroy === 'function') body.destroy();
            controller.signal.removeEventListener('abort', abortBody);
            controller.signal.removeEventListener('abort', abortOperation);
            clearTimeout(timer);
            active.delete(controller);
        }
    }
    const bucket = binding.receipt.bucket;
    async function putVariant(value) {
        if (binding && (binding.role === 'recovery' || binding.putAllowed === false)) throw storageError('authorization', 'put', 'not_attempted');
        const maximum = input(value, ['key', 'body'], 'put');
        if (!Buffer.isBuffer(value.body) || value.body.length < 1 || value.body.length > maximum) {
            throw storageError('invalid_input', 'put', 'not_attempted');
        }
        if (attemptedPuts.has(value.key)) throw storageError('put_already_attempted', 'put', 'indeterminate');
        if (attemptedPuts.size >= limits.putKeys) throw storageError('busy', 'put', 'not_attempted');
        // No eviction/replay in this client lifetime; the pipeline additionally requires its durable cross-instance PUT permit.
        attemptedPuts.add(value.key);
        const bytes = Buffer.from(value.body);
        const hash = sha256(bytes);
        return execute('put', new PutObjectCommand({ Bucket: bucket, Key: value.key, Body: bytes,
            ContentLength: bytes.length, ContentType: 'image/webp', ContentMD5: md5(bytes),
            ContentDisposition: 'inline; filename="item.webp"', CacheControl: 'no-store',
            Metadata: { sha256: hash }, IfNoneMatch: '*' }), async () => ({ outcome: 'stored',
                byteLength: bytes.length, contentType: 'image/webp', sha256: hash }));
    }
    async function headVariant(value) {
        const maximum = input(value, ['key'], 'head');
        return execute('head', new HeadObjectCommand({ Bucket: bucket, Key: value.key }),
            async result => Object.assign({ outcome: 'present' }, metadata(result, maximum, 'head')));
    }
    async function getVariant(value) {
        const maximum = input(value, ['key', 'byteLength', 'sha256'], 'get');
        if (!Number.isSafeInteger(value.byteLength) || value.byteLength < 1 || value.byteLength > maximum ||
            typeof value.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(value.sha256)) throw storageError('invalid_input', 'get', 'not_attempted');
        return execute('get', new GetObjectCommand({ Bucket: bucket, Key: value.key }), async (result, signal) => {
            const meta = metadata(result, maximum, 'get');
            if (meta.byteLength !== value.byteLength || meta.sha256 !== value.sha256 || !(result.Body instanceof Readable)) {
                throw storageError('integrity', 'get', 'unknown');
            }
            let size = 0;
            const chunks = [];
            for await (const chunk of result.Body) {
                if (signal.aborted) throw storageError('timeout', 'get', 'unknown');
                size += chunk.length;
                if (size > value.byteLength) throw storageError('integrity', 'get', 'unknown');
                chunks.push(Buffer.from(chunk));
            }
            if (signal.aborted) throw storageError('timeout', 'get', 'unknown');
            const bytes = Buffer.concat(chunks, size);
            if (size !== value.byteLength || sha256(bytes) !== value.sha256) throw storageError('integrity', 'get', 'unknown');
            return Object.assign({ outcome: 'present', body: bytes }, meta);
        });
    }
    async function deleteVariant(value) {
        if (binding && binding.role === 'runtime') throw storageError('authorization', 'delete', 'not_attempted');
        input(value, ['key'], 'delete');
        // Acknowledged deletion is not absence verification or permission to refund quotas.
        return execute('delete', new DeleteObjectCommand({ Bucket: bucket, Key: value.key }),
            async () => ({ outcome: 'delete_acknowledged' }));
    }
    function close() {
        if (closed) return;
        closed = true;
        for (const controller of active) controller.abort();
        client.destroy();
    }
    return Object.freeze({ putVariant, getVariant, headVariant, deleteVariant, close });
}

module.exports = { createBoundedImageStorage };
