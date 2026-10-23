const assert = require('node:assert/strict');
const pino = require('pino');
const request = require('supertest');
const createApp = require('../app');
const fixtures = require('../util/import-mongo/gifts.json').docs;
const { createIsolatedMongo } = require('./helpers/isolated-mongo');

describe('existing API contracts against isolated MongoDB', function () {
    this.timeout(180000);
    let isolated;
    let db;
    let app;
    const { prepareDatabaseIndexes } = require('../services/database-indexes');

    before(async function () {
        isolated = await createIsolatedMongo();
        db = isolated.db;
        await prepareDatabaseIndexes(db);
        app = createApp({
            connectToDatabase: async () => db,
            logger: pino({ level: 'silent' })
        });
    });

    after(async function () {
        if (isolated) await isolated.close();
    });

    it('does not automatically seed an empty database', async function () {
        assert.equal(await db.collection('gifts').countDocuments(), 0);
        const response = await request(app).get('/api/gifts').expect(200);
        assert.deepEqual(response.body, []);
        assert.equal(await db.collection('users').countDocuments(), 0);
    });

    describe('with the unchanged bundled demo fixtures', function () {
        beforeEach(async function () {
            // These writes can target only this suite's verified disposable server.
            await db.collection('gifts').deleteMany({});
            await db.collection('users').deleteMany({});
            await db.collection('gifts').insertMany(fixtures.map(gift => Object.assign({}, gift)));
        });

        function ids(gifts) {
            return gifts.map(gift => gift.id).sort();
        }

        it('preserves the root response', async function () {
            const response = await request(app).get('/').expect(200);
            assert.equal(response.text, 'Inside the server');
        });

        it('lists all 16 gifts with their existing fields', async function () {
            const response = await request(app).get('/api/gifts').expect(200);
            assert.equal(response.body.length, 16);
            assert.deepEqual(ids(response.body), ids(fixtures));
            for (const gift of response.body) {
                assert.match(gift._id, /^[a-f0-9]{24}$/);
                const existingFields = Object.assign({}, gift);
                delete existingFields._id;
                assert.deepEqual(existingFields, fixtures.find(fixture => fixture.id === gift.id));
            }
        });

        it('looks up a gift using its existing string id', async function () {
            const response = await request(app).get('/api/gifts/875').expect(200);
            assert.equal(response.body.id, '875');
            assert.equal(response.body.name, 'Lamp');
            assert.equal(response.body.image, '/images/lamp.jpeg');
        });

        it('returns the existing missing-gift response', async function () {
            const response = await request(app).get('/api/gifts/not-a-gift').expect(404);
            assert.equal(response.text, 'Gift not found');
        });

        it('returns all gifts when search filters are absent', async function () {
            const response = await request(app).get('/api/search').expect(200);
            assert.deepEqual(ids(response.body), ids(fixtures));
        });

        it('searches names case-insensitively and trims surrounding spaces', async function () {
            const response = await request(app).get('/api/search').query({ name: ' lAmP ' }).expect(200);
            assert.deepEqual(ids(response.body), ['875']);
        });

        it('treats a blank name as no name filter', async function () {
            const response = await request(app).get('/api/search').query({ name: '   ' }).expect(200);
            assert.deepEqual(ids(response.body), ids(fixtures));
        });

        it('filters by category', async function () {
            const response = await request(app).get('/api/search').query({ category: 'Office' }).expect(200);
            assert.deepEqual(ids(response.body), ids(fixtures.filter(gift => gift.category === 'Office')));
        });

        it('filters by condition', async function () {
            const response = await request(app).get('/api/search').query({ condition: 'New' }).expect(200);
            assert.deepEqual(ids(response.body), ids(fixtures.filter(gift => gift.condition === 'New')));
        });

        it('filters by maximum age', async function () {
            const response = await request(app).get('/api/search').query({ age_years: '2' }).expect(200);
            assert.deepEqual(ids(response.body), ids(fixtures.filter(gift => gift.age_years <= 2)));
        });

        it('combines existing filters', async function () {
            const response = await request(app).get('/api/search').query({
                name: 'table', category: 'Kitchen', condition: 'New', age_years: '3'
            }).expect(200);
            assert.deepEqual(ids(response.body), ['424']);
        });

        it('returns an empty array when no gifts match', async function () {
            const response = await request(app).get('/api/search').query({ name: 'not-a-real-item' }).expect(200);
            assert.deepEqual(response.body, []);
        });

    });
});
