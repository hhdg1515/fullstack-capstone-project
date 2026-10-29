import { apiRequest, ApiError } from './client';
import { urlConfig } from '../config';

export const PHOTO_BYTES = 3 * 1024 * 1024;
const id = value => typeof value === 'string' && /^[a-f0-9]{24}$/i.test(value);
const uuid = value => typeof value === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(value);
const integer = value => Number.isSafeInteger(value) && value >= 0;
export const validOperation = value => value && id(value.id) && ['reserved', 'processing', 'ready', 'failed', 'delete_pending', 'deleted'].includes(value.state) &&
  typeof value.cleanupPending === 'boolean' && typeof value.reservationExpired === 'boolean' && Number.isFinite(Date.parse(value.createdAt));
export const validReady = value => validOperation(value) && value.state === 'ready' && integer(value.sortPosition) && value.sortPosition < 5 &&
  ['thumbnail', 'display'].every(name => value[name]?.contentType === 'image/webp' && integer(value[name].width) && value[name].width >= 1 &&
    integer(value[name].height) && value[name].height >= 1 && Math.max(value[name].width, value[name].height) <= (name === 'thumbnail' ? 400 : 1280));
export const validPhotoOrder = images => Array.isArray(images) && images.length <= 5 && new Set(images.map(image => image?.id)).size === images.length && images.every((image, index) => validReady(image) && image.sortPosition === index);
export const validMetadata = value => value && integer(value.imageRevision) && Array.isArray(value.images) && value.images.length <= 5 && validPhotoOrder(value.images) &&
  Array.isArray(value.uploads) && value.uploads.length <= 25 && value.uploads.every(validOperation) &&
  value.capabilities?.metadata === true && typeof value.capabilities.binaryUpload === 'boolean' && typeof value.capabilities.imageRead === 'boolean' &&
  value.limits?.photos === 5 && value.limits.inputBytes === PHOTO_BYTES && ['attempts', 'successes', 'accountBytes', 'concurrent', 'records'].every(key => integer(value.limits[key])) &&
  ['itemSlots', 'attempts', 'successes', 'storageBytes', 'concurrent', 'records'].every(key => integer(value.allowance?.[key])) && typeof value.allowance.newUploadsAllowed === 'boolean';
