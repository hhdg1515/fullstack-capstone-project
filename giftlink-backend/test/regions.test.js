const assert = require('node:assert/strict');
const request = require('supertest');
const pino = require('pino');
const createApp = require('../app');
const { directory, validateRegion, regionChanges } = require('../services/regions');
const { verifyRegionSource } = require('../util/verify-region-source');
const source = require('./fixtures/metros-2021-source.json');
const previous = require('./fixtures/metros-v1.json');
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
        assert.equal(new Set(directory.metros.map(row => row.id)).size, 50);
        for (const row of directory.metros) {
            assert.match(row.id, /^\d{5}$/);
            for (const id of row.stateIds) { assert.ok(directory.states.some(state => state.id === id)); validateRegion(id, row.id); }
            if (row.suggestedTimeZone) assert.ok(validTimeZone(row.suggestedTimeZone));
        }
        assert.deepEqual(directory.metros.find(row => row.id === '38900').stateIds.slice().sort(), ['41', '53']);
        assert.equal(directory.metros.find(row => row.id === '19100').suggestedTimeZone, null);
        validateRegion('56', null); validateRegion(null, null);
    });
    it('matches the reviewed official M1 properties and derives every member state from that source', function () {
        assert.equal(source.length, directory.metros.length);
        assert.equal(new Set(source.map(row => row.GEOID)).size, source.length);
        for (const row of directory.metros) {
            const official = source.find(value => value.GEOID === row.id);
            assert.ok(official); assert.equal(official.LSAD, 'M1'); assert.equal(official.CBSAFP, row.id);
            assert.equal(row.label, official.NAME);
            assert.deepEqual(row.stateIds, official.NAME.split(', ').pop().split('-').map(code => directory.states.find(state => state.code === code).id));
            assert.ok(typeof row.shortLabel === 'string' && row.shortLabel.length < row.label.length + 10);
        }
        assert.equal(new Set(directory.metros.flatMap(row => row.stateIds)).size, 42);
        assert.deepEqual(directory.metros.find(row => row.id === '37980').stateIds, ['42', '34', '10', '24']);
        assert.deepEqual(directory.metros.find(row => row.id === '17140').stateIds, ['39', '21', '18']);
        assert.deepEqual(directory.metros.find(row => row.id === '33460').stateIds, ['27', '55']);
        assert.deepEqual(directory.metros.find(row => row.id === '28140').stateIds, ['29', '20']);
    });
    it('refuses an unverified or changed source file without any database access', function () {
        assert.throws(() => verifyRegionSource(Buffer.from(JSON.stringify({ features: [] }))), /Source hash differs/);
    });
    it('keeps all original IDs, official labels, memberships and explicit timezone policy without rewriting plans', function () {
        for (const old of previous) {
            const current = directory.metros.find(row => row.id === old.id);
            for (const field of Object.keys(old)) assert.deepEqual(current[field], old[field]);
            for (const stateId of old.stateIds) assert.deepEqual(regionChanges({ stateId, metroId: old.id }, { title: 'Ordinary edit' }), {});
        }
        for (const row of directory.metros.filter(row => !previous.some(old => old.id === row.id))) {
            assert.equal(row.suggestedTimeZone, row.stateIds.length === 1 && row.stateIds[0] === '06' ? 'America/Los_Angeles' : null);
        }
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
