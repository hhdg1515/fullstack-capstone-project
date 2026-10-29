// Local preparation is guidance and bandwidth reduction; Sharp remains authoritative.
export const SOURCE_BYTES = 20 * 1024 * 1024;
export const OUTPUT_BYTES = 3 * 1024 * 1024;
const PIXELS = 48 * 1000 * 1000, EDGE = 10000, HEADER_BYTES = 512 * 1024;
const fail = message => Object.assign(new Error(message), { code: 'PHOTO_PREPARATION_FAILED' });
export function sourcePhotoError(file) {
  if (!file || !Number.isSafeInteger(file.size) || file.size < 1 || file.size > SOURCE_BYTES) return 'Choose a nonempty photo up to 20 MiB.';
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) && !(file.type === '' && /\.(jpe?g|png|webp)$/i.test(file.name))) return 'Use JPEG, PNG or WebP. Convert HEIC to JPEG.';
  return '';
}
function dimensions(width, height, type) {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1 || width > EDGE || height > EDGE || width * height > PIXELS) throw fail('Photo is too large to prepare safely. Resize it below 48 megapixels and 10,000 pixels per edge.');
  return { width, height, type };
}
export function photoHeader(buffer) {
  const b = new Uint8Array(buffer), v = new DataView(buffer);
  const text = (offset, size) => String.fromCharCode(...b.slice(offset, offset + size));
  if (b.length >= 33 && b[0] === 137 && text(1, 3) === 'PNG' && text(12, 4) === 'IHDR') {
    const info = dimensions(v.getUint32(16), v.getUint32(20), 'image/png');
    for (let p = 33; p + 8 <= b.length;) {
      const size = v.getUint32(p), name = text(p + 4, 4);
      if (name === 'acTL') throw fail('Choose a still photo instead of an animation.');
      if (name === 'IDAT') return info;
      if (p + 12 + size > b.length) break;
      p += 12 + size;
    }
    throw fail("Couldn't read a still PNG header. Export the photo as JPEG or PNG.");
  }
  if (b.length >= 12 && text(0, 4) === 'RIFF' && text(8, 4) === 'WEBP') {
    for (let p = 12; p + 8 <= b.length;) {
      const size = v.getUint32(p + 4, true), start = p + 8, name = text(p, 4);
      if (name === 'VP8X' && start + 10 <= b.length) {
        if (b[start] & 2) throw fail('Choose a still photo instead of an animation.');
        return dimensions(1 + b[start + 4] + (b[start + 5] << 8) + (b[start + 6] << 16), 1 + b[start + 7] + (b[start + 8] << 8) + (b[start + 9] << 16), 'image/webp');
      }
      if (name === 'VP8L' && start + 5 <= b.length && b[start] === 47) return dimensions(1 + b[start + 1] + ((b[start + 2] & 63) << 8),
        1 + (b[start + 2] >> 6) + (b[start + 3] << 2) + ((b[start + 4] & 15) << 10), 'image/webp');
      if (name === 'VP8 ' && start + 10 <= b.length && b[start + 3] === 157 && b[start + 4] === 1 && b[start + 5] === 42) return dimensions(v.getUint16(start + 6, true) & 16383, v.getUint16(start + 8, true) & 16383, 'image/webp');
      if (size < 1 || start + size > b.length) break;
      p = start + size + (size % 2);
    }
  }
  if (b.length >= 4 && b[0] === 255 && b[1] === 216) {
    for (let p = 2; p + 3 < b.length;) {
      if (b[p++] !== 255) break;
      while (p < b.length && b[p] === 255) p++;
      const marker = b[p++]; if (p + 2 > b.length || marker === 218 || marker === 217) break;
      const size = v.getUint16(p); if (size < 2 || p + size > b.length) break;
      if ([192, 193, 194].includes(marker) && size >= 8) return dimensions(v.getUint16(p + 5), v.getUint16(p + 3), 'image/jpeg');
      p += size;
    }
  }
  throw fail("Couldn't read this photo. Export it as JPEG, PNG or WebP and try again.");
}
async function bytes(blob) {
  if (blob.arrayBuffer) return blob.arrayBuffer();
  return new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = () => reject(fail("Couldn't read this photo.")); reader.readAsArrayBuffer(blob); });
}
function deadline(promise, dispose = () => {}) {
  let expired = false, timer;
  const watched = promise.then(value => { if (expired) { dispose(value); throw fail('Photo preparation timed out. Try a smaller photo.'); } return value; });
  return Promise.race([watched, new Promise((resolve, reject) => { timer = setTimeout(() => { expired = true; reject(fail('Photo preparation timed out. Try a smaller photo.')); }, 20000); })]).finally(() => clearTimeout(timer));
}
export async function preparePhoto(file) {
  const problem = sourcePhotoError(file); if (problem) throw fail(problem);
  if (typeof window.createImageBitmap !== 'function') throw fail('Photo preparation needs a current browser. Try an updated Chrome, Edge or Safari.');
  const header = await deadline(bytes(file.slice(0, HEADER_BYTES)), value => new Uint8Array(value).fill(0));
  let info;
  try { info = photoHeader(header); } finally { new Uint8Array(header).fill(0); }
  let bitmap, canvas;
  try {
    bitmap = await deadline(window.createImageBitmap(file, { imageOrientation: 'from-image' }), value => value.close());
    dimensions(bitmap.width, bitmap.height, info.type);
    canvas = document.createElement('canvas'); const context = canvas.getContext('2d');
    if (!context) throw fail('Photo preparation is unavailable. Try another browser.');
    const type = info.type === 'image/jpeg' ? 'image/jpeg' : 'image/webp';
    for (let attempt = 0; attempt < 3; attempt++) {
      const ratio = Math.min(1, (1280 - attempt * 280) / Math.max(bitmap.width, bitmap.height));
      canvas.width = Math.max(1, Math.round(bitmap.width * ratio)); canvas.height = Math.max(1, Math.round(bitmap.height * ratio));
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      const output = await deadline(new Promise(resolve => canvas.toBlob(resolve, type, .85 - attempt * .15)));
      if (!output || !['image/jpeg', 'image/png', 'image/webp'].includes(output.type) || output.size === 0) throw fail("Couldn't prepare this photo. Try exporting it as JPEG.");
      if (output.size <= OUTPUT_BYTES) return new File([output], output.type === 'image/jpeg' ? 'photo.jpg' : output.type === 'image/png' ? 'photo.png' : 'photo.webp', { type: output.type });
    }
    throw fail('Photo is still too large. Resize it and try again.');
  } catch (error) {
    if (error.code === 'PHOTO_PREPARATION_FAILED') throw error;
    throw fail("Couldn't prepare this photo. Convert HEIC to JPEG or try a smaller photo.");
  } finally { bitmap?.close(); if (canvas) { canvas.width = 0; canvas.height = 0; } }
}
