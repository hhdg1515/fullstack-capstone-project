const express = require('express');
const { body } = require('express-validator');
const { rateLimit } = require('express-rate-limit');
const { validate } = require('../middleware/validation');
const { errorResponse } = require('../middleware/identity');
const { createPickupCommunicationService } = require('../services/pickup-communication');

function createPickupCommunicationRoutes({ connectToDatabase, now, messageLimit = 30 }) {
    // Mounted below the existing authenticated/rate-limited pickup router.
    const router = express.Router({ mergeParams: true });
    const service = createPickupCommunicationService({ connectToDatabase, now });
    router.get('/', async (req, res, next) => {
        try { res.json(await service.detail(req.user._id, req.params.requestId)); } catch (error) { next(error); }
    });
    router.get('/messages', async (req, res, next) => {
        try { res.json(await service.messages(req.user._id, req.params.requestId, req.query)); } catch (error) { next(error); }
    });
    router.post('/messages', rateLimit({ windowMs: 60000, limit: messageLimit, keyGenerator: req => req.user._id.toString(),
        standardHeaders: 'draft-7', legacyHeaders: false,
        handler: (req, res) => errorResponse(res, 429, 'MESSAGE_RATE_LIMIT', 'Too many messages. Wait a minute and retry.') }),
    validate(['text'], [body('text').isString().withMessage('Enter a text message.').bail().trim()
        .isLength({ min: 1, max: 2000 }).withMessage('Use 1 to 2000 characters.').bail()
        .not().matches(/[<>\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/).withMessage('Use plain text without markup or control characters.')]),
    async (req, res, next) => {
        try { res.status(201).json(await service.send(req.user._id, req.params.requestId, req.body.text)); } catch (error) { next(error); }
    });
    return router;
}
module.exports = createPickupCommunicationRoutes;
