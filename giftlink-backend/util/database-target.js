const { MongoClient } = require('mongodb');
const { lookup } = require('dns').promises;
const { createHash } = require('crypto');
const { readDatabaseConfig } = require('../config');
const { PreparationError } = require('../services/database-indexes');

async function readPreparationTarget(env, allowRemote) {
    if (!env.MONGO_DB_NAME) throw new PreparationError('Preparation requires an explicit MONGO_DB_NAME; there is no administration default.');
    if (!['development', 'staging', 'production'].includes(env.DB_ENVIRONMENT)) {
        throw new PreparationError('Set DB_ENVIRONMENT explicitly to development, staging, or production. This is separate from NODE_ENV.');
    }
    let config;
    let options;
    try {
        config = readDatabaseConfig(env);
        // Constructing a client parses standard and SRV/multi-host URIs without connecting.
        options = new MongoClient(config.mongoUrl).options;
    } catch (error) { throw new PreparationError('Invalid MongoDB configuration. Check MONGO_URL and MONGO_DB_NAME securely.'); }
    if (['admin', 'config', 'local'].includes(config.dbName.toLowerCase())) {
        throw new PreparationError('MongoDB system databases cannot be application preparation targets.');
    }
    if (options.proxyHost || options.proxyPort || options.proxyUsername || options.proxyPassword ||
        options.tlsInsecure || options.rejectUnauthorized === false || options.checkServerIdentity) {
        throw new PreparationError('Preparation refuses proxies and disabled TLS certificate/hostname verification.');
    }
    const hosts = options.hosts || [];
    if (hosts.some(host => host.socketPath)) throw new PreparationError('Use explicit TCP MongoDB endpoints for preparation.');
    let local = !options.srvHost && hosts.length === 1 &&
        ['127.0.0.1', '::1', 'localhost'].includes(hosts[0].host) && !options.replicaSet && !options.loadBalanced;
    if (local && hosts[0].host === 'localhost') {
        let addresses;
        try { addresses = await lookup('localhost', { all: true }); }
        catch (error) { throw new PreparationError('Could not verify localhost resolution.'); }
        local = addresses.length > 0 && addresses.every(address => ['127.0.0.1', '::1'].includes(address.address));
    }
    if (!local && !allowRemote) throw new PreparationError('Remote or discovery-enabled targets require --allow-remote, including for a read-only preview.');
    if (!local && options.tls !== true) throw new PreparationError('Remote preparation requires TLS with valid certificates; use mongodb+srv or tls=true.');
    return Object.assign({}, config, {
        environment: env.DB_ENVIRONMENT, remote: !local,
        endpoints: options.srvHost ? [options.srvHost] : hosts.map(host => host.toString()).sort(),
        scheme: options.srvHost ? 'mongodb+srv' : 'mongodb', replicaSet: options.replicaSet || null,
        clientOptions: Object.assign({ serverSelectionTimeoutMS: 10000, connectTimeoutMS: 10000,
            readPreference: 'primary', writeConcern: { w: 'majority' } }, local ? { directConnection: true } : {})
    });
}

async function inspectTarget(db, target) {
    if (db.databaseName !== target.dbName) throw new PreparationError('Connected database does not match MONGO_DB_NAME; no indexes were created.');
    const hello = await db.command({ hello: 1 });
    if (!hello.ok) throw new PreparationError('MongoDB target inspection failed.');
    const deployment = hello.msg === 'isdbgrid' ? 'sharded' : hello.setName ? 'replica-set' : 'standalone';
    // Bind approval to configured endpoints and observed topology, not credentials.
    // Standalone process identity also invalidates approval after a server restart.
    const identity = { endpoints: target.endpoints, scheme: target.scheme, database: target.dbName,
        environment: target.environment, replicaSet: target.replicaSet, deployment,
        observedSet: hello.setName || null, members: (hello.hosts || []).slice().sort(),
        process: deployment === 'standalone' && hello.topologyVersion ? String(hello.topologyVersion.processId) : null };
    const fingerprint = createHash('sha256').update(JSON.stringify(identity)).digest('hex');
    return { environment: target.environment, database: target.dbName, endpoints: target.endpoints,
        remote: target.remote, deployment, fingerprint };
}

module.exports = { readPreparationTarget, inspectTarget };
