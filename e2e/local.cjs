const fs = require('node:fs'); const os = require('node:os'); const path = require('node:path');
const http = require('node:http'); const https = require('node:https'); const { execFileSync } = require('node:child_process');
const { root } = require('./policy.cjs');
const { hostNetworkSettled } = require('./host-network.cjs');
const express = require(root + '/giftlink-backend/node_modules/express');
const pino = require(root + '/giftlink-backend/node_modules/pino');
const createApp = require(root + '/giftlink-backend/app');
const { createHostedApp } = require(root + '/giftlink-backend/index');
const { createIsolatedMongo } = require(root + '/giftlink-backend/test/helpers/isolated-mongo');
const { prepareDatabaseIndexes } = require(root + '/giftlink-backend/services/database-indexes');
const { readPreparationTarget, inspectTarget } = require(root + '/giftlink-backend/util/database-target');
async function localEnvironment({ photos = false, ownerListings = false, ownerListingPhotos = false, ownerListingPickups = false } = {}) {
  if ((photos || ownerListings || ownerListingPhotos || ownerListingPickups) && process.env.E2E_APP_ORIGIN) throw Error('Photo fixtures are local only');
  if (ownerListingPickups && !ownerListings) throw Error('Independent listing pickups need owner listings');
  if (ownerListingPhotos && (!photos || !ownerListings)) throw Error('Independent listing photos need the local photo pipeline and owner listings');
  let isolated, api, front, hosted, directory, storage, imagePipeline, imageMetadata;
  try {
    isolated = await createIsolatedMongo(); await prepareDatabaseIndexes(isolated.db);
    if (photos) {
      const { createIsolatedSeaweedFS } = require(root + '/giftlink-backend/test/helpers/isolated-seaweedfs');
      const { createLocalItemImagePipeline } = require(root + '/giftlink-backend/services/item-image-pipeline');
      storage = await createIsolatedSeaweedFS();
      imageMetadata = { storageBinding: { fingerprint: storage.config.targetFingerprint, namespace: storage.receipt.namespace },
        limits: { attempts: 50, successes: 20, accountBytes: 104857600, concurrent: 2, records: 1000 } };
      imagePipeline = createLocalItemImagePipeline({ connectToDatabase: async () => isolated.db, configuration: imageMetadata, storageConfig: storage.config });
    }
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'moveout-e2e-'));
    execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-keyout', path.join(directory, 'key.pem'), '-out', path.join(directory, 'cert.pem'), '-subj', '/CN=localhost', '-addext', 'subjectAltName=DNS:localhost,IP:127.0.0.1'], { stdio: 'ignore' });
    let online = true; let clock; const serverErrors = []; let nextPhotoResponse;
    const photoGates = new Set();
    const web = express();
    web.use('/api', (req, res) => {
      if (!online) return res.status(req.method === 'GET' ? 200 : 404).type('html').send('<!doctype html><title>Frontend fallback</title>');
      const proxy = http.request({ hostname: '127.0.0.1', port: api.address().port, path: req.originalUrl, method: req.method, headers: req.headers }, upstream => {
        const kind = req.method === 'PUT' && /\/images\/[a-f0-9]{24}\/content$/.test(req.originalUrl) ? 'content' :
          req.method === 'POST' && /\/images\/uploads$/.test(req.originalUrl) ? 'reservation' :
          req.method === 'POST' && /^\/api\/move-out-plans\/[a-f0-9]{24}\/items$/.test(req.originalUrl) ? 'item-save' :
          req.method === 'POST' && /\/images\/order$/.test(req.originalUrl) ? 'photo-order' :
          req.method === 'POST' && /\/images\/[a-f0-9]{24}\/actions$/.test(req.originalUrl) ? 'photo-delete' : null;
        const gate = photos && nextPhotoResponse?.kind === kind ? nextPhotoResponse : null;
        if (gate) {
          nextPhotoResponse = undefined; gate.arrived();
          gate.decision.then(deliver => { photoGates.delete(gate); if (deliver) { res.writeHead(upstream.statusCode, upstream.headers); upstream.pipe(res); }
            else { upstream.resume(); if (!res.destroyed) res.status(503).set('Cache-Control', 'private, no-store').json({
              error: { code: 'IMAGE_UPLOAD_UNCERTAIN', message: 'The upstream result is unavailable. Check the existing operation.' }
            }); } });
        } else { res.writeHead(upstream.statusCode, upstream.headers); upstream.pipe(res); }
      });
      proxy.on('error', () => res.status(503).json({ error: { code: 'SERVICE_UNAVAILABLE', message: 'Service unavailable' } })); req.pipe(proxy);
    });
    web.use(express.static(root + '/giftlink-frontend/build')); web.get('*', (req, res) => res.sendFile(root + '/giftlink-frontend/build/index.html'));
    front = https.createServer({ key: fs.readFileSync(path.join(directory, 'key.pem')), cert: fs.readFileSync(path.join(directory, 'cert.pem')) }, web).listen(0, '127.0.0.1');
    await new Promise(resolve => front.once('listening', resolve)); const origin = 'https://127.0.0.1:' + front.address().port;
    const env = { NODE_ENV: 'production', DB_ENVIRONMENT: 'staging', MONGO_URL: isolated.mongoUrl, MONGO_DB_NAME: isolated.dbName, APP_ORIGIN: origin };
    if (ownerListings) env.OWNER_LISTINGS_ENABLED = 'true';
    if (ownerListingPhotos) env.OWNER_LISTING_PHOTOS_ENABLED = 'true';
    if (ownerListingPickups) env.OWNER_LISTING_PICKUPS_ENABLED = 'true';
    if (photos) Object.assign(env, { ITEM_IMAGE_METADATA_ENABLED: 'true', ITEM_IMAGE_STORAGE_TARGET: imageMetadata.storageBinding.fingerprint,
      ITEM_IMAGE_NAMESPACE: imageMetadata.storageBinding.namespace });
    hosted = createHostedApp({ env, databaseFactory: () => ({ connect: async () => isolated.db, close: async () => {} }),
      logger: pino({ level: 'info' }, { write: line => { const entry = JSON.parse(line); if ((entry.event === 'request_failed' || entry.event === 'hosted_startup_failed' || entry.res?.statusCode >= 500) && serverErrors.length < 100) serverErrors.push('Server request/startup failure'); } }), appFactory: options => createApp({ ...options, imageMetadata: imageMetadata || options.imageMetadata, imagePipeline,
        pickupNow: () => new Date(clock === undefined ? Date.now() : clock) }) });
    api = hosted.listen(0, '127.0.0.1'); await new Promise(resolve => api.once('listening', resolve));
    const target = await inspectTarget(isolated.db, await readPreparationTarget(env, true));
    await hostNetworkSettled(); // after every fixture container and network exists, before any browser use
    return { origin, db: isolated.db, fingerprint: target.fingerprint, local: true, serverErrors,
      ...(photos ? { reconcilePhotos: async () => {
        if (process.env.E2E_APP_ORIGIN) throw Error('Photo maintenance is isolated local only');
        const { openLocalMaintenance } = require(root + '/giftlink-backend/util/local-image-maintenance');
        const { createLocalImageRecovery } = require(root + '/giftlink-backend/services/item-image-recovery');
        const maintenance = await openLocalMaintenance({ mongoReceiptPath: isolated.receiptPath, storageReceiptPath: storage.receiptPath,
          databaseName: isolated.dbName, environment: 'development', provider: 'seaweedfs-local', bucket: storage.receipt.bucket, namespace: storage.receipt.namespace });
        try {
          const preview = createLocalImageRecovery(maintenance); let manifest;
          try { manifest = await preview.preview(); } finally { preview.close(); }
          const apply = createLocalImageRecovery(maintenance);
          try { return await apply.apply(manifest, { ...maintenance.identity, manifest: manifest.digest }); } finally { apply.close(); }
        } finally { await maintenance.close(); }
      }, deferNextPhotoResponse: (kind = 'content') => {
        if (process.env.E2E_APP_ORIGIN || !['content', 'reservation', 'item-save', 'photo-order', 'photo-delete'].includes(kind) || nextPhotoResponse) throw Error('Local photo response gate refused');
        let arrived, finish;
        const gate = { kind, arrived: () => arrived(), decision: new Promise(resolve => { finish = resolve; }), cancel: () => finish(false) };
        const observed = new Promise(resolve => { arrived = resolve; });
        photoGates.add(gate); nextPhotoResponse = gate;
        return { arrived: observed, release: () => finish(true), discard: () => finish(false) };
      } } : {}),
      now: () => clock === undefined ? Date.now() : clock, advance: value => { clock = value; }, setOnline: value => { online = value; },
      close: async () => { for (const gate of photoGates) gate.cancel();
        await new Promise(resolve => front.close(resolve)); await new Promise(resolve => api.close(resolve)); await hosted.close();
        if (imagePipeline) imagePipeline.close(); try { if (storage) await storage.close(); } finally { await isolated.close(); }
        fs.rmSync(directory, { recursive: true, force: true }); } };
  } catch (error) {
    if (front) await new Promise(resolve => front.close(resolve)); if (api) await new Promise(resolve => api.close(resolve));
    if (hosted) await hosted.close().catch(() => {}); if (imagePipeline) imagePipeline.close();
    try { if (storage) await storage.close(); } finally { if (isolated) await isolated.close(); }
    if (directory) fs.rmSync(directory, { recursive: true, force: true }); throw error;
  }
}
module.exports = { localEnvironment };
