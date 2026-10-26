const assert = require('node:assert/strict');
const request = require('supertest');
const pino = require('pino');
const createApp = require('../app');
const { directory, validateRegion, regionChanges } = require('../services/regions');
const { validTimeZone } = require('../services/pickup-policy');

describe('dated curated U.S. geographic directory', function () {
    it('contains exactly 50 states plus DC with unique FIPS/USPS IDs and documented source vintage', function () {
        assert.equal(directory.states.length, 51); assert.equal(new Set(directory.states.map(row => row.id)).size, 51);
        assert.equal(new Set(directory.states.map(row => row.code)).size, 51);
        assert.deepEqual(directory.states.map(row => row.id).sort(), '01 02 04 05 06 08 09 10 11 12 13 15 16 17 18 19 20 21 22 23 24 25 26 27 28 29 30 31 32 33 34 35 36 37 38 39 40 41 42 44 45 46 47 48 49 50 51 53 54 55 56'.split(' '));
        assert.ok(directory.states.some(row => row.id === '11' && row.code === 'DC'));
        assert.ok(directory.states.every(row => /^\d{2}$/.test(row.id) && /^[A-Z]{2}$/.test(row.code)));
        assert.equal(directory.vintage.metros, 2021); assert.equal(directory.source.repository, 'uscensusbureau/citysdk');
        assert.match(directory.source.commit, /^[a-f0-9]{40}$/); assert.match(directory.source.metroSha256, /^[a-f0-9]{64}$/);
    });
    it('preserves shared cross-state CBSA IDs and does not invent nationwide metro coverage or timezone guesses', function () {
        assert.equal(new Set(directory.metros.map(row => row.id)).size, 12);
        for (const row of directory.metros) {
            assert.match(row.id, /^\d{5}$/);
            for (const id of row.stateIds) { assert.ok(directory.states.some(state => state.id === id)); validateRegion(id, row.id); }
            if (row.suggestedTimeZone) assert.ok(validTimeZone(row.suggestedTimeZone));
        }
        assert.deepEqual(directory.metros.find(row => row.id === '38900').stateIds.slice().sort(), ['41', '53']);
        assert.equal(directory.metros.find(row => row.id === '19100').suggestedTimeZone, null);
        validateRegion('02', null); validateRegion(null, null);
    });
    it('rejects labels, unknown IDs, wrong state/metro pairs, arrays and operator objects', function () {
        for (const [state, metro] of [['CA', '31080'], ['06', 'unknown'], ['06', '47900'], [null, '31080'],
            [6, '31080'], [['06'], '31080'], [{ $ne: null }, null], ['99', null], ['', null]]) {
            assert.throws(() => validateRegion(state, metro), error => error.code === 'INVALID_REGION');
        }
        assert.deepEqual(regionChanges({}, { city: 'Oakland' }), {});
        assert.deepEqual(regionChanges({ stateId: '06', metroId: '41860' }, { stateId: '06' }), { stateId: '06', metroId: '41860' });
    });
    it('serves public metadata without connecting, creating indexes or accepting supplied geography', async function () {
        const app = createApp({ connectToDatabase: async () => { throw new Error('No database permitted'); }, logger: pino({ level: 'silent' }) });
        const result = await request(app).get('/api/regions').expect(200);
        assert.deepEqual(result.body, directory); assert.match(result.headers['cache-control'], /no-store/);
    });
});
