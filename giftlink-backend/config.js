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
    if (env.ITEM_IMAGE_DISTRIBUTED_CONTROL_ENABLED !== undefined && env.ITEM_IMAGE_DISTRIBUTED_CONTROL_ENABLED !== 'false') {
        throw new Error('Distributed photo control requires a separately approved explicit context; ordinary startup remains disabled');
    }
    if (env.ITEM_IMAGE_R2_ENABLED !== undefined && env.ITEM_IMAGE_R2_ENABLED !== 'false') {
        throw new Error('Hosted R2 photos require separate real-provider approval and runtime integration; ordinary startup remains disabled');
    }
    if (env.ITEM_IMAGE_PIPELINE_ENABLED !== undefined && env.ITEM_IMAGE_PIPELINE_ENABLED !== 'false') {
        throw new Error('Deployed photo processing remains disabled pending real-provider approval; use reviewed B4-compatible explicit context injection only');
    }
    if (env.OWNER_LISTINGS_ENABLED !== undefined && !['true', 'false'].includes(env.OWNER_LISTINGS_ENABLED)) throw new Error('OWNER_LISTINGS_ENABLED must be true or false');
    const ownerListingsEnabled = env.OWNER_LISTINGS_ENABLED === 'true';
    // UX-2C1 private photos for independent drafts: separately gated, default off,
    // and meaningful only with the private owner API and image metadata enabled.
    if (env.OWNER_LISTING_PHOTOS_ENABLED !== undefined && !['true', 'false'].includes(env.OWNER_LISTING_PHOTOS_ENABLED)) throw new Error('OWNER_LISTING_PHOTOS_ENABLED must be true or false');
    const ownerListingPhotosEnabled = env.OWNER_LISTING_PHOTOS_ENABLED === 'true';
    if (ownerListingPhotosEnabled && (!ownerListingsEnabled || env.ITEM_IMAGE_METADATA_ENABLED !== 'true')) {
        throw new Error('OWNER_LISTING_PHOTOS_ENABLED requires OWNER_LISTINGS_ENABLED=true and ITEM_IMAGE_METADATA_ENABLED=true');
    }
    // UX-2C2 pickup requests, conversations and scheduling for eligible independent
    // listings: separately gated, default off. V2 publication itself stays disabled
    // (UX-2C3), so only explicitly constructed local fixtures can be eligible.
    if (env.OWNER_LISTING_PICKUPS_ENABLED !== undefined && !['true', 'false'].includes(env.OWNER_LISTING_PICKUPS_ENABLED)) throw new Error('OWNER_LISTING_PICKUPS_ENABLED must be true or false');
    const ownerListingPickupsEnabled = env.OWNER_LISTING_PICKUPS_ENABLED === 'true';
    if (ownerListingPickupsEnabled && !ownerListingsEnabled) throw new Error('OWNER_LISTING_PICKUPS_ENABLED requires OWNER_LISTINGS_ENABLED=true');
    const database = readDatabaseConfig(env);
    const secureCookies = env.NODE_ENV === 'production';
    const appOrigin = env.APP_ORIGIN || (secureCookies ? '' : 'http://localhost:3000');
    let origin;
    try { origin = new URL(appOrigin); } catch (error) { throw new Error('APP_ORIGIN must be an HTTP(S) origin'); }
    if (!['http:', 'https:'].includes(origin.protocol) || origin.origin !== appOrigin ||
        (secureCookies && origin.protocol !== 'https:')) {
        throw new Error('APP_ORIGIN must be an exact origin; production requires HTTPS');
    }
    const sessionTtlSeconds = env.SESSION_TTL_SECONDS === undefined ? 28800 : Number(env.SESSION_TTL_SECONDS);
    if (!Number.isInteger(sessionTtlSeconds) || sessionTtlSeconds < 300 || sessionTtlSeconds > 604800) {
        throw new Error('SESSION_TTL_SECONDS must be an integer from 300 to 604800');
    }
    const port = env.PORT === undefined ? 3060 : Number(env.PORT);
    if (env.PORT === '' || !Number.isInteger(port) || port < 0 || port > 65535) {
        throw new Error('PORT must be an integer from 0 to 65535');
    }
    const config = { mongoUrl: database.mongoUrl, dbName: database.dbName, appOrigin, secureCookies, sessionTtlSeconds, port, ownerListingsEnabled, ownerListingPhotosEnabled, ownerListingPickupsEnabled };
    const imageMetadata = require('./services/item-image-policy').readImageMetadataConfig(env);
    if (imageMetadata) config.imageMetadata = imageMetadata;
    return config;
}

module.exports = { readDatabaseConfig, readServerConfig };
