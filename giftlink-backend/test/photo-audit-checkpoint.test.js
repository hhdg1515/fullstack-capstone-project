const assert = require('node:assert/strict');
const { compare } = require('../../deployment/photo-audit-comparison.cjs');
const path = require('node:path');
const read = file => require(path.join('../../docs/verification/', file));
describe('offline dependency checkpoint interpretation', function () {
    it('distinguishes 285 inherited report entries from added advisory records on the identical committed graph', function () {
        const delta = compare(read('m65f2/after-frontend.json'), read('m65f5/frontend-default-cache.json'));
        assert.equal(delta.inheritedOnlyAddedEntries.length, 285); assert.deepEqual(delta.addedAdvisories, []); assert.deepEqual(delta.changedAdvisories, []); assert.deepEqual(delta.removedAdvisories, []);
    });
    it('reproduces the full F2 report with a separate writable fresh cache without reducing the remaining real audit debt', function () {
        assert.deepEqual(read('m65f5/frontend-fresh-cache.json'), read('m65f2/after-frontend.json'));
        assert.equal(read('m65f5/frontend-fresh-cache.json').metadata.vulnerabilities.total, 67);
    });
    it('does not misclassify a genuinely new direct advisory as inherited package-count noise', function () {
        const before = { vulnerabilities: {}, metadata: { vulnerabilities: {} } }, added = { source: 1, url: 'https://github.com/advisories/GHSA-synthetic', range: '<1.0.0' };
        const current = { vulnerabilities: { synthetic: { via: [added] } }, metadata: { vulnerabilities: {} } }, result = compare(before, current);
        assert.deepEqual(result.addedAdvisories, ['synthetic:1']); assert.deepEqual(result.inheritedOnlyAddedEntries, []);
    });
});
