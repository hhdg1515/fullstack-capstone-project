const { spawnSync } = require('node:child_process');
const { approve, inspectRemote, assertBudget, newRunId, runPattern } = require('./policy.cjs');
const { cleanup } = require('./cleanup.cjs');
const { recordRun } = require('./run-receipt.cjs');
const { AutomationBypassError } = require('./vercel-bypass.cjs');
(async () => {
  let remote;
  try {
    const operation = process.argv[2] || 'preview';
    if (!['preview', 'run', 'cleanup'].includes(operation)) throw Error('Use preview, run or cleanup');
    if (operation !== 'preview') approve(process.env, operation);
    remote = await inspectRemote(process.env);
    if (operation !== 'preview' && remote.inspected.fingerprint !== process.env.E2E_CONFIRM_TARGET) throw Error('Fingerprint mismatch');
    console.log(JSON.stringify({ mode: operation, origin: remote.origin, database: remote.inspected.database, environment: 'staging', fingerprint: remote.inspected.fingerprint, checks: remote.checks }));
    if (operation === 'preview') {
      const remaining = await remote.db.collection('users').countDocuments({ email: /^e2e\+[a-f0-9]{32}\./ });
      console.log(JSON.stringify({ syntheticAccountsRemaining: remaining, maxAccountsPerRun: 4, writes: false }));
      if (process.env.E2E_RUN_ID) console.log(JSON.stringify({ cleanupPreview: await cleanup(remote.db, process.env.E2E_RUN_ID, false) }));
      return;
    }
    if (operation === 'cleanup') {
      if (!runPattern.test(process.env.E2E_RUN_ID || '')) throw Error('Set the exact owned E2E_RUN_ID');
      console.log(JSON.stringify({ cleanup: await cleanup(remote.db, process.env.E2E_RUN_ID, true) })); return;
    }
    await assertBudget(remote.db);
    const runId = newRunId();
    recordRun({ runId, origin: remote.origin, database: remote.inspected.database, fingerprint: remote.inspected.fingerprint });
    console.log(JSON.stringify({ runId, maxAccounts: 4, note: 'Use this exact run ID for separately approved cleanup. No automatic remote cleanup.' }));
    await remote.database.close(); remote = undefined;
    const child = spawnSync(process.execPath, [require.resolve('@playwright/test/cli'), 'test'], { stdio: 'inherit', env: { ...process.env, E2E_RUN_ID: runId, E2E_REMOTE_RUN: 'confirmed' } });
    process.exitCode = typeof child.status === 'number' ? child.status : 1;
  } catch (error) {
    console.error(error instanceof AutomationBypassError ? JSON.stringify({ check: 'automation_bypass', status: null, category: error.category }) :
      'E2E operation refused or failed. Review the guarded setup/approvals and target privately. No broad cleanup or index creation was attempted.');
    process.exitCode = 1;
  }
  finally { if (remote) await remote.database.close().catch(() => {}); }
})();
