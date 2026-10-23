const createApp = require('./app');
const { createDatabase } = require('./models/db');
const { readServerConfig } = require('./config');

async function startServer(config, { database = createDatabase(config), logger = require('./logger') } = {}) {
    let server;
    try {
        // A failed database connection must never leave an HTTP listener running.
        await database.connect();
        const app = createApp({ connectToDatabase: database.connect, jwtSecret: config.jwtSecret, logger });
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
        runtime.stop().catch((error) => {
            console.error('Shutdown failed:', error.message);
            process.exitCode = 1;
        });
    };
    process.once('SIGINT', shutdown);
    process.once('SIGTERM', shutdown);
    return runtime;
}

if (require.main === module) {
    main().catch((error) => {
        console.error('Server startup failed:', error.message);
        process.exitCode = 1;
    });
}

module.exports = { startServer, main };
