import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { AuthProvider } from '../../context/AuthContext';
import RequireAuth from '../RequireAuth';
import LoginPage from '../LoginPage/LoginPage';
import PublicItems from '../Inventory/PublicItems';
import { RequestPickup, PickupDashboard, PickupDetail } from './Pickups';
import { confirmPickupChanges } from '../../api/confirmPickupChanges';

const user = { id: 'receiver', firstName: 'Reader' };
const item = { id: '64a000000000000000000001', name: 'Kitchen box', description: 'One whole box.', city: 'Oakland', neighborhood: 'Temescal',
  pickupTimeZone: 'Asia/Kolkata', availableFrom: '2030-07-01', effectiveAvailableUntil: '2030-07-03', availability: 'later' };
const base = { id: '64a000000000000000000002', role: 'receiver', status: 'pending', version: 1, note: 'Meet by the library', item,
  proposedAt: '2030-07-01T09:00:00.000Z', localDateTime: '2030-07-01T14:30', timeZone: 'Asia/Kolkata', counterpart: { firstName: 'Giver' },
  history: [{ action: 'pending', actor: 'receiver', at: '2026-01-01T00:00:00Z' }] };
const response = (data, status = 200) => ({ ok: status < 400, status, json: async () => data });
const error = (message, code, status = 409) => response({ error: { message, code } }, status);
const click = element => act(async () => { fireEvent.click(element); });
const submit = element => act(async () => { fireEvent.submit(element); });
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { resolve, promise }; };
function mount(path = '/app/items/' + item.id + '/request') {
  return render(<MemoryRouter initialEntries={[path]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}><AuthProvider><Routes>
    <Route path="/app/items/:itemId/request" element={<RequireAuth><RequestPickup /></RequireAuth>} />
    <Route path="/app/items/:itemId" element={<PublicItems />} />
    <Route path="/app/pickups" element={<RequireAuth><PickupDashboard key="sent" /></RequireAuth>} />
    <Route path="/app/pickups/incoming" element={<RequireAuth><PickupDashboard key="incoming" incoming /></RequireAuth>} />
    <Route path="/app/pickups/:requestId" element={<RequireAuth><PickupDetail /></RequireAuth>} />
    <Route path="/app/login" element={<LoginPage />} />
  </Routes></AuthProvider></MemoryRouter>);
}
beforeEach(() => {
  global.fetch = jest.fn(async url => {
    if (url.endsWith('/api/me')) return response({ user });
    if (url.includes('/api/items/')) return response({ item });
    return response({ request: base, requests: [], nextCursor: null });
  });
  jest.spyOn(window, 'confirm').mockReturnValue(true);
});
afterEach(() => jest.restoreAllMocks());

