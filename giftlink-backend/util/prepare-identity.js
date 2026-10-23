const { createDatabase } = require('../models/db');
const { readDatabaseConfig } = require('../config');
const { validateSeedTarget } = require('./import-mongo');
const { prepareIdentityIndexes } = require('../services/identity');

async function main({ argv = process.argv.slice(2), env = process.env, log = console.log } = {}) {
    const config = readDatabaseConfig(env);
    if (argv.length !== 4 || argv[0] !== '--confirm-db' || argv[2] !== '--confirm-host') {
        throw new Error('Usage: npm run db:prepare -- --confirm-db <database> --confirm-host <host:port>');
    }
    const target = await validateSeedTarget({ mongoUrl: config.mongoUrl, dbName: config.dbName,
        nodeEnv: env.NODE_ENV, confirmDb: argv[1] });
    if (argv[3] !== target.host) throw new Error('Confirmed host does not match the local database target');
    const database = createDatabase(target);
    try {
        const db = await database.connect();
        await db.command({ ping: 1 });
        if (db.databaseName !== target.dbName) throw new Error('Confirmed database does not match');
        log('Verified local identity-index target: ' + target.host + ' / ' + db.databaseName);
        await prepareIdentityIndexes(db);
        log('Identity indexes ready; existing accounts were not changed');
    } finally { await database.close(); }
}
if (require.main === module) {
    require('dotenv').config();
    main().catch(() => {
        // Duplicate-key errors contain private emails. Keep CLI output generic.
        console.error('Identity index preparation failed. Verify target confirmations and inspect existing email normalization/duplicates without changing accounts.');
        process.exitCode = 1;
    });
}
module.exports = { main };
