const assert = require('node:assert/strict');
const pino = require('pino');
const request = require('supertest');
const createApp = require('../app-factory');
const { failureCategory } = require('../middleware/diagnostics');

describe('operational diagnostics and bounded legacy queries', function () {
    it('generates server IDs, correlates safe error logs and never records client IDs, query text, cookies or bodies', async function () {
        const lines = [];
        const app = createApp({ connectToDatabase: async () => { throw new Error('private-database-password'); },
            logger: pino({ level: 'info' }, { write: line => lines.push(line) }) });
        const response = await request(app).get('/api/gifts?email=private-email')
            .set('X-Request-Id', 'private-caller-id').set('Cookie', 'session=private-cookie').expect(500);
        const id = response.headers['x-request-id']; assert.match(id, /^[a-f0-9-]{36}$/);
        const event = lines.map(line => JSON.parse(line)).find(line => line.event === 'request_failed');
        assert.equal(event.requestId, id); assert.ok(!lines.join('').includes('private-'));
        assert.ok(!JSON.stringify(response.body).includes('private-'));
    });
    it('classifies known phases and permission/auth failures without parsing private error text', function () {
        assert.equal(failureCategory('configuration', {}), 'configuration_invalid');
        assert.equal(failureCategory('target_validation', {}), 'target_configuration_invalid');
        assert.equal(failureCategory('index_verification', {}), 'required_indexes_unavailable');
        assert.equal(failureCategory('topology_verification', {}), 'transaction_topology_unavailable');
        assert.equal(failureCategory('app_construction', {}), 'application_initialization_failed');
        assert.equal(failureCategory('database_connect', { code: 18 }), 'database_authentication');
        assert.equal(failureCategory('index_verification', { code: 13 }), 'database_permissions');
    });
    it('applies a server query deadline and returns safe busy errors for deadline exhaustion', async function () {
        let options;
        const app = createApp({ logger: pino({ level: 'silent' }), connectToDatabase: async () => ({ collection: () => ({
            find: (query, values) => { options = values; return { toArray: async () => { throw Object.assign(new Error('private-query'), { code: 50 }); } }; }
        }) }) });
        const response = await request(app).get('/api/search?name=lamp').expect(503);
        assert.equal(options.maxTimeMS, 5000); assert.equal(response.body.error.code, 'SEARCH_BUSY');
        assert.ok(!JSON.stringify(response.body).includes('private-query'));
    });
});
