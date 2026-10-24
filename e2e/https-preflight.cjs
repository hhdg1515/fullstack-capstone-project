async function health(origin, fingerprint, request = fetch) {
  const options = headers => ({ redirect: 'error', signal: AbortSignal.timeout(15000), headers });
  const json = response => response.headers.get('content-type')?.includes('application/json');
  const uncached = response => /(?:^|[,\s])no-store(?:$|[,\s])/.test(response.headers.get('cache-control') || '');
  const fence = await request(origin + '/api/health', options({ 'X-Deployment-Target': '0'.repeat(64) }));
  if (fence.status !== 409 || !json(fence) || !uncached(fence) || (await fence.json()).error?.code !== 'DEPLOYMENT_CHANGED') throw Error('Proxy did not preserve the deployment-target fence');
  const response = await request(origin + '/api/health', options({ 'X-Deployment-Target': fingerprint }));
  if (response.status !== 200 || !json(response) || !uncached(response)) throw Error('Test API is not ready as uncached JSON');
  const body = await response.json();
  if (body.status !== 'ready' || body.environment !== 'staging' || body.databaseFingerprint !== fingerprint) throw Error('API and inspected staging database do not match; no test writes permitted');
  const anonymous = await request(origin + '/api/me', options({ 'X-Deployment-Target': fingerprint }));
  if (anonymous.status !== 401 || !json(anonymous) || !uncached(anonymous)) throw Error('Anonymous account access must return uncached JSON 401');
  for (const path of ['/', '/app/items']) {
    const page = await request(origin + path, options({}));
    if (page.status !== 200 || !page.headers.get('content-type')?.includes('text/html')) throw Error('Frontend or deep link is unavailable');
    const html = await page.text();
    if (!/<div\s+id=["']root["']/.test(html) || !/<script\b[^>]*\bsrc=["'][^"']*\/static\/js\//.test(html)) throw Error('Frontend does not serve the expected built React application');
  }
  return { tls: true, frontend: true, deepLink: true, jsonReadiness: true, targetFence: true, anonymousMe401: true, noStore: true };
}
module.exports = { health };