const validStatus = value => value && integer(value.imageRevision) && validOperation(value.upload);
const messages = {
  IMAGE_ITEM_LIMIT: 'All 5 photo spaces are used or held. Check pending uploads.',
  IMAGE_DAILY_ATTEMPTS: 'Daily attempt limit reached. Try after midnight UTC.',
  IMAGE_DAILY_UPLOADS: 'Daily allowance used or held. Try after midnight UTC.',
  IMAGE_STORAGE_CAPACITY: 'Photo storage is full or held. Contact support if this continues.',
  IMAGE_UPLOAD_CAPACITY: 'Uploads are pending. Check status before trying again.',
  IMAGE_RECORD_LIMIT: 'Photo history limit reached. Contact support.',
  IMAGE_CHANGED: 'Photos changed. Refresh and try again.',
  IMAGE_INTENT_CHANGED: 'This upload no longer matches. Check status first.',
  IMAGE_INPUT_INVALID: "Couldn't upload this photo. Try another JPEG, PNG or WebP.",
  IMAGE_INTENT_MISMATCH: 'The file changed. Check status, then choose it again.',
  IMAGE_UPLOAD_UNAVAILABLE: 'Update the plan and pickup dates to add photos.',
  IMAGE_UPLOAD_UNCERTAIN: 'Upload not confirmed. Check status.',
  IMAGE_PIPELINE_TIMEOUT: 'Upload timed out. Check status before continuing.',
  IMAGE_METADATA_INVALID: 'Photo status needs review. Contact support; limits may still apply.',
  IMAGE_PROCESSOR_BUSY: 'Photo processing is busy. Check status before trying again.',
  IMAGE_CONTROL_LIMIT: 'Too many requests. Wait a minute, then check status.',
  SESSION_EXPIRED: 'Session ended. Log in again.', UNAUTHENTICATED: 'Please log in again.',
  IMAGE_UNAVAILABLE: 'Photo unavailable. Refresh inventory.',
  CSRF_REJECTED: 'Session could not be confirmed. Reload and log in again.',
  FILE_UNSUPPORTED: 'Use JPEG, PNG or WebP. Convert HEIC to JPEG.',
  FILE_SIZE: 'Choose a nonempty photo up to 3 MiB.',
  BROWSER_UNSUPPORTED: 'Use a current browser over HTTPS or localhost.',
  REQUEST_ABORTED: 'Upload stopped. Check status before continuing.',
  NOT_FOUND: 'Photo uploads are unavailable.'
};
export function photoError(error, writing = false) {
  const code = Object.hasOwn(messages, error?.code) ? error.code : 'PHOTO_SERVICE_UNAVAILABLE';
  const result = new ApiError(messages[code] || 'Photo service unavailable. Refresh or check upload status.',
    Number.isInteger(error?.status) ? error.status : 0, code, undefined, undefined, error?.retryAfterSeconds);
  result.uncertain = writing && (result.status === 0 || result.status >= 500 || code === 'PHOTO_SERVICE_UNAVAILABLE');
  return result;
}
const localError = code => photoError({ code, status: 400 });
const root = (planId, itemId) => {
  if (!id(planId) || !id(itemId)) throw localError('IMAGE_UNAVAILABLE');
  return `/api/move-out-plans/${planId}/items/${itemId}/images`;
};
async function json(path, options = {}) {
  try { return await apiRequest(path, { ...options, notifyUnauthorized: false }); }
  catch (error) { throw photoError(error, options.method === 'POST'); }
}
export const readPhotos = (planId, itemId) => json(root(planId, itemId), { validate: validMetadata });
export function readUpload(planId, itemId, operationId, clientUploadId) {
  if (!id(operationId) && !uuid(clientUploadId)) throw localError('IMAGE_UNAVAILABLE');
  return json(root(planId, itemId) + (id(operationId) ? '/' + operationId : '/uploads/' + clientUploadId), { validate: validStatus });
}
export const reservePhoto = (planId, itemId, intent) => json(root(planId, itemId) + '/uploads', {
  method: 'POST', body: { imageRevision: intent.imageRevision, clientUploadId: intent.clientUploadId, byteLength: intent.byteLength, sha256: intent.sha256 }, validate: validStatus
});
export function reorderPhotos(planId, itemId, imageRevision, imageIds) {
  if (!integer(imageRevision) || !Array.isArray(imageIds) || imageIds.length > 5 || !imageIds.every(id) || new Set(imageIds).size !== imageIds.length) throw localError('IMAGE_UNAVAILABLE');
  return json(root(planId, itemId) + '/order', { method: 'POST', body: { imageRevision, imageIds },
    validate: value => value && integer(value.imageRevision) && validPhotoOrder(value.images) && value.images.map(image => image.id).join(',') === imageIds.join(',') });
}
export function deletePhoto(planId, itemId, imageId, imageRevision) {
  if (!id(imageId) || !integer(imageRevision)) throw localError('IMAGE_UNAVAILABLE');
  return json(root(planId, itemId) + '/' + imageId + '/actions', { method: 'POST', body: { imageRevision, action: 'delete' },
    validate: value => validStatus(value) && value.upload.id === imageId && ['delete_pending', 'deleted'].includes(value.upload.state) });
}
export function selectionError(file) {
  if (!file || !integer(file.size) || file.size < 1 || file.size > PHOTO_BYTES) return messages.FILE_SIZE;
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) && !(file.type === '' && /\.(jpe?g|png|webp)$/i.test(file.name))) return messages.FILE_UNSUPPORTED;
  return '';
}
export const securePhotoBrowser = () => typeof window.crypto?.subtle?.digest === 'function' && typeof window.crypto?.randomUUID === 'function';
export function uploadId() { if (!securePhotoBrowser()) throw localError('BROWSER_UNSUPPORTED'); return window.crypto.randomUUID(); }
export async function fileDigest(file) {
  const problem = selectionError(file); if (problem) throw localError(problem === messages.FILE_SIZE ? 'FILE_SIZE' : 'FILE_UNSUPPORTED');
  if (!securePhotoBrowser()) throw localError('BROWSER_UNSUPPORTED');
  let bytes;
  try {
    bytes = file.arrayBuffer ? await file.arrayBuffer() : await new Promise((resolve, reject) => {
      const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = () => reject(localError('FILE_UNSUPPORTED')); reader.readAsArrayBuffer(file);
    });
    const result = await window.crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(result), value => value.toString(16).padStart(2, '0')).join('');
  } finally { if (bytes) new Uint8Array(bytes).fill(0); }
}
export const photoUrl = imageId => { if (!id(imageId)) throw localError('IMAGE_UNAVAILABLE'); return `${urlConfig.backendUrl}/api/item-images/${imageId}/thumbnail`; };

