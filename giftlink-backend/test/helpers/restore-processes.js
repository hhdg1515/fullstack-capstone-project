/* jshint loopfunc: true */
// Test-only process registry: no public endpoint or hosted execution path.
const { fork } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const path = require('node:path');
const { writePrivateJson } = require('../../util/local-maintenance-receipt');
function createProcessRegistry(directory) {
    const workers = [];
    async function launch(script, input) {
        if (!['distributed-photo-worker.js', 'photo-restore-worker.js'].includes(script)) throw Error('Local process type');
        const file = path.join(directory, randomUUID() + '.json'); writePrivateJson(file, input);
        const child = fork(path.join(__dirname, script), [file], { stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
        const inbox = [], worker = { child, puts: 0, deletes: 0 };
        child.stdout.on('data', () => {}); child.stderr.on('data', () => {});
        child.on('message', m => { inbox.push(m); if (m.event === 'storage') { worker.puts += Number(m.method === 'PUT'); worker.deletes += Number(m.method === 'DELETE'); } });
        worker.take = async (event, id) => {
            const until = Date.now() + 20000;
            while (Date.now() < until) {
                const at = inbox.findIndex(m => m.event === event && (!id || m.id === id));
                if (at >= 0) return inbox.splice(at, 1)[0];
                if (inbox.some(m => m.event === 'refused') || child.exitCode !== null || child.signalCode !== null) throw Error('Local restore process refused/stopped');
                await new Promise(resolve => setTimeout(resolve, 20));
            }
            throw Error('Local restore process deadline');
        };
        worker.arm = async stage => { child.send({ type: 'arm', stage }); await worker.take('armed'); };
        worker.release = () => child.send({ type: 'release' });
        worker.rpc = async (type, manifest) => { const id = randomUUID(); child.send({ type, id, manifest }); const v = await worker.take('result', id); if (v.error) throw Error('Local recovery refused'); return v.result; };
        worker.kill = async () => { if (child.exitCode !== null || child.signalCode !== null) return; const done = new Promise(resolve => child.once('exit', resolve)); child.kill('SIGKILL'); await done; };
        worker.stop = async () => {
            if (child.exitCode !== null || child.signalCode !== null) return;
            const done = new Promise(resolve => child.once('exit', resolve)); if (child.connected) child.send({ type: 'close' });
            const timer = setTimeout(() => child.kill('SIGKILL'), 2000); await done; clearTimeout(timer);
        };
        workers.push(worker); const ready = await worker.take('ready'); worker.pid = ready.pid; worker.url = ready.port ? 'http://127.0.0.1:' + ready.port : null;
        return worker;
    }
    const stopped = () => workers.every(w => w.child.exitCode !== null || w.child.signalCode !== null);
    return { launch, stopped, stop: async () => { for (const w of workers) await w.stop(); } };
}
module.exports = { createProcessRegistry };
