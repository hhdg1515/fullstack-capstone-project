const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { staging, testOrigin } = require('./staging-target.cjs');
const { frontendConfig } = require('./frontend-config.cjs');
const { health } = require('../e2e/https-preflight.cjs');
const { StagingError, vercelApi } = require('./vercel-api.cjs');

function settings(env) {
  if (env.GITHUB_REPOSITORY !== 'hhdg1515/fullstack-capstone-project' || env.GITHUB_EVENT_NAME !== 'workflow_dispatch' ||
      !/^refs\/heads\/.+/.test(env.GITHUB_REF || '') || (env.GITHUB_REF !== 'refs/heads/main' && env.STAGING_OPERATION !== 'inspect') ||
      !/^[a-f0-9]{40}$/.test(env.APPROVED_SHA || '') || env.APPROVED_SHA !== env.GITHUB_SHA) throw new StagingError('Use a reviewed manual main run');
  const origin = testOrigin(env.STAGING_FRONTEND_ORIGIN);
  if (!new URL(origin).hostname.endsWith('.vercel.app')) throw new StagingError('Use an approved free Vercel test alias; custom DNS is outside this workflow');
  if (!['plan', 'inspect', 'deploy'].includes(env.STAGING_OPERATION)) throw new StagingError('Choose plan, inspect or deploy');
  if (env.STAGING_OPERATION !== 'plan' && !env.VERCEL_TOKEN) throw new StagingError('Configure VERCEL_TOKEN in isolated-e2e');
  return { origin, operation: env.STAGING_OPERATION };
}

function preparePreview(directory, origin, { assets = path.join(directory, 'build') } = {}) {
  testOrigin(origin);
  if (!fs.existsSync(path.join(assets, 'index.html'))) throw new StagingError('Build the production frontend first');
  const local = path.join(directory, '.vercel'); const projectFile = path.join(local, 'project.json');
  if (fs.existsSync(projectFile)) {
    const project = JSON.parse(fs.readFileSync(projectFile, 'utf8'));
    if (project.projectId !== staging.frontendProjectId || project.orgId !== staging.teamId) throw new StagingError('Refuse a different local project link');
  }
  fs.mkdirSync(path.join(local, 'output'), { recursive: true });
  fs.writeFileSync(projectFile, JSON.stringify({ projectId: staging.frontendProjectId, orgId: staging.teamId }));
  const config = frontendConfig(staging.apiOrigin, origin);
  fs.writeFileSync(path.join(local, 'output/config.json'), JSON.stringify({ version: 3, routes: config.routes }));
  fs.cpSync(assets, path.join(local, 'output/static'), { recursive: true });
  return config;
}

async function inspect({ origin, api }) {
  testOrigin(origin);
  const probe = async pathname => {
    try { return { value: await api('GET', pathname) }; }
    catch (error) { if (!(error instanceof StagingError) || !error.diagnostic) throw error; return { failure: error.diagnostic.operation }; }
  };
  // Reproduce the original validation reads independently, so one hidden or
  // missing resource cannot prevent checking access to the second project.
  const frontend = await probe('/v9/projects/' + staging.frontendProjectId);
  const backend = await probe('/v9/projects/' + staging.backendProjectId);
  const production = await probe('/v13/deployments/' + new URL(staging.productionFrontendOrigin).hostname);
  const previous = await probe('/v13/deployments/' + new URL(staging.apiOrigin).hostname);
  const team = await probe('/v2/teams/' + staging.teamId);
  const frontendByName = await probe('/v9/projects/fullstack-capstone-project');
  const backendByName = await probe('/v9/projects/fullstack-capstone-project-vkwm');
  const aliases = [];
  for (const [value, projectId] of [[staging.productionFrontendOrigin, staging.frontendProjectId], [staging.apiOrigin, staging.backendProjectId]]) {
    const alias = await probe('/v4/aliases/' + new URL(value).hostname);
    const id = alias.value?.deploymentId;
    const deployment = typeof id === 'string' && /^dpl_[a-zA-Z0-9]+$/.test(id) ? await probe('/v13/deployments/' + id) : {};
    aliases.push(alias.value?.projectId === projectId && deployment.value?.projectId === projectId && deployment.value?.target === 'production' && deployment.value?.readyState === 'READY');
  }
  const matches = (project, id, name, root, node) => project?.id === id && project.accountId === staging.teamId && project.name === name &&
    project.rootDirectory === root && (!node || project.nodeVersion === node);
  return { operation: 'inspect', remoteChanges: false,
    firstLegacyValidationFailure: [frontend, backend, production, previous].find(result => result.failure)?.failure || null,
    teamReadAccess: team.value?.id === staging.teamId,
    frontendProjectAccess: frontend.value?.id === staging.frontendProjectId,
    backendProjectAccess: backend.value?.id === staging.backendProjectId,
    frontendTeamMatches: frontend.value?.accountId === staging.teamId,
    backendTeamMatches: backend.value?.accountId === staging.teamId,
    frontendConfigurationMatches: matches(frontend.value, staging.frontendProjectId, 'fullstack-capstone-project', 'giftlink-frontend'),
    backendConfigurationMatches: matches(backend.value, staging.backendProjectId, 'fullstack-capstone-project-vkwm', 'giftlink-backend', '22.x'),
    frontendNameMatchesId: frontendByName.value?.id === staging.frontendProjectId,
    backendNameMatchesId: backendByName.value?.id === staging.backendProjectId,
    frontendAliasResolved: aliases[0], backendAliasResolved: aliases[1] };
}

