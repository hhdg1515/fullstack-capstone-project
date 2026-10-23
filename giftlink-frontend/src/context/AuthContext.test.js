import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { AuthProvider, useAppContext } from './AuthContext';

const user = { id: 'server-user', firstName: 'Server', lastName: 'User', email: 'own@example.test' };
const reply = (status, data) => ({ status, ok: status >= 200 && status < 300, json: async () => data });
function Consumer() {
  const auth = useAppContext();
  return <>
    <div>{auth.status}:{auth.user?.firstName}</div><p>{auth.error}</p><p>{auth.sessionMessage}</p>
    <button onClick={() => auth.login({ email: user.email, password: 'test-password' }).catch(() => {})}>Sign in</button>
    <button onClick={() => auth.logout().catch(() => {})}>Sign out</button>
    <button onClick={() => auth.refreshSession().catch(() => {})}>Retry</button>
  </>;
}
const renderAuth = () => render(<AuthProvider><Consumer /></AuthProvider>);
beforeEach(() => { global.fetch = jest.fn(); sessionStorage.clear(); });

test('checks the server and clears legacy browser identity instead of trusting it', async () => {
  sessionStorage.setItem('auth-token', 'old-bearer'); sessionStorage.setItem('name', 'Forged');
  let finish;
  fetch.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  renderAuth();
  expect(screen.getByText('loading:')).toBeInTheDocument();
  expect(sessionStorage.getItem('auth-token')).toBeNull();
  finish(reply(200, { user }));
  expect(await screen.findByText('authenticated:Server')).toBeInTheDocument();
  expect(screen.queryByText(/Forged/)).not.toBeInTheDocument();
});
test('confirms the cookie with /me after login and revokes the server session before showing logout', async () => {
  fetch.mockResolvedValueOnce(reply(401, { error: { code: 'UNAUTHENTICATED' } }))
    .mockResolvedValueOnce(reply(200, { user: { firstName: 'Unconfirmed form response' } }))
    .mockResolvedValueOnce(reply(200, { user }))
    .mockResolvedValueOnce(reply(204));
  renderAuth(); await screen.findByText('anonymous:');
  fireEvent.click(screen.getByText('Sign in'));
  await screen.findByText('authenticated:Server');
  expect(fetch.mock.calls[2][0]).toMatch(/\/api\/me$/);
  expect(sessionStorage.getItem('auth-token')).toBeNull();
  fireEvent.click(screen.getByText('Sign out'));
  await screen.findByText('anonymous:');
  expect(fetch.mock.calls[3][0]).toMatch(/\/api\/auth\/logout$/);
});
test('does not claim logout succeeded when the server cannot be reached', async () => {
  fetch.mockResolvedValueOnce(reply(200, { user })).mockRejectedValueOnce(new Error('offline'));
  renderAuth(); await screen.findByText('authenticated:Server');
  fireEvent.click(screen.getByText('Sign out'));
  await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
  expect(screen.getByText('authenticated:Server')).toBeInTheDocument();
});
test('handles expired sessions and server recovery separately', async () => {
  fetch.mockResolvedValueOnce(reply(503, { error: { message: 'Try later' } }))
    .mockResolvedValueOnce(reply(401, { error: { code: 'SESSION_EXPIRED' } }));
  renderAuth(); await screen.findByText('error:');
  expect(screen.getByText('Try later')).toBeInTheDocument();
  fireEvent.click(screen.getByText('Retry'));
  await screen.findByText('anonymous:');
  expect(screen.getByText('Your session ended. Please log in again.')).toBeInTheDocument();
});
test('an unauthorized event invalidates active session state', async () => {
  fetch.mockResolvedValue(reply(200, { user }));
  renderAuth(); await screen.findByText('authenticated:Server');
  fireEvent(window, new Event('giftlink:unauthorized'));
  expect(screen.getByText('anonymous:')).toBeInTheDocument();
});
test('ignores a stale initial session response after logout', async () => {
  let finish;
  fetch.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }))
    .mockResolvedValueOnce(reply(204));
  renderAuth(); fireEvent.click(screen.getByText('Sign out'));
  await screen.findByText('anonymous:');
  finish(reply(200, { user }));
  await waitFor(() => expect(screen.getByText('anonymous:')).toBeInTheDocument());
});

test('server sessions still work when optional legacy browser storage is blocked', async () => {
  const remove = jest.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => { throw new Error('Storage blocked'); });
  fetch.mockResolvedValue(reply(200, { user }));
  try {
    renderAuth();
    expect(await screen.findByText('authenticated:Server')).toBeInTheDocument();
  } finally { remove.mockRestore(); }
});
