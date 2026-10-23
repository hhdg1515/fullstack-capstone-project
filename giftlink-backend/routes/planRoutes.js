const express = require('express');
const { body } = require('express-validator');
const { validate } = require('../middleware/validation');
const { errorResponse } = require('../middleware/identity');
const { createPlanService, isCalendarDate, todayUTC } = require('../services/plans');

const label = (field, maximum) => body(field).isString().withMessage('Use text').bail().trim()
    .isLength({ min: 1, max: maximum }).withMessage('Use 1 to ' + maximum + ' characters').bail()
    .not().matches(/[\u0000-\u001f\u007f]/).withMessage('Use a single line of text');
function rules(editing) {
    const required = [body('moveOutDeadline').custom(isCalendarDate).withMessage('Use a valid calendar date (YYYY-MM-DD)'),
        label('city', 100), label('neighborhood', 100)];
    if (editing) required.forEach(rule => rule.optional());
    const title = body('title').optional().isString().withMessage('Use text').bail().trim()
        .isLength({ max: 120 }).withMessage('Use at most 120 characters').bail()
        .not().matches(/[\u0000-\u001f\u007f]/).withMessage('Use a single line of text');
    return validate(['title', 'moveOutDeadline', 'city', 'neighborhood'].concat(editing ? ['status'] : []),
        required.concat([title], editing ? [body('status').optional().isString().bail().isIn(['active', 'completed', 'cancelled'])
            .withMessage('Choose active, completed, or cancelled')] : []), editing);
}
function pastDeadline(res) {
    return res.status(400).json({ error: { code: 'VALIDATION_FAILED', message: 'Check your plan details',
        fields: [{ field: 'moveOutDeadline', message: 'Choose today or a later date (UTC)' }] } });
}

function createPlanRoutes({ connectToDatabase, auth }) {
    const router = express.Router();
    const plans = createPlanService({ connectToDatabase });
    router.use(auth.requireAuth);
    router.get('/', async (req, res, next) => {
        try { res.json({ plans: await plans.list(req.user._id) }); }
        catch (error) { next(error); }
    });
    router.post('/', rules(false), async (req, res, next) => {
        try {
            if (req.body.moveOutDeadline < todayUTC()) return pastDeadline(res);
            const plan = await plans.create(req.user._id, req.body);
            res.location('/api/move-out-plans/' + plan.id).status(201).json({ plan });
        } catch (error) { next(error); }
    });
    router.param('planId', (req, res, next, value) => {
        if (!/^[a-fA-F0-9]{24}$/.test(value)) return errorResponse(res, 404, 'PLAN_NOT_FOUND', 'Plan not found');
        next();
    });
    router.get('/:planId', async (req, res, next) => {
        try {
            const plan = await plans.find(req.params.planId, req.user._id);
            if (!plan) return errorResponse(res, 404, 'PLAN_NOT_FOUND', 'Plan not found');
            res.json({ plan });
        } catch (error) { next(error); }
    });
    router.patch('/:planId', rules(true), async (req, res, next) => {
        try {
            const existing = await plans.find(req.params.planId, req.user._id);
            if (!existing) return errorResponse(res, 404, 'PLAN_NOT_FOUND', 'Plan not found');
            if (req.body.moveOutDeadline && req.body.moveOutDeadline !== existing.moveOutDeadline &&
                req.body.moveOutDeadline < todayUTC()) return pastDeadline(res);
            const plan = await plans.update(req.params.planId, req.user._id, req.body);
            if (!plan) return errorResponse(res, 404, 'PLAN_NOT_FOUND', 'Plan not found');
            res.json({ plan });
        } catch (error) { next(error); }
    });
    return router;
}
module.exports = createPlanRoutes;
