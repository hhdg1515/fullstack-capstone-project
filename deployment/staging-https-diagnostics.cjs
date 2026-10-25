const fs = require('node:fs');
const path = require('node:path');
const { settings } = require('./staging-preview.cjs');
const { staging } = require('./staging-target.cjs');
const { inspectHttps } = require('../e2e/https-preflight.cjs');
const { AutomationBypassError, assertPrivateAutomation, bypassRequest } = require('../e2e/vercel-bypass.cjs');

function partialState(filename, origin, sourceRunId) {
  if (!/^[1-9][0-9]+$/.test(sourceRunId || '')) throw Error('Use an exact source Actions run ID');
  const receipt = JSON.parse(fs.readFileSync(filename, 'utf8'));
  const phases = ['validate_projects', 'deploy_frontend_preview', 'assign_test_alias', 'verify_public_preview', 'update_staging_api_origin', 'redeploy_staging_api', 'verify_staging_proxy', 'ready'];
  if (receipt.origin !== origin || receipt.apiOrigin !== staging.apiOrigin || receipt.fingerprint !== staging.fingerprint || !phases.includes(receipt.phase)) throw Error('Receipt does not match the approved staging target');
  const result = { sourceRunId, phase: receipt.phase };
  for (const field of ['frontendDeployment', 'previousFrontendAliasDeployment', 'previousBackendDeployment', 'backendDeployment']) {
    if (receipt[field] === undefined || receipt[field] === null) result[field] = null;
    else if (typeof receipt[field] === 'string' && /^dpl_[A-Za-z0-9]+$/.test(receipt[field])) result[field] = receipt[field];
    else throw Error('Invalid receipt deployment identifier');
  }
  // Deliberately omit provider URLs, environment values and unknown properties.
  return result;
}

async function main(env = process.env) {
  const config = settings(env);
  if (config.operation !== 'diagnose-https') throw Error('Use the GET-only HTTPS diagnostic operation');
  const output = path.resolve(__dirname, 'generated'); fs.mkdirSync(output, { recursive: true });
  const result = { source: null, beforeOrigin: null, afterOrigin: null, credentialFailure: null };
  let invalidReceipt = false;
  if (env.STAGING_FAILED_RUN_ID) {
    try { result.source = partialState(env.STAGING_FAILURE_RECEIPT, config.origin, env.STAGING_FAILED_RUN_ID); }
    catch { invalidReceipt = true; }
  }
  let request;
  try {
    assertPrivateAutomation(env);
    request = bypassRequest(config.origin, env.VERCEL_AUTOMATION_BYPASS_SECRET);
  } catch (error) {
    if (!(error instanceof AutomationBypassError)) throw error;
    result.credentialFailure = { check: 'automation_bypass', status: null, category: error.category };
  }
  // Provider automation access grants no application identity or database write.
  if (request) {
    result.beforeOrigin = await inspectHttps(config.origin, staging.fingerprint, request, { phase: 'before_origin' });
    result.afterOrigin = await inspectHttps(config.origin, staging.fingerprint, request, { phase: 'after_origin' });
  }
  const checks = result.credentialFailure ? [result.credentialFailure] :
    [...result.beforeOrigin.results, ...result.afterOrigin.results.map(value => ({ ...value, check: 'after_origin.' + value.check }))];
  for (const check of checks) console.log(JSON.stringify(check));
  const stateCategory = invalidReceipt ? 'source_receipt_unavailable_or_invalid' : result.source?.phase === 'verify_public_preview' ?
    'frontend_alias_assigned_backend_origin_update_not_reached' : result.source ? 'partial_state_recorded' : 'source_receipt_not_supplied';
  const state = { check: 'partial_deployment_state', status: null, category: stateCategory };
  console.log(JSON.stringify(state));
  if (env.GITHUB_ACTIONS === 'true') console.log('::notice title=Sanitized staging HTTPS diagnostics::' + JSON.stringify({ checks, state }));
  fs.writeFileSync(path.join(output, 'staging-https-diagnostics.json'), JSON.stringify(result), { mode: 0o600 });
  if (invalidReceipt || result.credentialFailure || !result.beforeOrigin.passed || !result.afterOrigin.passed) process.exitCode = 1;
}
if (require.main === module) main().catch(error => {
  console.error(error instanceof AutomationBypassError ? JSON.stringify({ check: 'automation_bypass', status: null, category: error.category }) :
    'Staging HTTPS diagnostics refused or failed; no deployment, alias or backend changes were attempted.');
  process.exitCode = 1;
});
module.exports = { partialState };
