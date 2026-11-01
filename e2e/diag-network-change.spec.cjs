// DIAGNOSTIC ONLY (throwaway branch, never merged). Timing of Chromium
// net::ERR_NETWORK_CHANGED after a container starts on the default Docker bridge,
// and whether waiting for host IPv6 duplicate-address detection (no tentative
// addresses left) before navigating removes it. Records sanitized classes only.
const https = require('node:https');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { test, expect } = require('@playwright/test');
const docker = args => { try { return execFileSync('docker', args, { encoding: 'utf8', timeout: 60000 }); } catch (_) { return ''; } };
const tentative = () => { try { return execFileSync('ip', ['-o', '-6', 'addr', 'show', 'tentative'], { encoding: 'utf8' }).trim(); } catch (_) { return 'ip-unavailable'; } };
test('time ERR_NETWORK_CHANGED after container start and test the DAD-settle mitigation', async ({ browser }) => {
  test.setTimeout(1500000);
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'diag-'));
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-keyout', path.join(directory, 'k.pem'), '-out', path.join(directory, 'c.pem'), '-subj', '/CN=127.0.0.1'], { stdio: 'ignore' });
  const server = https.createServer({ key: fs.readFileSync(path.join(directory, 'k.pem')), cert: fs.readFileSync(path.join(directory, 'c.pem')) },
    (req, res) => { res.setHeader('Connection', 'close'); res.end('<!doctype html><title>diag</title><h1>ok</h1>'); }).listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  execFileSync('docker', ['pull', '-q', 'busybox:1.36']);
  const summary = {};
  try {
    for (const mode of ['immediate', 'after_dad_settle']) {
      const s = summary[mode] = { trials: 0, trialsWithFailure: 0, navigations: 0, failures: 0, failureOffsetsMs: [], settleMs: [], tentativeSeenMs: [] };
      for (let trial = 0; trial < 30; trial++) {
        const name = 'diag-' + mode.replace(/_/g, '-') + '-' + trial;
        await new Promise(resolve => setTimeout(resolve, 2500));
        const t0 = Date.now();
        docker(['run', '-d', '--name', name, '--publish', '127.0.0.1::27017', 'busybox:1.36', 'sleep', '600']);
        if (mode === 'after_dad_settle') {
          // Deterministic quiescence: wait until the host has no tentative IPv6 addresses.
          let seen = false; while (Date.now() - t0 < 10000) { const t = tentative(); if (t) seen = true; else break; await new Promise(resolve => setTimeout(resolve, 50)); }
          s.settleMs.push(Date.now() - t0); if (seen) s.tentativeSeenMs.push(Date.now() - t0);
          await new Promise(resolve => setTimeout(resolve, 100));
        }
        let failed = false; const start = Date.now();
        while (Date.now() - start < 4000) {
          const context = await browser.newContext({ ignoreHTTPSErrors: true }); const page = await context.newPage();
          const outcome = await page.goto('https://127.0.0.1:' + server.address().port + '/n').then(() => 'ok', error => (String(error.message).match(/net::ERR_[A-Z_]+|Timeout|crash/i) || ['other'])[0]);
          s.navigations++; if (outcome !== 'ok') { s.failures++; failed = true; s.failureOffsetsMs.push(outcome + '@' + (Date.now() - t0)); }
          await context.close();
        }
        s.trials++; if (failed) s.trialsWithFailure++;
        docker(['rm', '-f', name]);
      }
      console.log(JSON.stringify({ diagnostic: mode, result: s }));
    }
  } finally { server.close(); fs.rmSync(directory, { recursive: true, force: true }); }
  console.log(JSON.stringify({ diagnosticSummary: summary, tentativeProbe: tentative() === 'ip-unavailable' ? 'unavailable' : 'available' }));
  expect(Object.keys(summary)).toHaveLength(2);
});
