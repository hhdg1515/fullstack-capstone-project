const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const path = require('node:path');
const express = require('express');
const { MongoClient } = require('mongodb');
const pino = require('pino');
const sinon = require('sinon');
const request = require('supertest');
const { startServer } = require('../server');
const { createDatabase } = require('../models/db');
const { readServerConfig } = require('../config');

describe('server bootstrap and configuration', function () {
    const logger = pino({ level: 'silent' });
    const indexedDb = { command: async () => ({ ok: 1, setName: 'isolated-test' }), collection: name => ({ indexes: async () => name === 'users' ?
        [{ key: { email: 1 }, unique: true }] : name === 'sessions' ? [{ key: { expiresAt: 1 }, expireAfterSeconds: 0 }] :
        name === 'pickupRequests' ? [{ key: { giverId: 1, _id: -1 } }, { key: { receiverId: 1, _id: -1 } }, { key: { itemId: 1 }, unique: true, partialFilterExpression: { status: 'accepted' } }, { key: { itemId: 1, receiverId: 1 }, unique: true, partialFilterExpression: { active: true } }] :
        name === 'moveOutPlans' ? [{ key: { ownerId: 1, moveOutDeadline: 1, _id: 1 } }] :
        name === 'pickupMessages' ? [{ key: { requestId: 1, createdAt: -1, _id: -1 } }] :
        [{ key: { planId: 1, ownerId: 1, createdAt: 1, _id: 1 } }, { key: { status: 1, publishedAt: -1, _id: -1 } }, { key: { status: 1, availableFrom: 1, publishedAt: -1, _id: -1 } }] }) };

    afterEach(function () {
        sinon.restore();
    });

    it('waits for the database before listening and supports repeatable shutdown', async function () {
        let connected;
        const database = {
            connect: sinon.stub().returns(new Promise(resolve => { connected = resolve; })),
            close: sinon.stub().resolves()
        };
        const listen = sinon.spy(express.application, 'listen');
        const starting = startServer({ port: 0, host: '127.0.0.1' }, { database, logger });
        let runtime;
        try {
            await new Promise(resolve => setImmediate(resolve));
            assert.equal(database.connect.callCount, 1);
            assert.equal(listen.callCount, 0);
            connected(indexedDb);
            runtime = await starting;
            assert.equal(listen.callCount, 1);
            await request(runtime.server).get('/').expect(200, 'Inside the server');
            await Promise.all([runtime.stop(), runtime.stop()]);
            assert.equal(database.close.callCount, 1);
            assert.equal(runtime.server.listening, false);
        } finally {
            if (runtime) await runtime.stop();
        }
    });

    it('does not listen when database connection fails and closes the client', async function () {
        const failure = new Error('isolated connection failure');
        const database = { connect: sinon.stub().rejects(failure), close: sinon.stub().resolves() };
        const listen = sinon.spy(express.application, 'listen');
        await assert.rejects(startServer({ port: 0 }, { database, logger }), error => error === failure);
        assert.equal(listen.callCount, 0);
        assert.equal(database.close.callCount, 1);
    });
    it('refuses missing database indexes without creating indexes or listening', async function () {
        const indexes = sinon.stub().resolves([]);
        const database = { connect: sinon.stub().resolves({ collection: () => ({ indexes }) }), close: sinon.stub().resolves() };
        const listen = sinon.spy(express.application, 'listen');
        await assert.rejects(startServer({ port: 0 }, { database, logger }), /Database indexes are required/);
        assert.equal(listen.callCount, 0);
        assert.equal(database.close.callCount, 1);
    });

    it('requires the new plan index even when identity indexes already exist', async function () {
        const database = { connect: async () => ({ collection: name => ({ indexes: async () =>
            name === 'pickupRequests' ? [{ key: { giverId: 1, _id: -1 } }, { key: { receiverId: 1, _id: -1 } }, { key: { itemId: 1 }, unique: true, partialFilterExpression: { status: 'accepted' } }, { key: { itemId: 1, receiverId: 1 }, unique: true, partialFilterExpression: { active: true } }] :
        name === 'moveOutPlans' ? [] : indexedDb.collection(name).indexes() }) }), close: sinon.stub().resolves() };
        const listen = sinon.spy(express.application, 'listen');
        await assert.rejects(startServer({ port: 0 }, { database, logger }), /Database indexes are required/);
        assert.equal(listen.callCount, 0);
        assert.equal(database.close.callCount, 1);
    });
    it('refuses a missing message index without creating it or starting HTTP', async function () {
        const database = { connect: async () => Object.assign({}, indexedDb, { collection: name => name === 'pickupMessages' ?
            { indexes: async () => [] } : indexedDb.collection(name) }), close: sinon.stub().resolves() };
        const listen = sinon.spy(express.application, 'listen');
        await assert.rejects(startServer({ port: 0 }, { database, logger }), /Database indexes are required/);
        assert.equal(listen.callCount, 0); assert.equal(database.close.callCount, 1);
    });
    it('refuses standalone MongoDB without initializing a replica set or listening', async function () {
        const database = { connect: async () => Object.assign({}, indexedDb, { command: async () => ({ ok: 1 }) }), close: sinon.stub().resolves() };
        const listen = sinon.spy(express.application, 'listen');
        await assert.rejects(startServer({ port: 0 }, { database, logger }), /replica set required/);
        assert.equal(listen.callCount, 0); assert.equal(database.close.callCount, 1);
    });

    it('closes the database when the HTTP port is already occupied', async function () {
        const occupying = express().listen(0, '127.0.0.1');
        await new Promise(resolve => occupying.once('listening', resolve));
        const database = { connect: sinon.stub().resolves(indexedDb), close: sinon.stub().resolves() };
        try {
            await assert.rejects(startServer({ port: occupying.address().port, host: '127.0.0.1' },
                { database, logger }), { code: 'EADDRINUSE' });
            assert.equal(database.close.callCount, 1);
        } finally {
            await new Promise(resolve => occupying.close(resolve));
        }
    });

    it('keeps existing defaults and permits explicit test ports/databases', function () {
        const env = { MONGO_URL: 'mongodb://127.0.0.1:1' };
        assert.deepEqual(readServerConfig(env), {
            mongoUrl: env.MONGO_URL, dbName: 'giftdb', appOrigin: 'http://localhost:3000', secureCookies: false, sessionTtlSeconds: 28800, port: 3060
        });
        const custom = readServerConfig(Object.assign({}, env, { PORT: '0', MONGO_DB_NAME: 'giftdb_test_custom' }));
        assert.equal(custom.port, 0);
        assert.equal(custom.dbName, 'giftdb_test_custom');
    });

    it('rejects missing settings, invalid database names, and invalid ports', function () {
        assert.throws(() => readServerConfig({}), /MONGO_URL/);
        assert.throws(() => readServerConfig({ MONGO_URL: 'mongodb://127.0.0.1:1', NODE_ENV: 'production' }), /APP_ORIGIN/);
        assert.throws(() => readServerConfig({ MONGO_URL: 'mongodb://127.0.0.1:1', SESSION_TTL_SECONDS: '0' }), /SESSION_TTL_SECONDS/);
        assert.throws(() => readServerConfig({ MONGO_URL: 'mongodb://127.0.0.1:1', APP_ORIGIN: 'https://site.test/path' }), /APP_ORIGIN/);
        const env = { MONGO_URL: 'mongodb://127.0.0.1:1' };
        for (const port of ['', '-1', '65536', 'abc', '3.5']) {
            assert.throws(() => readServerConfig(Object.assign({}, env, { PORT: port })), /PORT/);
        }
        assert.throws(() => readServerConfig(Object.assign({}, env, { MONGO_DB_NAME: 'db/name' })), /MONGO_DB_NAME/);
    });

    it('exits unsuccessfully for invalid CLI configuration', function () {
        assert.throws(() => execFileSync(process.execPath, ['server.js'], {
            cwd: path.resolve(__dirname, '..'), timeout: 5000,
            env: { NODE_ENV: 'test', MONGO_URL: 'mongodb://127.0.0.1:1', PORT: 'invalid' },
            stdio: 'pipe'
        }), error => error.status === 1 && /Server startup failed/.test(error.stderr.toString()));
    });
});

