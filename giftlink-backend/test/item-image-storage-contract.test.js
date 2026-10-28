/* jshint loopfunc: true */
const assert = require('node:assert/strict');
const { randomBytes, randomUUID, createHash } = require('node:crypto');
const http = require('node:http');
const fs = require('node:fs');
const { execFileSync } = require('node:child_process');
const { NodeHttpHandler } = require('@smithy/node-http-handler');
const { GetObjectCommand, HeadObjectCommand, HeadBucketCommand, PutObjectCommand } = require('@aws-sdk/client-s3');
const { createIsolatedSeaweedFS, validateResources, artifact } = require('./helpers/isolated-seaweedfs');

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const data = Buffer.from([0, 1, 254, 255, 15, 128, 0]);
const errorCategory = category => error => error.category === category && !error.message.includes('Secret');

describe('real SeaweedFS S3 contracts on verified disposable Docker resources', function () {
    this.timeout(180000);
    let fixture, storage, raw;
    const key = () => fixture.receipt.namespace + '/' + randomBytes(12).toString('hex') + '/' + randomUUID() + '/display.webp';
    const get = (objectKey, bytes = data) => ({ key: objectKey, byteLength: bytes.length, sha256: sha256(bytes) });
    before(async function () {
        fixture = await createIsolatedSeaweedFS(); storage = fixture.storage(); raw = fixture.client();
    });
    after(async function () { if (fixture) await fixture.close(); });

    it('verifies the exact owned live target and persists a credential-free ownership receipt', async function () {
        assert.deepEqual(await fixture.snapshot(), { running: true, owned: true });
        const saved = JSON.parse(fs.readFileSync(fixture.receiptPath));
        assert.equal(saved.containerId, fixture.receipt.containerId);
        assert.equal(saved.imageId, artifact.amd64ImageId);
        assert.equal(saved.endpoint, 'http://127.0.0.1:' + saved.port);
        assert.equal(saved.bucket, 'moveout-test-' + saved.runId);
        assert.equal(saved.secretAccessKey, undefined); assert.equal(saved.accessKeyId, undefined);
        if (process.platform !== 'win32') assert.equal(fs.statSync(fixture.receiptPath).mode & 0o777, 0o600);
    });
    it('writes, heads, reads exact synthetic bytes and exposes only the expected variant metadata', async function () {
        const objectKey = key();
        assert.equal((await storage.putVariant({ key: objectKey, body: data })).outcome, 'stored');
        const meta = await storage.headVariant({ key: objectKey });
        assert.deepEqual(meta, { outcome: 'present', byteLength: data.length, contentType: 'image/webp', sha256: sha256(data) });
        assert.deepEqual((await storage.getVariant(get(objectKey))).body, data);
        const headers = await raw.send(new HeadObjectCommand({ Bucket: fixture.receipt.bucket, Key: objectKey }));
        assert.equal(headers.ContentType, 'image/webp'); assert.equal(headers.CacheControl, 'no-store');
        assert.equal(headers.ContentDisposition, 'inline; filename="item.webp"');
        assert.deepEqual(headers.Metadata, { sha256: sha256(data) });
    });
    it('rejects anonymous and incorrectly signed reads of the private object', async function () {
        const objectKey = key(); await storage.putVariant({ key: objectKey, body: data });
        const status = await new Promise((resolve, reject) => {
            const request = http.get(fixture.receipt.endpoint + '/' + fixture.receipt.bucket + '/' + objectKey,
                { agent: new http.Agent({ keepAlive: false }), timeout: 2000 }, response => {
                    response.resume(); response.on('end', () => resolve(response.statusCode));
                });
            request.on('timeout', () => request.destroy(new Error('Local anonymous read timeout')));
            request.on('error', reject);
        });
        assert.equal(status, 403);
        await fixture.verify();
        const wrong = fixture.client(true);
        await assert.rejects(wrong.send(new GetObjectCommand({ Bucket: fixture.receipt.bucket, Key: objectKey })),
            error => error.$metadata.httpStatusCode === 403);
        assert.deepEqual((await storage.getVariant(get(objectKey))).body, data);
    });
    it('keeps a confirmed missing GET distinct from a bare missing HEAD and a missing bucket', async function () {
        const missing = key();
        await assert.rejects(storage.getVariant(get(missing)), errorCategory('not_found'));
        await assert.rejects(storage.headVariant({ key: missing }), errorCategory('unconfirmed_absence'));
        await fixture.verify();
        await assert.rejects(raw.send(new GetObjectCommand({ Bucket: 'missing-' + randomBytes(12).toString('hex'), Key: missing })),
            error => error.name === 'NoSuchBucket' && error.$metadata.httpStatusCode === 404);
    });
    it('honors If-None-Match: * across separate adapter instances without overwriting', async function () {
        const objectKey = key(); await storage.putVariant({ key: objectKey, body: data });
        const other = fixture.storage();
        await assert.rejects(other.putVariant({ key: objectKey, body: Buffer.from('different synthetic bytes') }),
            error => error.category === 'conflict' && error.outcome === 'rejected');
        assert.deepEqual((await storage.getVariant(get(objectKey))).body, data);
    });
    it('admits exactly one of four concurrent conditional writers, with winner bytes intact', async function () {
        // Separate clients ensure this exercises server atomicity, not the in-memory PUT set.
        for (let round = 0; round < 3; round++) {
            const objectKey = key();
            const candidates = Array.from({ length: 4 }, (_, index) => Buffer.from('race-' + round + '-' + index));
            const results = await Promise.all(candidates.map(async bytes => {
                const client = fixture.storage();
                try { await client.putVariant({ key: objectKey, body: bytes }); return { bytes }; }
                catch (error) { return { error }; }
            }));
            const winners = results.filter(result => result.bytes);
            assert.equal(winners.length, 1);
            assert.ok(results.filter(result => result.error).every(result => result.error.category === 'conflict'));
            assert.deepEqual((await storage.getVariant(get(objectKey, winners[0].bytes))).body, winners[0].bytes);
        }
    });
    it('accepts the adapter maximum display size and preserves a thumbnail independently', async function () {
        const bytes = Buffer.alloc(1024 * 1024, 193); const objectKey = key();
        const thumbnail = objectKey.replace('/display.webp', '/thumbnail.webp');
        await storage.putVariant({ key: objectKey, body: bytes });
        await storage.putVariant({ key: thumbnail, body: data });
        assert.deepEqual((await storage.getVariant(get(objectKey, bytes))).body, bytes);
        await storage.deleteVariant({ key: objectKey });
        assert.deepEqual((await storage.getVariant(get(thumbnail))).body, data);
    });
    it('deletes an exact object idempotently while preserving its sibling', async function () {
        const objectKey = key(), sibling = key();
        await storage.putVariant({ key: objectKey, body: data }); await storage.putVariant({ key: sibling, body: data });
        assert.equal((await storage.deleteVariant({ key: objectKey })).outcome, 'delete_acknowledged');
        assert.equal((await storage.deleteVariant({ key: objectKey })).outcome, 'delete_acknowledged');
        await assert.rejects(storage.getVariant(get(objectKey)), errorCategory('not_found'));
        assert.deepEqual((await storage.getVariant(get(sibling))).body, data);
    });
    it('does not auto-create a bucket on an otherwise valid PUT', async function () {
        const bucket = 'missing-' + randomBytes(12).toString('hex');
        await fixture.verify();
        await assert.rejects(raw.send(new PutObjectCommand({ Bucket: bucket, Key: key(), Body: data, IfNoneMatch: '*' })),
            error => error.name === 'NoSuchBucket' && error.$metadata.httpStatusCode === 404);
        await assert.rejects(raw.send(new HeadBucketCommand({ Bucket: bucket })), error => error.$metadata.httpStatusCode === 404);
    });
    it('rejects namespace escapes and malformed target confirmations before modifying native data', async function () {
        const objectKey = key(); await storage.putVariant({ key: objectKey, body: data });
        for (const invalid of ['../escape', objectKey.replace(fixture.receipt.namespace, 'foreign'), objectKey + '?token=x']) {
            await assert.rejects(storage.deleteVariant({ key: invalid }), errorCategory('invalid_input'));
        }
        await assert.rejects(fixture.verify(Object.assign({}, fixture.receipt, { containerId: '0'.repeat(64) })),
            error => error.code === 'ISOLATED_STORAGE_TARGET_MISMATCH');
        assert.deepEqual((await storage.getVariant(get(objectKey))).body, data);
    });
    it('records a committed native PUT with a lost response as indeterminate and never replays it', async function () {
        const objectKey = key(); let puts = 0;
        const delegate = new NodeHttpHandler({ requestTimeout: 2000, throwOnRequestTimeout: true });
        const transport = {
            destroy: () => delegate.destroy(),
            handle: async (request, options) => {
                const result = await delegate.handle(request, options);
                if (request.method === 'PUT') {
                    puts++;
                    // The real server has replied successfully; lose that reply at the client transport.
                    assert.equal(result.response.statusCode, 200); result.response.body.destroy();
                    throw Object.assign(new Error('Synthetic lost response'), { code: 'ECONNRESET' });
                }
                return result;
            }
        };
        const uncertain = fixture.storage({ requestHandler: transport });
        await assert.rejects(uncertain.putVariant({ key: objectKey, body: data }),
            error => error.category === 'provider' && error.outcome === 'indeterminate');
        assert.deepEqual((await storage.getVariant(get(objectKey))).body, data);
        await assert.rejects(uncertain.putVariant({ key: objectKey, body: data }), errorCategory('put_already_attempted'));
        assert.equal(puts, 1);
    });
    it('refuses foreign cleanup receipts and keeps the owned service available', async function () {
        await assert.rejects(fixture.close(Object.freeze(Object.assign({}, fixture.receipt))),
            error => error.code === 'ISOLATED_STORAGE_CLEANUP_RECEIPT');
        assert.deepEqual(await fixture.snapshot(), { running: true, owned: true });
    });
    it('rechecks resource receipt snapshots and rejects substituted mounts, images, ports and networks', function () {
        const r = Object.assign({}, fixture.receipt, { credentialsSha256: sha256('test' + '0'.repeat(16) + ':' + 'a'.repeat(64)) });
        const labels = { 'com.moveout.storage-test': r.runId, 'com.moveout.storage-test.nonce': r.nonce };
        const model = { daemon: { ID: r.daemonId, OSType: 'linux', Architecture: 'x86_64' },
            container: { Id: r.containerId, Name: '/' + r.containerName, Image: artifact.amd64ImageId,
                Config: { User: '1000:1000', Labels: labels, Entrypoint: ['/usr/bin/weed'], Cmd: artifact.arguments,
                    Env: ['AWS_ACCESS_KEY_ID=test' + '0'.repeat(16), 'AWS_SECRET_ACCESS_KEY=' + 'a'.repeat(64), 'S3_BUCKET=', 'S3_TABLE_BUCKET='] },
                HostConfig: { ReadonlyRootfs: true, CapDrop: ['ALL'], Privileged: false, NetworkMode: r.networkName,
                    Binds: null, PublishAllPorts: false, SecurityOpt: ['no-new-privileges'], Memory: 768 * 1024 * 1024,
                    NanoCpus: 2e9, PidsLimit: 256, Tmpfs: { '/tmp': 'rw,noexec,nosuid,size=64m' },
                    PortBindings: { '8333/tcp': [{ HostIp: '127.0.0.1', HostPort: '' }] } },
                Mounts: [{ Type: 'volume', Name: r.volumeName, Destination: '/data', RW: true }], State: { Running: true },
                NetworkSettings: { Ports: { '8333/tcp': [{ HostIp: '127.0.0.1', HostPort: String(r.port) }] },
                    Networks: { [r.networkName]: { NetworkID: r.networkId } } } },
            volume: { Name: r.volumeName, Driver: 'local', Options: null, Labels: labels },
            network: { Id: r.networkId, Name: r.networkName, Internal: false, Labels: labels,
                Options: { 'com.docker.network.bridge.enable_ip_masquerade': 'false', 'com.docker.network.bridge.enable_icc': 'false' },
                Containers: { [r.containerId]: {} } } };
        assert.equal(validateResources(r, model), true);
        const corrupt = [s => { s.container.Image = 'sha256:' + '0'.repeat(64); }, s => { s.volume.Name = 'foreign'; },
            s => { s.container.HostConfig.Binds = ['/foreign:/data']; }, s => { s.daemon.ID = 'remote'; },
            s => { s.container.Config.Env[1] = 'AWS_SECRET_ACCESS_KEY=' + 'b'.repeat(64); },
            s => { s.container.Config.Cmd = s.container.Config.Cmd.filter(arg => arg !== '-s3.iam=false'); },
            s => { s.network.Containers.foreign = {}; }, s => { s.network.Options['com.docker.network.bridge.enable_icc'] = 'true'; },
            s => { s.container.NetworkSettings.Ports['8333/tcp'][0].HostIp = '0.0.0.0'; }];
        for (const change of corrupt) { const state = JSON.parse(JSON.stringify(model)); change(state); assert.throws(() => validateResources(r, state)); }
    });
    it('closes clients and removes only receipt-owned container, volume, network and receipt', async function () {
        const receipt = fixture.receipt, receiptPath = fixture.receiptPath;
        await fixture.close(); await fixture.close();
        await assert.rejects(storage.headVariant({ key: key() }), errorCategory('closed'));
        assert.equal(fs.existsSync(receiptPath), false);
        const host = process.platform === 'win32' ? 'npipe:////./pipe/docker_engine' : 'unix:///var/run/docker.sock';
        const env = Object.assign({}, process.env);
        for (const name of ['DOCKER_HOST', 'DOCKER_CONTEXT', 'DOCKER_TLS', 'DOCKER_TLS_VERIFY', 'DOCKER_CERT_PATH']) delete env[name];
        function docker(args) { return execFileSync('docker', ['--host=' + host].concat(args), { env, encoding: 'utf8', timeout: 5000, windowsHide: true }).trim(); }
        assert.equal(docker(['ps', '-aq', '--filter', 'id=' + receipt.containerId]), '');
        assert.equal(docker(['volume', 'ls', '--filter', 'name=^' + receipt.volumeName + '$', '--format', '{{.Name}}']), '');
        assert.equal(docker(['network', 'ls', '--filter', 'id=' + receipt.networkId, '--format', '{{.ID}}']), '');
    });
});
