const { InventoryError } = require('./inventory-error');
const { ceiling } = require('./item-image-policy');
const requestBytes = 3407872;
const bad = () => new InventoryError(400, 'IMAGE_MULTIPART_INVALID', 'Send one photo file and no extra fields.');
function boundary(req) {
    if (req.get('Content-Encoding') && req.get('Content-Encoding').toLowerCase() !== 'identity') {
        throw new InventoryError(415, 'IMAGE_ENCODING_UNSUPPORTED', 'Send the original multipart request without Content-Encoding.');
    }
    const match = /^multipart\/form-data;\s*boundary=(?:"([A-Za-z0-9'()+_,\-./:=? ]{1,70})"|([A-Za-z0-9'()+_,\-./:=?]{1,70}))$/i.exec(req.get('Content-Type') || '');
    if (!match) throw bad();
    const value = match[1] || match[2]; if (value.endsWith(' ')) throw bad();
    const length = req.get('Content-Length');
    if (length !== undefined && (!/^[0-9]+$/.test(length) || Number(length) > requestBytes)) throw new InventoryError(413, 'IMAGE_REQUEST_TOO_LARGE', 'Keep the complete upload within 3.25 MiB.');
    return value;
}
function parseMultipart(bytes, value) {
    const start = Buffer.from('--' + value + '\r\n'), ending = Buffer.from('\r\n--' + value + '--\r\n');
    if (!bytes.subarray(0, start.length).equals(start) || !bytes.subarray(-ending.length).equals(ending)) throw bad();
    const separator = bytes.indexOf('\r\n\r\n', start.length);
    if (separator < start.length || separator - start.length > 2048) throw bad();
    const headers = bytes.subarray(start.length, separator).toString('latin1').split('\r\n');
    let disposition = false, contentType = '';
    if (headers.length > 2) throw bad();
    for (const line of headers) {
        if (/^content-disposition:/i.test(line)) {
            if (disposition || !/^content-disposition:\s*form-data;\s*name="file";\s*filename="[^"\r\n\x00-\x1f\x7f]{0,255}"$/i.test(line)) throw bad();
            disposition = true;
        } else if (/^content-type:/i.test(line)) {
            if (contentType || !/^content-type:\s*(image\/(jpeg|png|webp)|application\/octet-stream)\s*$/i.test(line)) throw bad();
            contentType = line.slice(line.indexOf(':') + 1).trim().toLowerCase();
        } else throw bad();
    }
    const body = bytes.subarray(separator + 4, bytes.length - ending.length);
    if (body.length > ceiling.inputBytes) throw new InventoryError(413, 'IMAGE_FILE_TOO_LARGE', 'Choose a photo no larger than 3 MiB.');
    if (!disposition || !body.length || body.indexOf(Buffer.from('\r\n--' + value)) >= 0) throw bad();
    return { body, contentType };
}
function readMultipart(req, value) {
    return new Promise((resolve, reject) => {
        const chunks = []; let size = 0, settled = false;
        const timer = setTimeout(() => finish(new InventoryError(408, 'IMAGE_INTAKE_TIMEOUT', 'Upload timed out. Check the operation status before trying another photo.')), 10000);
        function finish(error) {
            if (settled) return; settled = true; clearTimeout(timer);
            req.removeListener('data', data); req.removeListener('end', end); req.removeListener('error', aborted); req.removeListener('aborted', aborted);
            if (error) { req.pause(); chunks.length = 0; reject(error); }
            else {
                try { resolve(parseMultipart(Buffer.concat(chunks, size), value)); }
                catch (failure) { reject(failure); }
                chunks.length = 0;
            }
        }
        function data(chunk) {
            size += chunk.length;
            if (size > requestBytes) return finish(new InventoryError(413, 'IMAGE_REQUEST_TOO_LARGE', 'Keep the complete upload within 3.25 MiB.'));
            chunks.push(chunk);
        }
        function end() { if (!req.complete) return finish(bad()); finish(); }
        function aborted() { finish(bad()); }
        req.on('data', data); req.once('end', end); req.once('error', aborted); req.once('aborted', aborted);
        if (req.aborted || req.destroyed) aborted();
    });
}
module.exports = { boundary, readMultipart, parseMultipart, requestBytes };
