const { createDatabase } = require('../models/db');
const { inspectIdentityIndexes, prepareIdentityIndexes, PreparationError } = require('../services/identity-indexes');
const { readPreparationTarget, inspectTarget } = require('./identity-target');

function parseArguments(argv) {
    const args = {};
    for (let i = 0; i < argv.length; i++) {
        const flag = argv[i];
        if (Object.prototype.hasOwnProperty.call(args, flag)) throw new PreparationError('Duplicate preparation option.');
        if (['--apply', '--dry-run', '--allow-remote'].includes(flag)) args[flag] = true;
        else if (['--confirm-db', '--confirm-environment', '--confirm-target'].includes(flag) &&
            argv[i + 1] && !argv[i + 1].startsWith('--')) args[flag] = argv[++i];
        else throw new PreparationError('Usage: npm run db:prepare -- [--dry-run | --apply --confirm-db <database> --confirm-environment <environment> --confirm-target <preview-fingerprint>] [--allow-remote]');
    }
    if (args['--apply'] && args['--dry-run']) throw new PreparationError('Choose either --dry-run or --apply.');
    if (!args['--apply'] && Object.keys(args).some(flag => flag.startsWith('--confirm-'))) {
        throw new PreparationError('Confirmation flags require --apply; omit them for a preview.');
    }
    return args;
}

async function main({ argv = process.argv.slice(2), env = process.env, log = console.log,
    databaseFactory = createDatabase } = {}) {
    let database;
    try {
        const args = parseArguments(argv);
        const target = await readPreparationTarget(env, args['--allow-remote']);
        if (args['--apply'] && (args['--confirm-db'] !== target.dbName ||
            args['--confirm-environment'] !== target.environment || !/^[a-f0-9]{64}$/.test(args['--confirm-target'] || ''))) {
            throw new PreparationError('Apply requires matching --confirm-db, --confirm-environment, and the full --confirm-target fingerprint from a preview.');
        }
        database = databaseFactory(target);
        const db = await database.connect();
        const inspected = await inspectTarget(db, target);
        log(JSON.stringify({ target: inspected }));
        if (args['--apply'] && args['--confirm-target'] !== inspected.fingerprint) {
            throw new PreparationError('Target fingerprint does not match. Verify the project/cluster/database and run a fresh preview; no indexes were created.');
        }
        const plan = await inspectIdentityIndexes(db);
        log(JSON.stringify({ mode: args['--apply'] ? 'apply' : 'dry-run', plan }));
        if (!plan.ready) throw new PreparationError('Preparation blocked. Review account conflict counts or incompatible indexes securely. Use a separately reviewed migration; no accounts were changed.');
        if (args['--apply']) {
            // Check the live target again after scanning accounts and before any DDL.
            if ((await inspectTarget(db, target)).fingerprint !== inspected.fingerprint) {
                throw new PreparationError('Target changed during inspection. Run a fresh preview; no indexes were created.');
            }
            await prepareIdentityIndexes(db);
            log('Required identity indexes are ready. No accounts or demo gifts were imported or rewritten.');
        } else log('Read-only preview complete. No indexes or documents were changed. Review the target before approving --apply.');
        return { target: inspected, plan };
    } catch (error) {
        if (error instanceof PreparationError) throw error;
        // Connection, auth and server errors can contain credentials or document values.
        throw new PreparationError('Identity preparation failed. Check connectivity, TLS, permissions and target configuration securely; no account repair was attempted.');
    } finally {
        if (database) {
            try { await database.close(); }
            catch (error) { throw new PreparationError('Could not close the preparation client cleanly. Inspect connectivity securely.'); }
        }
    }
}
if (require.main === module) {
    require('dotenv').config();
    main().catch(error => {
        console.error(error instanceof PreparationError ? error.message : 'Identity preparation failed; inspect connectivity and permissions securely.');
        process.exitCode = 1;
    });
}
module.exports = { main, parseArguments };
