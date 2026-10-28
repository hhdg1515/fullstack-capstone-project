const createApp = require('./app');
const { assertDatabaseIndexes } = require('./services/database-indexes');

async function initializeApplication(config, { database, logger, appFactory = createApp, onPhase = () => {} }) {
    onPhase('database_connect');
    const db = await database.connect();
    onPhase('index_verification');
    await assertDatabaseIndexes(db, { imageMetadataEnabled: Boolean(config.imageMetadata) });
    onPhase('topology_verification');
    const topology = await db.command({ hello: 1 });
    if (!topology.setName && topology.msg !== 'isdbgrid') throw new Error('MongoDB replica set required for atomic inventory updates; see README');
    onPhase('app_construction');
    return appFactory({ connectToDatabase: database.connect, appOrigin: config.appOrigin,
        secureCookies: config.secureCookies, sessionTtlSeconds: config.sessionTtlSeconds, imageMetadata: config.imageMetadata, logger });
}
module.exports = { initializeApplication };
