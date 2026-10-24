const createApp = require('./app');
const { assertDatabaseIndexes } = require('./services/database-indexes');

async function initializeApplication(config, { database, logger, appFactory = createApp }) {
    const db = await database.connect();
    await assertDatabaseIndexes(db);
    const topology = await db.command({ hello: 1 });
    if (!topology.setName && topology.msg !== 'isdbgrid') throw new Error('MongoDB replica set required for atomic inventory updates; see README');
    return appFactory({ connectToDatabase: database.connect, appOrigin: config.appOrigin,
        secureCookies: config.secureCookies, sessionTtlSeconds: config.sessionTtlSeconds, logger });
}
module.exports = { initializeApplication };
