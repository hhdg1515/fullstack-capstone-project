const { Readable } = require('node:stream');
const assert = require('node:assert/strict');
// Synthetic wire service for high-volume lifecycle stress, NOT real R2 evidence.
class ProtocolObjectStore {
    constructor() { this.objects = new Map(); this.puts = new Map(); this.clients = []; this.failPut = null; }
    client() {
        const client = { closed: false, puts: 0, destroy: () => { client.closed = true; if (this.failClose) { this.failClose = false; throw Error('Synthetic teardown failure'); } }, handle: async request => {
            assert.equal(client.closed, false);
            const key = request.path, object = this.objects.get(key);
            if (request.method === 'PUT') {
                assert.equal(request.headers['if-none-match'], '*'); client.puts++;
                this.puts.set(key, (this.puts.get(key) || 0) + 1);
                if (this.failPut === 'before') { this.failPut = null; throw Error('Synthetic uncertain PUT'); }
                if (object) return this.response(412, {}, '<Error><Code>PreconditionFailed</Code></Error>');
                this.objects.set(key, { body: Buffer.from(request.body), headers: { 'content-length': String(request.body.length),
                    'content-type': request.headers['content-type'], 'cache-control': request.headers['cache-control'], 'x-amz-meta-sha256': request.headers['x-amz-meta-sha256'] } });
                if (this.failPut === 'after') { this.failPut = null; throw Error('Synthetic committed PUT with lost response'); }
                return this.response(200);
            }
            if (request.method === 'DELETE') { this.objects.delete(key); return this.response(204); }
            if (!object) return this.response(404, { 'content-type': 'application/xml' }, '<Error><Code>NoSuchKey</Code></Error>');
            return this.response(200, object.headers, request.method === 'HEAD' ? '' : object.body);
        } }; this.clients.push(client); return client;
    }
    response(statusCode, headers = {}, body = '') { return { response: { statusCode, headers, body: Readable.from([Buffer.from(body)]) } }; }
}
module.exports = { ProtocolObjectStore };
