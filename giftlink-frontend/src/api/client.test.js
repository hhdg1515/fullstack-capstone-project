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
