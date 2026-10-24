const express = require('express');
const { body, query, validationResult } = require('express-validator');
const { validate } = require('../middleware/validation');
const { errorResponse } = require('../middleware/identity');
const { isCalendarDate } = require('../services/calendar');
const { createInventoryService } = require('../services/inventory');
const id = value => /^[a-fA-F0-9]{24}$/.test(value);
const text = (field, max, required) => body(field).isString().bail().trim().isLength({ min: required ? 1 : 0, max }).bail()
    .not().matches(required ? /[<>\u0000-\u001f\u007f]/ : /[<>\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/)
    .withMessage('Use bounded plain text without markup or control characters');
function itemRules(editing) {
    const name = text('name', 160, true); if (editing) name.optional();
    const rules = [name, text('description', 2000, false).optional(), text('category', 80, false).optional(),
        body(['availableFrom', 'availableUntil']).optional({ nullable: true }).custom(isCalendarDate).withMessage('Use a valid YYYY-MM-DD calendar date')];
    if (editing) rules.push(body('version').isInt({ min: 1 }).custom(value => typeof value === 'number'));
    else rules.push(body('publish').optional().isBoolean().custom(value => typeof value === 'boolean'));
    return validate(['name', 'description', 'category', 'availableFrom', 'availableUntil', editing ? 'version' : 'publish'], rules, editing);
}
function createItemRoutes({ connectToDatabase, auth }) {
    const service = createInventoryService({ connectToDatabase });
    const privateRouter = express.Router({ mergeParams: true });
    privateRouter.use(auth.requireAuth, (req, res, next) => {
        if (!id(req.params.planId)) return errorResponse(res, 404, 'ITEM_NOT_FOUND', 'Item or plan not found');
        next();
    });
    privateRouter.param('itemId', (req, res, next, value) => id(value) ? next() : errorResponse(res, 404, 'ITEM_NOT_FOUND', 'Item or plan not found'));
    privateRouter.get('/', async (req, res, next) => {
        try { res.json(await service.list(req.user._id, req.params.planId)); } catch (error) { next(error); }
    });
    privateRouter.post('/', itemRules(false), async (req, res, next) => {
        try { res.status(201).json(await service.create(req.user._id, req.params.planId, req.body)); } catch (error) { next(error); }
    });
    privateRouter.patch('/:itemId', itemRules(true), async (req, res, next) => {
        try { res.json(await service.mutate(req.user._id, req.params.planId, req.params.itemId, req.body)); } catch (error) { next(error); }
    });
    privateRouter.post('/:itemId/actions', validate(['action', 'version'], [
        body('action').isString().bail().isIn(['publish', 'unlist', 'clear', 'reopen']), body('version').isInt({ min: 1 }).custom(value => typeof value === 'number')
    ]), async (req, res, next) => {
        try { res.json(await service.mutate(req.user._id, req.params.planId, req.params.itemId, req.body, req.body.action)); } catch (error) { next(error); }
    });
    const publicRouter = express.Router();
    publicRouter.use((req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
    publicRouter.get('/', query(['q', 'city', 'neighborhood']).optional().isString().bail().trim().isLength({ max: 100 }), async (req, res, next) => {
        if (!validationResult(req).isEmpty()) return errorResponse(res, 400, 'VALIDATION_FAILED', 'Use search text of at most 100 characters');
        try { res.json({ items: await service.publicRead({ q: req.query.q, city: req.query.city, neighborhood: req.query.neighborhood }) }); } catch (error) { next(error); }
    });
    publicRouter.get('/:itemId', async (req, res, next) => {
        try {
            const rows = id(req.params.itemId) ? await service.publicRead({ id: req.params.itemId }) : [];
            if (!rows.length) return errorResponse(res, 404, 'ITEM_NOT_FOUND', 'Listing unavailable');
            res.json({ item: rows[0] });
        } catch (error) { next(error); }
    });
    return { privateRouter, publicRouter };
}
module.exports = createItemRoutes;
