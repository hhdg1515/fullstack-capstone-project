jest.mock('../../api/usePublicCatalog', () => ({ __esModule: true, default: path => ({ data: require('../../test-support/catalogs')[path === '/api/regions' ? 'regions' : 'taxonomy'] }) }));
import React from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, useLocation, useNavigate } from 'react-router-dom';
import { AuthProvider } from '../../context/AuthContext';
import App from '../../App';

const user = { id: '64a000000000000000000001', firstName: 'Neighbor', lastName: 'Member', email: 'neighbor@example.test' };
const plan = { id: '64a000000000000000000002', title: 'Pasadena move', city: 'Pasadena', neighborhood: 'Bungalow Heaven', status: 'active', moveOutDeadline: '2030-07-10', pickupTimeZone: 'America/Los_Angeles' };
const item = { id: '64a000000000000000000003', name: 'Replacement table', description: 'A useful table.', city: 'Irvine', neighborhood: 'Woodbridge', status: 'available', availability: 'now', availableFrom: null,
  stateId: '06', metroId: '31080', isOwner: false, isReserved: false, availableUntil: null, effectiveAvailableUntil: '2030-07-10', pickupTimeZone: 'America/Los_Angeles', version: 1 };
const pickup = { id: '64a000000000000000000004', role: 'receiver', item, status: 'pending', version: 1, timeZone: 'America/Los_Angeles', proposedAt: '2030-07-01T19:00:00Z', note: '', counterpart: { firstName: 'Other neighbor' }, history: [] };
let sessionUser, detailRole;
const reply = (data, status = 200) => ({ ok: status < 400, status, json: async () => data });
const click = element => act(async () => { fireEvent.click(element); });
function HistoryControls() {
  const navigate = useNavigate(); const location = useLocation();
  return <aside aria-label="Test browser controls"><button onClick={() => navigate(-1)}>Browser Back</button><button onClick={() => navigate(1)}>Browser Forward</button>
    <output data-testid="route">{location.pathname + location.search + location.hash}</output></aside>;
}
function mount(path = '/') {
  return render(<MemoryRouter initialEntries={[path]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}><AuthProvider><App /><HistoryControls /></AuthProvider></MemoryRouter>);
}
const primary = () => within(screen.getByRole('navigation', { name: 'Primary' }));
const context = name => within(screen.getByRole('navigation', { name }));
async function login() {
  fireEvent.change(screen.getByLabelText('Email'), { target: { value: user.email } });
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'isolated-long-password' } });
  await act(async () => { fireEvent.submit(screen.getByRole('button', { name: 'Login', exact: true }).closest('form')); });
}
beforeEach(() => {
  localStorage.clear(); sessionUser = null; detailRole = 'receiver';
  jest.spyOn(window, 'scrollTo').mockImplementation(() => {});
  global.fetch = jest.fn(async (url, options = {}) => {
    const path = new URL(url, 'http://localhost').pathname;
    if (path === '/api/me') return sessionUser ? reply({ user: sessionUser }) : reply({ error: { code: 'UNAUTHENTICATED' } }, 401);
    if (path === '/api/auth/login' || path === '/api/auth/register') { sessionUser = user; return reply({ user }, path.endsWith('register') ? 201 : 200); }
    if (path === '/api/auth/logout') { sessionUser = null; return reply(null, 204); }
    if (path === '/api/items/locations') return reply({ locations: [{ city: 'Irvine', neighborhoods: ['Woodbridge'] }], truncated: false });
    if (path === '/api/items') return reply({ items: [item], total: 1, page: { hasMore: false, nextCursor: null } });
    if (path === '/api/items/' + item.id) return reply({ item });
    if (path.endsWith('/items') && path.startsWith('/api/move-out-plans/')) return reply({ plan, items: [{ ...item, city: plan.city, neighborhood: plan.neighborhood }], progress: { total: 1, cleared: 0 } });
    if (path === '/api/move-out-plans') return reply({ plans: [plan] });
    if (path.startsWith('/api/move-out-plans/')) return reply({ plan });
    if (path.endsWith('/sent') || path.endsWith('/received')) return reply({ requests: [{ ...pickup, role: path.endsWith('/received') ? 'giver' : 'receiver', ...(path.endsWith('/received') ? { plan: { id: plan.id, title: plan.title } } : {}) }], nextCursor: null });
    if (path.endsWith('/conversation')) return reply({ conversation: { id: pickup.id, requestId: pickup.id, role: detailRole, status: pickup.status, counterpart: pickup.counterpart } });
    if (path.endsWith('/conversation/messages')) return reply({ messages: [], nextCursor: null });
    if (path.startsWith('/api/pickup-requests/')) return reply({ request: { ...pickup, role: detailRole, ...(detailRole === 'giver' ? { plan: { id: plan.id, title: plan.title } } : {}) } });
    if (path === '/api/gifts') return reply([{ id: 'legacy-one', name: 'Original chair', description: 'Demo', date_added: 1700000000, condition: 'New' }]);
    if (path.startsWith('/api/gifts/')) return reply({ id: 'legacy-one', name: 'Original chair', description: 'Demo' });
    throw new Error('Unexpected API path: ' + path);
  });
});
afterEach(() => jest.restoreAllMocks());

