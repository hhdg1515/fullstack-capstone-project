const createApp = require('./app');
const { createDatabase } = require('./models/db');
const { readServerConfig } = require('./config');
const { assertDatabaseIndexes } = require('./services/database-indexes');

async function startServer(config, { database = createDatabase(config), logger = require('./logger') } = {}) {
    let server;
    try {
        // A failed database connection must never leave an HTTP listener running.
        const db = await database.connect();
        await assertDatabaseIndexes(db);
        const topology = await db.command({ hello: 1 });
        if (!topology.setName && topology.msg !== 'isdbgrid') throw new Error('MongoDB replica set required for atomic inventory updates; see README');
        const app = createApp({ connectToDatabase: database.connect, appOrigin: config.appOrigin,
            secureCookies: config.secureCookies, sessionTtlSeconds: config.sessionTtlSeconds, logger });
        server = await new Promise((resolve, reject) => {
            const listener = app.listen(config.port, config.host);
            listener.once('error', reject);
            listener.once('listening', () => {
                listener.removeListener('error', reject);
                resolve(listener);
            });
        });
        let stopping;
        const stop = () => {
            if (!stopping) {
                stopping = new Promise((resolve, reject) => {
                    server.close((error) => error ? reject(error) : resolve());
                }).finally(() => database.close());
            }
            return stopping;
        };
        logger.info({ port: server.address().port }, 'Server ready');
        return { app, server, stop };
    } catch (error) {
        await database.close();
        throw error;
    }
}

async function main() {
    require('dotenv').config();
    const runtime = await startServer(readServerConfig());
    const shutdown = () => {
        runtime.stop().catch(() => {
            console.error('Shutdown failed. Check database connectivity and server resources.');
            process.exitCode = 1;
        });
    };
    process.once('SIGINT', shutdown);
    process.once('SIGTERM', shutdown);
    return runtime;
}

if (require.main === module) {
    main().catch(() => {
        console.error('Server startup failed. Verify configuration, MongoDB replica-set connectivity, and prepared database indexes.');
        process.exitCode = 1;
    });
}

module.exports = { startServer, main };