describe('native MongoDB connection lifecycle', function () {
    afterEach(function () { sinon.restore(); });

    it('shares an in-flight connection and exposes explicit cleanup', async function () {
        const db = {};
        const connect = sinon.stub(MongoClient.prototype, 'connect').resolves();
        const select = sinon.stub(MongoClient.prototype, 'db').returns(db);
        const close = sinon.stub(MongoClient.prototype, 'close').resolves();
        const database = createDatabase({ mongoUrl: 'mongodb://127.0.0.1:1', dbName: 'giftdb_test_unit' });
        const first = database.connect();
        assert.equal(first, database.connect());
        assert.equal(await first, db);
        assert.equal(connect.callCount, 1);
        assert.equal(select.firstCall.args[0], 'giftdb_test_unit');
        await database.close();
        assert.equal(close.callCount, 1);
    });

    it('does not cache a failed connection', async function () {
        const connect = sinon.stub(MongoClient.prototype, 'connect');
        connect.onFirstCall().rejects(new Error('first attempt failed'));
        connect.onSecondCall().resolves();
        sinon.stub(MongoClient.prototype, 'db').returns({});
        sinon.stub(MongoClient.prototype, 'close').resolves();
        const database = createDatabase({ mongoUrl: 'mongodb://127.0.0.1:1', dbName: 'giftdb_test_unit' });
        await assert.rejects(database.connect(), /first attempt failed/);
        await database.connect();
        assert.equal(connect.callCount, 2);
        await database.close();
    });
});
