// Test-only real OS process. Only receipt-owned loopback DB/storage are admitted.
const { readPrivateJson } = require('../../util/local-maintenance-receipt');
const { openLocalMaintenance } = require('../../util/local-image-maintenance');
const { storageBinding } = require('../../services/item-image-storage-config');
const { seaweedR2Bridge } = require('./r2-fixture');
const { openR2PhotoContext } = require('../../util/r2-photo-context');
const { createR2ItemImagePipeline } = require('../../services/item-image-pipeline');
const intake = require('../../services/item-image-intake');
const createApp = require('../../app');
const http = require('node:http'), https = require('node:https');
async function main() {
    const request = http.request;
    https.request = () => { throw Error('No provider HTTPS'); };
    http.request = function (value, ...rest) {
        const v = typeof value === 'string' ? new URL(value) : value;
        if (!['127.0.0.1', '::1', '[::1]'].includes(v.hostname || v.host)) throw Error('Only loopback HTTP');
        return request.call(this, value, ...rest);
    };
    const input = readPrivateJson(process.argv[2]), local = await openLocalMaintenance(input.local);
    const receipt = local.receipts.mongo, env = input.env;
    if (env.MONGO_URL !== 'mongodb://127.0.0.1:' + receipt.port + '/?directConnection=true' || env.MONGO_DB_NAME !== receipt.dbName ||
        env.ITEM_IMAGE_R2_ACCOUNT_ID !== 'a'.repeat(32) || env.PHOTO_CONTROL_OWNER_PRIVATE_KEY !== undefined) throw Error('Local worker target');
    const fixture = { config: local.storageConfig, receipt: local.receipts.storage,
        verify: () => storageBinding(local.storageConfig).verify(local.receipts.storage) };
    let armed = null, release = null;
    async function barrier(stage) {
        if (armed !== stage) return;
        armed = null; await new Promise(resolve => { release = resolve; process.send({ event: 'barrier', stage }); }); release = null;
    }
    const context = await openR2PhotoContext({ env, storageOptions: () => {
        const bridge = seaweedR2Bridge(fixture, env);
        bridge.next = async (req, ctx, send) => {
            if (req.method === 'PUT') await barrier('before_put');
            const result = await send(); process.send({ event: 'storage', method: req.method });
            if (req.method === 'PUT') await barrier('after_put');
            if (req.method === 'DELETE') await barrier('after_delete');
            return result;
        };
        return { requestHandler: bridge };
    } });
    const originalCollection = context.db.collection.bind(context.db);
    context.db.collection = function (name, ...args) {
        const col = originalCollection(name, ...args);
        if (name === 'photoControls') {
            const update = col.updateOne.bind(col);
            col.updateOne = async (...params) => {
                if (params[1].$inc && params[1].$inc.fence) await barrier('before_fence');
                try { return await update(...params); }
                catch (error) { if (error.code === 112) process.send({ event: 'write_conflict' }); throw error; }
            };
        }
        return col;
    };
    const read = intake.readMultipart;
    intake.readMultipart = async (...args) => { await barrier('after_claim'); return read(...args); };
    if (env.ITEM_IMAGE_R2_ROLE === 'recovery') {
        const { createR2ImageRecovery } = require('../../services/item-image-recovery');
        process.on('message', async message => {
            if (message.type === 'arm') { armed = message.stage; process.send({ event: 'armed' }); }
            if (message.type === 'release' && release) release();
            if (message.type === 'close') { await context.close(); await local.close(); process.disconnect(); }
            if (message.type === 'preview' || message.type === 'apply') {
                const worker = createR2ImageRecovery(context);
                try {
                    const result = message.type === 'preview' ? await worker.preview() : await worker.apply(message.manifest,
                        Object.assign({}, context.identity, { manifest: message.manifest.digest }));
                    process.send({ event: 'result', id: message.id, result });
                } catch (error) { process.send({ event: 'result', id: message.id, error: 'refused' }); }
                finally { worker.close(); }
            }
        });
        process.send({ event: 'ready', pid: process.pid }); return;
    }
    const pipeline = createR2ItemImagePipeline(context);
    const app = createApp({ connectToDatabase: context.applicationConnectToDatabase, imageMetadata: context.metadata, imagePipeline: pipeline,
        imageControlLimit: 10000, authLimit: 10000, logger: require('pino')({ level: 'silent' }) });
    const server = app.listen(0, '127.0.0.1');
    server.on('listening', () => process.send({ event: 'ready', port: server.address().port, pid: process.pid }));
    process.on('message', async message => {
        if (message.type === 'arm') { armed = message.stage; process.send({ event: 'armed' }); }
        if (message.type === 'release' && release) release();
        if (message.type === 'close') {
            if (release) release(); await new Promise(resolve => server.close(resolve)); pipeline.close(); await context.close(); await local.close(); process.disconnect();
        }
    });
}
if (require.main === module) main().catch(() => { process.stderr.write('Local distributed photo worker refused.\n'); if (process.connected) process.send({ event: 'refused' }); process.exit(1); });
