const express = require('express');
const { rateLimit } = require('express-rate-limit');
const { errorResponse } = require('../middleware/identity');
const { createOwnerListingService } = require('../services/owner-listings');
function createOwnerListingRoutes({ connectToDatabase, auth, ownerListingsEnabled, ownerListingPhotosEnabled = false, independentPickups = false, independentPublication = false, imageMetadata, imageControlLimit = 20, pipeline }) {
    const photos = ownerListingPhotosEnabled === true && Boolean(imageMetadata);
    const service = createOwnerListingService({ connectToDatabase, imageMetadata, imageRead: Boolean(imageMetadata && pipeline), independentPhotos: photos, independentPickups, independentPublication });
    const enabled = (req, res, next) => ownerListingsEnabled === true ? next() : errorResponse(res, 503, 'OWNER_LISTINGS_DISABLED', 'Independent owner listings are not enabled.');
    const limit = rateLimit({ windowMs: 60000, limit: 120, standardHeaders: 'draft-7', legacyHeaders: false,
        handler: (req, res) => errorResponse(res, 429, 'OWNER_LISTINGS_BUSY', 'Too many listing requests. Wait a minute and retry.') });
    const read = express.Router(), write = express.Router();
    const handle = action => async (req, res, next) => {
        try {
            const result = await action(req);
            const caps = pipeline ? await pipeline.capabilities() : { binaryUpload: false, imageRead: false };
            if (pipeline && !caps.imageRead) {
                for (const item of result.items || [result.item]) item.photoPreview = { availability: 'unavailable', images: [] };
            }
            // Independent photo controls are a server capability, not a client guess.
            result.publicationEnabled = independentPublication;
            result.photoCapabilities = { metadata: photos, binaryUpload: photos && caps.binaryUpload === true, imageRead: photos && caps.imageRead === true };
            res.status(req.method === 'POST' && !req.params.itemId ? 201 : 200).json(result);
        } catch (error) { next(error); }
    };
    read.use(auth.requireAuth, enabled, limit);
    read.get('/', handle(req => service.list(req.user._id, req.query)));
    read.get('/:itemId', handle(req => service.detail(req.user._id, req.params.itemId)));
    // No router-wide authentication here: GET public browsing must fall through.
    const guards = [auth.requireAuth, enabled, limit];
    write.post('/', guards, handle(req => service.create(req.user._id, req.body)));
    write.patch('/:itemId', guards, handle(req => service.mutate(req.user._id, req.params.itemId, req.body)));
    write.post('/:itemId/actions', guards, handle(req => service.mutate(req.user._id, req.params.itemId, req.body, true)));
    // UX-2C1: owner-only private photos for independent items, behind their own gate.
    const photoGate = (req, res, next) => photos ? next() : errorResponse(res, 503, 'OWNER_LISTING_PHOTOS_DISABLED', 'Photos for independent listings are not enabled.');
    const validItem = (req, res, next) => /^[a-fA-F0-9]{24}$/.test(req.params.itemId) ? next() : errorResponse(res, 404, 'IMAGE_UNAVAILABLE', 'Photo or item unavailable.');
    const imageRoutes = photos ? require('./itemImageRoutes')({ connectToDatabase, configuration: imageMetadata, controlLimit: imageControlLimit, pipeline, independent: true }) : null;
    write.use('/:itemId/images', auth.requireAuth, enabled, photoGate, validItem, (req, res, next) => imageRoutes(req, res, next));
    return { read, write };
}
module.exports = createOwnerListingRoutes;
