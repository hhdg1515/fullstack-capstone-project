// Offline/disposable manual acceptance. No user-supplied DB/storage endpoint,
// .env loading, remote fallback, persistent fixture reuse or production flags.
const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const http = require('node:http');
const { spawn, execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
if (args.length !== 1 || args[0] !== '--approve-disposable-local') {
  console.error('Usage: node local/manual-mvp.cjs --approve-disposable-local'); process.exitCode = 1;
} else if (process.env.E2E_APP_ORIGIN || process.env.MONGO_URL || process.env.ITEM_IMAGE_R2_ENABLED === 'true' || process.env.ITEM_IMAGE_STORAGE_ENDPOINT) {
  console.error('Clear inherited database, hosted E2E and storage configuration. This command accepts only fresh local fixtures.'); process.exitCode = 1;
} else run().catch(() => { console.error('Local acceptance startup failed. Check Node 22, Docker Desktop Linux x64, OpenSSL and installed dependencies. No remote fallback was attempted.'); process.exitCode = 1; });
function openssl() {
  if (process.platform === 'win32') {
    for (const base of [process.env.ProgramFiles, process.env['ProgramFiles(x86)']].filter(Boolean)) {
      const candidate = path.join(base, 'Git', 'usr', 'bin', 'openssl.exe');
      if (fs.existsSync(candidate)) return candidate;
    }
  }
  return 'openssl';
}
async function freePort() {
  const server = net.createServer(); await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const port = server.address().port; await new Promise(resolve => server.close(resolve)); return port;
}
async function waitForDev(port, child) {
  const deadline = Date.now() + 120000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw Error('Frontend exited');
    const ready = await new Promise(resolve => {
      const request = http.get({ host: '127.0.0.1', port, timeout: 1000 }, response => { response.resume(); resolve(response.statusCode === 200); });
      request.on('timeout', () => request.destroy()); request.on('error', () => resolve(false));
    });
    if (ready) return; await new Promise(resolve => setTimeout(resolve, 200));
  }
  throw Error('Frontend unavailable');
}
async function stopChild(child) {
  if (!child || child.exitCode !== null) return;
  // The PID comes directly from our non-shell spawn, never a saved/user PID.
  if (process.platform === 'win32') execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
  else { child.kill('SIGTERM'); await new Promise(resolve => { child.once('exit', resolve); setTimeout(resolve, 5000).unref(); }); }
}
async function run() {
  if (Number(process.versions.node.split('.')[0]) !== 22) throw Error('Node 22 required');
  for (const key of ['DOCKER_CONTEXT', 'DOCKER_TLS', 'DOCKER_TLS_VERIFY', 'DOCKER_CERT_PATH']) delete process.env[key];
  process.env.DOCKER_HOST = process.platform === 'win32' ? 'npipe:////./pipe/docker_engine' : 'unix:///var/run/docker.sock';
  const opensslPath = openssl(); execFileSync(opensslPath, ['version'], { stdio: 'ignore', windowsHide: true });
  let dev, local, stopping = false;
  const shutdown = async () => {
    if (stopping) return; stopping = true;
    console.log('Stopping only this run; its disposable accounts, photos and database will be removed.');
    try { await stopChild(dev); } finally { if (local) await local.close(); }
  };
  const interrupt = () => { shutdown().then(() => { process.exitCode = 0; }).catch(() => { console.error('Local cleanup could not verify all owned resources; do not prune Docker.'); process.exitCode = 1; }); };
  process.once('SIGINT', interrupt); process.once('SIGTERM', interrupt);
  try {
    const port = await freePort();
    dev = spawn(process.execPath, [path.join(root, 'giftlink-frontend/node_modules/react-scripts/scripts/start.js')], {
      cwd: path.join(root, 'giftlink-frontend'), shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, HOST: '127.0.0.1', PORT: String(port), BROWSER: 'none', HTTPS: 'false', REACT_APP_BACKEND_URL: '', WDS_SOCKET_PORT: '0' }
    });
    // CRA output can contain inherited host configuration; don't forward it.
    dev.stdout.resume(); dev.stderr.resume(); await waitForDev(port, dev);
    local = await require('../e2e/local.cjs').localEnvironment({ photos: true, ownerListings: true, ownerListingPhotos: true,
      ownerListingPickups: true, ownerListingPublication: true, developmentOrigin: 'http://127.0.0.1:' + port, guardedPreparation: true, opensslPath });
    if (stopping) { await local.close(); return; }
    console.log('Fresh verified local MongoDB replica set and private SeaweedFS; guarded index preview/apply completed.');
    console.log('Open: ' + local.origin + '/app/listings');
    console.log('Health: ' + local.origin + '/api/health');
    console.log('Local-only self-signed certificate: ' + local.certificatePath);
    console.log('Use a normal browser and InPrivate/Incognito for two synthetic accounts. Ctrl+C stops and resets ONLY this run.');
  } catch (error) { await shutdown(); throw error; }
}
module.exports = { openssl, freePort };
