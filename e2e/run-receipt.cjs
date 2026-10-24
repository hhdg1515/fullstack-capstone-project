const fs = require('node:fs');
const path = require('node:path');
const { runPattern } = require('./policy.cjs');
function recordRun({ runId, origin, database, fingerprint }, { directory = 'run-receipts', output = process.env.GITHUB_OUTPUT } = {}) {
  if (!runPattern.test(runId) || !/^[a-f0-9]{64}$/.test(fingerprint)) throw Error('Invalid receipt identity');
  const receipt = { runId, origin, database, fingerprint, maxAccounts: 4, maxPlans: 2, maxItems: 6, maxRequests: 8, maxIssuedSessions: 8, ownedSessionExpiryUpdates: 2 };
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, runId + '.json'), JSON.stringify(receipt), { mode: 0o600, flag: 'wx' });
  // A nonsecret output makes the exact run-scoped cleanup ID discoverable through
  // artifact metadata, even when a runner's raw log download is unavailable.
  if (output) fs.appendFileSync(output, 'run_id=' + runId + '\n');
  return receipt;
}
module.exports = { recordRun };
