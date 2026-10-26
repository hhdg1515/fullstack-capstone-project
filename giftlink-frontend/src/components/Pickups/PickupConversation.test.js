import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useNavigate, useParams } from 'react-router-dom';
import { AuthProvider } from '../../context/AuthContext';
import RequireAuth from '../RequireAuth';
import PickupConversation from './PickupConversation';
import { PickupDetail } from './Pickups';

const id = '64a000000000000000000001', nextId = '64a000000000000000000002';
const user = { id: 'owner', firstName: 'Alex', lastName: 'Private', email: 'private@example.invalid' };
const root = '/api/pickup-requests/' + id + '/conversation';
const context = (role = 'giver', status = 'pending', requestId = id) => ({ conversation: { id: requestId, requestId, role, status, counterpart: { firstName: 'Alex' } } });
const message = (n, sender = 'giver', text = 'Message ' + n) => ({ id: n.toString(16).padStart(24, '0'), sender, text, createdAt: new Date(Date.UTC(2030, 0, 1, 10, n)).toISOString() });
const reply = (body, status = 200) => ({ status, ok: status < 400, json: async () => body });
const problem = (status, code = 'FAILED', fields) => reply({ error: { code, message: 'Request failed', fields } }, status);
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { resolve, promise }; };
let handler;
function Scene({ status }) {
  const { requestId } = useParams(); const navigate = useNavigate();
  return <><button onClick={() => navigate('/app/pickups/' + nextId)}>Next request</button><PickupConversation requestId={requestId} requestStatus={status} /></>;
}
function mount({ status = 'pending', detail = false, strict = false } = {}) {
  const tree = <MemoryRouter initialEntries={['/app/pickups/' + id]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}><AuthProvider><Routes>
    <Route path="/app/pickups/:requestId" element={<RequireAuth>{detail ? <PickupDetail /> : <Scene status={status} />}</RequireAuth>} />
    <Route path="/app/login" element={<h1>Login</h1>} />
  </Routes></AuthProvider></MemoryRouter>;
  return render(strict ? <React.StrictMode>{tree}</React.StrictMode> : tree);
}
const ready = async () => screen.findByText('Conversation loaded.');
const type = text => fireEvent.change(screen.getByLabelText('Message', { exact: true }), { target: { value: text } });
const submit = () => fireEvent.submit(screen.getByRole('button', { name: 'Send message' }).closest('form'));
const refresh = () => fireEvent.click(screen.getByRole('button', { name: 'Refresh conversation' }));
const texts = () => [...screen.getByRole('region', { name: 'Message history' }).querySelectorAll('.chat-text')].map(node => node.textContent);
beforeEach(() => {
  handler = async url => url.endsWith('/conversation') ? reply(context()) : reply({ messages: [], nextCursor: null });
  global.fetch = jest.fn(async (url, options) => url.endsWith('/api/me') ? reply({ user }) : handler(url, options));
});
afterEach(() => jest.restoreAllMocks());

