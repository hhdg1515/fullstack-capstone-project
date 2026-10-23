const express = require('express');
const { rateLimit } = require('express-rate-limit');
const { privateUser } = require('../services/identity');
const { errorResponse } = require('../middleware/identity');
const validation = require('../middleware/validation');

function createAuthRoutes({ identity, auth, authLimit = 30 }) {
    const router = express.Router();
    router.use((req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
    const limit = rateLimit({ windowMs: 15 * 60 * 1000, limit: authLimit,
        standardHeaders: 'draft-7', legacyHeaders: false,
        handler: (req, res) => errorResponse(res, 429, 'RATE_LIMITED', 'Too many attempts. Please try again later.') });

    router.post('/register', limit, validation.registration(), async (req, res, next) => {
        try {
            const user = await identity.register(req.body);
            auth.setCookie(res, await identity.issue(user._id, auth.readToken(req)));
            res.status(201).json({ user: privateUser(user) });
        } catch (error) {
            if (error.code === 11000) return errorResponse(res, 409, 'EMAIL_TAKEN', 'Email already registered');
            next(error);
        }
    });
    router.post('/login', limit, validation.login(), async (req, res, next) => {
        try {
            const user = await identity.login(req.body.email, req.body.password);
            if (!user) return errorResponse(res, 401, 'INVALID_CREDENTIALS', 'Email or password is incorrect');
            auth.setCookie(res, await identity.issue(user._id, auth.readToken(req)));
            res.json({ user: privateUser(user) });
        } catch (error) { next(error); }
    });
    router.post('/logout', async (req, res, next) => {
        try {
            await identity.revoke(auth.readToken(req));
            auth.clearCookie(res);
            res.status(204).end();
        } catch (error) { next(error); }
    });
    // Temporary URL compatibility; legacy bearer tokens are deliberately invalid.
    router.put('/update', auth.requireAuth, validation.legacyProfile(), async (req, res, next) => {
        if (req.get('email') && req.get('email').trim().toLowerCase() !== req.user.email) {
            return errorResponse(res, 403, 'FORBIDDEN', 'You can only update your account');
        }
        try {
            const user = await identity.update(req.user._id, { firstName: req.body.name });
            if (!user) return errorResponse(res, 401, 'SESSION_EXPIRED', 'Please log in again');
            res.json({ user: privateUser(user) });
        } catch (error) { next(error); }
    });
    return router;
}
module.exports = createAuthRoutes;
