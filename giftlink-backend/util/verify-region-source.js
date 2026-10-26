// Read-only, offline verification of a downloaded, immutable official source.
const fs = require('node:fs');
const { createHash } = require('node:crypto');
const assert = require('node:assert/strict');
const directory = require('../data/us-regions.json');
const evidence = require('../test/fixtures/metros-2021-source.json');
function verifyRegionSource(bytes) {
    assert.equal(createHash('sha256').update(bytes).digest('hex'), directory.source.metroSha256, 'Source hash differs from the pinned Census vintage');
    const source = JSON.parse(bytes.toString('utf8'));
    for (const expected of evidence) {
        const matches = source.features.filter(feature => feature.properties.GEOID === expected.GEOID);
        assert.equal(matches.length, 1, 'CBSA must occur exactly once');
        assert.deepEqual(matches[0].properties, expected, 'Source properties differ from the reviewed extract');
    }
    return evidence.length;
}
if (require.main === module) {
    try {
        assert.equal(process.argv.length, 3, 'Provide one downloaded Census GeoJSON file');
        console.log('Verified ' + verifyRegionSource(fs.readFileSync(process.argv[2])) + ' metro source records; no database accessed.');
    } catch (error) {
        console.error('Geographic source verification failed. Check the pinned file hash and reviewed extract.');
        process.exitCode = 1;
    }
}
module.exports = { verifyRegionSource };
