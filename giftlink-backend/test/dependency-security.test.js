const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), vm = require('node:vm');
describe('scoped tooling security overrides on Node 22', function () {
    this.timeout(20000);
    it('keeps JSHint dependencies compatible and blocks inherited array-path deletion in an isolated process', function () {
        const lodash = require.resolve('lodash', { paths: [path.dirname(require.resolve('jshint'))] });
        execFileSync(process.execPath, ['-e', `
            const assert = require('node:assert/strict'), lodash = require(${JSON.stringify(lodash)});
            Object.prototype.f2ProtectedSentinel = 'retained';
            try {
                lodash.unset({}, ['__proto__', 'f2ProtectedSentinel']);
                assert.equal(Object.prototype.f2ProtectedSentinel, 'retained');
                assert.equal(lodash.template('Hello <%= name %>')({ name: 'synthetic' }), 'Hello synthetic');
            } finally { delete Object.prototype.f2ProtectedSentinel; }
        `], { timeout: 5000 });
        const minimatch = require(require.resolve('minimatch', { paths: [path.dirname(require.resolve('jshint'))] }));
        assert.equal(minimatch('test/file.test.js', '**/*.test.js'), true);
    });
    it('preserves serializer values/options while escaping HTML and resisting injected RegExp flags', function () {
        const serialize = require(require.resolve('serialize-javascript', { paths: [path.dirname(require.resolve('mocha'))] }));
        const input = { text: '</script><script>synthetic</script>', regex: /safe/gi, date: new Date('2026-01-01T00:00:00.000Z'), fn: value => value + 1 };
        const output = serialize(input); assert.ok(!output.includes('</script>'));
        const decoded = vm.runInNewContext('(' + output + ')');
        assert.equal(decoded.text, input.text); assert.equal(decoded.regex.flags, 'gi'); assert.equal(decoded.date.toISOString(), input.date.toISOString()); assert.equal(decoded.fn(2), 3);
        const re = /safe/; Object.defineProperty(re, 'flags', { value: 'g"),globalThis.f2Injected=1,new RegExp("safe","g' });
        const box = {};
        try { vm.runInNewContext('(' + serialize(re) + ')', box); }
        catch (error) { assert.equal(error.name, 'SyntaxError'); }
        assert.equal(box.f2Injected, undefined);
    });
    it('executes the real Mocha parallel worker serialization boundary with the scoped override', function () {
        const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'moveout-tooling-'));
        try {
            const files = ['one', 'two'].map(name => { const file = path.join(temp, name + '.js'); fs.writeFileSync(file, "describe('trusted worker',()=>it('round trip',()=>require('node:assert/strict').equal(2+2,4)));\n"); return file; });
            const result = JSON.parse(execFileSync(process.execPath, [require.resolve('mocha/bin/mocha'), '--parallel', '--jobs', '2', '--grep', 'trusted', '--reporter', 'json'].concat(files), { timeout: 15000 }));
            assert.equal(result.stats.passes, 2); assert.equal(result.stats.failures, 0);
        } finally { fs.rmSync(temp, { recursive: true }); }
    });
});
