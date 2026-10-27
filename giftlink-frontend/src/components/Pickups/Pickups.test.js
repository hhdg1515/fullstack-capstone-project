import React from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom';
import { AuthProvider } from '../../context/AuthContext';
import RequireAuth from '../RequireAuth';
import LoginPage from '../LoginPage/LoginPage';
import PublicItems from '../Inventory/PublicItems';
import { RequestPickup, PickupDashboard, PickupDetail } from './Pickups';
import { confirmPickupChanges } from '../../api/confirmPickupChanges';

// Lifecycle tests isolate chat; PickupConversation.test.js and browser tests cover the real integration.
jest.mock('./PickupConversation', () => () => <section id="conversation"><h3 id="conversation-heading" tabIndex={-1}>Pickup conversation</h3></section>);

const user = { id: 'receiver', firstName: 'Reader', lastName: 'Neighbor', email: 'reader@example.test' };
const item = { id: '64a000000000000000000001', name: 'Kitchen box', description: 'One whole box.', city: 'Oakland', neighborhood: 'Temescal',
  pickupTimeZone: 'Asia/Kolkata', isReserved: false, availableFrom: '2030-07-01', effectiveAvailableUntil: '2030-07-03', availability: 'later' };
const base = { id: '64a000000000000000000002', role: 'receiver', status: 'pending', version: 1, note: 'Meet by the library', item,
  proposedAt: '2030-07-01T09:00:00.000Z', localDateTime: '2030-07-01T14:30', timeZone: 'Asia/Kolkata', counterpart: { firstName: 'Giver' },
  history: [{ action: 'pending', actor: 'receiver', at: '2026-01-01T00:00:00Z' }] };
