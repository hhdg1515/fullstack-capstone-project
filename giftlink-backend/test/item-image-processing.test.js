/* jshint loopfunc: true */
const assert = require('node:assert/strict');
const { deflateSync } = require('node:zlib');
const sharp = require('sharp');
const { processRaster, sha256 } = require('../services/item-image-processing');
const { validateRaster, crc32 } = require('../services/item-image-format');
const { parseMultipart, requestBytes } = require('../services/item-image-intake');
const { readServerConfig } = require('../config');
function chunk(type, data) {
    const b = Buffer.alloc(12 + data.length); b.writeUInt32BE(data.length); b.write(type, 4); data.copy(b, 8);
    b.writeUInt32BE(crc32(b.subarray(4, b.length - 4)), b.length - 4); return b;
}
function riff(chunks) { const head = Buffer.alloc(12); head.write('RIFF'); head.writeUInt32LE(4 + chunks.length, 4); head.write('WEBP', 8); return Buffer.concat([head, chunks]); }
function webpChunk(type, data) { const b = Buffer.alloc(8 + data.length + (data.length & 1)); b.write(type); b.writeUInt32LE(data.length, 4); data.copy(b, 8); return b; }
function multipart(file, ending = '--unit--\r\n') {
    return Buffer.concat([Buffer.from('--unit\r\nContent-Disposition: form-data; name="file"; filename="ignored.jpg"\r\nContent-Type: image/png\r\n\r\n'), file, Buffer.from('\r\n' + ending)]);
}
describe('strict raster validation, native Sharp privacy and bounded multipart grammar', function () {
    this.timeout(30000);
    let png, jpeg, webp;
    before(async function () {
        const seed = sharp({ create: { width: 1600, height: 800, channels: 3, background: '#318e76' } });
        png = await seed.clone().png().toBuffer(); jpeg = await seed.clone().jpeg().toBuffer(); webp = await seed.clone().webp().toBuffer();
    });
    for (const format of ['jpeg', 'png', 'webp']) it('processes actual ' + format + ' to bounded stripped WebP variants', async function () {
        const input = { jpeg, png, webp }[format]; const result = await processRaster(input);
        assert.equal(validateRaster(input).format, format);
        for (const [name, width, limit] of [['thumbnail', 400, 262144], ['display', 1280, 1048576]]) {
            const output = result.variants[name], meta = await sharp(output.body).metadata();
            assert.equal(meta.width, width); assert.equal(meta.height, width / 2); assert.equal(meta.format, 'webp');
            assert.equal(meta.space, 'srgb');
            assert.equal(meta.exif, undefined); assert.equal(meta.icc, undefined); assert.equal(meta.xmp, undefined); assert.equal(meta.iptc, undefined);
            assert.equal(output.sha256, sha256(output.body)); assert.ok(output.body.length <= limit);
        }
    });
    it('does not enlarge small images and preserves alpha without retaining source metadata', async function () {
        const input = await sharp({ create: { width: 11, height: 7, channels: 4, background: { r: 20, g: 70, b: 140, alpha: 0.4 } } }).png().toBuffer();
        for (const v of Object.values((await processRaster(input)).variants)) {
            const meta = await sharp(v.body).metadata(); assert.equal(meta.width, 11); assert.equal(meta.height, 7); assert.equal(meta.hasAlpha, true);
        }
    });
    it('strips genuine XMP, IPTC, ICC and JPEG comment payloads from both encoded outputs', async function () {
        function segment(marker, data) { const head = Buffer.from([255, marker, 0, 0]); head.writeUInt16BE(data.length + 2, 2); return Buffer.concat([head, data]); }
        const xmp = Buffer.from('http://ns.adobe.com/xap/1.0/\0<x:xmpmeta xmlns:x="adobe:ns:meta/"><synthetic>Private source annotation</synthetic></x:xmpmeta>');
        const caption = Buffer.from('Synthetic IPTC caption'), iim = Buffer.concat([Buffer.from([0x1c, 2, 120, 0, caption.length]), caption]);
        const header = Buffer.from('Photoshop 3.0\0' + '8BIM', 'latin1'), resource = Buffer.alloc(8);
        resource.writeUInt16BE(0x0404); resource.writeUInt32BE(iim.length, 4);
        const iptc = Buffer.concat([header, resource, iim, Buffer.alloc(iim.length & 1)]);
        const source = await sharp(jpeg).withMetadata().jpeg().toBuffer();
        const bytes = Buffer.concat([source.subarray(0, 2), segment(0xe1, xmp), segment(0xed, iptc), segment(0xfe, Buffer.from('Synthetic private comment')), source.subarray(2)]);
        const before = await sharp(bytes).metadata(); assert.ok(before.xmp && before.iptc && before.icc);
        for (const output of Object.values((await processRaster(bytes)).variants)) {
            const meta = await sharp(output.body).metadata();
            for (const field of ['xmp', 'iptc', 'icc', 'exif']) assert.equal(meta[field], undefined);
            assert.ok(!output.body.includes(Buffer.from('Synthetic')) && !output.body.includes(Buffer.from('Private source')));
        }
    });
    const colors = [[220, 30, 30], [30, 180, 40], [25, 60, 210], [210, 180, 20], [200, 30, 180], [20, 160, 180]];
    const maps = [(x, y) => [x, y], (x, y) => [2 - x, y], (x, y) => [2 - x, 1 - y], (x, y) => [x, 1 - y],
        (x, y) => [y, x], (x, y) => [1 - y, x], (x, y) => [1 - y, 2 - x], (x, y) => [y, 2 - x]];
    for (let orientation = 1; orientation <= 8; orientation++) it('applies EXIF orientation ' + orientation + ' including mirrored pixels and strips real GPS/profile metadata', async function () {
        const pixels = Buffer.alloc(60 * 40 * 3);
        for (let y = 0; y < 40; y++) for (let x = 0; x < 60; x++) {
            const color = colors[Math.floor(y / 20) * 3 + Math.floor(x / 20)];
            for (let c = 0; c < 3; c++) pixels[(y * 60 + x) * 3 + c] = color[c];
        }
        const input = await sharp(pixels, { raw: { width: 60, height: 40, channels: 3 } }).withMetadata({ orientation })
            .withExifMerge({ IFD0: { Artist: 'Synthetic artist' }, IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '37/1 46/1 0/1', GPSLongitudeRef: 'W', GPSLongitude: '122/1 25/1 0/1' } })
            .jpeg({ quality: 100, chromaSubsampling: '4:4:4' }).toBuffer();
        const source = await sharp(input).metadata(); assert.equal(source.orientation, orientation); assert.ok(source.icc.length && source.exif.length);
        // The source TIFF directory contains the GPS IFD pointer (0x8825), not just an artist string.
        const tiff = source.exif.subarray(6), little = tiff.toString('ascii', 0, 2) === 'II';
        const u16 = offset => little ? tiff.readUInt16LE(offset) : tiff.readUInt16BE(offset);
        const u32 = offset => little ? tiff.readUInt32LE(offset) : tiff.readUInt32BE(offset);
        const start = u32(4); let gps = 0;
        for (let at = start + 2; at < start + 2 + u16(start) * 12; at += 12) if (u16(at) === 0x8825) gps = u32(at + 8);
        assert.ok(gps > 0 && u16(gps) >= 4);
        for (const output of Object.values((await processRaster(input)).variants)) {
            const meta = await sharp(output.body).metadata();
            assert.equal(meta.width, orientation < 5 ? 60 : 40); assert.equal(meta.height, orientation < 5 ? 40 : 60);
            for (const key of ['exif', 'icc', 'iptc', 'xmp', 'orientation']) assert.equal(meta[key], undefined);
            const raw = await sharp(output.body).removeAlpha().raw().toBuffer();
            for (let y = 0; y < 2; y++) for (let x = 0; x < 3; x++) {
                const [dx, dy] = maps[orientation - 1](x, y), offset = ((dy * 20 + 10) * meta.width + dx * 20 + 10) * 3;
                for (let c = 0; c < 3; c++) assert.ok(Math.abs(raw[offset + c] - colors[y * 3 + x][c]) < 35);
            }
        }
    });
    for (const bytes of [Buffer.from('<svg><script>bad</script></svg>'), Buffer.from('<!doctype html>'), Buffer.from('%PDF-1.7'),
        Buffer.from('GIF89a'), Buffer.from('II*\0'), Buffer.from('MZ'), Buffer.from('....ftypheic'), Buffer.from('....ftypavif')]) {
        it('rejects unsupported or disguised content before decoding: ' + bytes.toString('hex').slice(0, 12), async function () {
            await assert.rejects(processRaster(bytes), error => error.code === 'IMAGE_INPUT_INVALID');
        });
    }
    it('rejects MIME/signature mismatch while ignoring extensions and generic octet-stream hints', async function () {
        await assert.rejects(processRaster(png, undefined, 'image/jpeg'));
        await processRaster(png, undefined, 'application/octet-stream');
    });
    it('rejects complete-container trailers, concatenated payloads, invalid CRCs and truncation', async function () {
        for (const input of [png, jpeg, webp]) {
            await assert.rejects(processRaster(Buffer.concat([input, Buffer.from('%PDF-script-payload')])));
            await assert.rejects(processRaster(input.subarray(0, input.length - 2)));
        }
        const bad = Buffer.from(png); bad[29] ^= 1; await assert.rejects(processRaster(bad));
        const icc = chunk('iCCP', Buffer.alloc(65537));
        await assert.rejects(processRaster(Buffer.concat([png.subarray(0, 33), icc, png.subarray(33)])));
    });
    it('rejects APNG and WebP animation, even if a first frame could be decoded', async function () {
        await assert.rejects(processRaster(Buffer.concat([png.subarray(0, 33), chunk('acTL', Buffer.alloc(8)), png.subarray(33)])));
        const flags = Buffer.alloc(10); flags[0] = 2;
        await assert.rejects(processRaster(riff(Buffer.concat([webpChunk('VP8X', flags), webpChunk('ANIM', Buffer.alloc(6)), webpChunk('ANMF', webp.subarray(12))]))));
    });
    it('rejects 16-bit PNG, excessive dimensions and declared decompression bombs before native work', async function () {
        for (const [w, h, depth] of [[10001, 1, 8], [4001, 4000, 8], [20, 20, 16]]) {
            const hdr = Buffer.from(png.subarray(16, 29)); hdr.writeUInt32BE(w); hdr.writeUInt32BE(h, 4); hdr[8] = depth;
            await assert.rejects(processRaster(Buffer.concat([png.subarray(0, 8), chunk('IHDR', hdr), png.subarray(33)])));
        }
        const tiny = Buffer.from(png.subarray(16, 29)); tiny.writeUInt32BE(1); tiny.writeUInt32BE(1, 4);
        await assert.rejects(processRaster(Buffer.concat([png.subarray(0, 8), chunk('IHDR', tiny), chunk('IDAT', deflateSync(Buffer.alloc(1024 * 1024))), chunk('IEND', Buffer.alloc(0))])));
    });
    it('rejects ignored zlib trailers and invalid PNG filter bytes', async function () {
        const hdr = Buffer.from(png.subarray(16, 29)); hdr.writeUInt32BE(1); hdr.writeUInt32BE(1, 4); hdr[9] = 2;
        for (const data of [Buffer.concat([deflateSync(Buffer.from([0, 1, 2, 3])), Buffer.from('hidden')]), deflateSync(Buffer.from([8, 1, 2, 3]))]) {
            await assert.rejects(processRaster(Buffer.concat([png.subarray(0, 8), chunk('IHDR', hdr), chunk('IDAT', data), chunk('IEND', Buffer.alloc(0))])));
        }
    });
    it('accepts bounded interlaced/palette PNG while rejecting compressed metadata bombs', async function () {
        const source = sharp({ create: { width: 31, height: 19, channels: 3, background: 'green' } });
        await processRaster(await source.clone().png({ progressive: true }).toBuffer());
        await processRaster(await source.clone().png({ palette: true, colours: 256, bitdepth: 8 }).toBuffer());
        const bomb = Buffer.concat([Buffer.from('profile\0\0'), deflateSync(Buffer.alloc(1048577))]);
        await assert.rejects(processRaster(Buffer.concat([png.subarray(0, 33), chunk('iCCP', bomb), png.subarray(33)])));
    });
    it('accepts only an exact single-file multipart body with bounded headers and no extra fields', function () {
        assert.ok(parseMultipart(multipart(png), 'unit').body.equals(png));
        for (const bytes of [multipart(png, '--unit\r\nContent-Disposition: form-data; name="extra"\r\n\r\nvalue\r\n--unit--\r\n'),
            multipart(png).subarray(0, -2), Buffer.concat([multipart(png), Buffer.from('trailer')]),
            multipart(png).subarray(3), multipart(Buffer.alloc(0)), multipart(png).toString('latin1').replace('name="file"', 'name="ownerId"')]) {
            assert.throws(() => parseMultipart(Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes, 'latin1'), 'unit'));
        }
        assert.equal(requestBytes, 3407872);
        assert.throws(() => parseMultipart(multipart(Buffer.alloc(3145729)), 'unit'), error => error.status === 413);
    });
    it('keeps deployment activation disabled even when metadata is configured', function () {
        const base = { MONGO_URL: 'mongodb://127.0.0.1:1' };
        readServerConfig(Object.assign({}, base, { ITEM_IMAGE_PIPELINE_ENABLED: 'false' }));
        for (const value of ['true', '1', '', 'TRUE']) assert.throws(() => readServerConfig(Object.assign({}, base, { ITEM_IMAGE_PIPELINE_ENABLED: value })), /B4/);
    });
});
