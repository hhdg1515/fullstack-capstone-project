import { urlConfig } from '../config';

export class ApiError extends Error {
  constructor(message, status, code, fields) {
    super(message);
    this.status = status;
    this.code = code;
    this.fields = fields;
  }
}

export async function apiRequest(path, { method = 'GET', body, notifyUnauthorized = true } = {}) {
  let response;
  try {
    response = await fetch(`${urlConfig.backendUrl}${path}`, {
      method, credentials: 'include', cache: 'no-store',
      headers: method === 'GET' ? {} : { 'Content-Type': 'application/json', 'X-CSRF-Protection': '1' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  } catch {
    throw new ApiError('Unable to reach the server. Please try again.', 0, 'NETWORK_ERROR');
  }
  const data = response.status === 204 ? null : await response.json().catch(() => null);
  if (!response.ok) {
    if (response.status === 401 && notifyUnauthorized) {
      window.dispatchEvent(new Event('giftlink:unauthorized'));
    }
    throw new ApiError(data?.error?.message || 'Request failed. Please try again.', response.status,
      data?.error?.code, data?.error?.fields);
  }
  return data;
}
