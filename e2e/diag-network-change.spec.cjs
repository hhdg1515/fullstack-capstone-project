// DIAGNOSTIC ONLY (throwaway branch, never merged). Does a host Docker network or
// container change abort Chromium navigations that open new connections shortly
// afterwards on the CI runner? Chromium flushes connecting sockets with
// net::ERR_NETWORK_CHANGED and delays its network-change signal by up to ~2 s,
// so each trial performs the Docker operation, then opens fresh connections
// (new context, Connection: close) for 4 s and records only sanitized error classes.
const https = require('node:https');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { test, expect } = require('@playwright/test');
const docker = args => { try { execFileSync('docker', args, { stdio: 'ignore', timeout: 60000 }); } catch (_) { /* cleanup best effort */ } };
const photoNetwork = name => ['network', 'create', '--opt', 'com.docker.network.bridge.enable_ip_masquerade=false', '--opt', 'com.docker.network.bridge.enable_icc=false', name];
const operations = {
  control: () => {},
  bridge_network_create: name => docker(photoNetwork(name)),
  bridge_network_remove: name => docker(['network', 'rm', name]),
  default_bridge_container_start: name => docker(['run', '-d', '--name', name, '--publish', '127.0.0.1::8080', 'busybox:1.36', 'sleep', '600']),
  default_bridge_container_remove: name => docker(['rm', '-f', name]),
  // The CI order: previous photo test tears down its container + private network,
  // then the next test starts its MongoDB-style container on the default bridge.
  photo_teardown_then_next_setup: name => {
    docker(['rm', '-f', name + '-photo']); docker(['network', 'rm', name + '-net']); docker(['rm', '-f', name + '-db']);
    docker(['run', '-d', '--name', name + '-next', '--publish', '127.0.0.1::27017', 'busybox:1.36', 'sleep', '600']);
  }
};
const prepare = {
  bridge_network_remove: name => docker(photoNetwork(name)),
  default_bridge_container_remove: name => docker(['run', '-d', '--name', name, '--publish', '127.0.0.1::8080', 'busybox:1.36', 'sleep', '600']),
  photo_teardown_then_next_setup: name => {
    docker(photoNetwork(name + '-net'));
    docker(['run', '-d', '--name', name + '-photo', '--network', name + '-net', '--publish', '127.0.0.1::8333', 'busybox:1.36', 'sleep', '600']);
    docker(['run', '-d', '--name', name + '-db', '--publish', '127.0.0.1::27017', 'busybox:1.36', 'sleep', '600']);
  }
};
test('classify fresh-connection navigation outcomes after Docker host-network changes', async ({ browser }) => {
  test.setTimeout(1500000);
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'diag-'));
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-keyout', path.join(directory, 'k.pem'), '-out', path.join(directory, 'c.pem'), '-subj', '/CN=127.0.0.1'], { stdio: 'ignore' });
  const server = https.createServer({ key: fs.readFileSync(path.join(directory, 'k.pem')), cert: fs.readFileSync(path.join(directory, 'c.pem')) },
    (req, res) => { res.setHeader('Connection', 'close'); res.end('<!doctype html><title>diag</title><h1>ok</h1>'); }).listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  execFileSync('docker', ['pull', '-q', 'busybox:1.36']);
  const results = {};
  try {
    for (const [name, operation] of Object.entries(operations)) {
      const counts = results[name] = { trialsWithFailure: 0 };
      for (let trial = 0; trial < 8; trial++) {
        const resource = 'diag-' + name.replace(/_/g, '-') + '-' + trial;
        if (prepare[name]) prepare[name](resource);
        await new Promise(resolve => setTimeout(resolve, 3000)); // let preparation's own signal pass
        operation(resource);
        let failed = false; const until = Date.now() + 4000;
        while (Date.now() < until) {
          const context = await browser.newContext({ ignoreHTTPSErrors: true }); const page = await context.newPage();
          const outcome = await page.goto('https://127.0.0.1:' + server.address().port + '/n').then(() => 'ok', error => (String(error.message).match(/net::ERR_[A-Z_]+|Timeout|crash/i) || ['other'])[0]);
          counts[outcome] = (counts[outcome] || 0) + 1; if (outcome !== 'ok') failed = true;
          await context.close();
        }
        if (failed) counts.trialsWithFailure++;
        for (const suffix of ['', '-photo', '-db', '-next']) docker(['rm', '-f', resource + suffix]);
        for (const suffix of ['', '-net']) docker(['network', 'rm', resource + suffix]);
      }
      console.log(JSON.stringify({ diagnostic: name, outcomes: counts }));
    }
  } finally { server.close(); fs.rmSync(directory, { recursive: true, force: true }); }
  console.log(JSON.stringify({ diagnosticSummary: results }));
  expect(Object.keys(results)).toHaveLength(6);
});
