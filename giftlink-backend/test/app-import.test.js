const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const path = require('node:path');

describe('application construction', function () {
    it('imports and constructs without connecting, listening, or seeding', function () {
        const script = `
            const assert = require('node:assert/strict');
            const express = require('express');
            const { MongoClient } = require('mongodb');
            const pino = require('pino');
            let connections = 0;
            let listeners = 0;
            MongoClient.prototype.connect = function () {
                connections += 1;
                throw new Error('Application import attempted a MongoDB connection');
            };
            express.application.listen = function () {
                listeners += 1;
                throw new Error('Application import attempted to listen');
            };
            const createApp = require('./app');
            assert.equal(typeof createApp, 'function');
            const app = createApp({
                connectToDatabase: async function () {
                    connections += 1;
                    throw new Error('Application construction attempted database access');
                },
                logger: pino({ level: 'silent' })
            });
            assert.equal(typeof app, 'function');
            assert.equal(connections, 0);
            assert.equal(listeners, 0);
            console.log('application import has no database or listener side effects');
        `;
        const output = execFileSync(process.execPath, ['-e', script], {
            cwd: path.resolve(__dirname, '..'),
            timeout: 5000,
            encoding: 'utf8'
        });
        assert.match(output, /no database or listener side effects/);
    });
});
