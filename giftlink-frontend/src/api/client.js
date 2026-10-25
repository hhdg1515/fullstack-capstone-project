import { urlConfig } from '../config';

export class ApiError extends Error {
  constructor(message, status, code, fields, conflicts) {
    super(message);
    this.status = status;
    this.code = code;
    this.fields = fields;
    this.conflicts = conflicts;
  }
}

const unavailable = () => new ApiError('The service is temporarily unavailable. Please try again later.', 503, 'SERVICE_UNAVAILABLE');
const timedOut = () => new ApiError('The request timed out. Refresh to check the latest state before trying again.', 0, 'REQUEST_TIMEOUT');

export async function apiRequest(path, { method = 'GET', body, notifyUnauthorized = true, validate } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    let response;
    try {
      response = await fetch(`${urlConfig.backendUrl}${path}`, {
        method, credentials: 'include', cache: 'no-store', signal: controller.signal,
        headers: method === 'GET' ? {} : { 'Content-Type': 'application/json', 'X-CSRF-Protection': '1' },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    } catch {
      if (controller.signal.aborted) throw timedOut();
      throw new ApiError('Unable to reach the server. Please try again.', 0, 'NETWORK_ERROR');
    }
    let data = null;
    if (response.status !== 204) {
      const contentType = response.headers?.get('content-type');
      // A frontend-only host may rewrite /api/* to index.html, even with status 200.
      if (contentType && !/^application\/(?:[\w.+-]+\+)?json(?:\s*;|$)/i.test(contentType)) throw unavailable();
      try { data = await response.json(); }
      catch { if (controller.signal.aborted) throw timedOut(); throw unavailable(); }
      if (!data || typeof data !== 'object') throw unavailable();
    }
    if (!response.ok) {
      if (response.status === 401 && notifyUnauthorized) window.dispatchEvent(new Event('giftlink:unauthorized'));
      throw new ApiError(typeof data?.error?.message === 'string' ? data.error.message : 'Request failed. Please try again.', response.status,
        data?.error?.code, data?.error?.fields, data?.error?.conflicts);
    }
    if (validate && !validate(data)) throw unavailable();
    return data;
  } finally {
    clearTimeout(timer);
  }
}
