const assert = require('node:assert/strict');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { randomBytes, randomUUID, createHash } = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { S3Client, ListBucketsCommand, CreateBucketCommand, HeadBucketCommand, PutObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');
const { NodeHttpHandler } = require('@smithy/node-http-handler');
const { readItemImageStorageConfig, fingerprint } = require('../../services/item-image-storage-config');
const { createItemImageStorage } = require('../../services/item-image-storage');
const artifact = require('../fixtures/seaweedfs-artifact.json');
Object.freeze(artifact.arguments); Object.freeze(artifact);

const execute = promisify(execFile);
const label = 'com.moveout.storage-test';
const digest = value => createHash('sha256').update(value).digest('hex');
const pause = () => new Promise(resolve => setTimeout(resolve, 150));
const host = process.platform === 'win32' ? 'npipe:////./pipe/docker_engine' : 'unix:///var/run/docker.sock';

function fixtureError(phase) {
    const error = new Error('Isolated SeaweedFS fixture failed: ' + phase);
    error.code = 'ISOLATED_STORAGE_' + phase.toUpperCase();
    return error;
}

async function docker(args, options = {}) {
    const env = Object.assign({}, process.env, options.env);
    for (const name of ['DOCKER_HOST', 'DOCKER_CONTEXT', 'DOCKER_TLS', 'DOCKER_TLS_VERIFY', 'DOCKER_CERT_PATH']) delete env[name];
    try {
        return await execute('docker', ['--host=' + host].concat(args), {
            env, timeout: options.timeout || 120000, maxBuffer: 1024 * 1024,
            windowsHide: true, signal: options.signal
        });
    } catch (error) {
        // execFile errors may contain stdout, env or command context. Do not forward them.
        throw fixtureError('docker_' + args[0]);
    }
}

function checkLabels(labels, receipt) {
    assert.equal(labels[label], receipt.runId);
    assert.equal(labels[label + '.nonce'], receipt.nonce);
}

// Pure validation is separately exercised with corrupted inspect snapshots.
function validateResources(receipt, state) {
    const c = state.container, v = state.volume, n = state.network;
    assert.equal(state.daemon.ID, receipt.daemonId);
    assert.equal(state.daemon.OSType, 'linux');
    assert.ok(['x86_64', 'amd64'].includes(state.daemon.Architecture));
    assert.equal(c.Id, receipt.containerId);
    assert.equal(c.Name, '/' + receipt.containerName);
    assert.equal(c.Image, artifact.amd64ImageId);
    checkLabels(c.Config.Labels, receipt);
    assert.deepEqual(c.Config.Entrypoint, ['/usr/bin/weed']);
    assert.deepEqual(c.Config.Cmd, artifact.arguments);
    const env = Object.fromEntries(c.Config.Env.map(entry => {
        const split = entry.indexOf('='); return [entry.slice(0, split), entry.slice(split + 1)];
    }));
    assert.match(env.AWS_ACCESS_KEY_ID, /^test[a-f0-9]{16}$/);
    assert.match(env.AWS_SECRET_ACCESS_KEY, /^[a-f0-9]{64}$/);
    assert.equal(digest(env.AWS_ACCESS_KEY_ID + ':' + env.AWS_SECRET_ACCESS_KEY), receipt.credentialsSha256);
    assert.equal(env.S3_BUCKET, ''); assert.equal(env.S3_TABLE_BUCKET, '');
    assert.equal(c.Config.User, '1000:1000');
    assert.equal(c.HostConfig.ReadonlyRootfs, true);
    assert.deepEqual(c.HostConfig.CapDrop, ['ALL']);
    assert.equal(c.HostConfig.Privileged, false);
    assert.equal(c.HostConfig.PublishAllPorts, false);
    assert.ok(c.HostConfig.SecurityOpt.includes('no-new-privileges'));
    assert.equal(c.HostConfig.Memory, 768 * 1024 * 1024);
    assert.equal(c.HostConfig.NanoCpus, 2 * 1e9);
    assert.equal(c.HostConfig.PidsLimit, 256);
    assert.deepEqual(c.HostConfig.Tmpfs, { '/tmp': 'rw,noexec,nosuid,size=64m' });
    assert.equal(c.HostConfig.NetworkMode, receipt.networkName);
    assert.equal(c.HostConfig.Binds, null);
    assert.equal(c.Mounts.length, 1);
    assert.equal(c.Mounts[0].Type, 'volume');
    assert.equal(c.Mounts[0].Name, receipt.volumeName);
    assert.equal(c.Mounts[0].Destination, '/data');
    assert.equal(c.Mounts[0].RW, true);
    assert.equal(v.Name, receipt.volumeName);
    assert.equal(v.Driver, 'local');
    assert.ok(!v.Options || Object.keys(v.Options).length === 0);
    checkLabels(v.Labels, receipt);
    assert.equal(n.Id, receipt.networkId);
    assert.equal(n.Name, receipt.networkName);
    assert.equal(n.Internal, false);
    assert.equal(n.Options['com.docker.network.bridge.enable_ip_masquerade'], 'false');
    assert.equal(n.Options['com.docker.network.bridge.enable_icc'], 'false');
    checkLabels(n.Labels, receipt);
    assert.deepEqual(Object.keys(n.Containers || {}), c.State.Running ? [receipt.containerId] : []);
    const bindings = c.HostConfig.PortBindings;
    assert.deepEqual(Object.keys(bindings), ['8333/tcp']);
    assert.deepEqual(bindings['8333/tcp'], [{ HostIp: '127.0.0.1', HostPort: '' }]);
    if (c.State.Running && receipt.port) {
        const ports = c.NetworkSettings.Ports['8333/tcp'];
        assert.deepEqual(ports, [{ HostIp: '127.0.0.1', HostPort: String(receipt.port) }]);
        assert.equal(Object.keys(c.NetworkSettings.Networks).length, 1);
        assert.equal(c.NetworkSettings.Networks[receipt.networkName].NetworkID, receipt.networkId);
    }
    return true;
}

async function createIsolatedSeaweedFS() {
    const runId = randomBytes(16).toString('hex');
    const nonce = randomBytes(24).toString('hex');
    const resourceName = 'moveout-seaweed-' + runId;
    const credentials = { accessKeyId: 'test' + randomBytes(8).toString('hex'), secretAccessKey: randomBytes(32).toString('hex') };
    const clients = [];
    let volumeCreated = false, networkCreated = false, containerId, receipt, closing, done = false;
    const state = { version: 1, runId, nonce, containerName: resourceName, volumeName: resourceName,
        networkName: resourceName, bucket: 'moveout-test-' + runId, namespace: 'item-images-test-' + runId,
        imageId: artifact.amd64ImageId, credentialsSha256: digest(credentials.accessKeyId + ':' + credentials.secretAccessKey) };
    const labels = ['--label', label + '=' + runId, '--label', label + '.nonce=' + nonce];
    const receiptDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'moveout-storage-receipt-'));
    const receiptPath = path.join(receiptDirectory, 'receipt.json');
    function saveReceipt() { fs.writeFileSync(receiptPath, JSON.stringify(state), { mode: 0o600 }); }
    let phase = 'daemon';

    async function snapshot(signal) {
        const results = await Promise.all([
            docker(['info', '--format', '{{json .}}'], { signal, timeout: 2000 }),
            docker(['inspect', containerId], { signal, timeout: 2000 }),
            docker(['volume', 'inspect', state.volumeName], { signal, timeout: 2000 }),
            docker(['network', 'inspect', state.networkName], { signal, timeout: 2000 })
        ]);
        return { daemon: JSON.parse(results[0].stdout), container: JSON.parse(results[1].stdout)[0],
            volume: JSON.parse(results[2].stdout)[0], network: JSON.parse(results[3].stdout)[0] };
    }
    async function verify(candidate = receipt, signal = undefined) {
        if (done || !receipt) throw fixtureError('closed');
        if (!candidate) throw fixtureError('target_mismatch');
        for (const key of ['version', 'runId', 'containerId', 'containerName', 'volumeName', 'imageId',
            'port', 'endpoint', 'bucket', 'namespace', 'credentialsSha256']) {
            if (candidate[key] !== receipt[key]) throw fixtureError('target_mismatch');
        }
        const observed = await snapshot(signal);
        try { validateResources(receipt, observed); } catch (error) { throw fixtureError('identity_mismatch'); }
        if (!observed.container.State.Running) throw fixtureError('not_running');
        return true;
    }
    function rawClient(invalidCredentials = false, timeout = 2000) {
        if (typeof invalidCredentials !== 'boolean' || done || closing || !receipt) throw fixtureError('client_configuration');
        const client = new S3Client({ endpoint: receipt.endpoint, region: 'us-east-1',
            credentials: Object.assign({}, credentials, invalidCredentials ? { secretAccessKey: '0'.repeat(64) } : {}),
            forcePathStyle: true, followRegionRedirects: false, ignoreConfiguredEndpointUrls: true,
            requestChecksumCalculation: 'WHEN_REQUIRED', responseChecksumValidation: 'WHEN_REQUIRED', maxAttempts: 1,
            requestHandler: new NodeHttpHandler({ connectionTimeout: 500, requestTimeout: timeout,
                throwOnRequestTimeout: true, socketTimeout: timeout }), logger: {} });
        clients.push({ close: () => client.destroy() });
        return client;
    }
    async function cleanup(confirmation = receipt) {
        if (confirmation !== receipt) throw fixtureError('cleanup_receipt');
        if (closing) return closing;
        closing = (async () => {
            for (const client of clients) client.close();
            if (containerId) {
                const observed = await snapshot();
                validateResources(receipt || state, observed);
                await docker(['rm', '--force', containerId]);
                containerId = undefined;
            }
            if (volumeCreated) {
                const v = JSON.parse((await docker(['volume', 'inspect', state.volumeName])).stdout)[0];
                assert.equal(v.Name, state.volumeName); assert.equal(v.Driver, 'local'); checkLabels(v.Labels, state);
                assert.ok(!v.Options || Object.keys(v.Options).length === 0);
                await docker(['volume', 'rm', state.volumeName]); volumeCreated = false;
            }
            if (networkCreated) {
                const n = JSON.parse((await docker(['network', 'inspect', state.networkName])).stdout)[0];
                assert.equal(n.Id, state.networkId); assert.equal(n.Internal, false); checkLabels(n.Labels, state);
                assert.deepEqual(Object.keys(n.Containers || {}), []);
                await docker(['network', 'rm', state.networkName]); networkCreated = false;
            }
            done = true;
            fs.rmSync(receiptDirectory, { recursive: true });
        })();
        try { return await closing; } catch (error) { closing = undefined; throw fixtureError('cleanup_identity_or_docker'); }
    }
    try {
        const daemon = JSON.parse((await docker(['info', '--format', '{{json .}}'])).stdout);
        if (daemon.OSType !== 'linux' || !['x86_64', 'amd64'].includes(daemon.Architecture)) throw fixtureError('unsupported_platform');
        state.daemonId = daemon.ID;
        phase = 'image';
        let image;
        try { image = JSON.parse((await docker(['image', 'inspect', artifact.image])).stdout)[0]; }
        catch (error) {
            await docker(['pull', '--platform', 'linux/amd64', artifact.image]);
            image = JSON.parse((await docker(['image', 'inspect', artifact.image])).stdout)[0];
        }
        assert.equal(image.Id, artifact.amd64ImageId);
        assert.ok(image.RepoDigests.includes(artifact.image));
        assert.equal(image.Config.Labels['org.opencontainers.image.revision'], artifact.sourceCommit);
        assert.equal(image.Config.Labels['org.opencontainers.image.licenses'], artifact.license);
        assert.equal((await docker(['volume', 'ls', '--filter', 'name=^' + resourceName + '$', '--format', '{{.Name}}'])).stdout.trim(), '');
        phase = 'volume'; saveReceipt();
        await docker(['volume', 'create'].concat(labels, [resourceName])); volumeCreated = true;
        phase = 'network';
        const network = await docker(['network', 'create',
            '--opt', 'com.docker.network.bridge.enable_ip_masquerade=false',
            '--opt', 'com.docker.network.bridge.enable_icc=false'].concat(labels, [resourceName]));
        state.networkId = network.stdout.trim(); networkCreated = true;
        phase = 'container'; saveReceipt();
        const created = await docker(['create', '--name', resourceName].concat(labels, [
            '--platform', 'linux/amd64', '--network', resourceName, '--publish', '127.0.0.1::8333',
            '--user', '1000:1000', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges', '--read-only',
            '--pids-limit', '256', '--memory', '768m', '--cpus', '2', '--tmpfs', '/tmp:rw,noexec,nosuid,size=64m',
            '--mount', 'type=volume,source=' + resourceName + ',target=/data',
            '--env', 'AWS_ACCESS_KEY_ID', '--env', 'AWS_SECRET_ACCESS_KEY', '--env', 'S3_BUCKET=', '--env', 'S3_TABLE_BUCKET=',
            '--entrypoint', '/usr/bin/weed', artifact.image
        ], artifact.arguments), { env: { AWS_ACCESS_KEY_ID: credentials.accessKeyId, AWS_SECRET_ACCESS_KEY: credentials.secretAccessKey } });
        containerId = created.stdout.trim(); state.containerId = containerId;
        saveReceipt(); phase = 'start';
        assert.match(containerId, /^[a-f0-9]{64}$/);
        await docker(['start', containerId]);
        const container = JSON.parse((await docker(['inspect', containerId])).stdout)[0];
        const ports = container.NetworkSettings.Ports['8333/tcp'];
        assert.equal(ports.length, 1); assert.equal(ports[0].HostIp, '127.0.0.1');
        state.port = Number(ports[0].HostPort); state.endpoint = 'http://127.0.0.1:' + state.port;
        receipt = Object.freeze(Object.assign({}, state));
        saveReceipt(); phase = 'verify';
        await verify();
        phase = 'binary_version';
        const version = (await docker(['exec', containerId, '/usr/bin/weed', 'version'])).stdout;
        assert.ok(version.includes(artifact.release + ' ' + artifact.sourceCommit.slice(0, 9) + ' linux amd64'));
        const admin = rawClient();
        const deadline = Date.now() + 30000;
        let ready = false;
        phase = 'readiness';
        while (!ready) {
            try {
                await verify();
                const listed = await admin.send(new ListBucketsCommand({}));
                assert.deepEqual(listed.Buckets, []); ready = true;
            } catch (error) {
                if (Date.now() > deadline) throw fixtureError('readiness');
                await pause();
            }
        }
        // The exact local daemon/container/image/network/volume/port and empty server
        // are now verified. This is the only bucket creation in this fixture.
        phase = 'bucket';
        await verify(); await admin.send(new CreateBucketCommand({ Bucket: receipt.bucket }));
        await admin.send(new HeadBucketCommand({ Bucket: receipt.bucket }));
        // Empty-bucket readiness does not prove the first volume assignment is ready.
        // One fresh journaled synthetic probe gets a bounded setup-only deadline;
        // it is never replayed. The application adapter retains its 5-second cap.
        phase = 'write_readiness';
        const probe = receipt.namespace + '/' + randomBytes(12).toString('hex') + '/' + randomUUID() + '/display.webp';
        state.bootstrapProbe = probe; saveReceipt();
        await verify();
        const bootstrap = rawClient(false, 30000);
        await bootstrap.send(new PutObjectCommand({ Bucket: receipt.bucket, Key: probe,
            Body: Buffer.from('synthetic readiness'), IfNoneMatch: '*' }));
        await verify();
        await bootstrap.send(new DeleteObjectCommand({ Bucket: receipt.bucket, Key: probe }));
        phase = 'configuration';
        const env = { ITEM_IMAGES_ENABLED: 'true', ITEM_IMAGE_STORAGE_DRIVER: 'seaweedfs-local',
            ITEM_IMAGE_STORAGE_ENVIRONMENT: 'test', ITEM_IMAGE_S3_REGION: 'us-east-1', ITEM_IMAGE_S3_ENDPOINT: receipt.endpoint,
            ITEM_IMAGE_S3_BUCKET: receipt.bucket, ITEM_IMAGE_NAMESPACE: receipt.namespace, ITEM_IMAGE_STORAGE_TARGET: fingerprint(receipt),
            ITEM_IMAGE_S3_ACCESS_KEY_ID: credentials.accessKeyId, ITEM_IMAGE_S3_SECRET_ACCESS_KEY: credentials.secretAccessKey };
        const config = readItemImageStorageConfig(env, { receipt, verify });
        return Object.freeze({ receipt, receiptPath, config, verify, close: cleanup,
            storage: options => {
                if (done || closing) throw fixtureError('closed');
                const storage = createItemImageStorage(config, options); clients.push(storage); return storage;
            },
            client: invalid => rawClient(invalid),
            // No Docker env or credential-bearing raw inspect snapshot is returned.
            snapshot: async () => { await verify(); return { running: true, owned: true }; }
        });
    } catch (error) {
        const location = error.code === 'ERR_ASSERTION' && /isolated-seaweedfs\.js:(\d+)/.exec(error.stack);
        await cleanup();
        throw fixtureError(phase + (location ? '_assertion_' + location[1] : ''));
    }
}

