const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const { execFileSync } = require('node:child_process');
const { ObjectId, BSON } = require('mongodb');
const { randomUUID } = require('node:crypto');
const sinon = require('sinon');
const { S3Client } = require('@aws-sdk/client-s3');
const { r2Environment, blockProviderNetwork } = require('./helpers/r2-fixture');
const { createIsolatedMongo } = require('./helpers/isolated-mongo');
const { createIsolatedSeaweedFS } = require('./helpers/isolated-seaweedfs');
const { prepareDatabaseIndexes } = require('../services/database-indexes');
const { createItemImagesService } = require('../services/item-images');
const { openLocalMaintenance } = require('../util/local-image-maintenance');
const readiness = require('../util/inspect-photo-readiness');
const summary = require('../util/summarize-local-photo-operations');
const { approvalIdentity } = require('../services/r2-image-storage-config');

describe('offline photo readiness diagnostics', function () {
    blockProviderNetwork(); let f;
    beforeEach(async () => { f = await r2Environment(); });
    afterEach(() => f.close());
    it('does not import an S3 SDK, load disabled receipt files, resolve hosts or open a socket', function () {
        const script = `
            const Module = require('node:module'), load = Module._load;
            Module._load = function(name) { if (/^@aws-sdk|^@smithy/.test(name)) throw Error('SDK'); return load.apply(this, arguments); };
            const forbidden = () => { throw Error('network'); };
            require('node:net').Socket.prototype.connect = forbidden; require('node:tls').connect = forbidden;
            const dns = require('node:dns'); dns.lookup = forbidden; dns.resolveSrv = forbidden;
            dns.promises.lookup = forbidden; dns.promises.resolveSrv = forbidden;
            const fs = require('node:fs'), read = fs.readFileSync;
            fs.readFileSync = function(name) { if (name === '/never-read-receipt') throw Error('receipt'); return read.apply(this, arguments); };
            const p = require('./util/inspect-photo-readiness');
            const disabled = p.inspect({ ITEM_IMAGE_R2_APPROVAL_FILE: '/never-read-receipt', MONGO_URL: 'mongodb+srv://must-not-contact.invalid/test' });
            if (!disabled.configurationValid || disabled.hostedTrialReady) process.exit(2);
            const configured = p.inspect(JSON.parse(process.env.SYNTHETIC_PHOTO_SETTINGS));
            if (!configured.configurationValid || configured.hostedTrialReady) process.exit(3);
        `;
        execFileSync(process.execPath, ['-e', script], { cwd: path.resolve(__dirname, '..'), timeout: 10000,
            env: Object.assign({}, process.env, { SYNTHETIC_PHOTO_SETTINGS: JSON.stringify(f.env) }) });
    });
    it('reports only allowlisted facts and fingerprints, never authority, filenames or private identities', function () {
        const output = readiness.inspect(f.env); assert.equal(output.configurationValid, true); assert.equal(output.hostedTrialReady, false);
        assert.equal(output.fingerprints.storage, f.env.ITEM_IMAGE_R2_TARGET);
        assert.equal(output.checks.find(c => c.name === 'approval_receipt').category, 'receipt_valid');
        const text = JSON.stringify(output);
        for (const value of [f.privateKey, f.env.ITEM_IMAGE_R2_ACCESS_KEY_ID, f.env.ITEM_IMAGE_R2_SECRET_ACCESS_KEY, f.env.ITEM_IMAGE_R2_APPROVAL_FILE,
            f.env.ITEM_IMAGE_R2_NAMESPACE, f.env.ITEM_IMAGE_R2_BUCKET, f.env.MONGO_URL, f.env.MONGO_DB_NAME, f.approval.signature, f.approval.credentialsFingerprint]) assert.ok(!text.includes(value));
    });
    it('distinguishes trusted expiration/future dates from unreadable or untrusted receipts', function () {
        const expected = approvalIdentity(f.env);
        assert.equal(readiness.receiptCheck(f.env, expected, Date.parse(f.approval.expiresAt)).category, 'receipt_expired');
        assert.equal(readiness.receiptCheck(f.env, expected, Date.parse(f.approval.issuedAt) - 1).category, 'receipt_not_yet_valid');
        fs.writeFileSync(f.env.ITEM_IMAGE_R2_APPROVAL_FILE, JSON.stringify(Object.assign({}, f.approval, { expiresAt: 'private-sentinel' })));
        assert.equal(readiness.receiptCheck(f.env, expected).category, 'receipt_identity_or_signature_invalid');
        fs.unlinkSync(f.env.ITEM_IMAGE_R2_APPROVAL_FILE);
        assert.equal(readiness.receiptCheck(f.env, expected).category, 'receipt_unreadable');
    });
    it('refuses missing credentials, wrong fingerprint, wrong namespace, missing metadata and invalid gates without connecting', function () {
        for (const changes of [{ ITEM_IMAGE_R2_SECRET_ACCESS_KEY: undefined }, { ITEM_IMAGE_R2_TARGET: '0'.repeat(64) },
            { ITEM_IMAGE_NAMESPACE: 'item-images-staging-' + '0'.repeat(32) }, { ITEM_IMAGE_METADATA_ENABLED: 'false' }, { ITEM_IMAGE_R2_ENABLED: 'yes' }, { ITEM_IMAGES_ENABLED: 'true' }, { PHOTO_APPROVAL_PRIVATE_KEY: f.privateKey }]) {
            assert.equal(readiness.inspect(Object.assign({}, f.env, changes)).configurationValid, false);
        }
    });
    it('rejects wrong signer/role and unsafe receipt files without relaying error text', async function () {
        const other = await r2Environment();
        try {
            const altered = Object.assign({}, f.env, { ITEM_IMAGE_R2_APPROVAL_PUBLIC_KEY: other.env.ITEM_IMAGE_R2_APPROVAL_PUBLIC_KEY });
            assert.equal(readiness.receiptCheck(altered, approvalIdentity(f.env)).category, 'receipt_identity_or_signature_invalid');
            assert.equal(readiness.receiptCheck(f.env, Object.assign({}, approvalIdentity(f.env), { role: 'recovery' })).category, 'receipt_identity_or_signature_invalid');
            const link = path.join(f.directory, 'unsafe.json'); fs.symlinkSync(f.env.ITEM_IMAGE_R2_APPROVAL_FILE, link);
            assert.equal(readiness.receiptCheck(Object.assign({}, f.env, { ITEM_IMAGE_R2_APPROVAL_FILE: link }), approvalIdentity(f.env)).category, 'receipt_unreadable');
        } finally { other.close(); }
    });
    it('requires an explicit offline operation and returns failure for invalid configuration', function () {
        for (const args of [[], ['--apply'], ['--offline', '--allow-remote'], ['--offline', '--offline']]) assert.throws(() => readiness.run(args));
        assert.equal(readiness.run(['--offline'], () => {}, {}), 0);
        assert.equal(readiness.run(['--offline'], () => {}, { ITEM_IMAGE_METADATA_ENABLED: 'yes' }), 1);
    });
    it('never prints credentials accidentally pasted into a validly signed fingerprint configuration', function () {
        f.env.ITEM_IMAGE_R2_SECRET_ACCESS_KEY = f.env.ITEM_IMAGE_R2_DATABASE_TARGET; f.approve();
        const report = readiness.inspect(f.env); assert.equal(report.configurationValid, false);
        assert.equal(report.fingerprints.database, undefined); assert.ok(!JSON.stringify(report).includes(f.env.ITEM_IMAGE_R2_SECRET_ACCESS_KEY));
    });
});

