/* jshint esversion: 9, loopfunc: true */
// CPU/memory-only synthetic probe. Originals are generated in RAM and piped to a
// fresh Node child for cold native/RSS attribution; no file, DB or S3 access.
const { spawn } = require('node:child_process');
const { performance } = require('node:perf_hooks');
const cases = ['png-rgba-16mp', 'jpeg-noise-16mp', 'jpeg-wide-16mp'];
async function child() {
    const chunks = []; let size = 0;
    for await (const chunk of process.stdin) { size += chunk.length; if (size > 3145728) throw Error('Probe input exceeds cap'); chunks.push(chunk); }
    const bytes = Buffer.concat(chunks), start = performance.now();
    const sharp = require('sharp'), requireMs = performance.now() - start;
    const { processRaster } = require('../services/item-image-processing');
    const begun = performance.now(); let result, outcome = 'accepted';
    try { result = await processRaster(bytes); } catch (error) { outcome = 'rejected'; }
    const variants = {};
    if (result) for (const name of ['thumbnail', 'display']) {
        const v = result.variants[name]; variants[name] = { byteLength: v.byteLength, width: v.width, height: v.height };
    }
    process.stdout.write(JSON.stringify({ outcome, node: process.version, platform: process.platform, arch: process.arch,
        sharp: sharp.versions.sharp, vips: sharp.versions.vips, inputBytes: size, requireMs: Math.round(requireMs),
        firstProcessingMs: Math.round(performance.now() - begun), maxRssMiB: Math.round(process.resourceUsage().maxRSS / 1024), variants }));
}
async function run() {
    const sharp = require('sharp'); const results = [];
    for (const sample of cases) {
        const width = sample === 'jpeg-wide-16mp' ? 10000 : 4000, height = sample === 'jpeg-wide-16mp' ? 1600 : 4000;
        let bytes;
        if (sample === 'png-rgba-16mp') bytes = await sharp({ create: { width, height, channels: 4, background: { r: 40, g: 80, b: 120, alpha: 0.5 } } }).png().toBuffer();
        else {
            const raw = Buffer.alloc(width * height * 3); let state = 123456789;
            for (let i = 0; i < raw.length; i++) { state ^= state << 13; state ^= state >>> 17; state ^= state << 5; raw[i] = state & 255; }
            bytes = await sharp(raw, { raw: { width, height, channels: 3 } }).jpeg({ quality: 15, chromaSubsampling: '4:2:0' }).toBuffer();
        }
        if (bytes.length > 3145728) throw Error('Synthetic fixture exceeds approved intake cap');
        const start = performance.now();
        const measured = await new Promise((resolve, reject) => {
            const worker = spawn(process.execPath, [__filename, '--sample'], { stdio: ['pipe', 'pipe', 'pipe'] });
            let text = '';
            const timer = setTimeout(() => { worker.kill('SIGKILL'); reject(Error('Probe exceeded deadline')); }, 30000);
            worker.stdout.on('data', chunk => { text += chunk; if (text.length > 8192) worker.kill('SIGKILL'); });
            worker.stderr.resume(); worker.on('error', reject);
            worker.on('close', code => { clearTimeout(timer); if (code) reject(Error('Probe failed')); else { try { resolve(JSON.parse(text)); } catch (error) { reject(Error('Invalid probe result')); } } });
            worker.stdin.on('error', reject); worker.stdin.end(bytes);
        });
        results.push(Object.assign({ sample, pixels: width * height, wallMs: Math.round(performance.now() - start) }, measured));
    }
    process.stdout.write(JSON.stringify({ scope: 'isolated local synthetic measurements; not Vercel benchmarks', results }, null, 2) + '\n');
}
if (require.main === module) (process.argv[2] === '--sample' ? child() : run()).catch(() => { console.error('Photo resource probe failed'); process.exitCode = 1; });
module.exports = { run };
