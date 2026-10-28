const { inflateSync } = require('node:zlib');
const { InventoryError } = require('./inventory-error');
const { ceiling } = require('./item-image-policy');
const invalid = () => new InventoryError(422, 'IMAGE_INPUT_INVALID', 'Choose a valid static 8-bit JPEG, PNG or WebP within the photo limits.');
const dimensions = (w, h) => {
    if (!Number.isInteger(w) || !Number.isInteger(h) || w < 1 || h < 1 || w > 10000 || h > 10000 || w * h > 16000000) throw invalid();
};
const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n; for (let i = 0; i < 8; i++) c = c & 1 ? 0xedb88320 ^ c >>> 1 : c >>> 1; return c >>> 0;
});
function crc32(bytes) { let c = 0xffffffff; for (const b of bytes) c = crcTable[(c ^ b) & 255] ^ c >>> 8; return (c ^ 0xffffffff) >>> 0; }
function png(bytes) {
    let at = 8, count = 0, width, height, channels, interlace, palette = false, image = false, ended = false, afterData = false;
    const compressed = []; let metadataBytes = 0, profile = false;
    while (at < bytes.length) {
        if (++count > 1024 || at + 12 > bytes.length) throw invalid();
        const length = bytes.readUInt32BE(at), type = bytes.toString('latin1', at + 4, at + 8), end = at + 12 + length;
        if (end > bytes.length || !/^[A-Za-z]{4}$/.test(type) || crc32(bytes.subarray(at + 4, end - 4)) !== bytes.readUInt32BE(end - 4)) throw invalid();
        const data = bytes.subarray(at + 8, end - 4);
        if (count === 1 && type !== 'IHDR' || ended) throw invalid();
        if (type === 'IHDR') {
            if (count !== 1 || length !== 13 || data[8] !== 8 || data[10] || data[11] || data[12] > 1) throw invalid();
            width = data.readUInt32BE(0); height = data.readUInt32BE(4); dimensions(width, height);
            channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[data[9]]; interlace = data[12]; if (!channels) throw invalid();
        } else if (type === 'PLTE') {
            if (image || palette || !length || length > 768 || length % 3) throw invalid(); palette = true;
        } else if (type === 'IDAT') {
            if (afterData || bytes[25] === 3 && !palette) throw invalid(); image = true; compressed.push(data);
        } else if (type === 'IEND') {
            if (!image || length || end !== bytes.length) throw invalid(); ended = true;
        } else {
            if (!['tRNS', 'cHRM', 'gAMA', 'iCCP', 'sRGB', 'pHYs', 'eXIf', 'tEXt', 'zTXt', 'iTXt', 'cICP', 'sBIT', 'bKGD', 'tIME'].includes(type) || length > 65536) throw invalid();
            let size = length;
            if (['iCCP', 'zTXt', 'iTXt'].includes(type)) {
                const keyword = data.indexOf(0); if (keyword < 1 || keyword > 79) throw invalid();
                let payload = keyword + 2, compressedText = true;
                if (type === 'iTXt') {
                    if (data[keyword + 1] > 1 || data[keyword + 2] !== 0) throw invalid();
                    compressedText = data[keyword + 1] === 1;
                    const language = data.indexOf(0, keyword + 3), translated = data.indexOf(0, language + 1);
                    if (language < 0 || translated < 0) throw invalid(); payload = translated + 1;
                } else if (data[keyword + 1] !== 0) throw invalid();
                if (type === 'iCCP') { if (profile) throw invalid(); profile = true; }
                if (compressedText) {
                    const inflated = inflateSync(data.subarray(payload), { info: true, maxOutputLength: 1048576 });
                    if (inflated.engine.bytesWritten !== data.length - payload) throw invalid(); size = inflated.buffer.length;
                } else size = data.length - payload;
            }
            metadataBytes += size; if (metadataBytes > 1048576) throw invalid();
            if (image) afterData = true;
        }
        at = end;
    }
    if (!ended) throw invalid();
    // Validate the entire zlib stream, including consumed input and scanline bounds;
    // no ignored compressed trailer can hide a second payload. Adam7 stays bounded.
    const passes = interlace ? [[0, 0, 8, 8], [4, 0, 8, 8], [0, 4, 4, 8], [2, 0, 4, 4], [0, 2, 2, 4], [1, 0, 2, 2], [0, 1, 1, 2]] : [[0, 0, 1, 1]];
    const rows = passes.map(([x, y, dx, dy]) => ({ width: Math.max(0, Math.ceil((width - x) / dx)), height: Math.max(0, Math.ceil((height - y) / dy)) }));
    const expected = rows.reduce((n, p) => n + (p.width ? (1 + p.width * channels) * p.height : 0), 0);
    const input = Buffer.concat(compressed);
    const result = inflateSync(input, { info: true, maxOutputLength: expected });
    if (result.engine.bytesWritten !== input.length || result.buffer.length !== expected) throw invalid();
    let offset = 0;
    for (const p of rows) if (p.width) for (let y = 0; y < p.height; y++) {
        if (result.buffer[offset] > 4) throw invalid(); offset += 1 + p.width * channels;
    }
    return { format: 'png', width, height };
}
function jpeg(bytes) {
    let at = 2, frame = null, scans = 0, markers = 0;
    while (at < bytes.length) {
        if (++markers > 4096 || bytes[at++] !== 255) throw invalid();
        while (bytes[at] === 255) at++;
        const marker = bytes[at++];
        if (marker === 0xd9) { if (!scans || !frame || at !== bytes.length) throw invalid(); return frame; }
        if (![0xc0, 0xc2, 0xc4, 0xdb, 0xdd, 0xda, 0xfe].includes(marker) && !(marker >= 0xe0 && marker <= 0xef)) throw invalid();
        if (at + 2 > bytes.length) throw invalid();
        const length = bytes.readUInt16BE(at), end = at + length;
        if (length < 2 || end > bytes.length) throw invalid();
        if ([0xc0, 0xc2].includes(marker)) {
            if (frame || length < 8 || bytes[at + 2] !== 8 || ![1, 3, 4].includes(bytes[at + 7]) || length !== 8 + 3 * bytes[at + 7]) throw invalid();
            frame = { format: 'jpeg', width: bytes.readUInt16BE(at + 5), height: bytes.readUInt16BE(at + 3) }; dimensions(frame.width, frame.height);
        }
        at = end;
        if (marker === 0xda) {
            if (!frame || ++scans > 256) throw invalid();
            while (at < bytes.length) {
                if (bytes[at] !== 255) { at++; continue; }
                const next = bytes[at + 1];
                if (next === 0 || next >= 0xd0 && next <= 0xd7) { at += 2; continue; }
                break;
            }
        }
    }
    throw invalid();
}
function webp(bytes, sanitized = false) {
    if (bytes.length < 20 || bytes.readUInt32LE(4) + 8 !== bytes.length || bytes.toString('latin1', 8, 12) !== 'WEBP') throw invalid();
    let at = 12, count = 0, payload = 0, extended = false;
    while (at < bytes.length) {
        if (++count > 32 || at + 8 > bytes.length) throw invalid();
        const type = bytes.toString('latin1', at, at + 4), size = bytes.readUInt32LE(at + 4), end = at + 8 + size;
        if (end + (size & 1) > bytes.length || size & 1 && bytes[end] !== 0) throw invalid();
        if (['VP8 ', 'VP8L'].includes(type)) {
            if (++payload > 1 || !size) throw invalid();
            if (type === 'VP8L') {
                if (size < 5 || bytes[at + 8] !== 0x2f) throw invalid();
                const bits = bytes.readUInt32LE(at + 9); if (bits >>> 29) throw invalid();
                dimensions((bits & 0x3fff) + 1, (bits >>> 14 & 0x3fff) + 1);
            } else {
                if (size < 10 || bytes[at + 8] & 1 || !bytes.subarray(at + 11, at + 14).equals(Buffer.from([0x9d, 1, 0x2a]))) throw invalid();
                dimensions(bytes.readUInt16LE(at + 14) & 0x3fff, bytes.readUInt16LE(at + 16) & 0x3fff);
            }
        }
        else if (type === 'VP8X') {
            if (count !== 1 || size !== 10 || extended || bytes[at + 8] & 0xc3 || bytes[at + 9] || bytes[at + 10] || bytes[at + 11]) throw invalid();
            if (sanitized && bytes[at + 8] & 0x2c) throw invalid(); extended = true;
            dimensions(bytes.readUIntLE(at + 12, 3) + 1, bytes.readUIntLE(at + 15, 3) + 1);
        } else if (type === 'ALPH') { if (!extended || payload) throw invalid(); }
        else if (sanitized || !['ICCP', 'EXIF', 'XMP '].includes(type) || size > 65536) throw invalid();
        at = end + (size & 1);
    }
    if (at !== bytes.length || payload !== 1) throw invalid();
    return { format: 'webp' };
}
function validateRaster(bytes) {
    try {
        if (!Buffer.isBuffer(bytes) || !bytes.length || bytes.length > ceiling.inputBytes) throw invalid();
        if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return png(bytes);
        if (bytes[0] === 255 && bytes[1] === 216) return jpeg(bytes);
        if (bytes.toString('latin1', 0, 4) === 'RIFF') return webp(bytes);
        throw invalid();
    } catch (error) { throw invalid(); }
}
module.exports = { validateRaster, validateWebp: bytes => webp(bytes, true), dimensions, invalid, crc32 };
