const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const { createProcessRegistry } = require('./helpers/restore-processes');
describe('real restore subprocess completion and IPC shutdown races', function () {
    this.timeout(20000); let directory, registry;
    beforeEach(function () { directory = fs.mkdtempSync(path.join(os.tmpdir(), 'moveout-ipc-')); registry = createProcessRegistry(directory); });
    afterEach(async function () { await registry.stop(); fs.rmSync(directory, { recursive: true }); });
    it('joins one-shot executors after their completion without sending redundant teardown messages', async function () {
        for (let i = 0; i < 5; i++) {
            const worker = await registry.launch('photo-restore-worker.js', { mode: 'ipc-completion-probe' });
            await worker.send({ type: 'finish' }); await worker.take('completed'); await worker.finish(); assert.equal(worker.child.exitCode, 0);
        }
        assert.equal(registry.stopped(), true);
    });
    it('reports a real closed channel as a rejected send and still safely joins the exiting process', async function () {
        const worker = await registry.launch('photo-restore-worker.js', { mode: 'ipc-completion-probe' });
        const disconnected = new Promise(resolve => worker.child.once('disconnect', resolve));
        await worker.send({ type: 'finish' }); await worker.take('completed'); await disconnected;
        await assert.rejects(worker.send({ type: 'close' }), /Local IPC closed/); await worker.stop(); assert.equal(worker.child.exitCode, 0);
    });
    it('does not hide a nonzero executor exit behind a received completion event', async function () {
        const worker = await registry.launch('photo-restore-worker.js', { mode: 'ipc-completion-probe', fail: true });
        await worker.send({ type: 'finish' }); await worker.take('completed'); await assert.rejects(worker.finish(), /failed to exit cleanly/);
        assert.equal(worker.child.exitCode, 1);
    });
});
