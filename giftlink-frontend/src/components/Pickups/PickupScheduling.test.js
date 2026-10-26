import React from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { AuthProvider } from '../../context/AuthContext';
import RequireAuth from '../RequireAuth';
import PickupScheduling, { PickupTime } from './PickupScheduling';
import { PickupDetail } from './Pickups';

const id = '64a000000000000000000001', otherId = '64a000000000000000000002';
const user = { id: 'owner', firstName: 'Alex', lastName: 'Private', email: 'private@example.invalid' };
const base = { id, role: 'giver', status: 'accepted', version: 2, proposedAt: '2030-01-15T20:00:00.000Z', localDateTime: '2030-01-15T12:00', timeZone: 'America/Los_Angeles',
  counterpart: { firstName: 'Alex' }, rescheduling: { proposal: null, canPropose: true, canAccept: false, canDecline: false, reason: null } };
const proposal = { id: '64a000000000000000000003', proposedBy: 'receiver', proposedAt: '2030-01-18T23:00:00.000Z', localDateTime: '2030-01-18T15:00', timeZone: base.timeZone, createdAt: '2030-01-01T00:00:00.000Z' };
const pending = (role = 'giver') => ({ ...base, role, version: 3, rescheduling: { proposal: { ...proposal, proposedBy: role === 'giver' ? 'receiver' : 'giver' }, canPropose: false, canAccept: true, canDecline: true, reason: 'proposal_pending' } });
const reply = (body, status = 200) => ({ status, ok: status < 400, json: async () => body });
const failure = (status, code = 'FAILED', message = 'Request failed') => reply({ error: { code, message } }, status);
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { resolve, promise }; };
let handler;
function mount(row = base, onRefresh = jest.fn()) {
  const draw = request => <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}><AuthProvider><Routes>
    <Route path="/" element={<RequireAuth><PickupScheduling request={request} onRefresh={onRefresh} /></RequireAuth>} />
    <Route path="/app/login" element={<h1>Login</h1>} />
  </Routes></AuthProvider></MemoryRouter>;
  const result = render(draw(row)); return { change: next => result.rerender(draw(next)), onRefresh };
}
const open = async () => { fireEvent.click(await screen.findByRole('button', { name: 'Propose new time' })); return screen.getByLabelText('New pickup date and time'); };
const submit = () => fireEvent.submit(screen.getByRole('button', { name: 'Propose time change' }).closest('form'));
beforeEach(() => {
  handler = async () => reply({ request: { ...base, version: 3 } });
  global.fetch = jest.fn(async (url, options) => url.endsWith('/api/me') ? reply({ user }) : handler(url, options));
  jest.spyOn(window, 'confirm').mockReturnValue(true);
});
afterEach(() => jest.restoreAllMocks());

