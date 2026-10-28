const fs = require('node:fs');

// Local ownership receipts/manifests are authority-bearing files, not config
// hints. Refuse symlinks, broad permissions, foreign owners and oversized input.
function readPrivateJson(file, maximum = 65536) {
    let descriptor;
    try {
        if (typeof file !== 'string' || fs.lstatSync(file).isSymbolicLink()) throw new Error();
        descriptor = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
        const stat = fs.fstatSync(descriptor);
        if (!stat.isFile() || stat.size > maximum || stat.size < 2 ||
            process.platform !== 'win32' && ((stat.mode & 0o077) !== 0 || stat.uid !== process.getuid())) throw new Error();
        const bytes = Buffer.alloc(maximum + 1);
        const size = fs.readSync(descriptor, bytes, 0, bytes.length, 0);
        if (size > maximum) throw new Error();
        return JSON.parse(bytes.subarray(0, size).toString('utf8'));
    } catch (error) { throw new Error('Private local receipt or manifest is invalid.'); }
    finally { if (descriptor !== undefined) fs.closeSync(descriptor); }
}
function writePrivateJson(file, value) {
    // Never overwrite another manifest or follow an existing symlink.
    fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
}
module.exports = { readPrivateJson, writePrivateJson };
