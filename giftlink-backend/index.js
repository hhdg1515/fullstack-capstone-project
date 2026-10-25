const express = require('express');
const { createDatabase } = require('./models/db');
const { readServerConfig } = require('./config');
const { initializeApplication } = require('./runtime');
const { readPreparationTarget, inspectTarget } = require('./util/database-target');
const { requestDiagnostics, createFailureDiagnostics } = require('./middleware/diagnostics');

function createHostedApp({ env = process.env, databaseFactory = createDatabase,
    logger = require('./logger'), appFactory, now = Date.now } = {}) {
    const app = express();
    app.disable('x-powered-by');
    app.use(requestDiagnostics);
    let ready;
    let retryAfter = 0;
    const reportFailure = createFailureDiagnostics(logger, now);
    // One initialization/pool per warm function instance, shared by concurrent requests.
    async function initialize(id) {
        let database;
        let phase = 'configuration';
        const started = now();
        try {
            if (env.NODE_ENV !== 'production' || !['staging', 'production'].includes(env.DB_ENVIRONMENT)) throw new Error('Hosted configuration required');
            const config = readServerConfig(env);
            phase = 'target_validation';
            const target = await readPreparationTarget(env, true);
            target.clientOptions = Object.assign({}, target.clientOptions, { maxPoolSize: 10, minPoolSize: 0, maxIdleTimeMS: 60000,
                serverSelectionTimeoutMS: 5000, connectTimeoutMS: 5000, waitQueueTimeoutMS: 5000 });
            database = databaseFactory(target);
            const api = await initializeApplication(config, { database, logger, appFactory, onPhase: value => { phase = value; } });
            phase = 'target_verification';
            const inspected = await inspectTarget(await database.connect(), target);
            logger.info({ event: 'hosted_startup_ready', durationMs: Math.max(0, now() - started), requestId: id }, 'Hosted service ready');
            return { api, database, target, health: { status: 'ready', environment: target.environment,
                databaseFingerprint: inspected.fingerprint } };
        } catch (error) {
            if (database) await database.close().catch(() => {});
            retryAfter = now() + 5000;
            reportFailure('hosted_startup_failed', phase, error, id);
            throw new Error('Hosted service unavailable');
        }
    }
    app.use(async (req, res, next) => {
        res.set('Cache-Control', 'private, no-store');
        const expected = req.get('X-Deployment-Target');
        // Liveness is not readiness. A supplied operational fence still follows
        // the normal live target verification before any response is returned.
        if (req.method === 'GET' && req.path === '/api/live' && !expected) return res.json({ status: 'alive' });
        let phase = 'initialization';
        try {
            if (!ready) {
                if (now() < retryAfter) throw new Error('Retry later');
                ready = initialize(req.id).catch(error => { ready = undefined; throw error; });
            }
            const runtime = await ready;
            // Optional operational fence: it is not authentication. E2E uses it
            // on every request so a retargeted deployment cannot receive test writes.
            phase = 'target_verification';
            if (expected || req.path === '/api/health') {
                const current = await inspectTarget(await runtime.database.connect(), runtime.target);
                runtime.health.databaseFingerprint = current.fingerprint;
            }
            if (expected && expected !== runtime.health.databaseFingerprint) return res.status(409).json({ error: {
                code: 'DEPLOYMENT_CHANGED', message: 'Deployment target changed. Reverify the approved environment.' } });
            if (req.path === '/api/health' && req.method === 'GET') {
                phase = 'readiness_ping';
                await (await runtime.database.connect()).command({ ping: 1 });
                return res.json(runtime.health);
            }
            if (req.path === '/api/live' && req.method === 'GET') return res.json({ status: 'alive' });
            return runtime.api(req, res, next);
        } catch (error) {
            if (phase !== 'initialization') reportFailure('hosted_readiness_failed', phase, error, req.id);
            res.set('Retry-After', '5');
            return res.status(503).json({ error: { code: 'SERVICE_UNAVAILABLE', message: 'The service is temporarily unavailable. Please try again later.' } });
        }
    });
    // Explicit shutdown is useful for isolated tests; Vercel reuses warm pools.
    app.close = async () => { if (ready) { const runtime = await ready; await runtime.database.close(); ready = undefined; } };
    return app;
}
module.exports = createHostedApp();
module.exports.createHostedApp = createHostedApp;
