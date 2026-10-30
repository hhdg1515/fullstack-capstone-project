const { performance } = require('node:perf_hooks');
const { InventoryError } = require('./inventory-error');
const { validateImageConfig, unavailable } = require('./item-image-policy');
const { storageBinding } = require('./item-image-storage-config');
const { createItemImageStorage } = require('./item-image-storage');
const { createItemImagesService } = require('./item-images');
const { createImageAuthorization } = require('./item-image-delivery');
const { processRaster, sha256 } = require('./item-image-processing');
const intake = require('./item-image-intake');
const pipelines = new WeakMap();
let nativeActive = false, readsActive = 0;
const busy = () => new InventoryError(429, 'IMAGE_PROCESSOR_BUSY', 'Photo processing is busy. Check the operation status and try again shortly.', { retryAfterSeconds: 5 });
const isContentRequest = req => req.method === 'PUT' && /^\/api\/move-out-plans\/[a-f0-9]{24}\/items\/[a-f0-9]{24}\/images\/[a-f0-9]{24}\/content$/i.test((req.baseUrl || '') + req.path);

// Local factory retains the opaque live-Docker binding; no environment URL swap.
function createLocalItemImagePipeline({ connectToDatabase, configuration, storageConfig, uploadsEnabled = true }) {
    const config = validateImageConfig(configuration), target = storageBinding(storageConfig);
    if (!target || config.storageBinding.fingerprint !== storageConfig.targetFingerprint ||
        config.storageBinding.namespace !== target.receipt.namespace || storageConfig.driver !== 'seaweedfs-local') throw new Error('Local photo pipeline target mismatch');
    return createPipeline({ connectToDatabase, configuration: config, storage: createItemImageStorage(storageConfig),
        createUploadStorage: () => createItemImageStorage(storageConfig), uploadsEnabled });
}
function createR2ItemImagePipeline(context) {
    if (!require('../util/r2-photo-context').isR2PhotoContext(context) || context.storageConfig.role !== 'runtime') throw new Error('R2 runtime context required');
    return createPipeline({ connectToDatabase: context.connectToDatabase, configuration: context.metadata,
        storage: context.createStorage(), createUploadStorage: context.createStorage, uploadsEnabled: context.storageConfig.uploadsEnabled, applicationConnection: context.applicationConnectToDatabase });
}
function createPipeline({ connectToDatabase, configuration: config, storage, createUploadStorage, uploadsEnabled, applicationConnection = null }) {
    if (typeof uploadsEnabled !== 'boolean') { storage.close(); throw new Error('Explicit upload admission required'); }
    const permitted = uploadsEnabled; let admitting = uploadsEnabled;
    const metadata = createItemImagesService({ connectToDatabase, configuration: config });
    const authorize = createImageAuthorization({ connectToDatabase, configuration: config });
    let closed = false, storageActive = 0;
    const uploadClients = new Set();
    function closeStorage(client) {
        try { client.close(); } catch (ignored) { /* Transport teardown never proves storage absence or releases charges. */ }
    }
    // Preserve the eight-operation pipeline budget across read and ticket-scoped
    // clients. Rotation never evicts a key or retries an operation.
    async function storageCall(client, method, value) {
        if (closed || storageActive >= 8) throw require('./item-image-storage-error').storageError(closed ? 'closed' : 'busy', method, 'not_attempted');
        storageActive++;
        try { return await client[method](value); } finally { storageActive--; }
    }
    function checkAvailable() { if (closed) throw new InventoryError(503, 'IMAGE_PIPELINE_UNAVAILABLE', 'Photo service unavailable.'); }
    function duplicate(res, current) {
        res.set('Connection', 'close');
        return res.status(current.upload.state === 'ready' ? 200 : current.upload.state === 'processing' ? 202 : 409).json(current);
    }
    async function upload(req, res, next) {
        let ticket, inputBytes, uploadStorage, admitted = false, disconnected = false;
        const onClose = () => { if (!res.writableEnded) disconnected = true; };
        res.once('close', onClose);
        const started = performance.now();
        const check = () => {
            checkAvailable();
            if (req.aborted || disconnected || performance.now() - started > 40000) throw new InventoryError(408, 'IMAGE_PIPELINE_TIMEOUT', 'Processing stopped. Check the operation status before starting another upload.');
        };
        try {
            check();
            const ids = [req.user._id, req.params.planId, req.params.itemId, req.params.imageId];
            const inspected = await metadata.inspectUpload(...ids);
            if (inspected.row.state !== 'reserved') return duplicate(res, inspected.body);
            if (!admitting) throw new InventoryError(503, 'IMAGE_UPLOADS_PAUSED', 'Photo uploads are paused. Your saved photos remain available.');
            const boundary = intake.boundary(req);
            if (nativeActive) {
                const latest = await metadata.inspectUpload(...ids);
                if (latest.row.state !== 'reserved') return duplicate(res, latest.body);
                throw busy();
            }
            if (!admitting) throw new InventoryError(503, 'IMAGE_UPLOADS_PAUSED', 'Photo uploads are paused. Check status before continuing.');
            nativeActive = true; admitted = true;
            const claimed = await metadata.claim(...ids);
            if (!claimed.claimed) return duplicate(res, claimed.body);
            ticket = claimed.row;
            const file = await intake.readMultipart(req, boundary); inputBytes = file.body; check();
            if (file.body.length !== ticket.intent.byteLength || sha256(file.body) !== ticket.intent.sha256) {
                throw new InventoryError(422, 'IMAGE_INTENT_MISMATCH', 'The file does not match its reservation. Reserve the selected file again.');
            }
            const output = await processRaster(file.body, check, file.contentType); inputBytes.fill(0);
            await metadata.prepareVariants(ticket, output.variants);
            // A fresh client is issued only for this newly claimed durable ticket.
            // Duplicate/failed/uncertain tickets return above, without a new client.
            uploadStorage = createUploadStorage(); uploadClients.add(uploadStorage);
            for (const name of ['thumbnail', 'display']) {
                check(); const intent = await metadata.beginPut(ticket, name); check();
                await storageCall(uploadStorage, 'putVariant', { key: intent.key, body: output.variants[name].body }); check();
                const verified = await storageCall(uploadStorage, 'getVariant', { key: intent.key, byteLength: intent.byteLength, sha256: intent.sha256 });
                if (!verified.body.equals(output.variants[name].body)) throw new Error('Variant verification failed');
                check(); await metadata.stored(ticket, name);
            }
            check(); const body = await metadata.finalize(ticket);
            return res.status(201).json(body);
        } catch (error) {
            if (ticket) try { await metadata.fail(ticket); } catch (failure) { /* Durable processing/deletion ledger remains; no blind refund. */ }
            req.pause(); res.set('Connection', 'close');
            if (error instanceof InventoryError) return next(error);
            return next(new InventoryError(503, 'IMAGE_UPLOAD_UNCERTAIN', 'Photo processing could not finish. Check its operation status; cleanup may be pending.'));
        } finally {
            if (uploadStorage) { closeStorage(uploadStorage); uploadClients.delete(uploadStorage); }
            if (inputBytes) inputBytes.fill(0); if (admitted) nativeActive = false; res.removeListener('close', onClose); }
    }
    async function deliver(req, res, next, currentViewer) {
        let admitted = false;
        try {
            checkAvailable();
            if (Object.keys(req.query).length) throw unavailable();
            if (readsActive >= 8) throw new InventoryError(429, 'IMAGE_READ_BUSY', 'Photo service is busy. Try again shortly.', { retryAfterSeconds: 5 });
            readsActive++; admitted = true;
            const initial = await authorize(req.params.imageId, req.params.variant, req.user && req.user._id), v = initial.variant;
            let body;
            if (req.method === 'HEAD') {
                const head = await storageCall(storage, 'headVariant', { key: v.key });
                if (head.byteLength !== v.byteLength || head.sha256 !== v.sha256) throw new Error('Photo metadata mismatch');
            } else body = (await storageCall(storage, 'getVariant', { key: v.key, byteLength: v.byteLength, sha256: v.sha256 })).body;
            const latest = await authorize(req.params.imageId, req.params.variant, await currentViewer());
            if (latest.row.generation !== initial.row.generation || JSON.stringify(latest.variant) !== JSON.stringify(v)) throw unavailable();
            checkAvailable();
            res.set({ 'Content-Type': 'image/webp', 'Content-Length': String(v.byteLength), 'X-Content-Type-Options': 'nosniff',
                'Cache-Control': 'private, no-store', 'Content-Disposition': 'inline; filename="item.webp"',
                'Referrer-Policy': 'no-referrer', 'Cross-Origin-Resource-Policy': 'same-site' });
            return req.method === 'HEAD' ? res.end() : res.end(body);
        } catch (error) {
            return next(error instanceof InventoryError ? error : new InventoryError(503, 'IMAGE_READ_UNAVAILABLE', 'Photo temporarily unavailable. Try again later.'));
        } finally { if (admitted) readsActive--; }
    }
    const facade = Object.freeze({ enabled: true, setUploadAdmission: value => {
        if (typeof value !== 'boolean' || value && !permitted || closed) throw new Error('Upload admission refused');
        admitting = value;
    }, close: () => { closed = true; closeStorage(storage); for (const client of uploadClients) closeStorage(client); } });
    pipelines.set(facade, { config, upload, deliver, connectToDatabase, applicationConnection, uploadsEnabled: () => !closed && admitting }); return facade;
}
function pipelineBinding(value, metadata, applicationConnection) {
    if (value === null || value === undefined) return null;
    const pipeline = pipelines.get(value);
    if (!pipeline || !metadata) throw new Error('Invalid local or R2 photo pipeline configuration');
    if (pipeline.applicationConnection && pipeline.applicationConnection !== applicationConnection) throw new Error('R2 application database connection mismatch');
    const expected = validateImageConfig(metadata);
    if (pipeline.config.storageBinding.fingerprint !== expected.storageBinding.fingerprint || pipeline.config.storageBinding.namespace !== expected.storageBinding.namespace ||
        Object.keys(expected.limits).some(key => pipeline.config.limits[key] !== expected.limits[key])) throw new Error('Invalid local or R2 photo pipeline configuration');
    return pipeline;
}
module.exports = { createLocalItemImagePipeline, createR2ItemImagePipeline, pipelineBinding, isContentRequest };
