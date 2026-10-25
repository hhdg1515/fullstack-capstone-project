const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const pinoHttp = require('pino-http');
const createGiftRoutes = require('./routes/giftRoutes');
const createSearchRoutes = require('./routes/searchRoutes');
const createAuthRoutes = require('./routes/authRoutes');
const createMeRoutes = require('./routes/meRoutes');
const createPlanRoutes = require('./routes/planRoutes');
const createItemRoutes = require('./routes/itemRoutes');
const createPickupRoutes = require('./routes/pickupRoutes');
const { InventoryError } = require('./services/inventory');
const { createIdentityService } = require('./services/identity');
const { createIdentityMiddleware } = require('./middleware/identity');
const { requestDiagnostics } = require('./middleware/diagnostics');

function createApp({ connectToDatabase, appOrigin = 'http://localhost:3000', secureCookies = false,
    sessionTtlSeconds = 28800, authLimit = 30, discoveryLimit = 120, pickupNow, logger = require('./logger') }) {
    const app = express();
    const identity = createIdentityService({ connectToDatabase, sessionTtlSeconds });
    const auth = createIdentityMiddleware({ identity, appOrigin, secureCookies, sessionTtlSeconds });
    const items = createItemRoutes({ connectToDatabase, auth, discoveryLimit });
    app.disable('x-powered-by');
    app.use(requestDiagnostics);
    app.use(pinoHttp({ logger, genReqId: req => req.id, serializers: {
        req: req => ({ id: req.id, method: req.method }),
        res: res => ({ statusCode: res.statusCode }),
        err: () => ({ message: 'Request failed' })
    } }));
    app.use(cors({ origin: appOrigin, credentials: true, allowedHeaders: ['Content-Type', 'X-CSRF-Protection'] }));
    app.use(cookieParser());
    app.use('/api', (req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
    app.use('/api', auth.protectWrites);
    app.use(express.json({ limit: '32kb' }));
    app.use('/api/gifts', createGiftRoutes({ connectToDatabase, logger, auth }));
    app.use('/api/search', createSearchRoutes({ connectToDatabase }));
    app.use('/api/auth', createAuthRoutes({ identity, auth, authLimit }));
    app.use('/api/me', createMeRoutes({ identity, auth }));
    app.use('/api/move-out-plans', createPlanRoutes({ connectToDatabase, auth }));
    app.use('/api/move-out-plans/:planId/items', items.privateRouter);
    app.use('/api/items', items.publicRouter);
    app.use('/api/pickup-requests', createPickupRoutes({ connectToDatabase, auth, now: pickupNow }));
    app.use('/api', (req, res) => res.status(404).json({ error: { code: 'NOT_FOUND', message: 'API route not found' } }));
    app.use((err, req, res, next) => {
        if (err instanceof InventoryError) return res.status(err.status).json({ error: Object.assign({ code: err.code, message: err.message }, err.details) });
        // Driver/validator errors can contain emails, input, or connection details.
        logger.error({ event: 'request_failed', requestId: req.id }, 'Request failed');
        const status = err.type === 'entity.parse.failed' ? 400 : err.type === 'entity.too.large' ? 413 : 500;
        res.status(status).json({ error: { code: 'REQUEST_FAILED',
            message: status === 500 ? 'Internal server error' : 'Invalid or oversized JSON request' } });
    });
    app.get('/', (req, res) => res.send('Inside the server'));
    return app;
}
module.exports = createApp;
