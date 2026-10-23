const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const pinoHttp = require('pino-http');
const createGiftRoutes = require('./routes/giftRoutes');
const createSearchRoutes = require('./routes/searchRoutes');
const createAuthRoutes = require('./routes/authRoutes');
const createMeRoutes = require('./routes/meRoutes');
const createPlanRoutes = require('./routes/planRoutes');
const { createIdentityService } = require('./services/identity');
const { createIdentityMiddleware } = require('./middleware/identity');

function createApp({ connectToDatabase, appOrigin = 'http://localhost:3000', secureCookies = false,
    sessionTtlSeconds = 28800, authLimit = 30, logger = require('./logger') }) {
    const app = express();
    const identity = createIdentityService({ connectToDatabase, sessionTtlSeconds });
    const auth = createIdentityMiddleware({ identity, appOrigin, secureCookies, sessionTtlSeconds });
    app.disable('x-powered-by');
    app.use(pinoHttp({ logger, serializers: {
        req: req => ({ id: req.id, method: req.method }),
        res: res => ({ statusCode: res.statusCode }),
        err: () => ({ message: 'Request failed' })
    } }));
    app.use(cors({ origin: appOrigin, credentials: true, allowedHeaders: ['Content-Type', 'X-CSRF-Protection'] }));
    app.use(cookieParser());
    app.use('/api', auth.protectWrites);
    app.use(express.json({ limit: '32kb' }));
    app.use('/api/gifts', createGiftRoutes({ connectToDatabase, logger, auth }));
    app.use('/api/search', createSearchRoutes({ connectToDatabase }));
    app.use('/api/auth', createAuthRoutes({ identity, auth, authLimit }));
    app.use('/api/me', createMeRoutes({ identity, auth }));
    app.use('/api/move-out-plans', createPlanRoutes({ connectToDatabase, auth }));
    app.use((err, req, res, next) => {
        // Driver/validator errors can contain emails, input, or connection details.
        logger.error({ event: 'request_failed' }, 'Request failed');
        const status = err.type === 'entity.parse.failed' ? 400 : err.type === 'entity.too.large' ? 413 : 500;
        res.status(status).json({ error: { code: 'REQUEST_FAILED',
            message: status === 500 ? 'Internal server error' : 'Invalid or oversized JSON request' } });
    });
    app.get('/', (req, res) => res.send('Inside the server'));
    return app;
}
module.exports = createApp;
