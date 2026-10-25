const fs = require('node:fs');
const { staging } = require('../deployment/staging-target.cjs');
const repository = 'hhdg1515/fullstack-capstone-project';
const owner = 'hhdg1515', ownerId = '144937930';

class WorkflowAuthorizationError extends Error {
  constructor(category) { super('Isolated E2E authorization refused (' + category + ').'); this.category = category; }
}
const refuse = category => { throw new WorkflowAuthorizationError(category); };

// These E2E_AUTH_* values are mapped explicitly from GitHub contexts by the
// workflow, never from dispatch inputs claiming to identify an actor.
function authorizeWorkflow(env) {
  if (env.E2E_AUTH_REPOSITORY !== repository || env.E2E_AUTH_OWNER !== owner) refuse('repository_not_allowed');
  if (env.E2E_AUTH_EVENT !== 'workflow_dispatch') refuse('manual_dispatch_required');
  if (env.E2E_AUTH_REF !== 'refs/heads/main') refuse('main_branch_required');
  if (env.E2E_AUTH_ACTOR !== owner || env.E2E_AUTH_ACTOR_ID !== ownerId) refuse('owner_actor_required');
  // actor retains the original runner's identity during reruns; triggering_actor
  // identifies the user asking for this attempt, including failed-job reruns.
  if (env.E2E_AUTH_TRIGGERING_ACTOR !== owner) refuse('owner_rerun_required');
  if (!/^[a-f0-9]{40}$/.test(env.E2E_AUTH_APPROVED_SHA || '') || env.E2E_AUTH_APPROVED_SHA !== env.E2E_AUTH_SHA) refuse('approved_sha_mismatch');
  if (!['preview', 'run', 'cleanup'].includes(env.E2E_AUTH_OPERATION)) refuse('operation_not_allowed');
  return env.E2E_AUTH_OPERATION;
}

function authorizeEnvironment(environment) {
  // Keep the existing Environment; do not require any reviewer or change its
  // rules, secrets or variables. Platform protections, if configured, still apply.
  if (environment?.name !== 'isolated-e2e') refuse('existing_environment_required');
}

function authorizeTarget(env) {
  const operation = authorizeWorkflow(env);
  if (env.E2E_OPERATION !== operation || env.E2E_APPROVE_OPERATION !== operation) refuse('operation_mismatch');
  if (env.E2E_APP_ORIGIN !== staging.frontendOrigin) refuse('staging_origin_mismatch');
  if (env.E2E_DB_NAME !== staging.database) refuse('staging_database_mismatch');
  if (env.E2E_EXPECTED_TARGET !== staging.fingerprint) refuse('approved_target_mismatch');
  if (operation !== 'preview' && (env.E2E_CONFIRM_ORIGIN !== staging.frontendOrigin || env.E2E_CONFIRM_DB !== staging.database ||
      env.E2E_CONFIRM_ENVIRONMENT !== 'staging' || env.E2E_CONFIRM_TARGET !== staging.fingerprint)) refuse('write_confirmation_mismatch');
  if ((operation === 'cleanup' || env.E2E_RUN_ID) && !/^[a-f0-9]{32}$/.test(env.E2E_RUN_ID || '')) refuse('owned_run_id_required');
  return operation;
}

if (require.main === module) {
  try {
    const mode = process.argv[2];
    authorizeWorkflow(process.env);
    if (mode === 'environment') authorizeEnvironment(JSON.parse(fs.readFileSync(process.argv[3], 'utf8')));
    else if (mode === 'target') authorizeTarget(process.env);
    else if (mode !== 'context') refuse('validation_mode_not_allowed');
    console.log('Single-owner isolated E2E authorization validated; no remote operation performed.');
  } catch (error) {
    console.error(JSON.stringify({ check: 'single_owner_authorization', category: error instanceof WorkflowAuthorizationError ? error.category : 'authorization_failed' }));
    process.exitCode = 1;
  }
}
module.exports = { authorizeWorkflow, authorizeEnvironment, authorizeTarget, WorkflowAuthorizationError };
