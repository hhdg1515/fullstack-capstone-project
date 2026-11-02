const test = require('node:test'), assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const launcher = path.join(__dirname, 'manual-mvp.cjs');
const run = (args, extra = {}) => spawnSync(process.execPath, [launcher, ...args], { env: { ...process.env, ...extra }, encoding: 'utf8', timeout: 10000 });
test('manual fixture requires exactly one explicit local disposal approval', () => {
  for (const args of [[], ['--apply'], ['--approve-disposable-local', '--allow-remote']]) {
    const result = run(args); assert.equal(result.status, 1); assert.match(result.stderr, /Usage:/); assert.equal(result.stdout, '');
  }
});
for (const [key, value] of [['MONGO_URL', 'mongodb+srv://synthetic-secret@remote.invalid/database'], ['E2E_APP_ORIGIN', 'https://remote.invalid'],
  ['ITEM_IMAGE_R2_ENABLED', 'true'], ['ITEM_IMAGE_STORAGE_ENDPOINT', 'https://remote.invalid']]) {
  test('manual fixture refuses inherited ' + key + ' before importing fixture code', () => {
    const result = run(['--approve-disposable-local'], { [key]: value }); assert.equal(result.status, 1);
    assert.match(result.stderr, /Clear inherited/); assert.equal(result.stdout, ''); assert.ok(!result.stderr.includes(value));
  });
}