export function uploadPhoto(planId, itemId, operationId, file, { signal, onProgress = () => {} } = {}) {
  if (!id(operationId)) return Promise.reject(localError('IMAGE_UNAVAILABLE'));
  const problem = selectionError(file);
  if (problem) return Promise.reject(localError(problem === messages.FILE_SIZE ? 'FILE_SIZE' : 'FILE_UNSUPPORTED'));
  const path = root(planId, itemId) + '/' + operationId + '/content';
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest(); let settled = false;
    const stop = () => xhr.abort();
    const finish = (error, result) => {
      if (settled) return; settled = true; signal?.removeEventListener('abort', stop);
      if (error) reject(photoError(error, true)); else resolve(result);
    };
    xhr.open('PUT', `${urlConfig.backendUrl}${path}`); xhr.withCredentials = true; xhr.timeout = 45000;
    xhr.setRequestHeader('X-CSRF-Protection', '1'); // Browser supplies multipart boundary and Origin.
    xhr.upload.onprogress = event => {
      if (!settled && event.lengthComputable && event.total > 0) onProgress(Math.min(99, Math.floor(event.loaded * 100 / event.total)), false);
    };
    xhr.upload.onload = () => { if (!settled) onProgress(100, true); };
    xhr.onerror = () => finish({ status: 0 });
    xhr.ontimeout = () => finish({ code: 'IMAGE_PIPELINE_TIMEOUT', status: 0 });
    xhr.onabort = () => finish({ code: 'REQUEST_ABORTED', status: 0 });
    xhr.onprogress = event => { if (event.loaded > 65536) { finish({ status: 503 }); xhr.abort(); } };
    xhr.onload = () => {
      let data;
      try {
        if (!/^application\/json(?:\s*;|$)/i.test(xhr.getResponseHeader('Content-Type') || '') || xhr.responseText.length > 65536) throw Error();
        data = JSON.parse(xhr.responseText);
      } catch { finish({ status: 503 }); return; }
      if (xhr.status < 200 || xhr.status >= 300) { finish({ status: xhr.status, code: data?.error?.code, retryAfterSeconds: data?.error?.retryAfterSeconds }); return; }
      const operation = data?.image || data?.upload;
      if (!validOperation(operation) || !integer(data.imageRevision) || !['ready', 'processing'].includes(operation.state)) { finish({ status: 503 }); return; }
      finish(null, { ...data, upload: operation });
    };
    signal?.addEventListener('abort', stop, { once: true });
    if (signal?.aborted) { finish({ status: 0, code: 'REQUEST_ABORTED' }); return; }
    const body = new FormData(); body.append('file', file, 'photo.bin');
    try { xhr.send(body); } catch { finish({ status: 0 }); }
  });
}
