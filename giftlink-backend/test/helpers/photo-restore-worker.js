// Synthetic receipt-owned restore executor / photo-disabled application process.
const { readPrivateJson } = require('../../util/local-maintenance-receipt');
const { openLocalMaintenance } = require('../../util/local-image-maintenance');
async function main() {
    const input = readPrivateJson(process.argv[2]);
    if (input.mode === 'ipc-completion-probe') {
        process.send({ event: 'ready', pid: process.pid });
        process.on('message', m => { if (m.type === 'finish') process.send({ event: 'completed' }, () => { process.disconnect(); setTimeout(() => process.exit(input.fail ? 1 : 0), 50); }); });
        return; // No DB/storage access in this process-lifecycle probe.
    }
    const context = await openLocalMaintenance(input.local);
    if (input.mode === 'restore') {
        process.send({ event: 'ready', pid: process.pid });
        process.on('message', async m => {
            if (m.type !== 'execute') return;
            try {
                const result = await require('./local-photo-restore').executeRestore(context, input, async () => {
                    if (input.crashAfterCommit) await new Promise(() => { process.send({ event: 'after_commit' }); });
                });
                process.send({ event: 'restored', result });
            } catch (error) { process.send({ event: 'refused' }); }
            finally { await context.close(); process.disconnect(); }
        }); return;
    }
    if (!['text-quarantine', 'anonymous-maintenance', 'locked-maintenance'].includes(input.mode)) throw Error('Profile');
    const express = require('express'), app = express();
    if (input.mode === 'locked-maintenance') app.use((req, res, next) => { if (req.path === '/api/health') return next(); res.status(503).json({ error: { code: 'RESTORE_REVIEW_REQUIRED' } }); });
    if (input.mode === 'anonymous-maintenance') app.use((req, res, next) => {
        if (req.method !== 'GET' || /^\/api\/(auth|me)(\/|$)/.test(req.path)) return res.status(503).json({ error: { code: 'RESTORE_REVIEW_REQUIRED' } }); next();
    });
    app.use(require('../../app')({ connectToDatabase: async () => { await context.verifyDatabase(); return context.db; },
        logger: require('pino')({ level: 'silent' }), authLimit: 10000 }));
    const server = app.listen(0, '127.0.0.1'); server.on('listening', () => process.send({ event: 'ready', pid: process.pid, port: server.address().port }));
    process.on('message', async m => { if (m.type === 'close') { await new Promise(resolve => server.close(resolve)); await context.close(); process.disconnect(); } });
}
if (require.main === module) main().catch(() => { process.stderr.write('Local restore process refused.\n'); if (process.connected) process.send({ event: 'refused' }); process.exit(1); });