// Reattach only to a live, fully verified disposable fixture. This does not
// provision, adopt, reset or destroy any resource. Credentials are recovered only
// from this exact owned local container, after its complete identity is checked.
async function openIsolatedSeaweedFS(receipt) {
    let closed = false;
    async function inspect(signal) {
        if (closed || !receipt || !/^[a-f0-9]{64}$/.test(receipt.containerId) || !/^[a-f0-9]{48}$/.test(receipt.nonce) ||
            receipt.version !== 1 || !/^[a-f0-9]{32}$/.test(receipt.runId) ||
            receipt.containerName !== 'moveout-seaweed-' + receipt.runId || receipt.volumeName !== receipt.containerName ||
            receipt.networkName !== receipt.containerName || receipt.bucket !== 'moveout-test-' + receipt.runId ||
            receipt.namespace !== 'item-images-test-' + receipt.runId || receipt.imageId !== artifact.amd64ImageId ||
            !Number.isInteger(receipt.port) || receipt.port < 1024 || receipt.port > 65535 ||
            receipt.endpoint !== 'http://127.0.0.1:' + receipt.port) throw fixtureError('receipt');
        const observed = await Promise.all([
            docker(['info', '--format', '{{json .}}'], { signal, timeout: 2000 }),
            docker(['inspect', receipt.containerId], { signal, timeout: 2000 }),
            docker(['volume', 'inspect', receipt.volumeName], { signal, timeout: 2000 }),
            docker(['network', 'inspect', receipt.networkName], { signal, timeout: 2000 })
        ]);
        const state = { daemon: JSON.parse(observed[0].stdout), container: JSON.parse(observed[1].stdout)[0],
            volume: JSON.parse(observed[2].stdout)[0], network: JSON.parse(observed[3].stdout)[0] };
        try { validateResources(receipt, state); } catch (error) { throw fixtureError('identity_mismatch'); }
        if (!state.container.State.Running) throw fixtureError('not_running');
        return state.container;
    }
    async function verify(candidate, signal) {
        if (!candidate || Object.keys(candidate).some(key => candidate[key] !== receipt[key])) throw fixtureError('receipt');
        await inspect(signal); return true;
    }
    const container = await inspect();
    const values = Object.fromEntries(container.Config.Env.map(entry => { const i = entry.indexOf('='); return [entry.slice(0, i), entry.slice(i + 1)]; }));
    const config = readItemImageStorageConfig({ ITEM_IMAGES_ENABLED: 'true', ITEM_IMAGE_STORAGE_DRIVER: 'seaweedfs-local',
        ITEM_IMAGE_STORAGE_ENVIRONMENT: 'test', ITEM_IMAGE_S3_REGION: 'us-east-1', ITEM_IMAGE_S3_ENDPOINT: receipt.endpoint,
        ITEM_IMAGE_S3_BUCKET: receipt.bucket, ITEM_IMAGE_NAMESPACE: receipt.namespace, ITEM_IMAGE_STORAGE_TARGET: fingerprint(receipt),
        ITEM_IMAGE_S3_ACCESS_KEY_ID: values.AWS_ACCESS_KEY_ID, ITEM_IMAGE_S3_SECRET_ACCESS_KEY: values.AWS_SECRET_ACCESS_KEY }, { receipt, verify });
    return { config, close: () => { closed = true; } };
}
module.exports = { createIsolatedSeaweedFS, openIsolatedSeaweedFS, validateResources, artifact };