function diagnosticReporter(env, write = value => console.log(value)) {
  return value => {
    write(JSON.stringify(value));
    if (env.GITHUB_ACTIONS !== 'true') return;
    // Actions caps notices per step. Keep success events in the log and reserve
    // a single notice for the complete summary, even after many probes.
    if (value.operation === 'inspect') write('::notice title=Sanitized Vercel inspection::' + JSON.stringify(value));
    else if (value.result === 'failed') write('::warning title=Sanitized Vercel request::' + JSON.stringify(value));
  };
}

async function deploy({ origin, api, cli, preflight = health, pause = ms => new Promise(resolve => setTimeout(resolve, ms)), record = () => {} }) {
  testOrigin(origin);
  const receipt = { origin, apiOrigin: staging.apiOrigin, fingerprint: staging.fingerprint, phase: 'validate_projects' };
  const stage = phase => { receipt.phase = phase; record({ ...receipt }); };
  stage('validate_projects');
  const frontend = await api('GET', '/v9/projects/' + staging.frontendProjectId);
  const backend = await api('GET', '/v9/projects/' + staging.backendProjectId);
  if (frontend.id !== staging.frontendProjectId || frontend.accountId !== staging.teamId || frontend.name !== 'fullstack-capstone-project' || frontend.rootDirectory !== 'giftlink-frontend' ||
      backend.id !== staging.backendProjectId || backend.accountId !== staging.teamId || backend.name !== 'fullstack-capstone-project-vkwm' || backend.rootDirectory !== 'giftlink-backend' || backend.nodeVersion !== '22.x') throw new StagingError('Existing project configuration does not match the approved resources');
  const production = await api('GET', '/v13/deployments/' + new URL(staging.productionFrontendOrigin).hostname);
  const previous = await api('GET', '/v13/deployments/' + new URL(staging.apiOrigin).hostname);
  if (production.projectId !== staging.frontendProjectId || production.target !== 'production' || previous.projectId !== staging.backendProjectId || previous.target !== 'production' || previous.readyState !== 'READY') throw new StagingError('Unexpected production alias or staging API deployment');
  const hostname = new URL(origin).hostname;
  if ((production.alias || []).includes(hostname) || production.url === hostname) throw new StagingError('Never assign an existing frontend production hostname');
  const alias = await api('GET', '/v4/aliases/' + hostname, undefined, true);
  if (alias) {
    if (alias.projectId !== staging.frontendProjectId || !alias.deploymentId) throw new StagingError('Alias belongs to a different project');
    const current = await api('GET', '/v13/deployments/' + alias.deploymentId);
    if (current.projectId !== staging.frontendProjectId || current.target === 'production') throw new StagingError('Never repoint a production deployment alias');
  }
  receipt.previousFrontendAliasDeployment = alias?.deploymentId || null;
  receipt.previousBackendDeployment = previous.id;
  stage('deploy_frontend_preview');
  const url = await cli();
  if (!/^https:\/\/[a-z0-9.-]+\.vercel\.app$/.test(url)) throw new StagingError('Unexpected preview URL');
  const preview = await api('GET', '/v13/deployments/' + new URL(url).hostname);
  if (preview.projectId !== staging.frontendProjectId || preview.target === 'production' || preview.readyState !== 'READY') throw new StagingError('Refuse a non-preview deployment');
  receipt.frontendDeployment = preview.id; receipt.frontendDeploymentUrl = url;
  stage('assign_test_alias');
  await api('POST', '/v2/deployments/' + preview.id + '/aliases', { alias: hostname });
  stage('verify_public_preview');
  // Refuse provider login redirects/protection before changing the API origin.
  // These checks use GET only; no account or session is created.
  await preflight(origin, staging.fingerprint);
  stage('update_staging_api_origin');
  await api('POST', '/v10/projects/' + staging.backendProjectId + '/env?upsert=true',
    [{ key: 'APP_ORIGIN', value: origin, type: 'plain', target: ['production'] }]);
  stage('redeploy_staging_api');
  const deployment = await api('POST', '/v13/deployments?forceNew=1', { deploymentId: previous.id, name: backend.name, target: 'production', meta: { action: 'redeploy' } });
  if (deployment.projectId !== staging.backendProjectId || !deployment.id) throw new StagingError('Unexpected API redeployment');
  receipt.backendDeployment = deployment.id;
  let ready = false;
  for (let attempt = 0; attempt < 60; attempt++) {
    const state = await api('GET', '/v13/deployments/' + deployment.id);
    if (state.projectId !== staging.backendProjectId || state.target !== 'production' || ['ERROR', 'CANCELED'].includes(state.readyState)) throw new StagingError('Staging API redeployment failed');
    if (state.readyState === 'READY') {
      const active = await api('GET', '/v13/deployments/' + new URL(staging.apiOrigin).hostname);
      if (active.projectId !== staging.backendProjectId) throw new StagingError('The API alias changed projects');
      if (active.id === deployment.id) { ready = true; break; }
    }
    await pause(5000);
  }
  if (!ready) throw new StagingError('Staging API deployment did not become ready');
  stage('verify_staging_proxy');
  receipt.checks = await preflight(origin, staging.fingerprint);
  stage('ready');
  return receipt;
}

