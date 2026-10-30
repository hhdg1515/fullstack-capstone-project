const { r2StorageBinding } = require('./r2-image-storage-config');
const { createBoundedImageStorage } = require('./item-image-s3-core');
function createR2ImageStorage(config, options = {}) {
    const binding = r2StorageBinding(config);
    return createBoundedImageStorage(binding && Object.assign({}, binding, { putAllowed: config.uploadsEnabled }), options);
}
module.exports = { createR2ImageStorage };