const response = (data, status = 200) => ({ ok: status < 400, status, json: async () => data });
const error = (message, code, status = 409) => response({ error: { message, code } }, status);
const click = element => act(async () => { fireEvent.click(element); });
const submit = element => act(async () => { fireEvent.submit(element); });
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { resolve, promise }; };
function RequestSwitch() { const navigate = useNavigate(); return <button onClick={() => navigate('/app/pickups/64a000000000000000000003')}>Next request</button>; }
function mount(path = '/app/items/' + item.id + '/request') {
  return render(<MemoryRouter initialEntries={[path]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}><AuthProvider><RequestSwitch /><Routes>
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
test('the direct request form shows the server owner state instead of accepting appointment input', async () => {
  fetch.mockImplementation(async url => response(url.endsWith('/api/me') ? { user } : { item: { ...item, isOwner: true } }));
  mount();
  expect(await screen.findByText('Your listing. You cannot request your own item. Manage it from My plans.')).toBeInTheDocument();
  expect(screen.queryByLabelText('Pickup date and time')).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Send pickup request' })).not.toBeInTheDocument();
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
test('a direct request URL stops at a known reservation and can recover after it is released', async () => {
  let isReserved = true;
  fetch.mockImplementation(async url => response(url.endsWith('/api/me') ? { user } : { item: { ...item, isReserved } }));
  mount();
  const refresh = await screen.findByRole('button', { name: 'Check availability' });
  expect(screen.queryByLabelText('Pickup date and time')).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Send pickup request' })).not.toBeInTheDocument();
  expect(fetch.mock.calls.every(([, options]) => options.method === 'GET')).toBe(true);
  isReserved = false; await click(refresh);
  expect(await screen.findByLabelText('Pickup date and time')).toHaveValue('');
});
test('missing reservation metadata does not silently claim that a pickup is available', async () => {
  fetch.mockImplementation(async url => response(url.endsWith('/api/me') ? { user } : { item: { ...item, isReserved: undefined } }));
  mount();
  expect(await screen.findByText('Current pickup availability will be checked when you send a request.')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Send pickup request' })).toBeInTheDocument();
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
  if (['INVALID_APPOINTMENT', 'OUTSIDE_PICKUP_WINDOW'].includes(code)) {
    expect(screen.getByLabelText('Pickup date and time')).toHaveFocus();
    expect(screen.getByLabelText('Pickup date and time')).toHaveAccessibleDescription(/Review the pickup time or listing/);
  } else expect(screen.getByRole('alert')).toHaveFocus();
});
test('private dashboards provide loading, empty/error/retry and role navigation', async () => {
  const pending = deferred(); fetch.mockImplementation(url => url.endsWith('/api/me') ? Promise.resolve(response({ user })) : pending.promise);
  mount('/app/pickups/incoming'); expect(await screen.findByText('Loading pickup requests…')).toBeInTheDocument();
  await act(async () => pending.resolve(error('Temporary failure', 'FAILED', 503)));
  expect(await screen.findByRole('alert')).toHaveTextContent('Temporary failure');
  fetch.mockResolvedValue(response({ requests: [], nextCursor: null })); await click(screen.getByRole('button', { name: 'Retry requests' }));
  expect(await screen.findByText('No pickup requests here yet.')).toBeInTheDocument();
  expect(screen.getByRole('navigation', { name: 'Give Away' })).toBeInTheDocument();
});
test('giver dashboard displays appointment timezone and plan, and filters accepted appointments with bounded next pages', async () => {
  fetch.mockImplementation(async url => response(url.endsWith('/api/me') ? { user } : { requests: [{ ...base, role: 'giver', plan: { id: 'plan', title: 'Summer move' } }], nextCursor: base.id }));
  mount('/app/pickups/incoming'); expect(await screen.findByRole('link', { name: 'Kitchen box' })).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Summer move' })).toHaveAttribute('href', '/app/plans/plan');
  expect(screen.getByText(/Asia\/Kolkata/)).toBeInTheDocument(); expect(screen.getByText(/2:30 PM/)).toBeInTheDocument();
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
  expect(await screen.findByText('Accepted')).toBeInTheDocument();
  const [, options] = fetch.mock.calls.find(([, options]) => options.method === 'POST'); expect(JSON.parse(options.body)).toEqual({ action: 'accept', version: 1 });
  expect(window.confirm).toHaveBeenCalled(); expect(screen.getByRole('button', { name: 'Record no-show' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Confirm handoff' })).toBeDisabled();
});
test.each([['complete', 'Confirm handoff', 'completed', 'Completed'], ['no_show', 'Record no-show', 'no_show', 'No-show'], ['cancel', 'Cancel request', 'cancelled', 'Cancelled']])('accepted appointment supports %s after its time', async (action, label, status, statusText) => {
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


test('multiple requests for one item retain applicant, proposed time, status and the exact review target', async () => {
  const requests = [{ ...base, role: 'giver', counterpart: { firstName: 'Alex' }, note: 'Library entrance' },
    { ...base, id: '64a000000000000000000003', role: 'giver', counterpart: { firstName: 'Sam' }, proposedAt: '2030-07-01T10:00:00.000Z', status: 'declined', note: 'Near the cafe' }];
  fetch.mockImplementation(async url => response(url.endsWith('/api/me') ? { user } : { requests, nextCursor: null }));
  mount('/app/pickups/incoming'); await screen.findByText('Applicant: Alex');
  for (const request of requests) {
    const card = screen.getByText('Applicant: ' + request.counterpart.firstName).closest('li');
    expect(within(card).getByRole('link', { name: 'Kitchen box' })).toHaveAttribute('href', '/app/items/' + item.id);
    expect(within(card).getByRole('link', { name: 'View request from ' + request.counterpart.firstName + ' for Kitchen box' })).toHaveAttribute('href', '/app/pickups/' + request.id);
    expect(card.querySelector('time')).toHaveAttribute('datetime', request.proposedAt);
    expect(within(card).getByText(request.status === 'pending' ? 'Pending' : 'Declined')).toBeInTheDocument();
    expect(within(card).getByText(request.note)).toBeInTheDocument(); expect(within(card).getByText(request.id)).toBeInTheDocument();
    expect(card.textContent).not.toContain(user.email);
  }
});
test('identically named applicants have separate exact references and review targets without inventing identities', async () => {
  const requests = [base, { ...base, id: '64a000000000000000000003' }];
  fetch.mockImplementation(async url => response(url.endsWith('/api/me') ? { user } : { requests, nextCursor: null }));
  mount('/app/pickups/incoming'); await screen.findAllByText('Applicant: Giver');
  const links = screen.getAllByRole('link', { name: 'View request from Giver for Kitchen box' });
  expect(links.map(link => link.getAttribute('href'))).toEqual(requests.map(request => '/app/pickups/' + request.id));
  for (const request of requests) expect(screen.getByText(request.id)).toBeInTheDocument();
});
test('filtered emptiness differs from no history and clearing it resets pagination', async () => {
  mount('/app/pickups'); await screen.findByText('No pickup requests here yet.');
  fireEvent.change(screen.getByLabelText('Request status'), { target: { value: 'accepted' } });
  expect(await screen.findByText('No requests match this status.')).toBeInTheDocument();
  expect(screen.queryByText('No pickup requests here yet.')).not.toBeInTheDocument();
  await click(screen.getByRole('button', { name: 'Clear status filter' }));
  expect(await screen.findByText('No pickup requests here yet.')).toBeInTheDocument();
  expect(fetch.mock.calls.at(-1)[0]).toMatch(/sent\?$/);
});
test('sent cards identify the current user as applicant and keep the giver and missing-listing recovery explicit', async () => {
  fetch.mockImplementation(async url => response(url.endsWith('/api/me') ? { user } : { requests: [{ ...base, item: null }], nextCursor: null }));
  mount('/app/pickups'); expect(await screen.findByText('Applicant: You')).toBeInTheDocument();
  expect(screen.getByText('Giver: Giver')).toBeInTheDocument();
  expect(screen.getByText('The listing is no longer available. You can still review the request.')).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'View request to Giver for former listing' })).toHaveAttribute('href', '/app/pickups/' + base.id);
});

test.each([false, true])('participant list has canonical conversation links for pending and closed history (incoming=%s)', async incoming => {
  const requests = ['pending', 'completed', 'cancelled', 'declined', 'no_show'].map((status, index) => ({ ...base, id: base.id.slice(0, -1) + index, status, role: incoming ? 'giver' : 'receiver' }));
  fetch.mockImplementation(async url => response(url.endsWith('/api/me') ? { user } : { requests, nextCursor: null }));
  mount(incoming ? '/app/pickups/incoming' : '/app/pickups');
  const links = await screen.findAllByRole('link', { name: 'Open conversation with Giver for Kitchen box' });
  expect(links.map(link => link.getAttribute('href'))).toEqual(requests.map(row => '/app/pickups/' + row.id + '#conversation'));
  expect(screen.queryByText(/unread/i)).not.toBeInTheDocument();
});
test('broken listing references keep request review without offering a conversation shortcut', async () => {
  fetch.mockImplementation(async url => response(url.endsWith('/api/me') ? { user } : { requests: [{ ...base, item: null }], nextCursor: null }));
  mount('/app/pickups'); await screen.findByText('Former listing');
  expect(screen.queryByRole('link', { name: /Open conversation/ })).not.toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'View request to Giver for former listing' })).toBeInTheDocument();
});
test('direct conversation deep link focuses the section after asynchronous request loading and keeps the filtered return', async () => {
  const pending = deferred(); fetch.mockImplementation(url => url.endsWith('/api/me') ? Promise.resolve(response({ user })) : pending.promise);
  render(<MemoryRouter initialEntries={[{ pathname: '/app/pickups/' + base.id, hash: '#conversation', state: { journey: 'give', returnSearch: 'status=accepted&cursor=64a000000000000000000003' } }]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
    <AuthProvider><Routes><Route path="/app/pickups/:requestId" element={<RequireAuth><PickupDetail /></RequireAuth>} /></Routes></AuthProvider></MemoryRouter>);
  await screen.findByText('Loading pickup requests…');
  await act(async () => pending.resolve(response({ request: base })));
  await waitFor(() => expect(screen.getByRole('heading', { name: 'Pickup conversation' })).toHaveFocus());
  expect(screen.getByRole('link', { name: 'Back to requests' })).toHaveAttribute('href', '/app/pickups?status=accepted&cursor=64a000000000000000000003');
});
test('lifecycle decisions block rapid duplicates and uncertain resubmission until canonical reload', async () => {
  const pending = deferred(); let postCount = 0;
  fetch.mockImplementation(async (url, options) => {
    if (options.method === 'POST') { postCount++; return pending.promise; }
    return response(url.endsWith('/api/me') ? { user } : { request: { ...base, role: 'giver' } });
  });
  mount('/app/pickups/' + base.id); const accept = await screen.findByRole('button', { name: 'Accept pickup' });
  await act(async () => { fireEvent.click(accept); fireEvent.click(accept); }); expect(postCount).toBe(1);
  await act(async () => pending.resolve(error('Sending could not be confirmed.', 'UNAVAILABLE', 503)));
  await screen.findByRole('alert'); expect(accept).toBeDisabled();
  await click(screen.getByRole('button', { name: 'Reload request' })); await waitFor(() => expect(accept).toBeEnabled()); expect(postCount).toBe(1);
});
test('a late action from another request cannot invalidate the new request session', async () => {
  const pending = deferred();
  fetch.mockImplementation(async (url, options) => options.method === 'POST' ? pending.promise : response(url.endsWith('/api/me') ? { user } : { request: { ...base, id: url.split('/').pop(), role: 'giver' } }));
  mount('/app/pickups/' + base.id); await click(await screen.findByRole('button', { name: 'Accept pickup' }));
  await click(screen.getByRole('button', { name: 'Next request' })); await screen.findByRole('button', { name: 'Accept pickup' });
  await act(async () => pending.resolve(error('Old expired session', 'SESSION_EXPIRED', 401)));
  expect(screen.queryByRole('heading', { name: 'Login' })).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Accept pickup' })).toBeEnabled(); expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});
test.each([403, 404])('definitive %s detail revalidation removes private content and conversation entry', async status => {
  let deny = false;
  fetch.mockImplementation(async url => url.endsWith('/api/me') ? response({ user }) : deny ? error('Private request unavailable', 'PICKUP_NOT_FOUND', status) : response({ request: base }));
  mount('/app/pickups/' + base.id); await screen.findByText('Applicant: You'); deny = true;
  await click(screen.getByRole('button', { name: 'Reload request' })); await screen.findByRole('alert');
  expect(screen.queryByText('Applicant: You')).not.toBeInTheDocument(); expect(screen.queryByRole('link', { name: 'Open conversation' })).not.toBeInTheDocument();
  expect(screen.queryByRole('heading', { name: 'Pickup conversation' })).not.toBeInTheDocument();
});

test.each([200, 401])('late %s request-load responses cannot replace or expire the next request', async status => {
  const pending = deferred();
  fetch.mockImplementation(async url => url.endsWith('/api/me') ? response({ user }) : url.endsWith(base.id) ? pending.promise : response({ request: { ...base, id: '64a000000000000000000003', counterpart: { firstName: 'New participant' } } }));
  mount('/app/pickups/' + base.id); await screen.findByText('Loading pickup requests…');
  await click(screen.getByRole('button', { name: 'Next request' })); await screen.findByText('Giver: New participant');
  await act(async () => pending.resolve(status === 401 ? error('Old session ended', 'SESSION_EXPIRED', 401) : response({ request: base })));
  expect(screen.getByText('Giver: New participant')).toBeInTheDocument(); expect(screen.queryByRole('heading', { name: 'Login' })).not.toBeInTheDocument();
});

test('a future accepted appointment leads with conversation rather than a disabled handoff action', async () => {
  fetch.mockImplementation(async url => response(url.endsWith('/api/me') ? { user } : { request: { ...base, role: 'giver', status: 'accepted' } }));
  mount('/app/pickups/' + base.id); const summary = await screen.findByRole('article', { name: 'Request summary' });
  expect(summary.querySelector('.pickup-actions').firstElementChild).toHaveTextContent('Open conversation');
  expect(screen.getByRole('button', { name: 'Confirm handoff' })).toBeDisabled();
  expect(screen.queryByText('Picked Up')).not.toBeInTheDocument();
});

test('a failed detail refresh labels retained information as last loaded and blocks lifecycle actions', async () => {
  let fail = false;
  fetch.mockImplementation(async url => url.endsWith('/api/me') ? response({ user }) : fail ? error('Reload failed', 'TEMPORARY', 503) : response({ request: { ...base, role: 'giver', status: 'accepted' } }));
  mount('/app/pickups/' + base.id); await screen.findByText('Accepted'); fail = true;
  await click(screen.getByRole('button', { name: 'Reload request' })); await screen.findByRole('alert');
  expect(screen.getByText('Showing last loaded details. Reload to confirm current status and pickup time.')).toBeVisible();
  expect(screen.getByRole('button', { name: 'Cancel request' })).toBeDisabled(); expect(screen.queryByText('No pickup requests here yet.')).not.toBeInTheDocument();
  fail = false; await click(screen.getByRole('button', { name: 'Reload request' })); await waitFor(() => expect(screen.getByRole('button', { name: 'Cancel request' })).toBeEnabled());
  expect(screen.queryByText('Showing last loaded details. Reload to confirm current status and pickup time.')).not.toBeInTheDocument();
});
