import { photoHeader, preparePhoto, sourcePhotoError, SOURCE_BYTES, OUTPUT_BYTES } from './photoPreparation';
const png = (width = 4032, height = 3024) => {
  const bytes = new Uint8Array(45); bytes.set([137, 80, 78, 71, 13, 10, 26, 10]); bytes.set([73, 72, 68, 82], 12);
  const view = new DataView(bytes.buffer); view.setUint32(8, 13); bytes.set([73, 68, 65, 84], 37); view.setUint32(16, width); view.setUint32(20, height); return bytes;
};
const source = (data = png(), type = 'image/png') => new File([data], 'private-address.png', { type });
let bitmap, canvas, draw, encode;
beforeEach(() => {
  bitmap = { width: 4032, height: 3024, close: jest.fn() }; window.createImageBitmap = jest.fn(async () => bitmap);
  draw = jest.fn(); encode = jest.fn(callback => callback(new Blob(['derived pixels'], { type: 'image/webp' })));
  canvas = { width: 0, height: 0, getContext: () => ({ drawImage: draw }), toBlob: encode };
  const create = document.createElement.bind(document); jest.spyOn(document, 'createElement').mockImplementation(tag => tag === 'canvas' ? canvas : create(tag));
});
afterEach(() => { jest.restoreAllMocks(); jest.useRealTimers(); });
test('prepares an ordinary large phone photo into a new bounded derivative, never returning the original', async () => {
  const file = source(new Blob([png(), new Uint8Array(4 * 1024 * 1024)]));
  expect(file.size).toBeGreaterThan(OUTPUT_BYTES); const result = await preparePhoto(file);
  expect(result).not.toBe(file); expect(result.name).toBe('photo.webp'); expect(result.type).toBe('image/webp'); expect(result.size).toBeLessThanOrEqual(OUTPUT_BYTES);
  expect(draw).toHaveBeenCalledWith(bitmap, 0, 0, 1280, 960); expect(bitmap.close).toHaveBeenCalledTimes(1); expect(canvas.width).toBe(0);
  expect(window.createImageBitmap).toHaveBeenCalledWith(file, { imageOrientation: 'from-image' });
});
test('uses the decoder orientation when scaling portrait photos and preserves alpha-capable encoding', async () => {
  bitmap.width = 3024; bitmap.height = 4032; await preparePhoto(source());
  expect(draw).toHaveBeenCalledWith(bitmap, 0, 0, 960, 1280); expect(encode.mock.calls[0][1]).toBe('image/webp');
});
test.each([[0, 100], [10001, 10], [9000, 9000]])('rejects unsafe header dimensions %s x %s before native decoding', async (width, height) => {
  await expect(preparePhoto(source(png(width, height)))).rejects.toThrow(/too large/); expect(window.createImageBitmap).not.toHaveBeenCalled();
});
test('rejects unsupported HEIC, empty sources and source bytes beyond the local bound', async () => {
  expect(sourcePhotoError(source([], 'image/heic'))).toMatch(/nonempty/);
  expect(sourcePhotoError(source(['heic'], 'image/heic'))).toMatch(/Convert HEIC/);
  expect(sourcePhotoError({ size: SOURCE_BYTES + 1, type: 'image/png' })).toMatch(/20 MiB/);
  await expect(preparePhoto(source(['heic'], 'image/heic'))).rejects.toThrow(/Convert HEIC/); expect(window.createImageBitmap).not.toHaveBeenCalled();
});
test('does not decode a fake raster header and never falls back to the original', async () => {
  await expect(preparePhoto(source(['<svg>not a png</svg>']))).rejects.toThrow(/Export/); expect(window.createImageBitmap).not.toHaveBeenCalled();
});
test('fails cleanly when decoding or canvas encoding fails', async () => {
  window.createImageBitmap.mockRejectedValueOnce(Error('private browser internals'));
  await expect(preparePhoto(source())).rejects.toThrow(/Couldn.t prepare/);
  encode.mockImplementation(callback => callback(null)); await expect(preparePhoto(source())).rejects.toThrow(/Couldn.t prepare/); expect(bitmap.close).toHaveBeenCalled();
});
test('bounds repeated compression attempts and rejects outputs still over the wire cap', async () => {
  encode.mockImplementation(callback => callback(new Blob([new Uint8Array(OUTPUT_BYTES + 1)], { type: 'image/webp' })));
  await expect(preparePhoto(source())).rejects.toThrow(/still too large/); expect(encode).toHaveBeenCalledTimes(3);
  expect(draw.mock.calls.every(call => Math.max(call[3], call[4]) <= 1280)).toBe(true); expect(bitmap.close).toHaveBeenCalled();
});
test('accepts a bounded canvas PNG fallback for browsers without WebP encoding, never an original fallback', async () => {
  encode.mockImplementation(callback => callback(new Blob(['canvas png'], { type: 'image/png' })));
  const file = source(); const result = await preparePhoto(file); expect(result.type).toBe('image/png'); expect(result.name).toBe('photo.png'); expect(result).not.toBe(file);
});
test('fails closed without createImageBitmap support', async () => {
  window.createImageBitmap = undefined; await expect(preparePhoto(source())).rejects.toThrow(/current browser/);
});
test('reads bounded JPEG and WebP dimensions without decoding or trusting the file extension', () => {
  const jpeg = new Uint8Array([255,216,255,192,0,8,8,1,44,1,144,3]);
  expect(photoHeader(jpeg.buffer)).toMatchObject({ width: 400, height: 300, type: 'image/jpeg' });
  const webp = new Uint8Array(30); webp.set([82,73,70,70],0); webp.set([87,69,66,80,86,80,56,88],8); new DataView(webp.buffer).setUint32(16,10,true);
  webp[24]=143;webp[25]=1;webp[27]=43;webp[28]=1;
  expect(photoHeader(webp.buffer)).toMatchObject({width:400,height:300,type:'image/webp'});
  webp[20]=2;expect(()=>photoHeader(webp.buffer)).toThrow(/still photo/);
});

test('rejects an APNG animation before decoding rather than silently flattening it', async () => {
  const header = png(); header.set([97, 99, 84, 76], 37);
  await expect(preparePhoto(source(header))).rejects.toThrow(/still photo/); expect(window.createImageBitmap).not.toHaveBeenCalled();
});