async function main(env = process.env) {
  const config = settings(env);
  const report = diagnosticReporter(env);
  if (config.operation === 'inspect') {
    const result = await inspect({ origin: config.origin, api: vercelApi(env.VERCEL_TOKEN, fetch, { readOnly: true, report }) });
    report(result);
    if (!result.frontendProjectAccess || !result.backendProjectAccess || !result.frontendConfigurationMatches || !result.backendConfigurationMatches ||
        !result.frontendNameMatchesId || !result.backendNameMatchesId || !result.frontendAliasResolved || !result.backendAliasResolved) process.exitCode = 1;
    return;
  }
  const repository = path.resolve(__dirname, '..');
  const frontend = path.join(repository, 'giftlink-frontend');
  // CLI validates project.rootDirectory relative to cwd. Run from the repo
  // root, with identical output for both supported monorepo link modes.
  preparePreview(frontend, config.origin);
  preparePreview(repository, config.origin, { assets: path.join(frontend, 'build') });
  const plan = { operation: config.operation, origin: config.origin, apiOrigin: staging.apiOrigin, frontendProjectId: staging.frontendProjectId,
    backendProjectId: staging.backendProjectId, frontendTarget: 'preview', backendTarget: 'production (dedicated staging API only)',
    productionFrontendUnchanged: staging.productionFrontendOrigin, expectedFingerprint: staging.fingerprint };
  if (config.operation === 'plan') { console.log(JSON.stringify({ ...plan, remoteChanges: false })); return; }
  const output = path.resolve(__dirname, 'generated'); fs.mkdirSync(output, { recursive: true });
  const record = receipt => { fs.writeFileSync(path.join(output, 'staging-deployment.json'), JSON.stringify(receipt)); console.log(JSON.stringify({ phase: receipt.phase })); };
  const result = await deploy({ origin: config.origin, api: vercelApi(env.VERCEL_TOKEN, fetch, { report }), record,
    cli: async () => {
      const child = spawnSync(env.VERCEL_CLI_PATH, ['deploy', '--prebuilt', '--environment=preview', '--yes', '--scope', staging.teamId, '--token', env.VERCEL_TOKEN],
        { cwd: repository, encoding: 'utf8', timeout: 600000 });
      if (child.status !== 0) throw new StagingError('Preview deployment failed; raw CLI output suppressed');
      return child.stdout.trim().split(/\r?\n/).findLast(line => /^https:\/\/[a-z0-9.-]+\.vercel\.app$/.test(line)) || '';
    } });
  console.log(JSON.stringify(result));
  console.log('Set isolated-e2e variable E2E_APP_ORIGIN to the receipt origin, then run the reviewed HTTPS preview workflow before bounded E2E.');
}
if (require.main === module) main().catch(error => {
  console.error(error instanceof StagingError ? error.message : 'Staging preparation/deployment failed. Review the sanitized phase receipt and provider access privately; no protection or network controls were relaxed.');
  process.exitCode = 1;
});
module.exports = { settings, preparePreview, vercelApi, inspect, diagnosticReporter, deploy };
