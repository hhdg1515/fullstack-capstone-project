const express = require('express');
const { rateLimit } = require('express-rate-limit');
const { errorResponse } = require('../middleware/identity');
const { createOwnerListingService } = require('../services/owner-listings');
function createOwnerListingRoutes({ connectToDatabase, auth, ownerListingsEnabled, imageMetadata, pipeline }) {
    const service = createOwnerListingService({ connectToDatabase, imageMetadata, imageRead: Boolean(imageMetadata && pipeline) });
    const enabled = (req, res, next) => ownerListingsEnabled === true ? next() : errorResponse(res, 503, 'OWNER_LISTINGS_DISABLED', 'Independent owner listings are not enabled.');
    const limit = rateLimit({ windowMs: 60000, limit: 120, standardHeaders: 'draft-7', legacyHeaders: false,
        handler: (req, res) => errorResponse(res, 429, 'OWNER_LISTINGS_BUSY', 'Too many listing requests. Wait a minute and retry.') });
    const read = express.Router(), write = express.Router();
    const handle = action => async (req, res, next) => {
        try {
            const result = await action(req);
            if (pipeline && !(await pipeline.capabilities()).imageRead) {
                for (const item of result.items || [result.item]) item.photoPreview = { availability: 'unavailable', images: [] };
            }
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
    return { read, write };
}
module.exports = createOwnerListingRoutes;
