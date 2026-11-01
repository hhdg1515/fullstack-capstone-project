import { apiRequest } from './client';

const object = value => value && typeof value === 'object' && !Array.isArray(value);
const item = value => object(value) && typeof value.id === 'string' && typeof value.name === 'string' &&
  Number.isSafeInteger(value.version) && object(value.capabilities) && object(value.location) && object(value.pickup);
const itemEnvelope = value => object(value) && item(value.item);
const listEnvelope = value => object(value) && Array.isArray(value.items) && value.items.every(item) &&
  (value.nextCursor === null || typeof value.nextCursor === 'string');
const pathFor = id => `/api/me/items/${encodeURIComponent(id)}`;

export function listOwnerListings({ cursor, status, limit } = {}) {
  const query = new URLSearchParams();
  if (cursor) query.set('cursor', cursor);
  if (status) query.set('status', status);
  if (limit !== undefined) query.set('limit', String(limit));
  return apiRequest(`/api/me/items${query.toString() ? `?${query}` : ''}`, { validate: listEnvelope });
}
export const getOwnerListing = id => apiRequest(pathFor(id), { validate: itemEnvelope });
export const createOwnerListing = body => apiRequest('/api/items', { method: 'POST', body, validate: itemEnvelope });
export const updateOwnerListing = (id, body) => apiRequest(`/api/items/${encodeURIComponent(id)}`, { method: 'PATCH', body, validate: itemEnvelope });
