// Deterministic process death at real metadata/provider boundaries. Used only by
// the owned-local B4 suite, never imported by the application.
const { ObjectId } = require('mongodb');
const { S3Client } = require('@aws-sdk/client-s3');
const sharp = require('sharp');
const { openLocalMaintenance } = require('../../util/local-image-maintenance');
const { createLocalImageRecovery } = require('../../services/item-image-recovery');
const { createItemImagesService } = require('../../services/item-images');
const { processRaster } = require('../../services/item-image-processing');
async function main() {
    const input = JSON.parse(process.argv[2]);
    const context = await openLocalMaintenance(input.target);
    if (input.phase === 'cleanup_after_delete') {
        const original = S3Client.prototype.send;
        S3Client.prototype.send = async function (command, ...rest) {
            const result = await original.call(this, command, ...rest);
            if (command.constructor.name === 'DeleteObjectCommand') process.kill(process.pid, 'SIGKILL');
            return result;
        };
        const recovery = createLocalImageRecovery(context);
        await recovery.apply(input.manifest, input.confirmations);
    } else {
        const service = createItemImagesService({ connectToDatabase: async () => context.db, configuration: input.config });
        const claimed = await service.claim(new ObjectId(input.owner), input.plan, input.item, input.image);
        const bytes = await sharp({ create: { width: 800, height: 600, channels: 3, background: '#387ab2' } }).png().toBuffer();
        await service.prepareVariants(claimed.row, (await processRaster(bytes)).variants);
        if (input.phase === 'after_journal') await service.beginPut(claimed.row, 'thumbnail');
        process.kill(process.pid, 'SIGKILL');
    }
    throw new Error('Crash injection did not execute');
}
if (require.main === module) main().catch(() => { process.stderr.write('Local crash fixture refused.\n'); process.exit(1); });
