import React, { useState } from 'react';
import 'whatwg-fetch';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createMemoryRouter, Link, Route, RouterProvider, Routes, useNavigate } from 'react-router-dom';
import { AuthProvider } from '../context/AuthContext';
import RequireAuth from '../components/RequireAuth';
import Navbar from '../components/Navbar/Navbar';
import { meaningfulChanges, UnsavedChangesProvider, useUnsavedForm } from './UnsavedChanges';

const user = { id: 'owner', firstName: 'Local', lastName: 'Owner', email: 'local@example.invalid' };
const response = (body, status = 200) => ({ ok: status < 400, status, json: async () => body });
function Example() {
  const [name, setName] = useState(''); const [saved, setSaved] = useState('');
  const guard = useUnsavedForm({ name }, { name: saved }); const navigate = useNavigate();
  return <><label>Draft name<input value={name} onChange={event => setName(event.target.value)} /></label>
    <button onClick={() => { guard.markSaved(); setSaved(name); }}>Save locally</button>
    <Link to="/away">Leave</Link><button onClick={() => navigate('/away', { replace: true })}>Replace route</button>
    <button onClick={() => navigate(-1)}>Back</button><OtherDraft /></>;
}
function OtherDraft() {
  const [text, setText] = useState(''); const guard = useUnsavedForm({ text }, { text: '' });
  return <><label>Other draft<input value={text} onChange={event => setText(event.target.value)} /></label>
    <button onClick={() => { if (guard.confirmDiscard()) setText(''); }}>Discard other draft</button></>;
}
function mount(entries = ['/edit']) {
  const router = createMemoryRouter([{ path: '*', element: <AuthProvider><UnsavedChangesProvider><Navbar /><Routes>
    <Route path="/edit" element={<RequireAuth><Example /></RequireAuth>} />
    <Route path="/away" element={<h1>Away</h1>} /><Route path="/app/login" element={<h1>Login</h1>} />
  </Routes></UnsavedChangesProvider></AuthProvider> }], { initialEntries: entries, future: { v7_relativeSplatPath: true } });
  render(<RouterProvider router={router} future={{ v7_startTransition: true }} />); return router;
}
beforeEach(() => {
  global.fetch = jest.fn(async url => response(url.endsWith('/api/me') ? { user } : { error: { message: 'Not available' } }, url.endsWith('/api/me') ? 200 : 503));
  jest.spyOn(window, 'confirm').mockReturnValue(false);
});
afterEach(() => jest.restoreAllMocks());

test('only meaningful fields differ; password whitespace remains meaningful', () => {
  expect(meaningfulChanges({ name: '  ' }, { name: '' })).toBe(false);
  expect(meaningfulChanges({ name: ' Desk ' }, { name: 'Desk' })).toBe(false);
  expect(meaningfulChanges({ password: ' ' }, { password: '' })).toBe(true);
});
test.each(['Leave', 'Replace route', 'Back'])('rejecting %s keeps the same draft; accepting leaves exactly once', async action => {
  const router = mount(['/away', '/edit']); const input = await screen.findByLabelText('Draft name');
  fireEvent.change(input, { target: { value: 'Meaningful private edit' } });
  fireEvent.click(action === 'Leave' ? screen.getByRole('link', { name: action }) : screen.getByRole('button', { name: action }));
  await waitFor(() => expect(window.confirm).toHaveBeenCalledTimes(1));
  expect(router.state.location.pathname).toBe('/edit'); expect(input).toHaveValue('Meaningful private edit');
  window.confirm.mockReturnValue(true);
  fireEvent.click(action === 'Leave' ? screen.getByRole('link', { name: action }) : screen.getByRole('button', { name: action }));
  expect(await screen.findByRole('heading', { name: 'Away' })).toBeInTheDocument();
  expect(window.confirm).toHaveBeenCalledTimes(2);
});
test('beforeunload is cancelled only while meaningful edits remain; saved edits do not warn or persist', async () => {
  const storage = jest.spyOn(Storage.prototype, 'setItem'); mount();
  const input = await screen.findByLabelText('Draft name');
  const unload = () => { const event = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(event); return event.defaultPrevented; };
  expect(unload()).toBe(false); fireEvent.change(input, { target: { value: '  ' } }); expect(unload()).toBe(false);
  fireEvent.change(input, { target: { value: 'Private draft' } }); expect(unload()).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: 'Save locally' })); expect(unload()).toBe(false);
  fireEvent.click(screen.getByRole('link', { name: 'Leave' })); await screen.findByRole('heading', { name: 'Away' });
  expect(window.confirm).not.toHaveBeenCalled(); expect(storage).not.toHaveBeenCalled();
});
test('session invalidation cannot be held open by a private dirty form', async () => {
  mount(); fireEvent.change(await screen.findByLabelText('Draft name'), { target: { value: 'Private draft' } });
  act(() => window.dispatchEvent(new Event('giftlink:unauthorized')));
  expect(await screen.findByRole('heading', { name: 'Login' })).toBeInTheDocument();
  expect(screen.queryByLabelText('Draft name')).not.toBeInTheDocument(); expect(window.confirm).not.toHaveBeenCalled();
});
test('cancelled logout makes no write; failed logout retains protection', async () => {
  mount(); fireEvent.change(await screen.findByLabelText('Draft name'), { target: { value: 'Private draft' } });
  fireEvent.click(screen.getByRole('button', { name: 'Logout' }));
  expect(fetch.mock.calls.every(([, options]) => options.method === 'GET')).toBe(true);
  window.confirm.mockReturnValue(true); fireEvent.click(screen.getByRole('button', { name: 'Logout' }));
  await waitFor(() => expect(screen.getByText('Logout could not be confirmed. Please try again.')).toBeInTheDocument());
  window.confirm.mockReturnValue(false); fireEvent.click(screen.getByRole('link', { name: 'Leave' }));
  await waitFor(() => expect(window.confirm).toHaveBeenCalledTimes(3));
  expect(screen.getByLabelText('Draft name')).toHaveValue('Private draft');
});

test('discarding one local form leaves another form’s meaningful edits protected', async () => {
  const router = mount(); fireEvent.change(await screen.findByLabelText('Draft name'), { target: { value: 'Keep this conversation draft' } });
  fireEvent.change(screen.getByLabelText('Other draft'), { target: { value: 'Discard this time draft' } });
  window.confirm.mockReturnValue(true); fireEvent.click(screen.getByRole('button', { name: 'Discard other draft' }));
  expect(screen.getByLabelText('Other draft')).toHaveValue(''); expect(window.confirm).toHaveBeenCalledTimes(1);
  window.confirm.mockReturnValue(false); fireEvent.click(screen.getByRole('link', { name: 'Leave' }));
  await waitFor(() => expect(window.confirm).toHaveBeenCalledTimes(2)); expect(router.state.location.pathname).toBe('/edit');
  expect(screen.getByLabelText('Draft name')).toHaveValue('Keep this conversation draft');
});
