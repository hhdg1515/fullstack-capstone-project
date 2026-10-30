const express = require('express');
const { body } = require('express-validator');
const { rateLimit } = require('express-rate-limit');
const { validate } = require('../middleware/validation');
const { errorResponse } = require('../middleware/identity');
const { createPickupService } = require('../services/pickups');
const createPickupCommunicationRoutes = require('./pickupCommunicationRoutes');

function createPickupRoutes({ connectToDatabase, auth, now, messageLimit, imageMetadata = null, imageRead = false }) {
    const service = createPickupService({ connectToDatabase, now, imageMetadata, imageRead }); const router = express.Router();
    router.use(rateLimit({ windowMs: 60000, limit: 120, standardHeaders: 'draft-7', legacyHeaders: false,
        handler: (req, res) => errorResponse(res, 429, 'PICKUP_RATE_LIMIT', 'Too many pickup requests. Wait a minute and retry.') }));
    router.use(auth.requireAuth);
    router.use('/:requestId/conversation', createPickupCommunicationRoutes({ connectToDatabase, now, messageLimit }));
    router.post('/', validate(['itemId', 'localDateTime', 'timeZone', 'note'], [
        body('itemId').isString().bail().matches(/^[a-fA-F0-9]{24}$/),
        body('localDateTime').isString().bail().isLength({ min: 16, max: 16 }),
        body('timeZone').isString().bail().isLength({ min: 1, max: 100 }),
        body('note').optional().isString().bail().trim().isLength({ max: 500 }).bail()
            .not().matches(/[<>\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/).withMessage('Use at most 500 plain-text characters')
    ]), async (req, res, next) => {
        try { res.status(201).json(await service.create(req.user._id, req.body.itemId, req.body)); } catch (error) { next(error); }
    });
    for (const [path, role] of [['sent', 'receiver'], ['received', 'giver']]) router.get('/' + path, async (req, res, next) => {
        try { res.json(await service.list(req.user._id, role, req.query)); } catch (error) { next(error); }
    });
    router.get('/:requestId', async (req, res, next) => {
        try { res.json(await service.detail(req.user._id, req.params.requestId)); } catch (error) { next(error); }
    });
    router.post('/:requestId/reschedule-proposals', validate(['version', 'localDateTime', 'timeZone'], [
        body('version').isInt({ min: 1 }).custom(value => typeof value === 'number'),
        body('localDateTime').isString().bail().isLength({ min: 16, max: 16 }).withMessage('Choose a local pickup date and time.'),
        body('timeZone').isString().bail().isLength({ min: 1, max: 100 }).withMessage('Use the existing pickup timezone.')
    ]), async (req, res, next) => {
        try { res.status(201).json(await service.schedule(req.user._id, req.params.requestId, req.body)); } catch (error) { next(error); }
    });
    router.post('/:requestId/reschedule-proposals/:proposalId/actions', validate(['version', 'action'], [
        body('version').isInt({ min: 1 }).custom(value => typeof value === 'number'),
        body('action').isString().bail().isIn(['accept', 'decline'])
    ]), async (req, res, next) => {
        try { res.json(await service.schedule(req.user._id, req.params.requestId, req.body, req.params.proposalId)); } catch (error) { next(error); }
    });
    router.post('/:requestId/actions', validate(['action', 'version'], [
        body('action').isString().bail().isIn(['accept', 'decline', 'cancel', 'complete', 'no_show']),
        body('version').isInt({ min: 1 }).custom(value => typeof value === 'number')
    ]), async (req, res, next) => {
        try { res.json(await service.act(req.user._id, req.params.requestId, req.body)); } catch (error) { next(error); }
    });
    return router;
}
module.exports = createPickupRoutes;
