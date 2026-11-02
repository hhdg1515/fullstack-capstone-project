const { execFileSync } = require('node:child_process');
// On a Linux host, each fixture container start adds a host veth whose IPv6
// link-local address completes duplicate-address detection about 1-2 s later.
// The shared Chromium treats that address change as a network change and fails
// navigations that are still connecting with net::ERR_NETWORK_CHANGED (measured
// on the CI runner image: 4/30 trials at 1.2-1.6 s; 0/30 after this wait).
// Hand a deployment to the browser only after the host has no tentative IPv6
// addresses. Bounded, and skipped where `ip` is unavailable (Docker Desktop keeps
// container interfaces inside its VM). Never retries or hides application errors.
async function hostNetworkSettled({ platform = process.platform, run = execFileSync, limitMs = 10000, pollMs = 50, marginMs = 100, log = console.error } = {}) {
  if (platform !== 'linux') return 'skipped';
  const started = Date.now();
  while (Date.now() - started < limitMs) {
    let tentative;
    try { tentative = String(run('ip', ['-o', '-6', 'addr', 'show', 'tentative'], { encoding: 'utf8', timeout: 2000 })).trim(); }
    catch (error) { return 'skipped'; }
    // Let the browser's netlink observer handle the final address event first.
    if (!tentative) { await new Promise(resolve => setTimeout(resolve, marginMs)); return 'settled'; }
    await new Promise(resolve => setTimeout(resolve, pollMs));
  }
  log('Host IPv6 addresses still tentative after ' + limitMs + ' ms; continuing.');
  return 'unsettled';
}
module.exports = { hostNetworkSettled };
