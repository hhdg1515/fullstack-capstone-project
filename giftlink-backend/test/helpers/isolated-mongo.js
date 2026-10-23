const assert = require('node:assert/strict');
const { execFile } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const { promisify } = require('node:util');
const { createDatabase } = require('../../models/db');

const execute = promisify(execFile);
const image = 'mongo@sha256:4a4ab5d4834207389e0d7270fac988e21ffedccecba77991a552f755df229907';
// A Docker archive can retain this verified x64 image without its repository digest.
const snapshotImageId = 'sha256:09f940d01e0c09abbfd246a2b10965cbf86a87c9c1dad86b374f925a084976c8';
const pause = () => new Promise(resolve => setTimeout(resolve, 200));

async function docker(args) {
    return execute('docker', args, { timeout: 120000, maxBuffer: 1024 * 1024 });
}

// No URI from MONGO_URL, .env, or a test environment variable is accepted here.
// Each suite owns a fresh container with no mounted development/production data.
async function createIsolatedMongo() {
    const runId = randomUUID().replace(/-/g, '');
    const name = 'giftlink-test-' + runId;
    const dbName = 'giftdb_test_' + runId;
    let containerId;
    let database;
    let imageId;

    async function inspectOwnedContainer() {
        const result = await docker(['inspect', containerId]);
        const container = JSON.parse(result.stdout)[0];
        assert.equal(container.Id, containerId);
        assert.equal(container.Name, '/' + name);
        assert.equal(container.Config.Labels['com.giftlink.test-run'], runId);
        return container;
    }

    async function close() {
        try {
            if (database) await database.close();
        } finally {
            if (containerId) {
                // Recheck identity before the only destructive cleanup operation.
                await inspectOwnedContainer();
                await docker(['rm', '--force', '--volumes', containerId]);
                containerId = undefined;
            }
        }
    }

    try {
        let inspectedImage;
        try {
            inspectedImage = await docker(['image', 'inspect', image]);
        } catch (error) {
            try {
                inspectedImage = await docker(['image', 'inspect', snapshotImageId]);
            } catch (missingSnapshot) {
                await docker(['pull', image]);
                inspectedImage = await docker(['image', 'inspect', image]);
            }
        }
        imageId = JSON.parse(inspectedImage.stdout)[0].Id;
        assert.match(imageId, /^sha256:[a-f0-9]{64}$/);
        const started = await docker([
            'run', '--detach', '--name', name,
            '--label', 'com.giftlink.test-run=' + runId,
            '--publish', '127.0.0.1::27017', imageId, '--bind_ip_all'
        ]);
        containerId = started.stdout.trim();
        assert.match(containerId, /^[a-f0-9]{64}$/);
        const container = await inspectOwnedContainer();
        assert.equal(container.Image, imageId);
        // Mongo's image creates disposable anonymous data volumes. No bind mount
        // or pre-existing named volume may be attached to the test container.
        assert.ok(container.Mounts.every(mount => mount.Type === 'volume' &&
            /^[a-f0-9]{64}$/.test(mount.Name)));
        assert.deepEqual(container.HostConfig.Binds, null);
        const ports = container.NetworkSettings.Ports['27017/tcp'];
        assert.equal(ports.length, 1);
        assert.equal(ports[0].HostIp, '127.0.0.1');
        assert.match(ports[0].HostPort, /^[0-9]+$/);
        const mongoUrl = 'mongodb://127.0.0.1:' + ports[0].HostPort;
        database = createDatabase({
            mongoUrl,
            dbName,
            clientOptions: { serverSelectionTimeoutMS: 1000 }
        });

        let db;
        const deadline = Date.now() + 30000;
        while (!db) {
            try {
                db = await database.connect();
                await db.command({ ping: 1 });
            } catch (error) {
                db = undefined;
                if (Date.now() >= deadline) throw error;
                await pause();
            }
        }
        assert.equal(db.databaseName, dbName);
        // A remote Docker context could publish on a different host. Confirm the
        // actual Mongo server matches our container before any fixture/seed write.
        const hello = await db.command({ hello: 1 });
        const containerHello = await docker([
            'exec', containerId, 'mongosh', '--quiet', '--eval',
            'db.adminCommand({hello:1}).topologyVersion.processId.toHexString()'
        ]);
        assert.match(containerHello.stdout.trim(), /^[a-f0-9]{24}$/);
        assert.equal(hello.topologyVersion.processId.toHexString(), containerHello.stdout.trim());
        assert.deepEqual(await db.listCollections().toArray(), []);
        return { db, mongoUrl, dbName, close };
    } catch (error) {
        await close();
        throw error;
    }
}

module.exports = { createIsolatedMongo };
