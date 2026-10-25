const { AutomationBypassError } = require('./vercel-bypass.cjs');
class HttpsPreflightError extends Error {
  constructor(results) {
    const first = results.find(result => result.failures.length);
    const failure = first.failures.find(value => value.category.startsWith('deployment_protection') || value.category === 'automation_bypass_rejected') || first.failures[0];
    super('HTTPS ' + failure.check + ' failed (' + (failure.status === null ? 'no HTTP response' : 'HTTP ' + failure.status) + '; ' + failure.category + ')');
    this.diagnostic = failure;
    this.results = results;
  }
}

function transportCategory(error) {
  if (error instanceof AutomationBypassError) return error.category;
  const code = error?.cause?.code || error?.code;
  if (['CERT_HAS_EXPIRED', 'CERT_NOT_YET_VALID', 'DEPTH_ZERO_SELF_SIGNED_CERT', 'SELF_SIGNED_CERT_IN_CHAIN', 'UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'ERR_TLS_CERT_ALTNAME_INVALID', 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY'].includes(code)) return 'tls_error';
  if (['ENOTFOUND', 'EAI_AGAIN'].includes(code)) return 'dns_error';
  if (['AbortError', 'TimeoutError'].includes(error?.name) || ['ETIMEDOUT', 'UND_ERR_CONNECT_TIMEOUT'].includes(code)) return 'timeout';
  return 'network_error';
}

function redirectCategory(location, origin) {
  try {
    const url = new URL(location, origin);
    if ((url.hostname === 'vercel.com' && /^\/(?:sso-api|login|oauth)(?:\/|$)/.test(url.pathname)) ||
        (url.origin === origin && /^\/_vercel\/(?:sso|auth)(?:\/|$)/.test(url.pathname))) return 'deployment_protection_redirect';
  } catch { /* No raw redirect target is returned or followed. */ }
  return 'http_redirect';
}