test('anonymous receivers go to login before fetching the private pickup form', async () => {
  fetch.mockResolvedValueOnce(error('Sign in', 'UNAUTHENTICATED', 401)); mount();
  expect(await screen.findByRole('heading', { name: 'Login' })).toBeInTheDocument();
  expect(fetch).toHaveBeenCalledTimes(1); expect(screen.queryByLabelText('Pickup date and time')).not.toBeInTheDocument();
});
test('public details offer a real request action while browsing stays anonymous', async () => {
  fetch.mockImplementation(async url => url.endsWith('/api/me') ? error('Sign in', 'UNAUTHENTICATED', 401) : response({ item }));
  mount('/app/items/' + item.id);
  await click(await screen.findByRole('link', { name: 'Request pickup' }));
  expect(await screen.findByRole('heading', { name: 'Login' })).toBeInTheDocument();
});
test('form uses the giver timezone explicitly, never prepopulates browser local time, and sends no identities', async () => {
  mount(); const control = await screen.findByLabelText('Pickup date and time');
  expect(control).toHaveValue(''); expect(screen.getByText('Asia/Kolkata')).toBeInTheDocument();
  expect(screen.getByText(/does not reserve/)).toBeInTheDocument();
  fireEvent.change(control, { target: { value: '2030-07-01T14:30' } });
  fireEvent.change(screen.getByLabelText('Coordination note (optional, private)'), { target: { value: ' Meet by the library ' } });
  await submit(screen.getByRole('button', { name: 'Send pickup request' }).closest('form'));
  expect(await screen.findByRole('heading', { name: 'Pickup request' })).toBeInTheDocument();
  const [, options] = fetch.mock.calls.find(([, options]) => options.method === 'POST');
  expect(JSON.parse(options.body)).toEqual({ itemId: item.id, localDateTime: '2030-07-01T14:30', timeZone: 'Asia/Kolkata', note: 'Meet by the library' });
  expect(options.headers['X-CSRF-Protection']).toBe('1'); expect(options.credentials).toBe('include');
});
test('missing giver timezone prevents request submission without guessing another zone', async () => {
  fetch.mockImplementation(async url => response(url.endsWith('/api/me') ? { user } : { item: { ...item, pickupTimeZone: null } }));
  mount(); expect(await screen.findByRole('alert')).toHaveTextContent('giver must set a pickup timezone');
  expect(screen.queryByRole('button', { name: 'Send pickup request' })).not.toBeInTheDocument();
});
test.each(['INVALID_APPOINTMENT', 'OUTSIDE_PICKUP_WINDOW', 'ITEM_RESERVED', 'DUPLICATE_PICKUP', 'LISTING_UNAVAILABLE'])('form preserves the draft on %s', async code => {
  fetch.mockImplementation(async (url, options) => options.method === 'POST' ? error('Review the pickup time or listing.', code) : response(url.endsWith('/api/me') ? { user } : { item }));
  mount(); fireEvent.change(await screen.findByLabelText('Pickup date and time'), { target: { value: '2030-07-01T14:30' } });
  await submit(screen.getByRole('button', { name: 'Send pickup request' }).closest('form'));
  expect(await screen.findByRole('alert')).toHaveTextContent('Review the pickup time or listing.');
  expect(screen.getByLabelText('Pickup date and time')).toHaveValue('2030-07-01T14:30');
});
test('private dashboards provide loading, empty/error/retry and role navigation', async () => {
  const pending = deferred(); fetch.mockImplementation(url => url.endsWith('/api/me') ? Promise.resolve(response({ user })) : pending.promise);
  mount('/app/pickups/incoming'); expect(await screen.findByText('Loading pickup requests…')).toBeInTheDocument();
  await act(async () => pending.resolve(error('Temporary failure', 'FAILED', 503)));
  expect(await screen.findByRole('alert')).toHaveTextContent('Temporary failure');
  fetch.mockResolvedValue(response({ requests: [], nextCursor: null })); await click(screen.getByRole('button', { name: 'Retry requests' }));
  expect(await screen.findByText('No pickup requests here yet.')).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'My requests as receiver' })).toHaveAttribute('href', '/app/pickups');
});
test('giver dashboard displays appointment timezone and plan, and filters accepted appointments with bounded next pages', async () => {
  fetch.mockImplementation(async url => response(url.endsWith('/api/me') ? { user } : { requests: [{ ...base, role: 'giver', plan: { id: 'plan', title: 'Summer move' } }], nextCursor: base.id }));
  mount('/app/pickups/incoming'); expect(await screen.findByRole('link', { name: 'Kitchen box' })).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Summer move' })).toHaveAttribute('href', '/app/plans/plan');
  expect(screen.getByText('Asia/Kolkata')).toBeInTheDocument(); expect(screen.getByText(/2:30 PM/)).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('Request status'), { target: { value: 'accepted' } });
  await waitFor(() => expect(fetch.mock.calls.some(([url]) => url.includes('received?status=accepted'))).toBe(true));
  await click(await screen.findByRole('button', { name: 'Next requests' }));
  await waitFor(() => expect(fetch.mock.calls.some(([url]) => url.includes(`cursor=${base.id}&status=accepted`))).toBe(true));
  expect(await screen.findByRole('button', { name: 'First page' })).toBeInTheDocument();
});
test('receiver private detail retains full item and private note without giver controls or internal identities', async () => {
  mount('/app/pickups/' + base.id);
  expect(await screen.findByText('Meet by the library')).toBeInTheDocument(); expect(screen.getByText('One whole box.')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Cancel request' })).toBeInTheDocument();
  for (const name of ['Accept pickup', 'Decline request', 'Confirm handoff', 'Record no-show']) expect(screen.queryByRole('button', { name })).not.toBeInTheDocument();
});
test('giver accepts using the current version after confirmation and sees appointment outcome controls', async () => {
  let current = { ...base, role: 'giver' };
  fetch.mockImplementation(async (url, options) => {
    if (options.method === 'POST') current = { ...current, status: 'accepted', version: 2 };
    return response(url.endsWith('/api/me') ? { user } : { request: current });
  });
  mount('/app/pickups/' + base.id); await click(await screen.findByRole('button', { name: 'Accept pickup' }));
  expect(await screen.findByText('Accepted appointment')).toBeInTheDocument();
  const [, options] = fetch.mock.calls.find(([, options]) => options.method === 'POST'); expect(JSON.parse(options.body)).toEqual({ action: 'accept', version: 1 });
  expect(window.confirm).toHaveBeenCalled(); expect(screen.getByRole('button', { name: 'Record no-show' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Confirm handoff' })).toBeDisabled();
});
test.each([['complete', 'Confirm handoff', 'completed', 'Handed over'], ['no_show', 'Record no-show', 'no_show', 'Receiver did not arrive'], ['cancel', 'Cancel request', 'cancelled', 'Cancelled']])('accepted appointment supports %s after its time', async (action, label, status, statusText) => {
  let current = { ...base, role: 'giver', status: 'accepted', version: 2, proposedAt: '2020-01-01T00:00:00Z' };
  fetch.mockImplementation(async (url, options) => {
    if (options.method === 'POST') current = { ...current, status, version: 3 };
    return response(url.endsWith('/api/me') ? { user } : { request: current });
  });
  mount('/app/pickups/' + base.id); await click(await screen.findByRole('button', { name: label }));
  expect(await screen.findByText(statusText)).toBeInTheDocument();
  expect(JSON.parse(fetch.mock.calls.find(([, options]) => options.method === 'POST')[1].body)).toEqual({ action, version: 2 });
});
test('conflicting decisions require reload and a declined confirmation sends no action', async () => {
  fetch.mockImplementation(async (url, options) => options.method === 'POST' ? error('Request changed; reload.', 'PICKUP_CHANGED') : response(url.endsWith('/api/me') ? { user } : { request: { ...base, role: 'giver' } }));
  mount('/app/pickups/' + base.id); const button = await screen.findByRole('button', { name: 'Accept pickup' });
  window.confirm.mockReturnValueOnce(false); await click(button); expect(fetch.mock.calls.some(([, options]) => options.method === 'POST')).toBe(false);
  await click(button); expect(await screen.findByRole('alert')).toHaveTextContent('Request changed; reload.');
  await click(screen.getByRole('button', { name: 'Reload request' }));
  expect(await screen.findByRole('button', { name: 'Accept pickup' })).toBeInTheDocument();
});
test('expired sessions redirect private actions back to login', async () => {
  fetch.mockImplementation(async (url, options) => options.method === 'POST' ? error('Session ended', 'SESSION_EXPIRED', 401) : response(url.endsWith('/api/me') ? { user } : { request: base }));
  mount('/app/pickups/' + base.id); await click(await screen.findByRole('button', { name: 'Cancel request' }));
  expect(await screen.findByRole('heading', { name: 'Login' })).toBeInTheDocument();
});
test('consequential inventory saves retry only after explicit cancellation confirmation', async () => {
  fetch.mockResolvedValueOnce(error('Two requests will be cancelled.', 'PICKUP_CONFIRMATION_REQUIRED')).mockResolvedValueOnce(response({ item }));
  await confirmPickupChanges('/api/item', { method: 'PATCH', body: { version: 3, availableFrom: '2030-07-02' } });
  expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining('Two requests'));
  expect(JSON.parse(fetch.mock.calls[1][1].body)).toEqual({ version: 3, availableFrom: '2030-07-02', confirmCancelRequests: true });
  fetch.mockReset().mockResolvedValue(error('Cancellation required.', 'PICKUP_CONFIRMATION_REQUIRED')); window.confirm.mockReturnValue(false);
  await expect(confirmPickupChanges('/api/plan', { method: 'PATCH', body: { status: 'completed' } })).rejects.toHaveProperty('code', 'PICKUP_CONFIRMATION_REQUIRED');
  expect(fetch).toHaveBeenCalledTimes(1);
});
