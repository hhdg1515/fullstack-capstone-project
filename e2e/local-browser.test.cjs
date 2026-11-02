const { test } = require('node:test');
const assert = require('node:assert/strict');
const { withLocalBrowser } = require('./local-browser.cjs');

test('each local browser starts after the verified deployment and closes before its teardown', async () => {
  const events = [], target = { local: true, origin: 'https://127.0.0.1:4567' };
  const type = { launch: async options => {
    assert.deepEqual(options, { headless: true }); events.push('launch');
    return { close: async () => events.push('close') };
  } };
  for (let i = 0; i < 2; i++) {
    events.push('deployment-ready');
    await withLocalBrowser(target, type, { headless: true }, async () => events.push('test'));
    events.push('deployment-close');
  }
  assert.deepEqual(events, Array(2).fill(['deployment-ready', 'launch', 'test', 'close', 'deployment-close']).flat());
});
test('failed local assertions close their browser without retrying the test or launch', async () => {
  let launches = 0, closes = 0, calls = 0;
  await assert.rejects(withLocalBrowser({ local: true, origin: 'https://localhost:4567' }, {
    launch: async () => { launches++; return { close: async () => closes++ }; }
  }, {}, async () => { calls++; throw Error('assertion failed'); }), /assertion failed/);
  assert.equal(launches, 1); assert.equal(closes, 1); assert.equal(calls, 1);
});
test('local browser refuses remote, unverified, credential-bearing and non-HTTPS targets before launch', async () => {
  let launches = 0;
  const type = { launch: async () => { launches++; } };
  for (const changes of [{ local: false }, { local: undefined }, { origin: 'https://staging.example.invalid' },
    { origin: 'http://localhost:1234' }, { origin: 'https://user:secret@localhost' }, { origin: 'https://localhost/path' },
    { origin: 'https://localhost/?secret=synthetic' }, { origin: 'https://localhost/#fragment' }]) {
    await assert.rejects(withLocalBrowser({ local: true, origin: 'https://127.0.0.1:4567', ...changes }, type, {}, async () => {}));
  }
  assert.equal(launches, 0);
});
