const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), vm = require('node:vm');
const { createRequire } = require('node:module');
test('actual vendored and external minifier serializers retain security and round-trip behavior', () => {
  const rollupRequire = createRequire(require.resolve('rollup-plugin-terser'));
  const vendored = require(path.join(path.dirname(require.resolve('terser-webpack-plugin')), 'serialize-javascript.js'));
  for (const serialize of [vendored, rollupRequire('serialize-javascript')]) {
    const source = serialize({ text: '</script>', pattern: /synthetic/gi, fn: n => n + 1 });
    assert.ok(!source.includes('</script>')); const result = vm.runInNewContext('(' + source + ')');
    assert.equal(result.text, '</script>'); assert.equal(result.pattern.flags, 'gi'); assert.equal(result.fn(4), 5);
    assert.ok(!serialize(function () { return '</script>'; }).includes('</script>'));
    const re = /safe/, box = {}; Object.defineProperty(re, 'flags', { value: 'g"),globalThis.f2Injected=1,new RegExp("safe","g' });
    try { vm.runInNewContext('(' + serialize(re) + ')', box); } catch (error) { assert.equal(error.name, 'SyntaxError'); }
    assert.equal(box.f2Injected, undefined);
  }
});
test('real Rollup/Terser worker still minifies a trusted entry with serialized options', { timeout: 15000 }, async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'moveout-minifier-')); let bundle;
  try {
    const entry = path.join(temp, 'entry.js'); fs.writeFileSync(entry, 'export const result = [1,2,3].map(n => n*2).join(",");');
    const { rollup } = require('rollup'); const { terser } = require('rollup-plugin-terser');
    bundle = await rollup({ input: entry, plugins: [terser({ numWorkers: 1 })] });
    const { output } = await bundle.generate({ format: 'iife', name: 'F2Synthetic' }); const context = {};
    vm.runInNewContext(output[0].code, context); assert.equal(context.F2Synthetic.result, '2,4,6');
  } finally { if (bundle) await bundle.close(); fs.rmSync(temp, { recursive: true }); }
});
test('multipart parameter escaping prevents CRLF header injection', () => {
  const FormData = require('form-data'), form = new FormData();
  form.append('photo\r\nX-F2-Injected: yes', Buffer.from('synthetic'), { filename: 'test"\r\nX-F2-Injected: yes.png' });
  const body = form.getBuffer().toString(); assert.ok(!body.includes('\r\nX-F2-Injected: yes')); assert.ok(body.includes('%0D%0A'));
});
test('shell-quote retains its data round-trip API without running a shell or editor', () => {
  const quote = require('shell-quote'); const args = ['plain', 'space value', 'quote"value', 'line\nbreak', '%VARIABLE%'];
  assert.deepEqual(quote.parse(quote.quote(args)), args); assert.equal(typeof require('launch-editor'), 'function');
});
test('proxy-addr still distinguishes trusted loopback from an untrusted mapped address', () => {
  const proxy = require('proxy-addr'), trust = proxy.compile('loopback');
  const request = { socket: { remoteAddress: '::ffff:10.0.0.1' }, headers: { 'x-forwarded-for': '198.51.100.1' } };
  assert.equal(proxy(request, trust), '::ffff:10.0.0.1');
  request.socket.remoteAddress = '127.0.0.1'; assert.equal(proxy(request, trust), '198.51.100.1');
});
test('existing development WebSocket library completes a bounded loopback handshake and echo', { timeout: 10000 }, async () => {
  const http = require('node:http'), WebSocket = require('faye-websocket');
  const server = http.createServer(), sockets = new Set(); let client, timer;
  server.on('upgrade', (request, socket, head) => {
    sockets.add(socket); const peer = new WebSocket(request, socket, head);
    peer.on('message', event => peer.send(event.data));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const echoed = new Promise((resolve, reject) => {
      client = new WebSocket.Client('ws://127.0.0.1:' + server.address().port);
      client.on('open', () => client.send('synthetic compatibility'));
      client.on('message', event => resolve(event.data)); client.on('error', reject);
    });
    const result = await Promise.race([echoed, new Promise((resolve, reject) => { timer = setTimeout(() => reject(Error('Local handshake timed out')), 5000); })]);
    assert.equal(result, 'synthetic compatibility');
  } finally { clearTimeout(timer); if (client) client.close(); for (const socket of sockets) socket.destroy(); await new Promise(resolve => server.close(resolve)); }
});
