import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { AuthProvider } from '../context/AuthContext';
import RequireAuth from './RequireAuth';
import LoginPage from './LoginPage/LoginPage';
import RegisterPage from './RegisterPage/RegisterPage';
import Profile from './Profile/Profile';
import Navbar from './Navbar/Navbar';

const user = { id: 'one', firstName: 'Gift', lastName: 'Giver', email: 'private@example.test' };
const reply = (status, data) => ({ status, ok: status >= 200 && status < 300, json: async () => data });
function renderPage(path) {
  return render(<MemoryRouter initialEntries={[path]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
    <AuthProvider><Navbar /><Routes>
      <Route path="/app/profile" element={<RequireAuth><Profile /></RequireAuth>} />
      <Route path="/app/login" element={<LoginPage />} />
      <Route path="/app/register" element={<RegisterPage />} />
      <Route path="/app" element={<p>Public browsing</p>} />
    </Routes></AuthProvider>
  </MemoryRouter>);
}
beforeEach(() => { global.fetch = jest.fn(); sessionStorage.clear(); });

test('account route waits for validation and redirects an anonymous user to login', async () => {
  fetch.mockResolvedValue(reply(401, { error: { code: 'UNAUTHENTICATED' } }));
  renderPage('/app/profile');
  expect(screen.getAllByRole('status').length).toBeGreaterThan(0);
  expect(await screen.findByRole('heading', { name: 'Login' })).toBeInTheDocument();
  expect(screen.queryByText('Your account')).not.toBeInTheDocument();
});
test('login form submits on Enter/form submission and returns to the requested account page', async () => {
  fetch.mockResolvedValueOnce(reply(401, { error: { code: 'UNAUTHENTICATED' } }))
    .mockResolvedValueOnce(reply(200, { user })).mockResolvedValueOnce(reply(200, { user }));
  renderPage('/app/profile');
  await screen.findByRole('heading', { name: 'Login' });
  fireEvent.change(screen.getByLabelText('Email'), { target: { value: user.email } });
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'test-password' } });
  fireEvent.submit(screen.getByRole('button', { name: 'Login' }).closest('form'));
  expect(await screen.findByRole('heading', { name: 'Your account' })).toBeInTheDocument();
});
test('login displays a server error and restores the submit control', async () => {
  fetch.mockResolvedValueOnce(reply(401, { error: {} })).mockResolvedValueOnce(reply(401, { error: { message: 'Email or password is incorrect' } }));
  renderPage('/app/login'); await waitFor(() => expect(screen.getByRole('button', { name: 'Login' })).toBeEnabled());
  fireEvent.change(screen.getByLabelText('Email'), { target: { value: user.email } });
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'wrong' } });
  fireEvent.submit(screen.getByRole('button', { name: 'Login' }).closest('form'));
  expect(await screen.findByRole('alert')).toHaveTextContent('Email or password is incorrect');
  expect(screen.getByRole('button', { name: 'Login' })).toBeEnabled();
});
test('registration displays duplicate-email errors without storing tokens', async () => {
  fetch.mockResolvedValueOnce(reply(401, { error: {} })).mockResolvedValueOnce(reply(409, { error: { message: 'Email already registered' } }));
  renderPage('/app/register'); await waitFor(() => expect(screen.getByRole('button', { name: 'Register' })).toBeEnabled());
  for (const [label, value] of [['First name', 'Gift'], ['Last name', 'Giver'], ['Email', user.email], ['Password', 'test-password-long']]) {
    fireEvent.change(screen.getByLabelText(label), { target: { value } });
  }
  fireEvent.submit(screen.getByRole('button', { name: 'Register' }).closest('form'));
  expect(await screen.findByRole('alert')).toHaveTextContent('Email already registered');
  expect(sessionStorage.length).toBe(0);
});
test('registration confirms the new session and returns to public browsing', async () => {
  fetch.mockResolvedValueOnce(reply(401, { error: {} })).mockResolvedValueOnce(reply(201, { user })).mockResolvedValueOnce(reply(200, { user }));
  renderPage('/app/register'); await waitFor(() => expect(screen.getByRole('button', { name: 'Register' })).toBeEnabled());
  fireEvent.submit(screen.getByRole('button', { name: 'Register' }).closest('form'));
  expect(await screen.findByText('Public browsing')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Logout' })).toBeInTheDocument();
});
test('account updates use PATCH /me and show server-confirmed values', async () => {
  fetch.mockResolvedValueOnce(reply(200, { user })).mockResolvedValueOnce(reply(200, { user: { ...user, firstName: 'Updated' } }));
  renderPage('/app/profile'); await screen.findByRole('heading', { name: 'Your account' });
  expect(screen.getByText(user.email)).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('First name'), { target: { value: 'Updated' } });
  fireEvent.submit(screen.getByRole('button', { name: 'Save' }).closest('form'));
  expect(await screen.findByText('Account updated.')).toBeInTheDocument();
  expect(JSON.parse(fetch.mock.calls[1][1].body)).toEqual({ firstName: 'Updated', lastName: 'Giver' });
  expect(fetch.mock.calls[1][1].method).toBe('PATCH');
  expect(screen.getByRole('button', { name: 'Welcome, Updated' })).toBeInTheDocument();
});
test('expiry during an account update removes private UI and shows the login message', async () => {
  fetch.mockResolvedValueOnce(reply(200, { user })).mockResolvedValueOnce(reply(401, { error: { code: 'SESSION_EXPIRED', message: 'Please log in again' } }));
  renderPage('/app/profile'); await screen.findByRole('heading', { name: 'Your account' });
  fireEvent.submit(screen.getByRole('button', { name: 'Save' }).closest('form'));
  expect(await screen.findByRole('heading', { name: 'Login' })).toBeInTheDocument();
  expect(screen.queryByText(user.email)).not.toBeInTheDocument();
  expect(screen.getByText('Your session ended. Please log in again.')).toBeInTheDocument();
});
test('logout failure leaves the user signed in and provides retry feedback', async () => {
  fetch.mockResolvedValueOnce(reply(200, { user })).mockRejectedValueOnce(new Error('offline'));
  renderPage('/app/profile'); await screen.findByRole('button', { name: 'Logout' });
  fireEvent.click(screen.getByRole('button', { name: 'Logout' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Logout could not be confirmed');
  expect(screen.getByRole('heading', { name: 'Your account' })).toBeInTheDocument();
});

test('background session checks preserve an unsaved account draft', async () => {
  fetch.mockResolvedValue(reply(200, { user }));
  renderPage('/app/profile'); await screen.findByRole('heading', { name: 'Your account' });
  fireEvent.change(screen.getByLabelText('First name'), { target: { value: 'Unsaved draft' } });
  fireEvent(window, new Event('focus'));
  await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
  expect(screen.getByLabelText('First name')).toHaveValue('Unsaved draft');
});