test.each(['giver', 'receiver'])('uses the server %s role, not equal display names, to distinguish messages', async role => {
  handler = async url => url.endsWith('/conversation') ? reply(context(role)) : reply({ messages: [message(1, 'giver'), message(2, 'receiver')], nextCursor: null });
  mount(); await ready();
  expect(screen.getByText(`You (${role === 'giver' ? 'giver' : 'requester'})`)).toBeInTheDocument();
  const other = role === 'giver' ? 'requester' : 'giver'; expect(screen.getByText(`Alex (${other})`)).toBeInTheDocument();
  expect(screen.getByText('You (' + (role === 'giver' ? 'giver' : 'requester') + ')').closest('li')).toHaveClass('chat-mine');
  expect(screen.queryByText(user.email)).not.toBeInTheDocument(); expect(document.querySelector('time')).toHaveAttribute('datetime', message(1).createdAt);
});
test('shows initial loading, empty history and recoverable network failure', async () => {
  const wait = deferred(); handler = async url => url.endsWith('/conversation') ? wait.promise : reply({ messages: [], nextCursor: null });
  mount(); expect(await screen.findByText('Loading conversation…')).toBeInTheDocument();
  await act(async () => wait.resolve(problem(503))); expect(await screen.findByRole('alert')).toHaveTextContent('Could not load messages');
  handler = async url => url.endsWith('/conversation') ? reply(context()) : reply({ messages: [], nextCursor: null });
  fireEvent.click(screen.getByRole('button', { name: 'Retry conversation' })); await screen.findByText('Conversation refreshed.');
  expect(screen.getByText('No messages yet.')).toBeInTheDocument(); expect(screen.getByRole('button', { name: 'Send message' })).toBeEnabled();
});
test('sends only text with the existing cookie/CSRF client, blocks rapid duplicates and clears on success', async () => {
  const wait = deferred(); const posts = [];
  handler = async (url, options) => {
    if (options.method === 'POST') { posts.push(options); return wait.promise; }
    return url.endsWith('/conversation') ? reply(context()) : reply({ messages: [], nextCursor: null });
  };
  mount(); await ready(); const storage = jest.spyOn(Storage.prototype, 'setItem'); type('  Ready\nfor pickup  ');
  const input = screen.getByLabelText('Message', { exact: true }); input.focus(); submit(); submit();
  expect(posts).toHaveLength(1); expect(JSON.parse(posts[0].body)).toEqual({ text: 'Ready\nfor pickup' });
  expect(posts[0].credentials).toBe('include'); expect(posts[0].headers['X-CSRF-Protection']).toBe('1');
  expect(input).toHaveAttribute('readonly');
  await act(async () => wait.resolve(reply({ message: message(1, 'giver', 'Ready\nfor pickup') }, 201)));
  expect(await screen.findByText('Message sent.')).toBeInTheDocument(); expect(texts()).toEqual(['Ready\nfor pickup']);
  expect(input).toHaveValue(''); expect(input).toHaveFocus(); expect(storage).not.toHaveBeenCalled();
});
test.each([0, 409, 429, 503])('preserves failed-send drafts for status %s, without automatically retrying POST', async status => {
  let count = 0;
  handler = async (url, options) => {
    if (options.method === 'POST') { count++; if (!status) throw Error('offline'); return problem(status); }
    return url.endsWith('/conversation') ? reply(context()) : reply({ messages: [message(1)], nextCursor: null });
  };
  mount(); await ready(); type('Keep my unfinished text'); submit();
  expect(await screen.findByRole('alert')).toHaveTextContent(status === 429 ? 'Wait a minute' : /Refresh|refresh/);
  expect(screen.getByDisplayValue('Keep my unfinished text')).toBeInTheDocument(); expect(texts()).toEqual(['Message 1']); expect(count).toBe(1);
  if (status !== 429) expect(screen.getByRole('button', { name: 'Send message' })).toBeDisabled();
  refresh(); await screen.findByText('Conversation refreshed.'); expect(screen.getByRole('button', { name: 'Send message' })).toBeEnabled(); expect(count).toBe(1);
  expect(screen.getByDisplayValue('Keep my unfinished text')).toBeInTheDocument();
});
test('server field errors describe and focus the preserved input after sending stops', async () => {
  handler = async (url, options) => options.method === 'POST' ? problem(400, 'VALIDATION_FAILED', [{ field: 'text', message: 'Use plain text.' }]) :
    url.endsWith('/conversation') ? reply(context()) : reply({ messages: [], nextCursor: null });
  mount(); await ready(); type('Retain this'); submit();
  await waitFor(() => expect(screen.getByLabelText('Message', { exact: true })).toHaveFocus());
  expect(screen.getByLabelText('Message', { exact: true })).toHaveAccessibleDescription(/Use plain text/); expect(screen.getByLabelText('Message', { exact: true })).toHaveValue('Retain this');
});
test('validates empty/plain-text limits by Unicode code points and accepts 2,000 astral characters', async () => {
  let posted = '';
  handler = async (url, options) => {
    if (options.method === 'POST') { posted = JSON.parse(options.body).text; return reply({ message: message(1, 'giver', posted) }, 201); }
    return url.endsWith('/conversation') ? reply(context()) : reply({ messages: [], nextCursor: null });
  };
  mount(); await ready();
  for (const value of ['   ', '😀'.repeat(2001), '<markup>', 'control\u0000character']) {
    type(value); submit(); expect(screen.getByLabelText('Message', { exact: true })).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByLabelText('Message', { exact: true })).toHaveFocus(); expect(posted).toBe('');
  }
  type('😀'.repeat(2000)); submit(); await screen.findByText('Message sent.'); expect(Array.from(posted)).toHaveLength(2000);
});
test('paginates, deduplicates overlapping pages and keeps an older cursor when refresh overlaps', async () => {
  let latest = [message(3), message(4)]; const paths = [];
  handler = async url => {
    paths.push(url); if (url.endsWith('/conversation')) return reply(context());
    if (url.endsWith('?before=old')) return reply({ messages: [message(1), message(2), message(3)], nextCursor: 'older' });
    if (url.endsWith('?before=older')) return reply({ messages: [], nextCursor: null });
    return reply({ messages: latest, nextCursor: 'old' });
  };
  mount(); await ready(); fireEvent.click(screen.getByRole('button', { name: 'Load earlier messages' })); await screen.findByText('Earlier messages loaded.');
  expect(texts()).toEqual([1, 2, 3, 4].map(n => 'Message ' + n));
  latest = [message(4), message(5)]; refresh(); await screen.findByText('Conversation refreshed.');
  expect(texts()).toEqual([1, 2, 3, 4, 5].map(n => 'Message ' + n));
  fireEvent.click(screen.getByRole('button', { name: 'Load earlier messages' })); await waitFor(() => expect(paths.some(path => path.includes('before=older'))).toBe(true));
  await waitFor(() => expect(screen.queryByRole('button', { name: 'Load earlier messages' })).not.toBeInTheDocument());
});
test('refresh keeps a gap and existing history when new messages exceed a page; bounded earlier loads fill it', async () => {
  let latest = false;
  handler = async url => {
    if (url.endsWith('/conversation')) return reply(context());
    if (url.includes('before=gap')) return reply({ messages: [message(2), message(3), message(4)], nextCursor: 'middle' });
    if (url.includes('before=tail')) return reply({ messages: [message(0)], nextCursor: null });
    return reply({ messages: latest ? [message(5), message(6)] : [message(1), message(2)], nextCursor: latest ? 'gap' : 'tail' });
  };
  mount(); await ready(); latest = true; refresh(); await screen.findByText('Conversation refreshed.');
  expect(texts()).toEqual([1, 2, 5, 6].map(n => 'Message ' + n)); expect(screen.getByText(/Some messages between these pages/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Load earlier messages' })); await screen.findByText('Earlier messages loaded.');
  expect(texts()).toEqual([1, 2, 3, 4, 5, 6].map(n => 'Message ' + n)); expect(screen.queryByText(/Some messages between these pages/)).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Load earlier messages' })); await waitFor(() => expect(texts()[0]).toBe('Message 0'));
});
test('failed refresh and pagination keep the draft and loaded messages, and retry without reloading everything', async () => {
  let fail = false;
  handler = async url => url.endsWith('/conversation') ? reply(context()) : fail ? problem(503) : reply({ messages: [message(3)], nextCursor: 'old' });
  mount(); await ready(); type('Private unfinished draft'); fail = true; refresh(); await screen.findByRole('alert');
  expect(texts()).toEqual(['Message 3']); expect(screen.getByDisplayValue('Private unfinished draft')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Load earlier messages' })); await screen.findByRole('alert');
  expect(texts()).toEqual(['Message 3']); expect(screen.getByDisplayValue('Private unfinished draft')).toBeInTheDocument();
});
test.each(['completed', 'cancelled', 'declined', 'no_show'])('%s history is readable with no send control', async status => {
  handler = async url => url.endsWith('/conversation') ? reply(context('receiver', status)) : reply({ messages: [message(1)], nextCursor: null });
  mount({ status }); await ready(); expect(texts()).toEqual(['Message 1']); expect(screen.getByText(/This request is closed/)).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Send message' })).not.toBeInTheDocument(); expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
});
test.each([403, 404])('a %s refresh hides loaded private history and disables sending without losing the draft', async status => {
  let fail = false;
  handler = async url => fail ? problem(status) : url.endsWith('/conversation') ? reply(context()) : reply({ messages: [message(1)], nextCursor: null });
  mount(); await ready(); type('Keep this draft'); fail = true; refresh(); await screen.findByRole('alert');
  expect(screen.queryByText('Message 1')).not.toBeInTheDocument(); expect(screen.getByDisplayValue('Keep this draft')).toHaveAttribute('readonly');
  expect(screen.getByRole('button', { name: 'Send message' })).toBeDisabled();
});
test('a send rejected after server-side closure preserves the draft and refresh restores read-only history', async () => {
  let closed = false;
  handler = async (url, options) => {
    if (options.method === 'POST') { closed = true; return problem(404); }
    return url.endsWith('/conversation') ? reply(context('giver', closed ? 'completed' : 'pending')) : reply({ messages: [message(1)], nextCursor: null });
  };
  mount(); await ready(); type('Unsent at closure'); submit(); await screen.findByRole('alert');
  expect(screen.queryByText('Message 1')).not.toBeInTheDocument(); expect(screen.getByDisplayValue('Unsent at closure')).toHaveAttribute('readonly');
  fireEvent.click(screen.getByRole('button', { name: 'Retry conversation' })); await screen.findByText('Conversation refreshed.');
  expect(texts()).toEqual(['Message 1']); expect(screen.getByText(/This request is closed/)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Send message' })).toBeDisabled();
});
test('a late successful POST cannot add an old message or clear the new request draft', async () => {
  const wait = deferred();
  handler = async (url, options) => {
    if (options.method === 'POST') return wait.promise;
    if (url.endsWith('/conversation')) return reply(context('giver', 'pending', url.includes(nextId) ? nextId : id));
    return reply({ messages: [], nextCursor: null });
  };
  mount(); await ready(); type('Old request send'); submit(); fireEvent.click(screen.getByRole('button', { name: 'Next request' }));
  await ready(); type('New request draft');
  await act(async () => wait.resolve(reply({ message: message(1, 'giver', 'Old request send') }, 201)));
  expect(screen.getByLabelText('Message', { exact: true })).toHaveValue('New request draft'); expect(texts()).toEqual([]);
});
test('a mismatched successful context response cannot reveal another conversation or enable a composer', async () => {
  handler = async () => reply(context('giver', 'pending', nextId)); mount(); await screen.findByRole('alert');
  expect(screen.queryByRole('region', { name: 'Message history' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Send message' })).not.toBeInTheDocument();
  expect(fetch.mock.calls.filter(([url]) => url.endsWith('/messages'))).toHaveLength(0);
});
test('a current 401 uses existing session invalidation and removes private UI', async () => {
  let expire = false;
  handler = async url => expire ? problem(401, 'SESSION_EXPIRED') : url.endsWith('/conversation') ? reply(context()) : reply({ messages: [message(1)], nextCursor: null });
  mount(); await ready(); expire = true; refresh(); expect(await screen.findByRole('heading', { name: 'Login' })).toBeInTheDocument();
  expect(screen.queryByText('Message 1')).not.toBeInTheDocument();
});
test.each([200, 401])('request switching discards old draft/history and ignores a late %s response', async status => {
  const wait = deferred(); let oldPage = false;
  handler = async url => {
    if (url.includes(nextId)) return url.endsWith('/conversation') ? reply(context('receiver', 'pending', nextId)) : reply({ messages: [message(9, 'receiver', 'Next request only')], nextCursor: null });
    if (url.endsWith('/conversation')) return reply(context());
    return oldPage ? wait.promise : reply({ messages: [message(1)], nextCursor: null });
  };
  mount(); await ready(); type('Old draft'); oldPage = true; refresh(); fireEvent.click(screen.getByRole('button', { name: 'Next request' }));
  expect(await screen.findByText('Next request only')).toBeInTheDocument();
  await act(async () => wait.resolve(status === 401 ? problem(401) : reply({ messages: [message(8, 'giver', 'Late old private body')], nextCursor: null })));
  expect(texts()).toEqual(['Next request only']); expect(screen.getByLabelText('Message', { exact: true })).toHaveValue('');
  expect(screen.queryByRole('heading', { name: 'Login' })).not.toBeInTheDocument(); expect(screen.queryByText('Late old private body')).not.toBeInTheDocument();
});
test('React strict effects ignore an obsolete context response and cannot restore old data or invalidate the current session', async () => {
  const wait = deferred(); let contexts = 0;
  handler = async url => url.endsWith('/conversation') ? (++contexts === 1 ? wait.promise : reply(context())) : reply({ messages: [message(1)], nextCursor: null });
  mount({ strict: true }); await ready(); await act(async () => wait.resolve(problem(401)));
  expect(texts()).toEqual(['Message 1']); expect(screen.queryByRole('heading', { name: 'Login' })).not.toBeInTheDocument();
});
test('plain text stays literal, multiline/long words stay in a scrollable region and history is not a live announcement', async () => {
  const text = '<img src=x onerror=alert(1)>\n' + 'longword'.repeat(200);
  handler = async url => url.endsWith('/conversation') ? reply(context()) : reply({ messages: [message(1, 'receiver', text)], nextCursor: null });
  mount(); await ready(); const region = screen.getByRole('region', { name: 'Message history' });
  expect(region.querySelector('img')).toBeNull(); expect(region.querySelector('.chat-text').textContent).toBe(text);
  expect(region).toHaveAttribute('tabindex', '0'); expect(region).not.toHaveAttribute('aria-live'); expect(screen.queryByRole('log')).not.toBeInTheDocument();
});
test('the real pickup detail keeps the chat draft on parent reload, then closes sending on backend lifecycle state', async () => {
  let state = 'pending'; const reload = deferred(); let wait = false;
  const pickup = () => ({ id, role: 'giver', status: state, version: 1, counterpart: { firstName: 'Alex' }, item: null, timeZone: 'UTC',
    proposedAt: '2030-01-01T10:00:00Z', note: '', history: [], cancellationReason: null });
  handler = async (url, options) => {
    if (url === '/api/pickup-requests/' + id) return wait ? reload.promise : reply({ request: pickup() });
    if (options.method === 'POST') { state = 'declined'; return reply({ request: pickup() }); }
    return url.endsWith('/conversation') ? reply(context('giver', state)) : reply({ messages: [message(1)], nextCursor: null });
  };
  jest.spyOn(window, 'confirm').mockReturnValue(true); mount({ detail: true }); await ready(); type('Do not lose this');
  wait = true; fireEvent.click(screen.getByRole('button', { name: 'Reload request' }));
  expect(screen.getByDisplayValue('Do not lose this')).toBeInTheDocument();
  await act(async () => reload.resolve(reply({ request: pickup() }))); wait = false;
  fireEvent.click(screen.getByRole('button', { name: 'Decline request' }));
  await screen.findByText(/This request is closed/); expect(screen.getByDisplayValue('Do not lose this')).toHaveAttribute('readonly');
  expect(screen.getByRole('button', { name: 'Send message' })).toBeDisabled();
});
