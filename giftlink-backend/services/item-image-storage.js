const { storageBinding } = require('./item-image-storage-config');
const { createBoundedImageStorage } = require('./item-image-s3-core');

// Local entry remains opaque/live-Docker verified. No R2 config is accepted here.
function createItemImageStorage(config, options = {}) {
    const local = storageBinding(config);
    const binding = local && Object.assign({}, local, { protocol: 'http:', hostname: '127.0.0.1',
        port: local.receipt.port, region: 'us-east-1', role: 'local' });
    return createBoundedImageStorage(binding, options);
}
module.exports = { createItemImageStorage };
