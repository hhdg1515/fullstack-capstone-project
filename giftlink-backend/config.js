function readDatabaseConfig(env = process.env) {
    if (!env.MONGO_URL || !env.MONGO_URL.trim()) {
        throw new Error('MONGO_URL is required');
    }
    const dbName = env.MONGO_DB_NAME || 'giftdb';
    if (!/^[A-Za-z0-9_-]+$/.test(dbName)) {
        throw new Error('MONGO_DB_NAME must contain only letters, numbers, underscores, or hyphens');
    }
    return { mongoUrl: env.MONGO_URL, dbName };
}

function readServerConfig(env = process.env) {
    const database = readDatabaseConfig(env);
    if (!env.JWT_SECRET || !env.JWT_SECRET.trim()) {
        throw new Error('JWT_SECRET is required');
    }
    const port = env.PORT === undefined ? 3060 : Number(env.PORT);
    if (env.PORT === '' || !Number.isInteger(port) || port < 0 || port > 65535) {
        throw new Error('PORT must be an integer from 0 to 65535');
    }
    return { mongoUrl: database.mongoUrl, dbName: database.dbName, jwtSecret: env.JWT_SECRET, port };
}

module.exports = { readDatabaseConfig, readServerConfig };