test('keeps the minimal editor collapsed, focuses required input and sends server version/zone with CSRF only', async () => {
  const callbacks = jest.fn(); mount(base, callbacks); const input = await open(); expect(input).toHaveFocus(); submit();
  expect(input).toHaveAccessibleDescription(/Choose a new pickup date/); expect(fetch.mock.calls.filter(([, options]) => options.method === 'POST')).toHaveLength(0);
  fireEvent.change(input, { target: { value: '2030-01-18T15:00' } }); submit(); await waitFor(() => expect(callbacks).toHaveBeenCalledTimes(1));
  const [url, options] = fetch.mock.calls.find(([, options]) => options.method === 'POST'); expect(url).toBe('/api/pickup-requests/' + id + '/reschedule-proposals');
  expect(JSON.parse(options.body)).toEqual({ version: 2, localDateTime: '2030-01-18T15:00', timeZone: 'America/Los_Angeles' });
  expect(options.credentials).toBe('include'); expect(options.headers['X-CSRF-Protection']).toBe('1');
  expect(screen.getByText('Time change proposed. The confirmed time has not changed.')).toBeInTheDocument();
});
test('blocks duplicate submit and awaits a fresh canonical snapshot after a successful POST', async () => {
  const wait = deferred(); handler = async () => wait.promise; const view = mount(); const input = await open(); fireEvent.change(input, { target: { value: '2030-01-18T15:00' } });
  submit(); submit(); expect(fetch.mock.calls.filter(([, options]) => options.method === 'POST')).toHaveLength(1);
  await act(async () => wait.resolve(reply({ request: { ...base, version: 3 } })));
  expect(screen.getByRole('button', { name: 'Propose new time' })).toBeDisabled();
  view.change({ ...base, version: 3 }); await waitFor(() => expect(screen.getByRole('button', { name: 'Propose new time' })).toBeEnabled());
});
test.each(['giver', 'receiver'])('shows the other %s participant’s unconfirmed proposal with role attribution and explicit response actions', async role => {
  mount(pending(role)); const group = await screen.findByRole('group', { name: 'Pending time change' });
  expect(within(group).getByText('Proposed time — waiting for approval')).toBeInTheDocument(); expect(group.textContent).toContain('Proposed by Alex');
  expect(group.querySelector('time')).toHaveAttribute('datetime', proposal.proposedAt);
  expect(screen.getByRole('button', { name: 'Accept proposed time' })).toBeEnabled(); expect(screen.getByRole('button', { name: 'Decline time change' })).toBeEnabled();
  expect(screen.queryByRole('button', { name: 'Propose new time' })).not.toBeInTheDocument();
});
test.each(['giver', 'receiver'])('does not offer self-response to a %s even if stale flags claim it is allowed', async role => {
  mount({ ...pending(role), rescheduling: { ...pending(role).rescheduling, proposal: { ...proposal, proposedBy: role } } });
  await screen.findByText(/Waiting for the other participant/); expect(screen.queryByRole('button', { name: 'Accept proposed time' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Decline time change' })).not.toBeInTheDocument();
});
test.each(['accept', 'decline'])('posts the exact proposal ID/version for %s and refreshes without mutating props', async action => {
  const row = pending(); const callback = jest.fn(); handler = async () => reply({ request: { ...row, version: 4 } }); mount(row, callback);
  fireEvent.click(await screen.findByRole('button', { name: action === 'accept' ? 'Accept proposed time' : 'Decline time change' }));
  await waitFor(() => expect(callback).toHaveBeenCalledTimes(1));
  const [url, options] = fetch.mock.calls.find(([, options]) => options.method === 'POST');
  expect(url).toBe('/api/pickup-requests/' + id + '/reschedule-proposals/' + proposal.id + '/actions'); expect(JSON.parse(options.body)).toEqual({ version: 3, action });
  expect(row.proposedAt).toBe(base.proposedAt); expect(row.rescheduling.proposal).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Accept proposed time' })).toBeDisabled();
});
test('declined acceptance confirmation makes no request', async () => {
  window.confirm.mockReturnValue(false); mount(pending()); fireEvent.click(await screen.findByRole('button', { name: 'Accept proposed time' }));
  expect(fetch.mock.calls.filter(([, options]) => options.method === 'POST')).toHaveLength(0);
});
test.each(['INVALID_APPOINTMENT', 'APPOINTMENT_PAST', 'OUTSIDE_PICKUP_WINDOW', 'UNCHANGED_APPOINTMENT'])('%s preserves the time draft and focuses its error', async code => {
  handler = async () => failure(400, code, 'Choose another valid pickup time.'); mount(); const input = await open();
  fireEvent.change(input, { target: { value: '2030-01-18T15:00' } }); submit();
  await waitFor(() => expect(input).toHaveFocus()); expect(await screen.findByRole('alert')).toBeInTheDocument();
  expect(input).toHaveValue('2030-01-18T15:00'); expect(input).toHaveAccessibleDescription(/Choose another valid pickup time/);
});
test.each([0, 409, 503, 403, 404])('a %s failure keeps the draft and requires a successful explicit revalidation before retry', async status => {
  handler = async () => { if (!status) throw Error('offline'); return failure(status); };
  const view = mount(); const input = await open(); fireEvent.change(input, { target: { value: '2030-01-18T15:00' } }); submit();
  await screen.findByRole('alert'); expect(input).toHaveValue('2030-01-18T15:00'); expect(screen.getByRole('button', { name: 'Propose time change' })).toBeDisabled();
  const posts = fetch.mock.calls.filter(([, options]) => options.method === 'POST').length;
  fireEvent.click(screen.getByRole('button', { name: 'Reload current times' })); expect(view.onRefresh).toHaveBeenCalledTimes(1);
  expect(screen.getByRole('button', { name: 'Propose time change' })).toBeDisabled();
  view.change({ ...base }); await waitFor(() => expect(screen.getByRole('button', { name: 'Propose time change' })).toBeEnabled());
  expect(input).toHaveValue('2030-01-18T15:00'); expect(fetch.mock.calls.filter(([, options]) => options.method === 'POST')).toHaveLength(posts);
});
test('rate limits are actionable without dropping the proposed value', async () => {
  handler = async () => failure(429); mount(); const input = await open(); fireEvent.change(input, { target: { value: '2030-01-18T15:00' } }); submit();
  expect(await screen.findByRole('alert')).toHaveTextContent('Wait a minute'); expect(input).toHaveValue('2030-01-18T15:00'); expect(screen.getByRole('button', { name: 'Propose time change' })).toBeEnabled();
});
test('an elapsed confirmed appointment cannot be changed, while an outstanding proposal may be declined', async () => {
  const row = pending(); mount({ ...row, rescheduling: { ...row.rescheduling, canAccept: false, reason: 'appointment_passed' } });
  await screen.findByText(/confirmed pickup time has passed/); expect(screen.queryByRole('button', { name: 'Accept proposed time' })).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Decline time change' })).toBeEnabled();
});
test.each(['completed', 'cancelled', 'declined', 'no_show'])('%s requests retain a readonly draft but no submit capability', async status => {
  const view = mount(); const input = await open(); fireEvent.change(input, { target: { value: '2030-01-18T15:00' } });
  view.change({ ...base, status, version: 3, rescheduling: { proposal: null, canPropose: false, canAccept: false, canDecline: false } });
  await screen.findByText(/This request is closed/); expect(input).toHaveAttribute('readonly'); expect(input).toHaveValue('2030-01-18T15:00');
  expect(screen.getByRole('button', { name: 'Propose time change' })).toBeDisabled();
});
test('current expired-session responses use the existing authentication flow', async () => {
  handler = async () => failure(401); mount(); const input = await open(); fireEvent.change(input, { target: { value: '2030-01-18T15:00' } }); submit();
  expect(await screen.findByRole('heading', { name: 'Login' })).toBeInTheDocument(); expect(screen.queryByLabelText('New pickup date and time')).not.toBeInTheDocument();
});
test.each([200, 401])('a late %s response from another request cannot affect the new request or login', async status => {
  const wait = deferred(); handler = async () => wait.promise; const view = mount(); const input = await open(); fireEvent.change(input, { target: { value: '2030-01-18T15:00' } }); submit();
  view.change({ ...base, id: otherId }); await screen.findByRole('button', { name: 'Propose new time' });
  await act(async () => wait.resolve(status === 200 ? reply({ request: { ...base, version: 3 } }) : failure(401)));
  expect(view.onRefresh).not.toHaveBeenCalled(); expect(screen.queryByRole('heading', { name: 'Login' })).not.toBeInTheDocument();
  expect(screen.queryByLabelText('New pickup date and time')).not.toBeInTheDocument();
});
test('unknown/older backend metadata cannot enable scheduling', async () => {
  mount({ ...base, rescheduling: undefined }); await screen.findByText(/Reload the request to check whether/);
  expect(screen.queryByRole('button')).not.toBeInTheDocument();
});
test('the real detail distinguishes confirmed/proposed time and renders structured events outside chat', async () => {
  let current = { ...pending(), item: null, note: '', history: [], cancellationReason: null };
  handler = async (url, options) => {
    if (url.endsWith('/conversation')) return reply({ conversation: { id, requestId: id, role: 'giver', status: current.status, counterpart: current.counterpart } });
    if (url.endsWith('/conversation/messages')) return reply({ messages: [], nextCursor: null });
    if (options.method === 'POST') {
      current = { ...current, proposedAt: proposal.proposedAt, localDateTime: proposal.localDateTime, version: 4,
        rescheduling: { proposal: null, canPropose: true, canAccept: false, canDecline: false },
        history: [{ action: 'reschedule_accepted', actor: 'giver', at: '2030-01-01T00:00:00.000Z', reason: null,
          reschedule: { proposal, previousAppointment: base } }] };
    }
    return reply({ request: current });
  };
  render(<MemoryRouter initialEntries={['/app/pickups/' + id]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}><AuthProvider><Routes>
    <Route path="/app/pickups/:requestId" element={<RequireAuth><PickupDetail /></RequireAuth>} />
  </Routes></AuthProvider></MemoryRouter>);
  await screen.findByText('Conversation loaded.');
  expect(screen.getByText('Confirmed pickup:').closest('p').querySelector('time')).toHaveAttribute('datetime', base.proposedAt);
  expect(screen.getByRole('group', { name: 'Pending time change' }).querySelector('time')).toHaveAttribute('datetime', proposal.proposedAt);
  fireEvent.click(screen.getByRole('button', { name: 'Accept proposed time' })); await screen.findByRole('button', { name: 'Propose new time' });
  expect(screen.getByText('Confirmed pickup:').closest('p').querySelector('time')).toHaveAttribute('datetime', proposal.proposedAt);
  expect(screen.queryByRole('group', { name: 'Pending time change' })).not.toBeInTheDocument();
  expect(screen.getByText('New pickup time confirmed')).toBeInTheDocument();
  expect(within(screen.getByRole('region', { name: 'Message history' })).getByText('No messages yet.')).toBeInTheDocument();
});

test('cancelling a valid time edit restores focus to its existing proposal entry', async () => {
  mount(); const input = await open(); fireEvent.change(input, { target: { value: '2030-01-18T15:00' } });
  fireEvent.click(screen.getByRole('button', { name: 'Cancel time edit' }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Propose new time' })).toHaveFocus());
  expect(screen.queryByLabelText('New pickup date and time')).not.toBeInTheDocument(); expect(fetch.mock.calls.filter(([,o]) => o.method === 'POST')).toHaveLength(0);
});
test('an expired proposal describes unchanged confirmation and offers only actual server-authorized responses', async () => {
  const row = pending(); mount({ ...row, rescheduling: { ...row.rescheduling, canAccept: false, reason: 'proposal_unavailable' } });
  expect(await screen.findByText('The proposed time is no longer valid. The confirmed time still applies.')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Accept proposed time' })).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Decline time change' })).toBeEnabled();
  expect(screen.getByText(/Chat does not change the confirmed pickup/)).toBeInTheDocument();
});
test('unknown proposal metadata cannot promise a decline action or overwrite an existing proposal', async () => {
  mount({ ...base, rescheduling: { proposal: null, canPropose: false, canAccept: false, canDecline: false, reason: 'proposal_unavailable' } });
  await screen.findByText('The proposed time is no longer valid. The confirmed time still applies.');
  expect(screen.queryByRole('button')).not.toBeInTheDocument();
});


test.each([undefined, null, '', 'Not/AZone'])('pickup display refuses missing/invalid zone %s instead of using device time', timeZone => {
  render(<PickupTime value={{ ...base, timeZone }} />);
  expect(screen.getByText('Time unavailable. Reload the request.')).toBeInTheDocument();
  expect(document.querySelector('time')).toBeNull(); expect(fetch).not.toHaveBeenCalled();
});
