const { randomBytes, createHash } = require('crypto');
const { ObjectId } = require('mongodb');
const bcrypt = require('bcryptjs');

const tokenHash = token => createHash('sha256').update(token).digest('hex');
const normalizeEmail = email => email.trim().toLowerCase();
const privateUser = user => ({ id: user._id.toString(), firstName: user.firstName, lastName: user.lastName, email: user.email });
const publicUser = user => ({ id: user._id.toString(), firstName: user.firstName });
const validToken = token => typeof token === 'string' && /^[a-f0-9]{64}$/.test(token);

async function prepareIdentityIndexes(db) {
    // Do not rewrite legacy accounts or silently resolve duplicate identities.
    const users = db.collection('users');
    const cursor = users.find({}, { projection: { email: 1 } });
    while (await cursor.hasNext()) {
        const user = await cursor.next();
        if (typeof user.email !== 'string' || !user.email || user.email !== normalizeEmail(user.email)) {
            throw new Error('Existing emails need an explicitly reviewed normalization migration; no accounts were changed');
        }
    }
    await users.createIndex({ email: 1 }, { name: 'users_email_unique', unique: true });
    await db.collection('sessions').createIndex({ expiresAt: 1 }, { name: 'sessions_expiry', expireAfterSeconds: 0 });
}

async function assertIdentityIndexes(db) {
    try {
        const users = await db.collection('users').indexes();
        const sessions = await db.collection('sessions').indexes();
        if (!users.some(index => index.unique === true && Object.keys(index.key).length === 1 && index.key.email === 1 && !index.partialFilterExpression && !index.sparse && !index.collation) ||
            !sessions.some(index => Object.keys(index.key).length === 1 && index.key.expiresAt === 1 && index.expireAfterSeconds === 0 && !index.partialFilterExpression)) {
            throw new Error('Missing identity indexes');
        }
    } catch (error) {
        throw new Error('Identity indexes are required. Verify the local target and run npm run db:prepare; existing data was not changed');
    }
}

function createIdentityService({ connectToDatabase, sessionTtlSeconds = 28800 }) {
    // A missing account still incurs bcrypt verification work.
    let dummyHash;
    async function register(data) {
        const db = await connectToDatabase();
        const user = {
            email: normalizeEmail(data.email), firstName: data.firstName.trim(), lastName: data.lastName.trim(),
            password: await bcrypt.hash(data.password, 10), createdAt: new Date()
        };
        const result = await db.collection('users').insertOne(user);
        user._id = result.insertedId;
        return user;
    }
    async function login(email, password) {
        const db = await connectToDatabase();
        const user = await db.collection('users').findOne({ email: normalizeEmail(email) });
        if (!dummyHash) dummyHash = await bcrypt.hash(randomBytes(32).toString('hex'), 10);
        const matches = await bcrypt.compare(password, user && typeof user.password === 'string' ? user.password : dummyHash);
        return matches && user ? user : null;
    }
    async function revoke(token) {
        if (!validToken(token)) return;
        const db = await connectToDatabase();
        await db.collection('sessions').deleteOne({ _id: tokenHash(token) });
    }
    async function issue(userId, previousToken) {
        const db = await connectToDatabase();
        const token = randomBytes(32).toString('hex');
        await db.collection('sessions').insertOne({
            _id: tokenHash(token), userId, createdAt: new Date(), expiresAt: new Date(Date.now() + sessionTtlSeconds * 1000)
        });
        await revoke(previousToken);
        return token;
    }
    async function authenticate(token) {
        if (!validToken(token)) return null;
        const db = await connectToDatabase();
        const session = await db.collection('sessions').findOne({ _id: tokenHash(token), expiresAt: { $gt: new Date() } });
        if (!session || !(session.userId instanceof ObjectId)) return null;
        const user = await db.collection('users').findOne({ _id: session.userId }, { projection: { password: 0 } });
        return user ? { user, sessionId: session._id } : null;
    }
    async function update(userId, changes) {
        const db = await connectToDatabase();
        return db.collection('users').findOneAndUpdate({ _id: userId }, {
            $set: Object.assign({}, changes, { updatedAt: new Date() })
        }, { returnDocument: 'after', projection: { password: 0 } });
    }
    return { register, login, revoke, issue, authenticate, update };
}

module.exports = { createIdentityService, prepareIdentityIndexes, assertIdentityIndexes, privateUser, publicUser, tokenHash };
