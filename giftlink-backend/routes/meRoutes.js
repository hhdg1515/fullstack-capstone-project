const express = require('express');
const { privateUser } = require('../services/identity');
const { errorResponse } = require('../middleware/identity');
const validation = require('../middleware/validation');

function createMeRoutes({ identity, auth }) {
    const router = express.Router();
    router.use(auth.requireAuth);
    router.get('/', (req, res) => res.json({ user: privateUser(req.user) }));
    router.patch('/', validation.profile(), async (req, res, next) => {
        try {
            const user = await identity.update(req.user._id, req.body);
            if (!user) return errorResponse(res, 401, 'SESSION_EXPIRED', 'Please log in again');
            res.json({ user: privateUser(user) });
        } catch (error) { next(error); }
    });
    return router;
}
module.exports = createMeRoutes;
