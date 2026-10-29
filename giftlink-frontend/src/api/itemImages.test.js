import { createHash } from 'crypto';
import { fileDigest, photoError, photoUrl, readPhotos, readUpload, reservePhoto, selectionError, uploadId, uploadPhoto } from './itemImages';

const plan = 'a'.repeat(24), item = 'b'.repeat(24), image = 'c'.repeat(24), clientId = '00000000-0000-4000-8000-000000000001';
const operation = { id: image, state: 'reserved', cleanupPending: false, reservationExpired: false, createdAt: '2026-10-28T12:00:00Z' };
const reply = (data, status = 200, type = 'application/json') => ({ ok: status < 400, status, headers: new Headers({ 'Content-Type': type }), json: async () => data });
let requests;
class FakeXHR {
  constructor() { this.upload = {}; this.headers = {}; requests.push(this); }
  open(method, url) { this.method = method; this.url = url; }
  setRequestHeader(key, value) { this.headers[key] = value; }
  send(body) { this.body = body; }
  abort() { this.onabort?.(); }
  getResponseHeader() { return this.type || 'application/json'; }
  respond(status, body, type) { this.status = status; this.responseText = typeof body === 'string' ? body : JSON.stringify(body); this.type = type; this.onload(); }
}
beforeEach(() => {
  requests = []; global.XMLHttpRequest = FakeXHR; global.fetch = jest.fn();
  Object.defineProperty(window, 'crypto', { configurable: true, value: { randomUUID: jest.fn(() => clientId),
    subtle: { digest: jest.fn(async (name, bytes) => Uint8Array.from(createHash('sha256').update(Buffer.from(bytes)).digest()).buffer) } } });
});
afterEach(() => jest.restoreAllMocks());
test('computes the actual file SHA-256 and a cryptographic stable upload UUID without sending file metadata', async () => {
  const file = new File(['abc'], 'private-address.png', { type: 'image/png' });
  expect(await fileDigest(file)).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  expect(uploadId()).toBe(clientId); expect(window.crypto.randomUUID).toHaveBeenCalledTimes(1); expect(fetch).not.toHaveBeenCalled();
});
test.each([['image/heic', 'private.heic'], ['image/svg+xml', 'private.svg'], ['image/gif', 'private.gif']])('warns about unsupported %s before reading or reserving', (type, name) => {
  expect(selectionError(new File(['abc'], name, { type }))).toMatch(/JPEG.*PNG.*WebP.*HEIC/);
});
test('rejects empty and oversized files and permits only a known extension when MIME is empty', async () => {
  expect(selectionError(new File([], 'empty.png', { type: 'image/png' }))).toMatch(/nonempty/);
  expect(selectionError(new File([new Uint8Array(3145729)], 'large.jpg', { type: 'image/jpeg' }))).toMatch(/3 MiB/);
  expect(selectionError(new File(['abc'], 'photo.webp'))).toBe(''); expect(selectionError(new File(['abc'], 'unknown.bin'))).toMatch(/JPEG/);
  await expect(fileDigest(new File([], 'empty.png'))).rejects.toMatchObject({ code: 'FILE_SIZE' });
});
test('JSON reservation uses the existing session/CSRF conventions and an allowlisted intent only', async () => {
  fetch.mockResolvedValue(reply({ imageRevision: 0, upload: operation }, 201));
  await reservePhoto(plan, item, { clientUploadId: clientId, imageRevision: 0, byteLength: 3, sha256: 'f'.repeat(64), filename: 'PRIVATE', ownerId: 'PRIVATE', file: new File(['abc'], 'PRIVATE') });
  const [url, options] = fetch.mock.calls[0]; expect(url).toBe(`/api/move-out-plans/${plan}/items/${item}/images/uploads`);
  expect(options.credentials).toBe('include'); expect(options.headers).toEqual({ 'Content-Type': 'application/json', 'X-CSRF-Protection': '1' });
  expect(JSON.parse(options.body)).toEqual({ imageRevision: 0, clientUploadId: clientId, byteLength: 3, sha256: 'f'.repeat(64) });
  expect(options.body).not.toMatch(/PRIVATE|filename|ownerId/);
});
test('recovers a reservation by UUID with GET and never retries a POST automatically', async () => {
  fetch.mockResolvedValue(reply({ imageRevision: 0, upload: operation }));
  await readUpload(plan, item, undefined, clientId);
  expect(fetch.mock.calls[0][0]).toContain('/uploads/' + clientId); expect(fetch.mock.calls[0][1].method).toBe('GET');
  await readUpload(plan, item, image, clientId); expect(fetch.mock.calls[1][0]).toMatch(new RegExp('/' + image + '$'));
});
test('refuses arbitrary identifiers and image URLs before any network request', () => {
  expect(() => readUpload(plan, item, 'https://private.invalid', 'bad')).toThrow();
  expect(() => readPhotos('../foreign', item)).toThrow(); expect(() => photoUrl('https://private.invalid')).toThrow();
  expect(photoUrl(image)).toBe('/api/item-images/' + image + '/thumbnail'); expect(fetch).not.toHaveBeenCalled();
});
test('uses one credentialed FormData PUT, a generic filename and no manual multipart Content-Type', async () => {
  const progress = jest.fn(), file = new File(['abc'], 'sensitive-filename.png', { type: 'image/png' });
  const promise = uploadPhoto(plan, item, image, file, { onProgress: progress }); const xhr = requests[0];
  expect(xhr.method).toBe('PUT'); expect(xhr.withCredentials).toBe(true); expect(xhr.timeout).toBe(45000);
  expect(xhr.headers).toEqual({ 'X-CSRF-Protection': '1' }); expect(xhr.body).toBeInstanceOf(FormData);
  expect(xhr.body.get('file').name).toBe('photo.bin'); expect(Array.from(xhr.body.keys())).toEqual(['file']);
  xhr.upload.onprogress({ lengthComputable: true, loaded: 3, total: 3 }); expect(progress).toHaveBeenLastCalledWith(99, false);
  xhr.upload.onload(); expect(progress).toHaveBeenLastCalledWith(100, true);
  xhr.respond(201, { imageRevision: 1, image: { ...operation, state: 'ready' } }); await expect(promise).resolves.toMatchObject({ upload: { state: 'ready' } });
  expect(requests).toHaveLength(1);
});
test.each(['network', 'timeout', 'abort', 'html', 'malformed', 'unknown-code'])('makes %s upload failures uncertain and sanitized without a second PUT', async fault => {
  const controller = new AbortController(); const promise = uploadPhoto(plan, item, image, new File(['abc'], 'photo.png', { type: 'image/png' }), { signal: controller.signal });
  const rejected = expect(promise).rejects.toMatchObject({ uncertain: true }); const xhr = requests[0];
  if (fault === 'network') xhr.onerror(); else if (fault === 'timeout') xhr.ontimeout(); else if (fault === 'abort') controller.abort();
  else if (fault === 'html') xhr.respond(200, '<!doctype PRIVATE>', 'text/html');
  else if (fault === 'malformed') xhr.respond(201, { private: 'PRIVATE' });
  else xhr.respond(503, { error: { code: 'PRIVATE_PROVIDER', message: 'PRIVATE credentials bucket/key' } });
  await rejected; try { await promise; } catch (error) { expect(error.message).not.toMatch(/PRIVATE|bucket\/key|credentials/); }
  expect(requests).toHaveLength(1);
});
test('does not invalidate another account from an unscoped late 401; the scoped component owns that decision', async () => {
  const listener = jest.fn(); window.addEventListener('giftlink:unauthorized', listener);
  fetch.mockResolvedValue(reply({ error: { code: 'SESSION_EXPIRED', message: 'PRIVATE' } }, 401));
  await expect(readUpload(plan, item, image)).rejects.toMatchObject({ code: 'SESSION_EXPIRED' });
  expect(listener).not.toHaveBeenCalled(); window.removeEventListener('giftlink:unauthorized', listener);
});
test('maps actual quota and stale-revision codes to actionable messages without forwarding private provider strings', () => {
  expect(photoError({ code: 'IMAGE_RECORD_LIMIT', status: 429, message: 'PRIVATE' }).message).toMatch(/waiting does not reset/);
  expect(photoError({ code: 'IMAGE_CHANGED', status: 409 }).message).toMatch(/Refresh photos/);
  expect(photoError({ code: 'IMAGE_DAILY_UPLOADS', status: 429 }).message).toMatch(/UTC/);
});
