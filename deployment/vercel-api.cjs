const { staging, testOrigin } = require('./staging-target.cjs');
class StagingError extends Error {}

// Only describe known operations. Never interpolate provider messages, response
// bodies, credentials, request bodies or arbitrary resource strings into logs.
function describe(method, pathname) {
  for (const [role, id, name] of [
    ['frontend', staging.frontendProjectId, 'fullstack-capstone-project'],
    ['backend', staging.backendProjectId, 'fullstack-capstone-project-vkwm']
  ]) {
    for (const [kind, value] of [['id', id], ['name', name]]) {
      if (method === 'GET' && pathname === '/v9/projects/' + value) return {
        operation: 'get_' + role + '_project_by_' + kind, resource: role + '_project', endpoint: '/v9/projects/{idOrName}'
      };
    }
  }
  if (method === 'GET' && pathname === '/v2/teams/' + staging.teamId) return { operation: 'get_team', resource: 'team', endpoint: '/v2/teams/{teamId}' };
  if (method === 'GET' && pathname.startsWith('/v13/deployments/')) {
    const value = pathname.slice('/v13/deployments/'.length);
    if (!/^(?:dpl_[a-zA-Z0-9]+|[a-z0-9-]+\.vercel\.app)$/.test(value)) throw new StagingError('Refuse an invalid deployment identifier');
    const role = value === new URL(staging.productionFrontendOrigin).hostname ? 'frontend_production' :
      value === new URL(staging.apiOrigin).hostname ? 'staging_api' : null;
    return { operation: role ? 'get_' + role + '_deployment_by_hostname' : 'get_deployment', resource: role ? role + '_deployment' : 'deployment', endpoint: '/v13/deployments/{idOrUrl}' };
  }
  if (method === 'GET' && pathname.startsWith('/v4/aliases/')) {
    const value = pathname.slice('/v4/aliases/'.length);
    const role = value === new URL(staging.productionFrontendOrigin).hostname ? 'frontend_production' :
      value === new URL(staging.apiOrigin).hostname ? 'staging_api' : 'staging_frontend';
    if (role === 'staging_frontend') testOrigin('https://' + value);
    if (!/^[a-z0-9-]+\.vercel\.app$/.test(value)) throw new StagingError('Refuse an invalid alias identifier');
    return { operation: 'get_' + role + '_alias', resource: role + '_alias', endpoint: '/v4/aliases/{idOrAlias}' };
  }
  if (method === 'POST' && /^\/v2\/deployments\/dpl_[a-zA-Z0-9]+\/aliases$/.test(pathname)) return { operation: 'assign_test_alias', resource: 'staging_frontend_alias', endpoint: '/v2/deployments/{id}/aliases' };
  if (method === 'POST' && pathname === '/v10/projects/' + staging.backendProjectId + '/env?upsert=true') return { operation: 'update_staging_api_origin', resource: 'backend_environment', endpoint: '/v10/projects/{idOrName}/env' };
  if (method === 'POST' && pathname === '/v13/deployments?forceNew=1') return { operation: 'redeploy_staging_api', resource: 'backend_deployment', endpoint: '/v13/deployments' };
  throw new StagingError('Refuse an unsupported Vercel management request');
}

function vercelApi(token, request = fetch, { readOnly = false, report = () => {} } = {}) {
  return async (method, pathname, body, missing = false) => {
    if (readOnly && method !== 'GET') throw new StagingError('Read-only Vercel inspection forbids remote writes');
    const details = { ...describe(method, pathname), method };
    // Optional absence is meaningful only for the candidate staging alias.
    if (missing && details.resource !== 'staging_frontend_alias') throw new StagingError('Only the candidate staging alias may be absent');
    const url = new URL(pathname, 'https://api.vercel.com'); url.searchParams.set('teamId', staging.teamId);
    const fail = (classification, status = null) => {
      const diagnostic = { ...details, status, result: 'failed', classification };
      report(diagnostic);
      const error = new StagingError('Vercel ' + details.operation + ' (' + details.resource + ', ' + method + ' ' + details.endpoint + ') failed: ' +
        (status === null ? classification : 'HTTP ' + status + '; ' + classification));
      error.diagnostic = diagnostic;
      throw error;
    };
    let response;
    try {
      response = await request(url, { method, redirect: 'error', signal: AbortSignal.timeout(30000),
        headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    } catch { return fail('transport_error'); }
    if (missing && response.status === 404) { report({ ...details, status: 404, result: 'absent' }); return null; }
    if (!response.ok) return fail(({ 400: 'invalid_request', 401: 'unauthenticated', 403: 'forbidden', 404: 'not_found_or_inaccessible', 405: 'method_not_allowed', 429: 'rate_limited' })[response.status] || 'provider_error', response.status);
    let result;
    try { result = await response.json(); } catch { return fail('invalid_json_response', response.status); }
    report({ ...details, status: response.status, result: 'ok' });
    return result;
  };
}
module.exports = { StagingError, vercelApi };
