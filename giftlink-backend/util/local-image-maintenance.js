const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { createDatabase } = require('../models/db');
const { readPreparationTarget, inspectTarget } = require('./database-target');
const { readPrivateJson } = require('./local-maintenance-receipt');
const { openIsolatedSeaweedFS } = require('../test/helpers/isolated-seaweedfs');
const execute = promisify(execFile);
const host = process.platform === 'win32' ? 'npipe:////./pipe/docker_engine' : 'unix:///var/run/docker.sock';
const fail = () => { throw new Error('Local maintenance target verification failed.'); };
const verifiedTargets = new WeakSet();

async function docker(args) {
    const env = Object.assign({}, process.env);
    for (const name of ['DOCKER_HOST', 'DOCKER_CONTEXT', 'DOCKER_TLS', 'DOCKER_TLS_VERIFY', 'DOCKER_CERT_PATH']) delete env[name];
    try { return JSON.parse((await execute('docker', ['--host=' + host].concat(args), { env, timeout: 3000, maxBuffer: 65536, windowsHide: true })).stdout); }
    catch (error) { return fail(); }
}
async function openLocalMaintenance({ mongoReceiptPath, storageReceiptPath, databaseName, environment, provider, bucket, namespace }) {
    // Explicit identities plus independent receipt verification. No .env, URI,
    // AWS credentials, remote Docker context or default endpoint is consulted.
    const receipt = readPrivateJson(mongoReceiptPath, 8192), storageReceipt = readPrivateJson(storageReceiptPath, 8192);
    if (environment !== 'development' || provider !== 'seaweedfs-local' ||
        receipt.version !== 1 || !/^[a-f0-9]{32}$/.test(receipt.runId) ||
        !/^[a-f0-9]{64}$/.test(receipt.containerId) || !/^[a-f0-9]{24}$/.test(receipt.processId) ||
        receipt.containerName !== 'giftlink-test-' + receipt.runId || receipt.dbName !== 'giftdb_test_' + receipt.runId ||
        databaseName !== receipt.dbName || !Number.isInteger(receipt.port) || receipt.port < 1024 || receipt.port > 65535 ||
        !Array.isArray(receipt.volumes) || receipt.volumes.length !== 2 || !receipt.volumes.every(v => /^[a-f0-9]{64}$/.test(v)) ||
        bucket !== storageReceipt.bucket || namespace !== storageReceipt.namespace) fail();
    const mongoImage = 'sha256:09f940d01e0c09abbfd246a2b10965cbf86a87c9c1dad86b374f925a084976c8';
    async function verifyContainer() {
        const results = await Promise.all([docker(['info', '--format', '{{json .}}']), docker(['inspect', receipt.containerId])]);
        const daemon = results[0], c = results[1][0];
        if (daemon.ID !== receipt.daemonId || daemon.OSType !== 'linux' || c.Id !== receipt.containerId || c.Name !== '/' + receipt.containerName ||
            c.Image !== mongoImage || receipt.imageId !== mongoImage || !c.State.Running || c.HostConfig.Privileged ||
            c.Config.Labels['com.giftlink.test-run'] !== receipt.runId || c.HostConfig.Binds !== null ||
            JSON.stringify(c.Config.Cmd) !== JSON.stringify(['--bind_ip_all', '--replSet', 'giftlink-test']) ||
            !c.Mounts.every(m => m.Type === 'volume' && receipt.volumes.includes(m.Name)) || c.Mounts.length !== 2 ||
            Object.keys(c.HostConfig.PortBindings).length !== 1 ||
            JSON.stringify(c.NetworkSettings.Ports['27017/tcp']) !== JSON.stringify([{ HostIp: '127.0.0.1', HostPort: String(receipt.port) }])) fail();
    }
    await verifyContainer();
    const target = await readPreparationTarget({ MONGO_URL: 'mongodb://127.0.0.1:' + receipt.port + '/?directConnection=true',
        MONGO_DB_NAME: databaseName, DB_ENVIRONMENT: environment }, false);
    const database = createDatabase({ mongoUrl: target.mongoUrl, dbName: databaseName,
        clientOptions: { directConnection: true, serverSelectionTimeoutMS: 2000, connectTimeoutMS: 2000, socketTimeoutMS: 5000, monitorCommands: true } });
    let storage;
    try {
        const db = await database.connect();
        const verifyDatabase = async () => {
            await verifyContainer();
            const hello = await db.command({ hello: 1 }, { maxTimeMS: 2000 });
            if (db.databaseName !== databaseName || hello.setName !== 'giftlink-test' || !hello.isWritablePrimary ||
                !hello.topologyVersion || hello.topologyVersion.processId.toHexString() !== receipt.processId) fail();
            return true;
        };
        await verifyDatabase();
        const inspected = await inspectTarget(db, target);
        storage = await openIsolatedSeaweedFS(storageReceipt);
        Object.freeze(receipt.volumes);
        const context = Object.freeze({ db, verifyDatabase, storageConfig: storage.config,
            identity: Object.freeze({ database: databaseName, environment, databaseFingerprint: inspected.fingerprint,
                provider, storageFingerprint: storage.config.targetFingerprint, bucket, namespace }),
            receipts: Object.freeze({ mongo: Object.freeze(receipt), storage: Object.freeze(storageReceipt) }),
            close: async () => { storage.close(); await database.close(); } });
        verifiedTargets.add(context); return context;
    } catch (error) { if (storage) storage.close(); await database.close(); return fail(); }
}
module.exports = { openLocalMaintenance, isLocalMaintenance: value => verifiedTargets.has(value) };