test('anonymous homepage exposes both intentions immediately while the session check is still pending', async () => {
  fetch.mockReturnValue(new Promise(() => {})); mount();
  expect(screen.getByRole('heading', { name: /Move lighter.*Settle smarter/ , level: 1 })).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Start Giving' })).toHaveAttribute('href', '/app/plans');
  expect(screen.getByRole('link', { name: 'Explore Free Items' })).toHaveAttribute('href', '/app/items');
  expect(screen.getByText(/Everything is free/)).toBeInTheDocument();
  expect(fetch).toHaveBeenCalledTimes(1); expect(fetch.mock.calls[0][0]).toMatch(/\/api\/me$/);
});
test('Find Free Items opens anonymously without a plan and asks for a browsing region', async () => {
  mount(); await click(screen.getByRole('link', { name: 'Explore Free Items' }));
  expect(await screen.findByRole('heading', { name: 'Where would you like to find free items?' })).toBeInTheDocument();
  expect(screen.getByLabelText('State', { exact: true })).toHaveValue('');
  expect(fetch.mock.calls.some(([url]) => url.includes('/api/items?'))).toBe(false);
  expect(primary().getByRole('link', { name: 'Find Free Items' })).toHaveAttribute('aria-current', 'location');
  expect(context('Find Free Items').getByRole('link', { name: 'My pickup requests' })).toHaveAccessibleDescription('Sign in required');
  expect(fetch.mock.calls.some(([url]) => url.includes('/api/move-out-plans'))).toBe(false);
  expect(screen.queryByLabelText(/account type|role/i)).not.toBeInTheDocument();
});
test('Start Giving requires login, preserves intent through registration and returns to the existing plans dashboard', async () => {
  mount(); await click(screen.getByRole('link', { name: 'Start Giving' }));
  expect(await screen.findByRole('heading', { name: 'Login' })).toBeInTheDocument();
  await click(screen.getByRole('link', { name: 'Register Here' }));
  expect(await screen.findByRole('heading', { name: 'Register' })).toBeInTheDocument();
  expect(screen.queryByLabelText(/role|giver|receiver|buyer|seller|account type/i)).not.toBeInTheDocument();
  for (const [label, value] of [['First name', 'Neighbor'], ['Last name', 'Member'], ['Email', user.email], ['Password', 'isolated-long-password']]) fireEvent.change(screen.getByLabelText(label), { target: { value } });
  await act(async () => { fireEvent.submit(screen.getByRole('button', { name: 'Register', exact: true }).closest('form')); });
  expect(await screen.findByRole('heading', { name: 'My move-out plans' })).toBeInTheDocument();
  const [, options] = fetch.mock.calls.find(([url]) => url.endsWith('/api/auth/register'));
  expect(Object.keys(JSON.parse(options.body)).sort()).toEqual(['email', 'firstName', 'lastName', 'password']);
  expect(screen.getByText('Signed in as Neighbor')).toBeInTheDocument();
});
test('login preserves a protected inventory URL including edit query and fragment', async () => {
  const path = `/app/plans/${plan.id}/items?edit=${item.id}#inventory`;
  mount(path); await screen.findByRole('heading', { name: 'Login' }); await login();
  expect(await screen.findByRole('heading', { name: 'Plan inventory' })).toBeInTheDocument();
  expect(screen.getByTestId('route')).toHaveTextContent(path);
  expect(await screen.findByLabelText('Item name', { exact: true })).toHaveValue(item.name);
});
test('a protected shared pickup action survives login and registration navigation in both directions', async () => {
  const path = `/app/items/${item.id}/request`;
  mount(path); await screen.findByRole('heading', { name: 'Login' });
  await click(screen.getByRole('link', { name: 'Register Here' })); await screen.findByRole('heading', { name: 'Register' });
  await click(screen.getByRole('link', { name: 'Login', exact: true })); await login();
  expect(await screen.findByLabelText('Pickup date and time')).toBeInTheDocument();
  expect(screen.getByTestId('route')).toHaveTextContent(path);
  expect(context('Find Free Items').getByRole('link', { name: 'My pickup requests' })).toHaveAttribute('href', '/app/pickups');
});
test('one account gives in Pasadena and searches Irvine without copying or enforcing its plan location', async () => {
  sessionUser = user; mount('/app/plans');
  expect(await screen.findByRole('link', { name: 'Pasadena move' })).toBeInTheDocument();
  await click(primary().getByRole('link', { name: 'Find Free Items' }));
  await act(async () => fireEvent.change(screen.getByLabelText('State'), { target: { value: '06' } }));
  await act(async () => fireEvent.change(screen.getByLabelText('Metro area'), { target: { value: '31080' } }));
  await click(screen.getByRole('button', { name: /^Filters/ }));
  await screen.findByRole('option', { name: 'Irvine' }); expect(screen.getByLabelText('City', { exact: true })).toHaveValue('');
  fireEvent.change(screen.getByLabelText('City', { exact: true }), { target: { value: 'Irvine' } });
  await click(screen.getByRole('button', { name: 'Find free items' }));
  await waitFor(() => expect(screen.getByTestId('route')).toHaveTextContent('/app/items?stateId=06&metroId=31080&city=Irvine'));
  await click(primary().getByRole('link', { name: 'Give Away' })); await screen.findByRole('link', { name: 'Pasadena move' });
  await click(screen.getByRole('button', { name: 'Browser Back' }));
  expect(await screen.findByLabelText('City', { exact: true })).toHaveValue('Irvine');
  expect(screen.getByText('Signed in as Neighbor')).toBeInTheDocument();
  expect(fetch.mock.calls.some(([, options]) => options.method !== undefined && options.method !== 'GET')).toBe(false);
});
test('Give Away provides consolidated incoming requests and per-plan inventory/clearance without another dashboard', async () => {
  sessionUser = user; mount('/app/plans');
  await click(await screen.findByRole('link', { name: 'Manage items & clearance progress' }));
  expect(await screen.findByText('0 of 1 items cleared')).toBeInTheDocument();
  expect(context('Give Away').getByRole('link', { name: 'Items & clearance progress' })).toHaveAttribute('aria-current', 'location');
  await click(context('Give Away').getByRole('link', { name: 'Incoming requests' }));
  expect(await screen.findByRole('heading', { name: 'Incoming pickup requests' })).toBeInTheDocument();
  expect(fetch.mock.calls.some(([url]) => url.includes('/api/pickup-requests/received'))).toBe(true);
  detailRole = 'giver'; await click(await screen.findByRole('link', { name: /^View request from/ }));
  expect(await screen.findByRole('button', { name: 'Accept pickup' })).toBeInTheDocument();
  expect(primary().getByRole('link', { name: 'Give Away' })).toHaveAttribute('aria-current', 'location');
  await click(primary().getByRole('link', { name: 'Find Free Items' }));
  await click(context('Find Free Items').getByRole('link', { name: 'My pickup requests' }));
  expect(await screen.findByRole('heading', { name: 'My pickup requests' })).toBeInTheDocument();
  expect(fetch.mock.calls.some(([url]) => url.includes('/api/pickup-requests/sent'))).toBe(true);
});
test('public details and browser Back/Forward preserve shared discovery filters', async () => {
  mount('/app/items?stateId=06&metroId=31080&city=Irvine&neighborhood=Woodbridge&q=table');
  await click(await screen.findByRole('link', { name: item.name }));
  expect(await screen.findByRole('heading', { name: item.name })).toBeInTheDocument();
  expect(context('Find Free Items').getByRole('link', { name: 'Browse listings' })).toHaveAttribute('href', '/app/items?stateId=06&metroId=31080&city=Irvine&neighborhood=Woodbridge&q=table');
  await click(screen.getByRole('button', { name: 'Browser Back' }));
  expect(await screen.findByLabelText('Search items')).toHaveValue('table');
  expect(screen.getByLabelText('City', { exact: true })).toHaveValue('Irvine');
  await click(screen.getByRole('button', { name: 'Browser Forward' }));
  expect(await screen.findByRole('heading', { name: item.name })).toBeInTheDocument();
  expect(screen.getByLabelText('Share this listing')).toHaveValue('http://localhost/app/items/' + item.id);
});
test.each([['giver', 'Give Away', 'Incoming requests'], ['receiver', 'Find Free Items', 'My pickup requests']])('direct private request links use the server-reported %s context', async (role, label, link) => {
  sessionUser = user; detailRole = role; mount('/app/pickups/' + pickup.id);
  await screen.findByRole('heading', { name: item.name });
  await screen.findByText('Conversation loaded.');
  expect(context(label).getByRole('link', { name: link })).toHaveAttribute('aria-current', 'location');
  expect(screen.getByRole('link', { name: 'Back to requests' })).toHaveAttribute('href', role === 'giver' ? '/app/pickups/incoming' : '/app/pickups');
});
test('mobile menu exposes its state, supports Escape/focus return, and closes after navigation', async () => {
  sessionUser = user; mount(); await screen.findByText('Signed in as Neighbor');
  const button = screen.getByRole('button', { name: 'Menu' }); expect(button).toHaveAttribute('aria-expanded', 'false');
  await click(button); expect(button).toHaveAttribute('aria-expanded', 'true'); expect(button).toHaveAttribute('aria-controls', 'primary-navigation');
  fireEvent.keyDown(primary().getByRole('link', { name: 'Give Away' }), { key: 'Escape' });
  expect(button).toHaveAttribute('aria-expanded', 'false'); expect(button).toHaveFocus();
  await click(button); await click(primary().getByRole('link', { name: 'Give Away' }));
  expect(await screen.findByRole('heading', { name: 'My move-out plans' })).toBeInTheDocument();
  expect(button).toHaveAttribute('aria-expanded', 'false'); expect(document.getElementById('main-content')).toHaveFocus();
});
test('brand and default account/logout navigation return to the two-path homepage', async () => {
  sessionUser = user; mount('/app/profile'); await screen.findByRole('heading', { name: 'Your account' });
  expect(primary().getByRole('link', { name: 'Account' })).toHaveAttribute('aria-current', 'location');
  await click(screen.getByRole('link', { name: 'Move-Out Marketplace' })); expect(screen.getByRole('link', { name: 'Start Giving' })).toBeInTheDocument();
  await click(screen.getByRole('button', { name: 'Logout' }));
  expect(primary().getByRole('link', { name: 'Account' })).toHaveAttribute('href', '/app/login');
  expect(screen.getByTestId('route')).toHaveTextContent('/');
});
test('existing demo routes and item detail links remain usable outside the primary journeys', async () => {
  mount(); await click(screen.getByRole('link', { name: 'Demo gift collection' }));
  expect(await screen.findByText('Original chair')).toBeInTheDocument();
  await click(screen.getByRole('button', { name: 'View Details' }));
  expect(await screen.findByRole('heading', { name: 'Original chair' })).toBeInTheDocument();
  await click(screen.getByRole('button', { name: 'Back', exact: true }));
  expect(await screen.findByRole('heading', { name: 'Demo gift collection' })).toBeInTheDocument();
  await click(screen.getByRole('link', { name: 'Demo gift search' })); expect(await screen.findByRole('button', { name: 'Search', exact: true })).toBeInTheDocument();
});
test.each(['https://example.invalid/', '//example.invalid', '/app/login?again=1', '/app/register#again'])('unsafe or looping login destination %s returns to the homepage', async from => {
  mount({ pathname: '/app/login', state: { from } }); await screen.findByRole('heading', { name: 'Login' }); await login();
  expect(await screen.findByRole('link', { name: 'Explore Free Items' })).toBeInTheDocument();
  expect(screen.getByTestId('route')).toHaveTextContent('/');
});
