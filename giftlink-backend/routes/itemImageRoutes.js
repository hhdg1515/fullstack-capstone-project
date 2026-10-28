const express = require('express');
const { body } = require('express-validator');
const { rateLimit } = require('express-rate-limit');
const { validate } = require('../middleware/validation');
const { errorResponse } = require('../middleware/identity');
const { createItemImagesService } = require('../services/item-images');
const { ceiling } = require('../services/item-image-policy');

const revision = () => body('imageRevision').custom(value => Number.isSafeInteger(value) && value >= 0).withMessage('Use the current photo revision.');
function createItemImageRoutes({ connectToDatabase, configuration, controlLimit = 20, pipeline = null }) {
    const router = express.Router({ mergeParams: true });
    const service = createItemImagesService({ connectToDatabase, configuration });
    router.use((req, res, next) => {
        if (Object.keys(req.query).length) return errorResponse(res, 400, 'VALIDATION_FAILED', 'This metadata endpoint has no query parameters.');
        next();
    });
    router.use(rateLimit({ windowMs: 60000, limit: controlLimit, standardHeaders: 'draft-7', legacyHeaders: false,
        handler: (req, res) => errorResponse(res, 429, 'IMAGE_CONTROL_LIMIT', 'Too many photo metadata requests. Wait a minute before retrying.') }));
    router.param('imageId', (req, res, next, value) => /^[a-fA-F0-9]{24}$/.test(value) ? next() : errorResponse(res, 404, 'IMAGE_UNAVAILABLE', 'Photo or item unavailable.'));
    const actor = req => [req.user._id, req.params.planId, req.params.itemId];
    if (pipeline) router.put('/:imageId/content', pipeline.upload);
    router.get('/', async (req, res, next) => { try { res.json(await service.list(...actor(req))); } catch (error) { next(error); } });
    router.get('/:imageId', async (req, res, next) => { try { res.json(await service.status(...actor(req), req.params.imageId)); } catch (error) { next(error); } });
    router.post('/uploads', validate(['imageRevision', 'clientUploadId', 'byteLength', 'sha256'], [revision(),
        body('clientUploadId').isString().bail().isUUID(4).withMessage('Use a random version 4 upload ID.').toLowerCase(),
        body('sha256').isString().bail().matches(/^[a-fA-F0-9]{64}$/).withMessage('Use the selected file SHA-256.').toLowerCase(),
        body('byteLength').custom(value => Number.isSafeInteger(value) && value >= 1 && value <= ceiling.inputBytes).withMessage('Declare 1 byte to 3 MiB.')
    ]), async (req, res, next) => {
        try { const result = await service.reserve(...actor(req), req.body); res.status(result.created ? 201 : 200).json(result.body); } catch (error) { next(error); }
    });
    router.post('/order', validate(['imageRevision', 'imageIds'], [revision(),
        body('imageIds').isArray({ max: ceiling.photos }).withMessage('List all ready photo IDs, at most five.')
    ]), async (req, res, next) => { try { res.json(await service.reorder(...actor(req), req.body)); } catch (error) { next(error); } });
    router.post('/:imageId/actions', validate(['imageRevision', 'action'], [revision(), body('action').equals('delete').withMessage('Use the delete action.')]),
        async (req, res, next) => {
            try { const result = await service.remove(...actor(req), req.params.imageId, req.body); res.status(result.status).json(result.body); } catch (error) { next(error); }
        });
    return router;
}
module.exports = createItemImageRoutes;
