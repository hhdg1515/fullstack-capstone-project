const { test: base, expect } = require('./local-browser.cjs');
const { approve, inspectRemote, newRunId, runPattern } = require('./policy.cjs');
const { localEnvironment } = require('./local.cjs');
const test = base.extend({
  deployment: [async ({}, use) => {
    if (process.env.E2E_APP_ORIGIN) {
      approve(process.env, 'run');
      if (process.env.E2E_REMOTE_RUN !== 'confirmed' || !runPattern.test(process.env.E2E_RUN_ID || '')) throw Error('Use the guarded remote:run launcher');
      const remote = await inspectRemote(process.env);
      try {
        if (remote.inspected.fingerprint !== process.env.E2E_CONFIRM_TARGET) throw Error('Approved fingerprint changed');
        await use({ ...remote, fingerprint: remote.inspected.fingerprint, runId: process.env.E2E_RUN_ID, local: false, now: Date.now });
      } finally { await remote.database.close(); }
    } else {
      const local = await localEnvironment(); try { await use({ ...local, runId: newRunId() }); } finally { await local.close(); }
    }
  }, { scope: 'worker', timeout: 180000 }]
});
module.exports = { test, expect };
