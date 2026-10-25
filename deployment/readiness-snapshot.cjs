const { staging } = require('./staging-target.cjs');
const unknown = 'not_observed';
function environment(project, key, target, expected) {
  if (!Array.isArray(project?.env)) return unknown;
  const entries = project.env.filter(value => value.key === key && (Array.isArray(value.target) ? value.target.includes(target) : value.target === target));
  if (!entries.length) return 'absent';
  // Never decrypt, print or return an environment value. Plain configuration
  // can be compared in the runner; secret values are presence-only metadata.
  if (expected === undefined) return 'present';
  if (entries.some(value => value.type !== 'plain' || typeof value.value !== 'string')) return 'present_value_not_observed';
  return entries.every(value => value.value === expected) ? 'matches_expected' : 'differs_from_expected';
}
function protection(project) {
  const scope = project?.ssoProtection?.deploymentType;
  const present = key => project && Object.hasOwn(project, key) ? Boolean(project[key]) : null;
  return { ssoConfigurationPresent: present('ssoProtection'),
    ssoScope: ['all', 'preview', 'prod_deployment_urls_and_all_previews'].includes(scope) ? scope : unknown,
    passwordConfigurationPresent: present('passwordProtection'),
    automationConfigurationPresent: present('protectionBypass') };
}
function readinessSnapshot({ frontend, backend, production, api, team, alias, preview }) {
  const plan = team?.billing?.plan;
  const routes = Array.isArray(production?.routes) ? production.routes : null;
  return { providerPlan: ['hobby', 'pro', 'enterprise'].includes(plan) ? plan : unknown,
    frontend: { protection: protection(frontend),
      productionBuildBackend: environment(frontend, 'REACT_APP_BACKEND_URL', 'production', ''),
      productionRoutesExposeStaging: routes ? routes.some(route => typeof route.dest === 'string' &&
        (route.dest.startsWith(staging.apiOrigin) || route.dest.startsWith(staging.frontendOrigin))) : null,
      productionIsExpectedProject: production ? production.projectId === staging.frontendProjectId && production.target === 'production' : null },
    stagingApi: { protection: protection(backend), node22: backend ? backend.nodeVersion === '22.x' : null,
      origin: environment(backend, 'APP_ORIGIN', 'production', staging.frontendOrigin),
      tier: environment(backend, 'DB_ENVIRONMENT', 'production', 'staging'),
      database: environment(backend, 'MONGO_DB_NAME', 'production', staging.database),
      databaseCredential: environment(backend, 'MONGO_URL', 'production'),
      activeDeploymentReady: api ? api.projectId === staging.backendProjectId && api.target === 'production' && api.readyState === 'READY' : null },
    assignedStagingAlias: { belongsToFrontend: alias ? alias.projectId === staging.frontendProjectId : null,
      pointsToReadyPreview: preview ? preview.projectId === staging.frontendProjectId && preview.target !== 'production' && preview.readyState === 'READY' : null },
    atlasControlPlane: unknown, productionDatabase: 'not_authorized_or_inspected' };
}
module.exports = { readinessSnapshot };
