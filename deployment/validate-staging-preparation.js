const { readPreparationTarget } = require('../giftlink-backend/util/database-target');
const { PreparationError } = require('../giftlink-backend/services/database-indexes');

// This workflow is deliberately narrower than the general administration CLI.
// Validate before connecting; the existing CLI still checks the live fingerprint
// and conflicts immediately before any approved index creation.
async function validateStagingPreparation(env = process.env) {
    if (env.GITHUB_EVENT_NAME !== 'workflow_dispatch' || env.GITHUB_REF !== 'refs/heads/main' ||
        env.GITHUB_REPOSITORY !== 'hhdg1515/fullstack-capstone-project') {
        throw new PreparationError('Run this workflow manually on main in hhdg1515/fullstack-capstone-project.');
    }
    if (!/^[a-f0-9]{40}$/.test(env.APPROVED_SHA || '') || env.APPROVED_SHA !== env.GITHUB_SHA) {
        throw new PreparationError('approved_sha must exactly match the full reviewed main commit selected for this run.');
    }
    if (env.MONGO_DB_NAME !== 'moveout_e2e_staging' || env.DB_ENVIRONMENT !== 'staging') {
        throw new PreparationError('Set isolated-e2e variable E2E_DB_NAME to moveout_e2e_staging; only DB_ENVIRONMENT=staging is supported.');
    }
    if (!env.MONGO_URL || !env.MONGO_URL.trim()) {
        throw new PreparationError('Configure environment secret E2E_MONGO_URL in isolated-e2e; do not put credentials in workflow inputs or logs.');
    }
    if (!['dry-run', 'apply'].includes(env.PREPARATION_OPERATION)) {
        throw new PreparationError('Select exactly dry-run or apply.');
    }
    if (env.PREPARATION_OPERATION === 'apply') {
        if (env.CONFIRM_DB !== env.MONGO_DB_NAME || env.CONFIRM_ENVIRONMENT !== 'staging' ||
            !/^[a-f0-9]{64}$/.test(env.CONFIRM_TARGET || '')) {
            throw new PreparationError('Apply requires confirm_db=moveout_e2e_staging, confirm_environment=staging, and the full confirm_target fingerprint from the reviewed dry-run.');
        }
    } else if (env.CONFIRM_DB || env.CONFIRM_ENVIRONMENT || env.CONFIRM_TARGET) {
        throw new PreparationError('Leave all apply confirmation inputs empty for a read-only dry-run.');
    }
    const target = await readPreparationTarget(env, true);
    if (!target.remote) throw new PreparationError('The staging workflow requires an explicitly configured remote TLS database target.');
}

if (require.main === module) {
    validateStagingPreparation().then(() => {
        console.log('Manual staging configuration validated without connecting. The guarded utility will verify the live target next.');
    }).catch(error => {
        console.error(error instanceof PreparationError ? error.message : 'Staging validation failed; inspect configuration securely.');
        process.exitCode = 1;
    });
}

module.exports = { validateStagingPreparation };
