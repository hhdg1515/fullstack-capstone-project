const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
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
    const jwtSecret = randomUUID();

    before(async function () {
        isolated = await createIsolatedMongo();
        db = isolated.db;
        app = createApp({
            connectToDatabase: async () => db,
            jwtSecret,
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

        async function register(overrides) {
            return request(app).post('/api/auth/register').send(Object.assign({
                email: 'giver@example.test', password: 'test-only-password',
                firstName: 'Gift', lastName: 'Giver'
            }, overrides));
        }

        async function update(token, email, name) {
            const operation = request(app).put('/api/auth/update');
            if (token !== undefined) operation.set('Authorization', 'Bearer ' + token);
            if (email !== undefined) operation.set('email', email);
            return operation.send({ name: name === undefined ? 'Updated' : name });
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

        it('preserves gift creation and its acknowledgment response', async function () {
            const gift = { id: 'integration-only-gift', name: 'Test Chair', condition: 'New' };
            const response = await request(app).post('/api/gifts').send(gift).expect(201);
            assert.equal(response.body.acknowledged, true);
            assert.match(response.body.insertedId, /^[a-f0-9]{24}$/);
            const detail = await request(app).get('/api/gifts/' + gift.id).expect(200);
            assert.equal(detail.body.name, gift.name);
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

        it('registers a normalized email and stores a bcrypt hash', async function () {
            const response = await register({ email: 'GIVER@EXAMPLE.TEST' });
            assert.equal(response.status, 200);
            assert.equal(response.body.email, 'giver@example.test');
            assert.deepEqual(Object.keys(response.body).sort(), ['authtoken', 'email']);
            const user = await db.collection('users').findOne({ email: 'giver@example.test' });
            assert.equal(user.firstName, 'Gift');
            assert.equal(user.lastName, 'Giver');
            assert.notEqual(user.password, 'test-only-password');
            assert.equal(await bcrypt.compare('test-only-password', user.password), true);
            assert.equal(jwt.verify(response.body.authtoken, jwtSecret).user.id, user._id.toString());
        });

        it('rejects invalid registration without creating a user', async function () {
            const response = await register({ email: 'invalid', password: '', firstName: '', lastName: '' });
            assert.equal(response.status, 400);
            assert.ok(Array.isArray(response.body.errors));
            assert.equal(await db.collection('users').countDocuments(), 0);
        });

        it('rejects duplicate email with the existing response', async function () {
            assert.equal((await register()).status, 200);
            const response = await register({ email: 'GIVER@EXAMPLE.TEST' });
            assert.equal(response.status, 409);
            assert.deepEqual(response.body, { message: 'Email already registered' });
            assert.equal(await db.collection('users').countDocuments(), 1);
        });

        it('logs in with a normalized email and existing response fields', async function () {
            await register();
            const response = await request(app).post('/api/auth/login').send({
                email: ' GIVER@EXAMPLE.TEST ', password: 'test-only-password'
            }).expect(200);
            assert.deepEqual(Object.keys(response.body).sort(), ['authtoken', 'userEmail', 'userName']);
            assert.equal(response.body.userName, 'Gift');
            assert.equal(response.body.userEmail, 'giver@example.test');
            const user = await db.collection('users').findOne({ email: 'giver@example.test' });
            assert.equal(jwt.verify(response.body.authtoken, jwtSecret).user.id, user._id.toString());
        });

        it('rejects missing login credentials', async function () {
            const response = await request(app).post('/api/auth/login').send({}).expect(400);
            assert.deepEqual(response.body, { error: 'Email and password are required' });
        });

        it('returns the existing unknown-user login response', async function () {
            const response = await request(app).post('/api/auth/login').send({
                email: 'unknown@example.test', password: 'test-only-password'
            }).expect(404);
            assert.deepEqual(response.body, { error: 'User not found' });
        });

        it('returns the existing wrong-password response', async function () {
            await register();
            const response = await request(app).post('/api/auth/login').send({
                email: 'giver@example.test', password: 'wrong-password'
            }).expect(404);
            assert.deepEqual(response.body, { error: 'Wrong password' });
        });

        it('updates only the authenticated user and returns a signed token', async function () {
            const registered = await register();
            const response = await update(registered.body.authtoken, 'GIVER@EXAMPLE.TEST', '  Updated Giver  ');
            assert.equal(response.status, 200);
            assert.deepEqual(Object.keys(response.body), ['authtoken']);
            const user = await db.collection('users').findOne({ email: 'giver@example.test' });
            assert.equal(user.firstName, 'Updated Giver');
            assert.ok(user.updatedAt instanceof Date);
            assert.equal(jwt.verify(response.body.authtoken, jwtSecret).user.id, user._id.toString());
        });

        it('rejects an update without authentication and leaves the user unchanged', async function () {
            await register();
            const response = await update(undefined, 'giver@example.test');
            assert.equal(response.status, 401);
            assert.deepEqual(response.body, { error: 'Authentication required' });
            assert.equal((await db.collection('users').findOne({ email: 'giver@example.test' })).firstName, 'Gift');
        });

        it('rejects an invalid token', async function () {
            await register();
            const response = await update('invalid-token', 'giver@example.test');
            assert.equal(response.status, 401);
            assert.deepEqual(response.body, { error: 'Invalid or expired token' });
        });

        it('rejects an expired token', async function () {
            await register();
            const user = await db.collection('users').findOne({ email: 'giver@example.test' });
            const token = jwt.sign({ user: { id: user._id.toString() } }, jwtSecret, { expiresIn: -1 });
            const response = await update(token, user.email);
            assert.equal(response.status, 401);
            assert.deepEqual(response.body, { error: 'Invalid or expired token' });
        });

        it('rejects modifying another account and changes neither account', async function () {
            const giver = await register();
            await register({ email: 'receiver@example.test', firstName: 'Receiver' });
            const response = await update(giver.body.authtoken, 'receiver@example.test', 'Unauthorized');
            assert.equal(response.status, 403);
            assert.deepEqual(response.body, { error: 'Not authorized to update this user' });
            assert.equal((await db.collection('users').findOne({ email: 'giver@example.test' })).firstName, 'Gift');
            assert.equal((await db.collection('users').findOne({ email: 'receiver@example.test' })).firstName, 'Receiver');
        });

        it('rejects an update without the existing required email header', async function () {
            const registered = await register();
            const response = await update(registered.body.authtoken);
            assert.equal(response.status, 400);
            assert.deepEqual(response.body, { error: 'Email not found in the request headers' });
        });

        it('validates the profile name before updating', async function () {
            const registered = await register();
            const response = await update(registered.body.authtoken, 'giver@example.test', '   ');
            assert.equal(response.status, 400);
            assert.ok(Array.isArray(response.body.errors));
            assert.equal((await db.collection('users').findOne({ email: 'giver@example.test' })).firstName, 'Gift');
        });
    });
});
