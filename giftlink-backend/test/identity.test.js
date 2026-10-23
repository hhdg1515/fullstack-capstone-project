const assert = require('node:assert/strict');
const request = require('supertest');
const bcrypt = require('bcryptjs');
const pino = require('pino');
const createApp = require('../app');
const { createIsolatedMongo } = require('./helpers/isolated-mongo');
const { prepareIdentityIndexes, assertIdentityIndexes, tokenHash, publicUser } = require('../services/identity');
const { createLogger } = require('../logger');

const origin = 'http://localhost:3000';
const details = { email: 'giver@example.test', firstName: 'Gift', lastName: 'Giver', password: 'test-only-password' };
const write = operation => operation.set('Origin', origin).set('X-CSRF-Protection', '1');
const cookie = response => response.headers['set-cookie'][0].split(';')[0];
const rawToken = response => cookie(response).split('=')[1];

// Every database write here is after the helper checks the Docker label, mounts,
// random database name, loopback port, and actual MongoDB server process identity.
describe('identity and access against verified isolated MongoDB', function () {
    this.timeout(180000);
    let isolated;
    let db;
    let app;
    before(async function () {
        isolated = await createIsolatedMongo(); db = isolated.db;
        await prepareIdentityIndexes(db);
    });
    after(async function () { if (isolated) await isolated.close(); });
    beforeEach(async function () {
        await db.collection('users').deleteMany({});
        await db.collection('sessions').deleteMany({});
        await db.collection('gifts').deleteMany({});
        app = createApp({ connectToDatabase: async () => db, logger: pino({ level: 'silent' }) });
    });
    const register = overrides => write(request(app).post('/api/auth/register')).send(Object.assign({}, details, overrides));
    const me = sessionCookie => request(app).get('/api/me').set('Cookie', sessionCookie);
    const patch = (sessionCookie, body) => write(request(app).patch('/api/me')).set('Cookie', sessionCookie).send(body);

    it('normalizes registration, hashes passwords, and sets HttpOnly bounded cookies without JSON tokens', async function () {
        const response = await register({ email: ' GIVER@EXAMPLE.TEST ' }).expect(201);
        assert.deepEqual(Object.keys(response.body), ['user']);
        assert.deepEqual(Object.keys(response.body.user).sort(), ['email', 'firstName', 'id', 'lastName']);
        assert.equal(response.body.user.email, details.email);
        assert.match(response.headers['set-cookie'][0], /HttpOnly/);
        assert.match(response.headers['set-cookie'][0], /SameSite=Lax/);
        assert.match(response.headers['set-cookie'][0], /Max-Age=28800/);
        assert.equal(response.headers['cache-control'], 'no-store');
        const user = await db.collection('users').findOne({ email: details.email });
        assert.ok(await bcrypt.compare(details.password, user.password));
        const session = await db.collection('sessions').findOne({ _id: tokenHash(rawToken(response)) });
        assert.ok(session.expiresAt > new Date());
        assert.ok(!JSON.stringify(session).includes(rawToken(response)));
        assert.ok(!JSON.stringify(response.body).includes(user.password));
    });
    it('uses Secure host-only cookies in production', async function () {
        app = createApp({ connectToDatabase: async () => db, secureCookies: true, appOrigin: 'https://app.example.test', logger: pino({ level: 'silent' }) });
        const response = await request(app).post('/api/auth/register').set('Origin', 'https://app.example.test')
            .set('X-CSRF-Protection', '1').send(details).expect(201);
        assert.match(response.headers['set-cookie'][0], /^__Host-giftlink_session=/);
        assert.match(response.headers['set-cookie'][0], /; Secure/);
        assert.match(response.headers['set-cookie'][0], /Path=\//);
        assert.ok(!response.headers['set-cookie'][0].includes('Domain='));
    });
    it('handles concurrent duplicate normalized registration using the unique index', async function () {
        const responses = await Promise.all([register(), register({ email: 'GIVER@EXAMPLE.TEST' })]);
        assert.deepEqual(responses.map(response => response.status).sort(), [201, 409]);
        assert.equal(await db.collection('users').countDocuments(), 1);
        assert.equal(await db.collection('sessions').countDocuments(), 1);
        assert.equal(responses.find(response => response.status === 409).body.error.code, 'EMAIL_TAKEN');
    });
    it('accepts an existing bcrypt account and returns a fresh session on login', async function () {
        await db.collection('users').insertOne(Object.assign({}, details, { password: await bcrypt.hash(details.password, 10) }));
        const response = await write(request(app).post('/api/auth/login')).send({ email: ' GIVER@EXAMPLE.TEST ', password: details.password }).expect(200);
        const profile = await me(cookie(response)).expect(200);
        assert.equal(profile.body.user.email, details.email);
        assert.equal(profile.body.user.firstName, details.firstName);
    });
    it('returns identical safe errors for unknown account and wrong password', async function () {
        await register();
        const missing = await write(request(app).post('/api/auth/login')).send({ email: 'missing@example.test', password: details.password }).expect(401);
        const wrong = await write(request(app).post('/api/auth/login')).send({ email: details.email, password: 'wrong-password' }).expect(401);
        assert.deepEqual(missing.body, wrong.body);
        assert.equal(missing.body.error.code, 'INVALID_CREDENTIALS');
    });
    it('preserves legacy bcrypt login for an overlong password while rejecting it for new accounts', async function () {
        const password = 'legacy-password-'.repeat(7);
        await db.collection('users').insertOne(Object.assign({}, details, { password: await bcrypt.hash(password, 10) }));
        await write(request(app).post('/api/auth/login')).send({ email: details.email, password }).expect(200);
        await register({ email: 'new@example.test', password }).expect(400);
        await write(request(app).post('/api/auth/login')).send({ email: details.email, password: 'a'.repeat(1025) }).expect(400);
    });
    it('rotates the current browser session at login', async function () {
        const first = await register().expect(201);
        const login = await write(request(app).post('/api/auth/login')).set('Cookie', cookie(first))
            .send({ email: details.email, password: details.password }).expect(200);
        assert.notEqual(cookie(first), cookie(login));
        await me(cookie(first)).expect(401);
        await me(cookie(login)).expect(200);
    });
    it('logout revokes a copied session and is idempotent', async function () {
        const registered = await register().expect(201);
        const other = await register({ email: 'other@example.test' });
        const copied = cookie(registered);
        const response = await write(request(app).post('/api/auth/logout')).set('Cookie', copied).send({}).expect(204);
        assert.match(response.headers['set-cookie'][0], /Expires=Thu, 01 Jan 1970/);
        await me(copied).expect(401);
        assert.equal(await db.collection('sessions').countDocuments(), 1);
        await me(cookie(other)).expect(200);
        await write(request(app).post('/api/auth/logout')).send({}).expect(204);
    });
    it('rejects expired sessions immediately without waiting for TTL cleanup', async function () {
        const registered = await register().expect(201);
        await db.collection('sessions').updateOne({ _id: tokenHash(rawToken(registered)) }, { $set: { expiresAt: new Date(0) } });
        const response = await me(cookie(registered)).expect(401);
        assert.equal(response.body.error.code, 'SESSION_EXPIRED');
        await patch(cookie(registered), { firstName: 'Blocked' }).expect(401);
        assert.equal((await db.collection('users').findOne({ email: details.email })).firstName, 'Gift');
    });
    it('rejects missing, malformed, forged and old bearer tokens', async function () {
        await request(app).get('/api/me').expect(401);
        await me('giftlink_session=not-a-token').expect(401);
        await me('giftlink_session=' + 'a'.repeat(64)).expect(401);
        await request(app).get('/api/me').set('Authorization', 'Bearer legacy-jwt').expect(401);
    });
    it('rejects sessions whose user no longer exists', async function () {
        const registered = await register();
        await db.collection('users').deleteMany({});
        await me(cookie(registered)).expect(401);
    });
    it('updates only the authenticated identity without accepting caller ownership fields', async function () {
        const first = await register();
        const second = await register({ email: 'receiver@example.test', firstName: 'Receiver' });
        await patch(cookie(first), { firstName: ' Updated ', lastName: ' Name ' }).expect(200);
        assert.equal((await me(cookie(first))).body.user.firstName, 'Updated');
        assert.equal((await me(cookie(second))).body.user.firstName, 'Receiver');
        for (const field of ['id', '_id', 'email', 'password', 'role', 'pickupLocation']) {
            await patch(cookie(first), { [field]: second.body.user.id }).expect(400);
        }
        const legacy = await write(request(app).put('/api/auth/update')).set('Cookie', cookie(first))
            .set('email', 'receiver@example.test').send({ name: 'Unauthorized' }).expect(403);
        assert.equal(legacy.body.error.code, 'FORBIDDEN');
        assert.equal((await me(cookie(second))).body.user.firstName, 'Receiver');
    });
    it('keeps the deprecated update URL authenticated and identity-scoped', async function () {
        const registered = await register();
        const response = await write(request(app).put('/api/auth/update')).set('Cookie', cookie(registered)).send({ name: 'Renamed' }).expect(200);
        assert.equal(response.body.user.firstName, 'Renamed');
        assert.equal(response.body.authtoken, undefined);
    });
    it('validates names, scalar types, extra fields, email and bcrypt byte bounds without echoing secrets', async function () {
        const bad = [{ password: 'short' }, { password: 'é'.repeat(6) }, { password: 'é'.repeat(37) }, { email: { $ne: null } },
            { firstName: '' }, { lastName: 'a'.repeat(81) }, { role: 'admin' }];
        for (const overrides of bad) {
            const response = await register(overrides).expect(400);
            assert.equal(response.body.error.code, 'VALIDATION_FAILED');
            assert.ok(!JSON.stringify(response.body).includes(details.password));
        }
        assert.equal(await db.collection('users').countDocuments(), 0);
        const registered = await register();
        await patch(cookie(registered), {}).expect(400);
        await patch(cookie(registered), { firstName: '   ' }).expect(400);
        await write(request(app).post('/api/auth/login')).send({}).expect(400);
    });
    it('requires exact Origin, custom CSRF header and JSON for every write including login/logout', async function () {
        for (const path of ['/api/auth/register', '/api/auth/login', '/api/auth/logout', '/api/gifts']) {
            await request(app).post(path).send(details).expect(403);
            await request(app).post(path).set('Origin', 'https://evil.example.test').set('X-CSRF-Protection', '1').send(details).expect(403);
            await request(app).post(path).set('Origin', origin).send(details).expect(403);
            await request(app).post(path).set('Origin', 'null').set('X-CSRF-Protection', '1').send(details).expect(403);
        }
        await write(request(app).post('/api/auth/login')).type('form').send(details).expect(415);
        await request(app).get('/api/gifts').expect(200);
        const response = await request(app).options('/api/me').set('Origin', 'https://evil.example.test')
            .set('Access-Control-Request-Method', 'PATCH').expect(204);
        assert.notEqual(response.headers['access-control-allow-origin'], 'https://evil.example.test');
    });
    it('rejects cross-origin authenticated profile updates and logout without changing the session', async function () {
        const registered = await register();
        await request(app).patch('/api/me').set('Cookie', cookie(registered)).set('Origin', 'https://evil.example.test')
            .set('X-CSRF-Protection', '1').send({ firstName: 'Forged' }).expect(403);
        await request(app).post('/api/auth/logout').set('Cookie', cookie(registered)).set('Origin', 'https://evil.example.test')
            .set('X-CSRF-Protection', '1').send({}).expect(403);
        const response = await me(cookie(registered)).expect(200);
        assert.equal(response.body.user.firstName, details.firstName);
    });
    it('enforces write authentication and derives gift ownership on the server', async function () {
        await write(request(app).post('/api/gifts')).send({ id: 'mine', name: 'Chair' }).expect(401);
        const registered = await register();
        await write(request(app).post('/api/gifts')).set('Cookie', cookie(registered))
            .send({ id: 'mine', name: 'Chair', posted_by: 'forged-owner' }).expect(400);
        const created = await write(request(app).post('/api/gifts')).set('Cookie', cookie(registered))
            .send({ id: 'mine', name: 'Chair' }).expect(201);
        assert.equal(created.body.acknowledged, true);
        assert.equal((await db.collection('gifts').findOne({ id: 'mine' })).posted_by, registered.body.user.id);
    });
    it('excludes password hashes, emails, sessions and future pickup fields from all public gift APIs', async function () {
        await db.collection('gifts').insertOne({ id: 'private-fields', name: 'Chair', email: 'private@example.test',
            password: 'private-hash', token: 'private-token', pickupLocation: 'private-address', privatePickupDetails: { address: 'secret' } });
        for (const path of ['/api/gifts', '/api/gifts/private-fields', '/api/search?name=Chair']) {
            const response = await request(app).get(path).expect(200);
            for (const secret of ['private@example.test', 'private-hash', 'private-token', 'private-address', 'privatePickupDetails']) {
                assert.ok(!JSON.stringify(response.body).includes(secret));
            }
        }
        const registered = await register();
        const stored = await db.collection('users').findOne({ email: details.email });
        assert.deepEqual(publicUser(stored), { id: stored._id.toString(), firstName: 'Gift' });
        assert.ok(!JSON.stringify((await me(cookie(registered))).body).includes(stored.password));
    });
    it('does not log sensitive headers, request/response bodies, queries or database errors', async function () {
        const chunks = [];
        app = createApp({ connectToDatabase: async () => db, logger: createLogger({ write: text => chunks.push(text) }) });
        const registered = await register();
        await register().expect(409);
        await me(cookie(registered)).expect(200);
        await request(app).get('/api/gifts?email=private-query@example.test').set('Authorization', 'Bearer private-token').expect(200);
        await write(request(app).patch('/api/me')).set('Cookie', cookie(registered)).send({ password: 'private-submitted-password' }).expect(400);
        app = createApp({ connectToDatabase: async () => { throw new Error('private-database-error@example.test'); },
            logger: createLogger({ write: text => chunks.push(text) }) });
        const failure = await request(app).get('/api/gifts').expect(500);
        assert.equal(failure.body.error.message, 'Internal server error');
        const logs = chunks.join('');
        for (const secret of [details.email, details.password, rawToken(registered), 'private-token', 'private-submitted-password', 'private-query@example.test', 'private-database-error@example.test']) {
            assert.ok(!logs.includes(secret));
        }
    });
    it('throttles repeated authentication attempts', async function () {
        app = createApp({ connectToDatabase: async () => db, authLimit: 2, logger: pino({ level: 'silent' }) });
        await write(request(app).post('/api/auth/login')).send({ email: details.email, password: details.password }).expect(401);
        await write(request(app).post('/api/auth/login')).send({ email: details.email, password: details.password }).expect(401);
        const response = await write(request(app).post('/api/auth/login')).send({ email: details.email, password: details.password }).expect(429);
        assert.equal(response.body.error.code, 'RATE_LIMITED');
    });
    it('checks and prepares indexes repeatably only on the verified test target', async function () {
        await assertIdentityIndexes(db);
        await prepareIdentityIndexes(db);
        await assertIdentityIndexes(db);
    });
    it('refuses non-normalized legacy emails without modifying accounts', async function () {
        await db.collection('users').insertOne({ email: 'UPPER@EXAMPLE.TEST' });
        await assert.rejects(prepareIdentityIndexes(db), /reviewed normalization migration/);
        assert.equal((await db.collection('users').findOne({})).email, 'UPPER@EXAMPLE.TEST');
    });
    it('refuses existing duplicate emails instead of deleting or merging accounts', async function () {
        await db.collection('users').dropIndex('users_email_unique');
        await db.collection('users').insertMany([{ email: details.email, firstName: 'One' }, { email: details.email, firstName: 'Two' }]);
        const before = await db.collection('users').find({}).toArray();
        try {
            await assert.rejects(prepareIdentityIndexes(db), /Index preparation blocked/);
            assert.deepEqual(await db.collection('users').find({}).toArray(), before);
        } finally {
            await db.collection('users').deleteMany({});
            await prepareIdentityIndexes(db);
        }
    });
});