async function inspectHttps(origin, fingerprint, request = fetch, { phase = 'after_origin' } = {}) {
  if (!['before_origin', 'after_origin'].includes(phase)) throw Error('Use before_origin or after_origin HTTPS checks');
  const url = new URL(origin);
  if (url.protocol !== 'https:' || url.origin !== origin || url.username || url.password || !/^[a-f0-9]{64}$/.test(fingerprint)) throw Error('Use an exact HTTPS origin and approved fingerprint');
  const wrongFingerprint = (fingerprint[0] === '0' ? '1' : '0') + fingerprint.slice(1);
  const definitions = [
    { name: 'react_homepage', path: '/', status: 200, type: 'html' },
    { name: 'react_deep_link', path: '/app/items', status: 200, type: 'html' },
    { name: 'health_wrong_fingerprint', path: '/api/health', status: 409, type: 'json', target: wrongFingerprint },
    { name: 'health_approved_fingerprint', path: '/api/health', status: 200, type: 'json', target: fingerprint },
    { name: 'anonymous_me', path: '/api/me', status: 401, type: 'json', target: fingerprint }
  ];
  const results = [];
  for (const definition of definitions) {
    const result = { check: definition.name, status: null, category: 'passed', contentType: 'missing', cacheControl: 'missing', failures: [] };
    const fail = (assertion, category) => result.failures.push({ check: definition.name + '.' + assertion, status: result.status, category });
    const headers = definition.target ? { 'X-Deployment-Target': definition.target } : {};
    // Configuration/Origin agreement is checked only after APP_ORIGIN changes.
    // All five routing/readiness assertions remain required before that change.
    if (phase === 'after_origin' && definition.name === 'anonymous_me') headers.Origin = origin;
    let response;
    try {
      response = await request(origin + definition.path, { method: 'GET', credentials: 'omit', redirect: 'manual', signal: AbortSignal.timeout(15000), headers });
    } catch (error) { fail('transport', transportCategory(error)); }
    if (response) {
      result.status = response.status;
      const mime = (response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
      result.contentType = mime === 'application/json' ? 'json' : mime === 'text/html' ? 'html' : mime ? 'other' : 'missing';
      const cache = response.headers.get('cache-control') || '';
      result.cacheControl = /(?:^|[,\s])no-store(?:$|[,\s])/i.test(cache) ? 'no_store' : cache ? 'not_no_store' : 'missing';
      if (response.status >= 300 && response.status < 400) {
        const category = redirectCategory(response.headers.get('location'), origin);
        fail('redirect', request.usesVercelBypass && category === 'deployment_protection_redirect' ? 'automation_bypass_rejected' : category);
      } else {
        if (response.status !== definition.status) fail('status', 'unexpected_status');
        if (result.contentType !== definition.type) fail('content_type', result.contentType === 'html' ? 'html_instead_of_json' : 'unexpected_content_type');
        if (definition.type === 'json' && result.cacheControl !== 'no_store') fail('cache_control', 'missing_no_store');
        if (definition.type === 'json' && /^HIT$/i.test(response.headers.get('x-vercel-cache') || '')) fail('edge_cache', 'cached_api_response');
        let text;
        try { text = await response.text(); } catch (error) { fail('body_read', transportCategory(error)); }
        if (typeof text === 'string') {
          if ([401, 403].includes(response.status) && result.contentType === 'html' && /Authentication Required|Vercel Authentication|vercel\.com\/sso-api/i.test(text)) fail('protection', request.usesVercelBypass ? 'automation_bypass_rejected' : 'deployment_protection_html');
          if (text.length > 262144) fail('body_size', 'response_too_large');
          else if (result.contentType === definition.type && definition.type === 'html') {
            if (!/<div\s+id=["']root["']/.test(text) || !/<script\b[^>]*\bsrc=["'][^"']*\/static\/js\//.test(text)) fail('react_markup', 'unexpected_html_application');
          } else if (result.contentType === 'json' && definition.type === 'json') {
            let body;
            try { body = JSON.parse(text); } catch { fail('json_body', 'invalid_json'); }
            if (body !== undefined) {
              if (definition.name === 'health_wrong_fingerprint' && body?.error?.code !== 'DEPLOYMENT_CHANGED') fail('target_fence', 'deployment_fence_mismatch');
              if (definition.name === 'health_approved_fingerprint' && (body?.status !== 'ready' || body?.environment !== 'staging' || body?.databaseFingerprint !== fingerprint)) fail('staging_readiness', 'staging_target_or_readiness_mismatch');
              if (definition.name === 'anonymous_me' && !['UNAUTHENTICATED', 'UNAUTHORIZED'].includes(body?.error?.code)) fail('anonymous_auth', 'anonymous_auth_response_mismatch');
            }
          }
        }
        if (phase === 'after_origin' && definition.name === 'anonymous_me' &&
            (response.headers.get('access-control-allow-origin') !== origin || response.headers.get('access-control-allow-credentials') !== 'true')) fail('configured_origin', 'app_origin_mismatch');
      }
      // Redirect bodies, cookies and authentication headers are never inspected.
      if (response.status >= 300 && response.status < 400) {
        try { await response.body?.cancel(); } catch { /* Keep the precise redirect failure. */ }
      }
    }
    result.category = result.failures.find(failure => failure.category.startsWith('deployment_protection') || failure.category === 'automation_bypass_rejected')?.category || result.failures[0]?.category || 'passed';
    results.push(result);
  }
  return { phase, passed: results.every(result => !result.failures.length), results };
}

async function health(origin, fingerprint, request = fetch, options) {
  const inspected = await inspectHttps(origin, fingerprint, request, options);
  if (!inspected.passed) throw new HttpsPreflightError(inspected.results);
  return { tls: true, frontend: true, deepLink: true, jsonReadiness: true, targetFence: true, anonymousMe401: true, noStore: true,
    configuredOrigin: inspected.phase === 'after_origin' };
}
module.exports = { health, inspectHttps, HttpsPreflightError };
