const { createHash } = require('node:crypto');
const { performance } = require('node:perf_hooks');
const { validateRaster, validateWebp, dimensions, invalid } = require('./item-image-format');
const { ceiling } = require('./item-image-policy');
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
let sharp;
function native() {
    if (!sharp) {
        sharp = require('sharp');
        sharp.cache({ memory: 0, files: 0, items: 0 }); sharp.concurrency(1);
    }
    return sharp;
}
const inputOptions = Object.freeze({ limitInputPixels: 16000000, failOn: 'warning', unlimited: false, sequentialRead: true, animated: false });
async function processRaster(bytes, check = () => {}, contentType = '') {
    const started = performance.now();
    try {
        check(); const sniffed = validateRaster(bytes); const decode = native();
        if (contentType && contentType !== 'application/octet-stream' && contentType !== 'image/' + sniffed.format) throw invalid();
        const meta = await decode(bytes, inputOptions).timeout({ seconds: 5 }).metadata();
        dimensions(meta.width, meta.height);
        if (meta.format !== sniffed.format || meta.depth !== 'uchar' || meta.pages && meta.pages !== 1 || meta.channels < 1 || meta.channels > 4) throw invalid();
        const result = {};
        for (const [name, edge] of [['thumbnail', 400], ['display', 1280]]) {
            check();
            const output = await decode(bytes, inputOptions).autoOrient().toColourspace('srgb')
                .resize(edge, edge, { fit: 'inside', withoutEnlargement: true }).webp({ quality: 80, effort: 4 })
                .timeout({ seconds: 5 }).toBuffer({ resolveWithObject: true });
            check();
            const body = output.data, info = output.info;
            if (body.length > ceiling[name + 'Bytes'] || !body.length || info.format !== 'webp' || Math.max(info.width, info.height) > edge) throw invalid();
            validateWebp(body);
            const actual = await decode(body, inputOptions).timeout({ seconds: 2 }).metadata();
            if (actual.width !== info.width || actual.height !== info.height || actual.format !== 'webp' ||
                actual.exif || actual.icc || actual.iptc || actual.xmp || actual.orientation || actual.hasProfile) throw invalid();
            result[name] = { body, width: info.width, height: info.height, byteLength: body.length, sha256: sha256(body), contentType: 'image/webp' };
        }
        return { variants: result, processingMs: performance.now() - started };
    } catch (error) { throw invalid(); }
}
module.exports = { processRaster, sha256 };
