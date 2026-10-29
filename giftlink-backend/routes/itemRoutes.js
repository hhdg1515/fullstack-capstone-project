const express = require('express');
const { body } = require('express-validator');
const { rateLimit } = require('express-rate-limit');
const { validate } = require('../middleware/validation');
const { errorResponse } = require('../middleware/identity');
const { isCalendarDate } = require('../services/calendar');
const { createInventoryService } = require('../services/inventory');
const { createDiscoveryService } = require('../services/discovery');
const id = value => /^[a-fA-F0-9]{24}$/.test(value);
const text = (field, max, required) => body(field).isString().bail().trim().isLength({ min: required ? 1 : 0, max }).bail()
    .not().matches(required ? /[<>\u0000-\u001f\u007f]/ : /[<>\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/)
    .withMessage('Use bounded plain text without markup or control characters');
function itemRules(editing) {
    const name = text('name', 160, true); if (editing) name.optional();
    const rules = [name, text('description', 2000, false).optional(), text('category', 80, false).optional(),
        body(['availableFrom', 'availableUntil']).optional({ nullable: true }).custom(isCalendarDate).withMessage('Use a valid YYYY-MM-DD calendar date')];
    if (editing) rules.push(body('version').isInt({ min: 1 }).custom(value => typeof value === 'number'), body('confirmCancelRequests').optional().custom(value => typeof value === 'boolean'));
    rules.push(body('publish').optional().isBoolean().custom(value => typeof value === 'boolean'));
    return validate(['name', 'description', 'category', 'categoryId', 'itemTypeId', 'customItemType', 'condition', 'availableFrom', 'availableUntil', 'publish'].concat(editing ? ['version', 'confirmCancelRequests'] : []), rules, editing);
}
function createItemRoutes({ connectToDatabase, auth, discoveryLimit = 120, imageMetadata = null, imageControlLimit = 20, pipeline = null }) {
    const service = createInventoryService({ connectToDatabase, imageMetadata, imageRead: Boolean(imageMetadata && pipeline) });
    const discovery = createDiscoveryService({ connectToDatabase, imageMetadata, imageRead: Boolean(imageMetadata && pipeline) });
    const privateRouter = express.Router({ mergeParams: true });
    privateRouter.use(auth.requireAuth, (req, res, next) => {
        if (!id(req.params.planId)) return errorResponse(res, 404, 'ITEM_NOT_FOUND', 'Item or plan not found');
        next();
    });
    privateRouter.param('itemId', (req, res, next, value) => id(value) ? next() : errorResponse(res, 404, 'ITEM_NOT_FOUND', 'Item or plan not found'));
    if (imageMetadata) privateRouter.use('/:itemId/images', require('./itemImageRoutes')({ connectToDatabase,
        configuration: imageMetadata, controlLimit: imageControlLimit, pipeline }));
    privateRouter.get('/', async (req, res, next) => {
        try { res.json(Object.assign(await service.list(req.user._id, req.params.planId), {
                photoCapabilities: { metadata: Boolean(imageMetadata), binaryUpload: Boolean(imageMetadata && pipeline), imageRead: Boolean(imageMetadata && pipeline) }
            })); } catch (error) { next(error); }
    });
    privateRouter.post('/', itemRules(false), async (req, res, next) => {
        try { res.status(201).json(await service.create(req.user._id, req.params.planId, req.body)); } catch (error) { next(error); }
    });
    privateRouter.patch('/:itemId', itemRules(true), async (req, res, next) => {
        try { res.json(await service.mutate(req.user._id, req.params.planId, req.params.itemId, req.body)); } catch (error) { next(error); }
    });
    privateRouter.post('/:itemId/actions', validate(['action', 'version', 'confirmCancelRequests'], [
        body('confirmCancelRequests').optional().custom(value => typeof value === 'boolean'),
        body('action').isString().bail().isIn(['publish', 'unlist', 'clear', 'reopen']), body('version').isInt({ min: 1 }).custom(value => typeof value === 'number')
    ]), async (req, res, next) => {
        try { res.json(await service.mutate(req.user._id, req.params.planId, req.params.itemId, req.body, req.body.action)); } catch (error) { next(error); }
    });
    const publicRouter = express.Router();
    publicRouter.use((req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
    publicRouter.use(rateLimit({ windowMs: 60000, limit: discoveryLimit, standardHeaders: 'draft-7', legacyHeaders: false,
        handler: (req, res) => errorResponse(res, 429, 'DISCOVERY_RATE_LIMIT', 'Too many discovery requests. Please wait a minute and retry.') }));
    publicRouter.get('/', auth.optionalAuth, async (req, res, next) => {
        try { res.json(await discovery.browse(req.query, req.user && req.user._id)); } catch (error) { next(error); }
    });
    publicRouter.get('/locations', async (req, res, next) => {
        try { res.json(await discovery.locations(req.query)); } catch (error) { next(error); }
    });
    publicRouter.get('/:itemId', auth.optionalAuth, async (req, res, next) => {
        try { res.json(await discovery.detail(req.params.itemId, req.user && req.user._id)); } catch (error) { next(error); }
    });
    return { privateRouter, publicRouter };
}
module.exports = createItemRoutes;