describe('bounded local photo backlog inspection with actual receipt-verified fixtures', function () {
    this.timeout(180000); blockProviderNetwork(); let mongo, fixture, context, db, service, target, owner, item, plan;
    before(async function () {
        mongo = await createIsolatedMongo(); db = mongo.db; await prepareDatabaseIndexes(db); fixture = await createIsolatedSeaweedFS();
        target = { mongoReceiptPath: mongo.receiptPath, storageReceiptPath: fixture.receiptPath, databaseName: mongo.dbName,
            environment: 'development', provider: 'seaweedfs-local', bucket: fixture.receipt.bucket, namespace: fixture.receipt.namespace };
        context = await openLocalMaintenance(target);
        service = createItemImagesService({ connectToDatabase: async () => db, configuration: { storageBinding: {
            fingerprint: fixture.config.targetFingerprint, namespace: fixture.receipt.namespace }, limits: {
            attempts: 50, successes: 20, accountBytes: 100 * 1024 * 1024, concurrent: 2, records: 1000 } } });
    });
    beforeEach(async function () {
        for (const name of ['users', 'moveOutPlans', 'items', 'itemImages']) await db.collection(name).deleteMany({});
        owner = new ObjectId(); plan = new ObjectId(); item = new ObjectId(); const at = new Date();
        await db.collection('users').insertOne({ _id: owner, email: 'synthetic-private@example.invalid' });
        await db.collection('moveOutPlans').insertOne({ _id: plan, ownerId: owner, status: 'active', moveOutDeadline: '2099-01-01', inventoryRevision: 0, createdAt: at, updatedAt: at });
        await db.collection('items').insertOne({ _id: item, planId: plan, ownerId: owner, name: 'Synthetic private item', status: 'draft', version: 1, createdAt: at, updatedAt: at });
    });
    after(async function () { if (context) await context.close(); try { if (fixture) await fixture.close(); } finally { if (mongo) await mongo.close(); } });
    async function reserve() {
        const current = await db.collection('items').findOne({ _id: item });
        return service.reserve(owner, plan.toString(), item.toString(), { imageRevision: current.imageRevision || 0, clientUploadId: randomUUID(), byteLength: 10, sha256: 'a'.repeat(64) });
    }
    it('reports a bounded partial page without changing documents, quotas, indexes or storage', async function () {
        await reserve(); await reserve();
        const before = await db.collection('itemImages').find({}).toArray(), user = await db.collection('users').findOne({ _id: owner }), commands = [];
        const listener = event => commands.push(event.commandName); context.db.client.on('commandStarted', listener);
        const sends = sinon.stub(S3Client.prototype, 'send').callsFake(async () => { throw Error('No object access is allowed in this summary'); });
        let result;
        try { result = await summary.summarize(context, 1); assert.equal(sends.callCount, 0); }
        finally { sends.restore(); context.db.client.off('commandStarted', listener); }
        assert.equal(result.inspected, 1); assert.equal(result.hasMore, true); assert.equal(result.counts.activeProducerLease, 1); assert.equal(result.counts.future, 1);
        assert.equal(result.settlementVerified, false); assert.equal(result.objectPresenceVerified, false);
        assert.ok(commands.every(name => ['hello', 'aggregate', 'find', 'listIndexes', 'killCursors', 'getMore'].includes(name)), JSON.stringify(commands));
        assert.deepEqual(await db.collection('itemImages').find({}).toArray(), before); assert.deepEqual(await db.collection('users').findOne({ _id: owner }), user);
        const out = JSON.stringify(result); for (const value of [owner, item, plan, before[0]._id, before[0].generation, before[0].variants.thumbnail.key,
            fixture.receipt.namespace, fixture.receipt.bucket, 'synthetic-private@example.invalid']) assert.ok(!out.includes(String(value)));
    });
    it('retains unknown-write holds and reports them without treating time or a summary as settlement evidence', async function () {
        const reserved = await reserve(), id = reserved.body.upload.id, ticket = (await service.claim(owner, plan.toString(), item.toString(), id)).row;
        const { processRaster } = require('../services/item-image-processing'), sharp = require('sharp');
        const raw = await sharp({ create: { width: 8, height: 8, channels: 3, background: '#123456' } }).png().toBuffer();
        // This ledger-only drill issues a PUT permit, never an object write.
        await service.prepareVariants(ticket, (await processRaster(raw)).variants); await service.beginPut(ticket, 'thumbnail');
        const past = new Date(Date.now() - 60000); await db.collection('itemImages').updateOne({ _id: ticket._id }, { $set: { maintenanceDueAt: past, 'lease.expiresAt': past } });
        const before = BSON.serialize(await db.collection('users').findOne({ _id: owner }));
        const result = await summary.summarize(context); assert.equal(result.counts.unknownWriteOperations, 1); assert.equal(result.counts.due, 1); assert.equal(result.counts.unsettledOperations, 1);
        assert.deepEqual(BSON.serialize(await db.collection('users').findOne({ _id: owner })), before);
    });
    it('refuses forged contexts, mismatched storage records, invalid bounds and missing required indexes', async function () {
        await assert.rejects(summary.summarize(Object.assign({}, context)), e => e.summaryCategory === 'local_target_required');
        await assert.rejects(summary.summarize(context, 26), e => e.summaryCategory === 'invalid_limit');
        await reserve(); const current = await db.collection('itemImages').findOne({});
        await db.collection('itemImages').updateOne({ _id: current._id }, { $set: { 'storageBinding.fingerprint': '0'.repeat(64) } });
        await assert.rejects(summary.summarize(context), e => e.summaryCategory === 'storage_target_mismatch');
        await db.collection('itemImages').deleteMany({}); await db.collection('itemImages').dropIndex('images_due_work');
        try { await assert.rejects(summary.summarize(context)); assert.ok(!(await db.collection('itemImages').indexes()).some(i => i.name === 'images_due_work')); }
        finally { await prepareDatabaseIndexes(db); }
    });
    it('has a strictly local CLI with exact receipt targets and no remote/apply mode', async function () {
        const args = ['--local', '--mongo-receipt', mongo.receiptPath, '--storage-receipt', fixture.receiptPath, '--database', mongo.dbName,
            '--environment', 'development', '--provider', 'seaweedfs-local', '--bucket', fixture.receipt.bucket, '--namespace', fixture.receipt.namespace, '--limit', '1'];
        const reports = []; assert.equal(await summary.run(args, value => reports.push(value)), 0); assert.equal(reports[0].inspected, 0);
        for (const bad of [args.concat('--apply'), args.concat('--allow-remote'), args.concat('--limit', '26'), args.map(x => x === 'development' ? 'staging' : x)]) assert.throws(() => summary.parse(bad));
        await assert.rejects(summary.run(args.map(x => x === mongo.dbName ? 'unapproved' : x), () => {}));
    });
});
