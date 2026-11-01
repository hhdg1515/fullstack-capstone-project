// DIAGNOSTIC ONLY (throwaway branch, never merged). Does a host Docker network or
// container change abort an in-flight Chromium navigation on the CI runner?
// Each case starts a page.goto against a local HTTPS server whose HTML response
// is held for 1.5 s, triggers one Docker operation ~200 ms later, and records
// only the sanitized error class. No application, secret or user data is involved.
const https = require('node:https');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, execFile } = require('node:child_process');
const { test, expect } = require('@playwright/test');
const run = (args, done) => execFile('docker', args, { timeout: 30000 }, () => done && done());
const operations = {
  control: () => {},
  network_create_rm: name => run(['network', 'create', '--opt', 'com.docker.network.bridge.enable_ip_masquerade=false',
    '--opt', 'com.docker.network.bridge.enable_icc=false', name], () => run(['network', 'rm', name])),
  network_rm_only: name => run(['network', 'rm', name]),
  container_run_rm: name => run(['run', '--rm', '--name', name, '--publish', '127.0.0.1::8080', 'busybox:1.36', 'true'])
};
test('classify navigation outcomes during Docker host-network changes', async ({ browser }) => {
  test.setTimeout(900000);
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'diag-'));
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-keyout', path.join(directory, 'k.pem'), '-out', path.join(directory, 'c.pem'), '-subj', '/CN=127.0.0.1'], { stdio: 'ignore' });
  const server = https.createServer({ key: fs.readFileSync(path.join(directory, 'k.pem')), cert: fs.readFileSync(path.join(directory, 'c.pem')) },
    (req, res) => setTimeout(() => res.end('<!doctype html><title>diag</title><h1>ok</h1>'), 1500)).listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  execFileSync('docker', ['pull', '-q', 'busybox:1.36']);
  const results = {};
  try {
    for (const [name, operation] of Object.entries(operations)) {
      const counts = results[name] = {};
      for (let index = 0; index < 15; index++) {
        const resource = 'diag-' + name.replace(/_/g, '-') + '-' + index;
        if (name === 'network_rm_only') execFileSync('docker', ['network', 'create', resource]);
        const context = await browser.newContext({ ignoreHTTPSErrors: true }); const page = await context.newPage();
        const navigation = page.goto('https://127.0.0.1:' + server.address().port + '/x' + index).then(() => 'ok', error => (String(error.message).match(/net::ERR_[A-Z_]+|Timeout|crash/i) || ['other'])[0]);
        setTimeout(() => operation(resource), 200);
        const outcome = await navigation; counts[outcome] = (counts[outcome] || 0) + 1;
        await context.close(); await new Promise(resolve => setTimeout(resolve, 2500));
        execFile('docker', ['network', 'rm', resource], () => {});
      }
      console.log(JSON.stringify({ diagnostic: name, outcomes: counts }));
    }
  } finally { server.close(); fs.rmSync(directory, { recursive: true, force: true }); }
  console.log(JSON.stringify({ diagnosticSummary: results }));
  expect(Object.keys(results)).toHaveLength(4);
});
