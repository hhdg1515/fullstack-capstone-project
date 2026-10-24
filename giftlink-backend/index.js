const express = require('express');
const { createDatabase } = require('./models/db');
const { readServerConfig } = require('./config');
const { initializeApplication } = require('./runtime');
const { readPreparationTarget, inspectTarget } = require('./util/database-target');

function createHostedApp({ env = process.env, databaseFactory = createDatabase,
    logger = require('./logger'), appFactory, now = Date.now } = {}) {
    const app = express();
    app.disable('x-powered-by');
    let ready;
    let retryAfter = 0;
    // One initialization/pool per warm function instance, shared by concurrent requests.
    async function initialize() {
        let database;
        try {
            if (env.NODE_ENV !== 'production' || !['staging', 'production'].includes(env.DB_ENVIRONMENT)) throw new Error('Hosted configuration required');
            const config = readServerConfig(env);
            const target = await readPreparationTarget(env, true);
            target.clientOptions = Object.assign({}, target.clientOptions, { maxPoolSize: 10, minPoolSize: 0, maxIdleTimeMS: 60000 });
            database = databaseFactory(target);
            const api = await initializeApplication(config, { database, logger, appFactory });
            const inspected = await inspectTarget(await database.connect(), target);
            return { api, database, target, health: { status: 'ready', environment: target.environment,
                databaseFingerprint: inspected.fingerprint } };
        } catch (error) {
            if (database) await database.close().catch(() => {});
            retryAfter = now() + 5000;
            logger.error({ event: 'hosted_startup_failed' }, 'Hosted service unavailable; verify configuration, connectivity and prepared indexes securely');
            throw new Error('Hosted service unavailable');
        }
    }
    app.use(async (req, res, next) => {
        res.set('Cache-Control', 'private, no-store');
        try {
            if (!ready) {
                if (now() < retryAfter) throw new Error('Retry later');
                ready = initialize().catch(error => { ready = undefined; throw error; });
            }
            const runtime = await ready;
            // Optional operational fence: it is not authentication. E2E uses it
            // on every request so a retargeted deployment cannot receive test writes.
            const expected = req.get('X-Deployment-Target');
            if (expected || req.path === '/api/health') {
                const current = await inspectTarget(await runtime.database.connect(), runtime.target);
                runtime.health.databaseFingerprint = current.fingerprint;
            }
            if (expected && expected !== runtime.health.databaseFingerprint) return res.status(409).json({ error: {
                code: 'DEPLOYMENT_CHANGED', message: 'Deployment target changed. Reverify the approved environment.' } });
            if (req.path === '/api/health' && req.method === 'GET') {
                await (await runtime.database.connect()).command({ ping: 1 });
                return res.json(runtime.health);
            }
            return runtime.api(req, res, next);
        } catch (error) {
            return res.status(503).json({ error: { code: 'SERVICE_UNAVAILABLE', message: 'The service is temporarily unavailable. Please try again later.' } });
        }
    });
    // Explicit shutdown is useful for isolated tests; Vercel reuses warm pools.
    app.close = async () => { if (ready) { const runtime = await ready; await runtime.database.close(); ready = undefined; } };
    return app;
}
module.exports = createHostedApp();
module.exports.createHostedApp = createHostedApp;
