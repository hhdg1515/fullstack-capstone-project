import { apiRequest } from './client';

const reply = (status, data) => ({ status, ok: status >= 200 && status < 300, json: async () => data });
beforeEach(() => { global.fetch = jest.fn(); });
afterEach(() => jest.restoreAllMocks());

test('sends cookie credentials and the CSRF header on writes without browser-readable tokens', async () => {
  fetch.mockResolvedValue(reply(200, { user: { id: 'one' } }));
  await apiRequest('/api/me', { method: 'PATCH', body: { firstName: 'Updated' } });
  expect(fetch.mock.calls[0][1]).toEqual({ method: 'PATCH', credentials: 'include', cache: 'no-store',
    headers: { 'Content-Type': 'application/json', 'X-CSRF-Protection': '1' }, body: '{"firstName":"Updated"}' });
});
test('notifies session expiry for a protected request', async () => {
  const listener = jest.fn();
  window.addEventListener('giftlink:unauthorized', listener);
  fetch.mockResolvedValue(reply(401, { error: { code: 'SESSION_EXPIRED', message: 'Session ended' } }));
  await expect(apiRequest('/api/me')).rejects.toMatchObject({ status: 401, code: 'SESSION_EXPIRED' });
  expect(listener).toHaveBeenCalledTimes(1);
  window.removeEventListener('giftlink:unauthorized', listener);
});
test('handles logout without a JSON response', async () => {
  fetch.mockResolvedValue({ status: 204, ok: true });
  await expect(apiRequest('/api/auth/logout', { method: 'POST', body: {} })).resolves.toBeNull();
});
test('reports network failures without logging credentials', async () => {
  fetch.mockRejectedValue(new Error('private request detail'));
  await expect(apiRequest('/api/me')).rejects.toMatchObject({ code: 'NETWORK_ERROR', status: 0,
    message: 'Unable to reach the server. Please try again.' });
});
test.each([200, 401, 404, 502])('rejects HTML with HTTP %s as an unavailable service without reading it as JSON', async status => {
  const json = jest.fn().mockRejectedValue(new SyntaxError('Unexpected token < private HTML'));
  const listener = jest.fn(); window.addEventListener('giftlink:unauthorized', listener);
  try {
    fetch.mockResolvedValue({ status, ok: status < 400, headers: new Headers({ 'Content-Type': 'text/html; charset=utf-8' }), json });
    await expect(apiRequest('/api/me')).rejects.toMatchObject({ status: 503, code: 'SERVICE_UNAVAILABLE' });
    expect(json).not.toHaveBeenCalled(); expect(listener).not.toHaveBeenCalled();
  } finally { window.removeEventListener('giftlink:unauthorized', listener); }
});
test('turns malformed JSON into a safe error without returning null or exposing response contents', async () => {
  fetch.mockResolvedValue({ status: 200, ok: true, headers: new Headers({ 'content-type': 'application/json' }),
    json: async () => { throw new SyntaxError('Unexpected token < private upstream body'); } });
  await expect(apiRequest('/api/me')).rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE', message: 'The service is temporarily unavailable. Please try again later.' });
});
test.each([null, 'upstream proxy', 42, false])('rejects unexpected successful JSON primitive %s', async value => {
  fetch.mockResolvedValue(reply(200, value));
  await expect(apiRequest('/api/me')).rejects.toHaveProperty('code', 'SERVICE_UNAVAILABLE');
});
test('accepts JSON media types and validates successful payloads including unexpected empty responses', async () => {
  fetch.mockResolvedValue({ ...reply(200, { items: [] }), headers: new Headers({ 'content-type': 'application/vnd.example+json; charset=utf-8' }) });
  await expect(apiRequest('/api/items', { validate: data => Array.isArray(data?.items) })).resolves.toEqual({ items: [] });
  fetch.mockResolvedValue(reply(200, {}));
  await expect(apiRequest('/api/items', { validate: data => Array.isArray(data?.items) })).rejects.toHaveProperty('code', 'SERVICE_UNAVAILABLE');
  fetch.mockResolvedValue({ status: 204, ok: true });
  await expect(apiRequest('/api/me', { validate: data => Boolean(data?.user) })).rejects.toHaveProperty('code', 'SERVICE_UNAVAILABLE');
});
