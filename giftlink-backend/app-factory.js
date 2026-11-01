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
    sessionTtlSeconds = 28800, authLimit = 30, discoveryLimit = 120, pickupNow, messageLimit,
    ownerListingsEnabled = false, ownerListingPhotosEnabled = false, imageMetadata = null, imageControlLimit = 20, imagePipeline = null, logger = require('./logger') }) {
    const app = express();
    const pipeline = imagePipeline ? require('./services/item-image-pipeline').pipelineBinding(imagePipeline, imageMetadata, connectToDatabase) : null;
    const identity = createIdentityService({ connectToDatabase, sessionTtlSeconds });
    const auth = createIdentityMiddleware({ identity, appOrigin, secureCookies, sessionTtlSeconds,
        binaryRequest: pipeline ? require('./services/item-image-pipeline').isContentRequest : () => false });
    const items = createItemRoutes({ connectToDatabase, auth, discoveryLimit, imageMetadata, imageControlLimit, pipeline });
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
    if (pipeline) {
        const { rateLimit } = require('express-rate-limit');
        const limit = rateLimit({ windowMs: 60000, limit: imageControlLimit, standardHeaders: 'draft-7', legacyHeaders: false,
            handler: (req, res) => res.status(429).json({ error: { code: 'IMAGE_CONTROL_LIMIT', message: 'Too many photo requests. Wait a minute before retrying.' } }) });
        app.use('/api', (req, res, next) => require('./services/item-image-pipeline').isContentRequest(req) ? limit(req, res, next) : next());
    }
    app.use('/api', auth.protectWrites);
    app.use(express.json({ limit: '32kb' }));
    app.get('/api/regions', (req, res) => res.json(require('./services/regions').directory));
    app.get('/api/item-taxonomy', (req, res) => res.json(require('./services/item-taxonomy').taxonomy));
    app.use('/api/gifts', createGiftRoutes({ connectToDatabase, logger, auth }));
    app.use('/api/search', createSearchRoutes({ connectToDatabase }));
    app.use('/api/auth', createAuthRoutes({ identity, auth, authLimit }));
    const ownerListings = require('./routes/ownerListingRoutes')({ connectToDatabase, auth, ownerListingsEnabled,
        ownerListingPhotosEnabled: ownerListingsEnabled === true && ownerListingPhotosEnabled === true, imageMetadata, imageControlLimit, pipeline });
    app.use('/api/me/items', ownerListings.read);
    app.use('/api/items', ownerListings.write);
    app.use('/api/me', createMeRoutes({ identity, auth }));
    app.use('/api/move-out-plans', createPlanRoutes({ connectToDatabase, auth }));
    app.use('/api/move-out-plans/:planId/items', items.privateRouter);
    app.use('/api/items', items.publicRouter);
    if (pipeline) {
        const { rateLimit } = require('express-rate-limit');
        app.use('/api/item-images', rateLimit({ windowMs: 60000, limit: discoveryLimit, standardHeaders: 'draft-7', legacyHeaders: false,
            handler: (req, res) => res.status(429).json({ error: { code: 'IMAGE_READ_BUSY', message: 'Too many photo requests. Try again shortly.' } }) }));
        const deliver = (req, res, next) => pipeline.deliver(req, res, next, async () => {
            const current = await identity.authenticate(auth.readToken(req)); return current && current.user._id;
        }, { independentPhotos: ownerListingsEnabled === true && ownerListingPhotosEnabled === true });
        app.head('/api/item-images/:imageId/:variant', auth.optionalAuth, deliver);
        app.get('/api/item-images/:imageId/:variant', auth.optionalAuth, deliver);
    }
    app.use('/api/pickup-requests', createPickupRoutes({ connectToDatabase, auth, now: pickupNow, messageLimit, imageMetadata, imageRead: Boolean(imageMetadata && pipeline) }));
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
