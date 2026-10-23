const { lookup } = require('dns').promises;
const { createDatabase } = require('../../models/db');
const { readDatabaseConfig } = require('../../config');
const gifts = require('./gifts.json').docs;

async function validateSeedTarget({ mongoUrl, dbName, nodeEnv, confirmDb }) {
    if (String(nodeEnv).toLowerCase() === 'production' || /prod/i.test(dbName)) {
        throw new Error('Demo seeding is disabled for production targets');
    }
    if (confirmDb !== dbName) {
        throw new Error('Explicit confirmation required: --confirm-db ' + dbName);
    }
    const target = new URL(mongoUrl);
    if (target.protocol !== 'mongodb:') {
        throw new Error('Demo seeding requires a local mongodb:// target');
    }
    const hostname = target.hostname.toLowerCase();
    const addresses = hostname === 'localhost' ? await lookup('localhost', { all: true }) : [{ address: hostname }];
    if (!addresses.length || !addresses.every(({ address }) => ['127.0.0.1', '::1', '[::1]'].includes(address))) {
        throw new Error('Demo seeding is restricted to loopback MongoDB; remote clusters are refused');
    }
    for (const key of Array.from(target.searchParams.keys())) {
        const option = key.toLowerCase();
        if (option !== 'authsource' && option !== 'directconnection') {
            throw new Error('Demo seed URI options are limited to authSource and directConnection');
        }
        // MongoDB option names are case-insensitive; remove every spelling first.
        if (option === 'directconnection') target.searchParams.delete(key);
    }
    // A loopback seed target must not discover remote replica-set members.
    target.searchParams.set('directConnection', 'true');
    return { mongoUrl: target.toString(), dbName, host: hostname + ':' + (target.port || '27017') };
}

async function seedDemoGifts(db) {
    const result = await db.collection('gifts').bulkWrite(gifts.map((gift) => ({
        updateOne: { filter: { id: gift.id }, update: { $setOnInsert: gift }, upsert: true }
    })));
    return { insertedCount: result.upsertedCount, existingCount: gifts.length - result.upsertedCount };
}

async function main({ argv = process.argv.slice(2), env = process.env, log = console.log } = {}) {
    const config = readDatabaseConfig(env);
    if (argv.length !== 2 || argv[0] !== '--confirm-db') {
        throw new Error('Usage: npm run seed -- --confirm-db ' + config.dbName);
    }
    const target = await validateSeedTarget({
        mongoUrl: config.mongoUrl, dbName: config.dbName, nodeEnv: env.NODE_ENV, confirmDb: argv[1]
    });
    const database = createDatabase(target);
    try {
        const db = await database.connect();
        await db.command({ ping: 1 });
        if (db.databaseName !== target.dbName) {
            throw new Error('Connected database does not match the confirmed seed target');
        }
        log('Verified local MongoDB target: ' + target.host + ' / ' + db.databaseName);
        const result = await seedDemoGifts(db);
        log('Demo gifts inserted: ' + result.insertedCount + '; existing IDs preserved: ' + result.existingCount);
        return result;
    } finally {
        await database.close();
    }
}

if (require.main === module) {
    require('dotenv').config();
    main().catch(() => {
        console.error('Demo seeding failed. Check the local target, confirmation, and database connection.');
        process.exitCode = 1;
    });
}

module.exports = { seedDemoGifts, validateSeedTarget, main };
