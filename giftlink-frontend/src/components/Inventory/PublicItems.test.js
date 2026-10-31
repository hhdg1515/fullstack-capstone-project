jest.mock('../../context/AuthContext', () => ({ useAppContext: () => mockAuth }));
jest.mock('../../api/usePublicCatalog', () => ({ __esModule: true, default: path => ({ data: require('../../test-support/catalogs')[path === '/api/regions' ? 'regions' : 'taxonomy'] }) }));
import React from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useLocation, useNavigate } from 'react-router-dom';
import PublicItems from './PublicItems';

const day = offset => new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10);
const a = { id: '64a000000000000000000001', name: 'Kitchen supplies', description: 'A full box of cookware and utensils.', category: 'Kitchen & craft',
  city: 'Oakland', neighborhood: 'Temescal', metroId: '41860', stateId: '06', pickupTimeZone: 'UTC', isOwner: false, status: 'available', isReserved: false, availability: 'now', availableFrom: null, availableUntil: null,
  effectiveAvailableUntil: day(20), moveOutDeadline: day(20), publishedAt: '2026-01-01T12:00:00.000Z' };
const b = { ...a, id: '64a000000000000000000002', name: 'Reading lamp', availability: 'later', availableFrom: day(5), neighborhood: 'Rockridge' };
const places = { locations: [{ city: 'Oakland', neighborhoods: ['Temescal', 'Rockridge'] }, { city: 'Berkeley', neighborhoods: ['Temescal', 'Downtown'] }], truncated: false };
const reply = (status, data) => ({ status, ok: status >= 200 && status < 300, json: async () => data });
const feed = (items, cursor = null, total = items.length ? 2 : 0) => reply(200, { items, total, today: day(0), page: { limit: 12, hasMore: Boolean(cursor), nextCursor: cursor } });
const pending = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
let mockAuth;
let handler;
let locationHandler;
function Navigation() {
  const location = useLocation(); const navigate = useNavigate();
  return <><output aria-label="Current URL">{location.pathname}{location.search}</output><button onClick={() => navigate(-1)}>Browser back</button></>;
}
function mount(path = '/app/items', unselected = false) {
  const regional = value => {
    if (typeof value !== 'string' || !value.match(/^\/app\/items(?:\?|$)/) || unselected) return value;
    const url = new URL(value, 'http://localhost');
    if (!url.searchParams.has('stateId') && !url.searchParams.has('metroId')) { url.searchParams.set('stateId', '06'); url.searchParams.set('metroId', '41860'); }
    return url.pathname + url.search;
  };
  path = Array.isArray(path) ? path.map(regional) : regional(path);
  return render(<MemoryRouter initialEntries={Array.isArray(path) ? path : [path]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
    <Navigation /><Routes><Route path="/app/items" element={<PublicItems />} /><Route path="/app/items/:itemId" element={<PublicItems />} /></Routes>
  </MemoryRouter>);
}
beforeEach(() => {
  mockAuth = undefined; localStorage.clear();
  handler = async () => feed([a, b]); locationHandler = async () => reply(200, places);
  global.fetch = jest.fn(async (url, options) => url.includes('/api/items/locations') ? locationHandler(url, options) : handler(url, options));
});
const ready = () => screen.findByRole('link', { name: a.name });
const submit = async () => { await act(async () => { fireEvent.submit(screen.getByRole('button', { name: 'Find free items' }).closest('form')); }); };
const click = async name => { await act(async () => { fireEvent.click(screen.getByRole('button', { name })); }); };
const apiCalls = () => fetch.mock.calls.filter(([url]) => !url.includes('/api/items/locations'));

const publicPhoto = '64b000000000000000000001';
const publicVariant = name => ({ url: `/api/item-images/${publicPhoto}/${name}`, width: 300, height: 200 });
test('optional malformed cover data cannot hide real counts or send requests to an external image host', async () => {
  handler = async () => feed([{ ...a, imageAvailability: 'ready', coverImage: { id: publicPhoto, thumbnail: { ...publicVariant('thumbnail'), url: 'https://example.invalid/private' } } }], null, 1);
  mount(); await ready();
  expect(screen.getByRole('heading', { name: '1 available item' })).toBeInTheDocument();
  expect(screen.getByText('Photo unavailable')).toBeInTheDocument();
  expect(screen.queryByRole('img')).not.toBeInTheDocument();
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});
test('authoritative refresh removes a revoked gallery and its request action', async () => {
  handler = async () => reply(200, { item: { ...a, imageAvailability: 'ready', images: [{ id: publicPhoto, thumbnail: publicVariant('thumbnail'), display: publicVariant('display') }] } });
  mount('/app/items/' + a.id);
  expect(await screen.findByRole('img', { name: a.name + ' (1 of 1)' })).toBeInTheDocument();
  handler = async () => reply(404, { error: { code: 'NOT_FOUND', message: 'Item not found' } });
  await click('Refresh listings');
  expect(await screen.findByRole('alert')).toHaveTextContent('This listing is no longer available.');
  expect(screen.queryByRole('img')).not.toBeInTheDocument();
  expect(screen.queryByRole('link', { name: 'Request pickup' })).not.toBeInTheDocument();
});

test('uses the server owner flag to replace the public request action without hiding the listing', async () => {
  handler = async () => reply(200, { item: { ...a, pickupTimeZone: 'UTC', isOwner: true } });
  mount('/app/items/' + a.id);
  expect(await screen.findByText('Your listing.')).toBeInTheDocument();
  expect(screen.getByRole('heading', { name: a.name })).toBeInTheDocument();
  expect(screen.queryByRole('link', { name: 'Request pickup' })).not.toBeInTheDocument();
});

test.each(['/app/items/' + a.id])('reserved items never promise immediate availability at %s', async path => {
  const reserved = { ...a, isReserved: true, pickupTimeZone: 'UTC' };
  handler = async url => url.includes('/api/items?') ? feed([reserved]) : reply(200, { item: reserved });
  mount(path);
  expect(await screen.findByText('Pickup arranged')).toBeInTheDocument();
  const content = path === '/app/items' ? within(screen.getByRole('list', { name: 'Available items' })) : screen;
  expect(content.queryByText('Available Now')).not.toBeInTheDocument();
  expect(screen.queryByRole('link', { name: 'Request pickup' })).not.toBeInTheDocument();
});
test('refreshing a released listing restores its request action from the new server response', async () => {
  let isReserved = true;
  handler = async () => reply(200, { item: { ...a, pickupTimeZone: 'UTC', isReserved } });
  mount('/app/items/' + a.id); await screen.findByText('Pickup arranged');
  isReserved = false; await click('Refresh listings');
  expect(await screen.findByRole('link', { name: 'Request pickup' })).toBeInTheDocument();
  expect(screen.getByText('Available Now')).toBeInTheDocument();
});
test('a listing awaiting giver setup does not advertise immediate pickup', async () => {
  handler = async () => reply(200, { item: { ...a, pickupTimeZone: null } });
  mount('/app/items/' + a.id);
  expect(await screen.findByText('Pickup setup needed')).toBeInTheDocument();
  expect(screen.queryByText('Available Now')).not.toBeInTheDocument();
  expect(screen.queryByRole('link', { name: 'Request pickup' })).not.toBeInTheDocument();
});
test('an older response without reservation data describes a window rather than inventing availability', async () => {
  handler = async () => reply(200, { item: { ...a, pickupTimeZone: 'UTC', isReserved: undefined } });
  mount('/app/items/' + a.id);
  expect(await screen.findByText('Pickup window')).toBeInTheDocument();
  expect(screen.getByText('Current pickup availability will be checked when you send a request.')).toBeInTheDocument();
  expect(screen.queryByText('Available Now')).not.toBeInTheDocument();
});

test('anonymous discovery uses the selected metro without an account and shows useful now/later text cards', async () => {
  mount(); await ready();
  expect(screen.getByLabelText('City')).toHaveValue(''); expect(screen.getByLabelText('Neighborhood')).toHaveValue('');
  const cards = screen.getByRole('list', { name: 'Available items' });
  expect(within(cards).getByText('Available Now')).toBeInTheDocument(); expect(within(cards).getByText('Available Later')).toBeInTheDocument();
  expect(within(cards).getAllByText(a.category)).toHaveLength(2); expect(within(cards).getAllByText(/Pickup until/)).toHaveLength(2);
  expect(within(cards).getByText('Temescal, Oakland, CA')).toBeInTheDocument();
  expect(fetch.mock.calls.every(([url]) => url.includes('/api/items'))).toBe(true);
  expect(screen.queryByRole('img')).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /pickup request|reserve|login/i })).not.toBeInTheDocument();
});
test('search applies a name/description/tag phrase on the server and persists it in the URL', async () => {
  mount(); await ready();
  fireEvent.change(screen.getByLabelText('Search items'), { target: { value: '  cookware   and utensils ' } }); await submit();
  await waitFor(() => expect(screen.getByLabelText('Current URL')).toHaveTextContent('q=cookware+and+utensils'));
  await waitFor(() => expect(apiCalls().some(([url]) => new URL(url, 'http://localhost').searchParams.get('q') === 'cookware and utensils')).toBe(true));
  expect(screen.getByLabelText('Search items')).toHaveValue('cookware and utensils');
});
test('city options populate from listings and changing city clears an incompatible neighborhood', async () => {
  mount(); await ready(); await screen.findByRole('option', { name: 'Oakland' });
  fireEvent.change(screen.getByLabelText('Neighborhood'), { target: { value: 'Rockridge' } });
  fireEvent.change(screen.getByLabelText('City'), { target: { value: 'Berkeley' } });
  expect(screen.getByLabelText('Neighborhood')).toHaveValue('');
  expect(within(screen.getByLabelText('Neighborhood')).queryByRole('option', { name: 'Rockridge' })).not.toBeInTheDocument();
  await submit(); await waitFor(() => expect(screen.getByLabelText('Current URL')).toHaveTextContent('city=Berkeley'));
  expect(screen.getByLabelText('Current URL')).not.toHaveTextContent('neighborhood=');
});
test('neighborhood-only filtering spans cities and does not require an eligibility location', async () => {
  mount(); await ready(); await screen.findByRole('option', { name: 'Oakland' });
  expect(within(screen.getByLabelText('Neighborhood')).getAllByRole('option', { name: 'Temescal' })).toHaveLength(1);
  fireEvent.change(screen.getByLabelText('Neighborhood'), { target: { value: 'Temescal' } }); await submit();
  await waitFor(() => expect(screen.getByLabelText('Current URL')).toHaveTextContent('neighborhood=Temescal'));
  expect(screen.getByLabelText('Current URL')).not.toHaveTextContent('city=');
});
test.each(['now', 'later'])('applies the %s availability filter without confusing it with publication order', async availability => {
  mount(); await ready();
  fireEvent.change(screen.getByLabelText('Pickup availability'), { target: { value: availability } }); await submit();
  await waitFor(() => expect(apiCalls().some(([url]) => new URL(url, 'http://localhost').searchParams.get('availability') === availability)).toBe(true));
});
test('selected pickup dates and deadline sorting are preserved together in the request and URL', async () => {
  mount(); await ready();
  fireEvent.change(screen.getByLabelText('Pickup availability'), { target: { value: 'date' } });
  expect(screen.getByLabelText('Pickup date (UTC)')).toHaveAttribute('min', day(0));
  fireEvent.change(screen.getByLabelText('Pickup date (UTC)'), { target: { value: day(6) } });
  fireEvent.change(screen.getByLabelText('Sort items'), { target: { value: 'deadline' } }); await submit();
  await waitFor(() => expect(apiCalls().some(([url]) => { const query = new URL(url, 'http://localhost').searchParams; return query.get('date') === day(6) && query.get('sort') === 'deadline'; })).toBe(true));
  expect(screen.getByLabelText('Current URL')).toHaveTextContent('availability=date');
});
test('shared URLs restore filters and browser back restores the previous query after clearing', async () => {
  mount('/app/items?q=lamp&city=Oakland&availability=later&sort=deadline'); await ready();
  expect(screen.getByLabelText('Search items')).toHaveValue('lamp'); expect(screen.getByLabelText('City')).toHaveValue('Oakland');
  expect(screen.getByLabelText('Sort items')).toHaveValue('deadline');
  await click('Clear filters');
  await waitFor(() => expect(screen.getByLabelText('Current URL')).toHaveTextContent(/^\/app\/items\?stateId=06&metroId=41860$/));
  expect(screen.getByLabelText('Pickup availability')).toHaveValue('all');
  await click('Browser back');
  await waitFor(() => expect(screen.getByLabelText('Search items')).toHaveValue('lamp'));
  expect(screen.getByLabelText('City')).toHaveValue('Oakland'); expect(screen.getByLabelText('Pickup availability')).toHaveValue('later');
});
test('Load More appends a server page, retains filters, deduplicates live records, and prevents duplicate clicks', async () => {
  const next = pending();
  handler = async url => new URL(url, 'http://localhost').searchParams.has('cursor') ? next.promise : feed([a], 'opaque-next');
  mount('/app/items?city=Oakland&sort=deadline'); await ready();
  await click('Load more');
  expect(screen.getByRole('button', { name: 'Loading more…' })).toBeDisabled();
  const query = new URL(apiCalls().at(-1)[0], 'http://localhost').searchParams;
  expect(query.get('cursor')).toBe('opaque-next'); expect(query.get('city')).toBe('Oakland'); expect(query.get('sort')).toBe('deadline');
  await act(async () => next.resolve(feed([a, b])));
  expect(await screen.findByRole('link', { name: b.name })).toBeInTheDocument();
  expect(screen.getAllByRole('link', { name: a.name })).toHaveLength(1); expect(screen.getByText('Showing 2 items')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Load more' })).not.toBeInTheDocument();
});
test.each(['STALE_CURSOR', 'INVALID_CURSOR'])('%s offers a clean restart instead of reusing a broken continuation', async code => {
  let first = true;
  handler = async url => {
    if (new URL(url, 'http://localhost').searchParams.has('cursor')) return reply(code === 'STALE_CURSOR' ? 409 : 400, { error: { code, message: 'Refresh results to start again' } });
    const data = first ? feed([a], 'old-cursor') : feed([b]); first = false; return data;
  };
  mount(); await ready(); await click('Load more');
  expect(await screen.findByRole('alert')).toHaveTextContent('Refresh results');
  expect(screen.queryByRole('button', { name: 'Load more' })).not.toBeInTheDocument();
  await click('Start again');
  expect(await screen.findByRole('link', { name: b.name })).toBeInTheDocument();
  expect(screen.queryByRole('link', { name: a.name })).not.toBeInTheDocument();
});
test('a temporary next-page failure retries that page while retaining current results', async () => {
  let tries = 0;
  handler = async url => {
    if (!new URL(url, 'http://localhost').searchParams.has('cursor')) return feed([a], 'next');
    return ++tries === 1 ? reply(503, { error: { message: 'Search is busy' } }) : feed([b]);
  };
  mount(); await ready(); await click('Load more');
  expect(await screen.findByRole('alert')).toHaveTextContent('Search is busy'); expect(screen.getByRole('link', { name: a.name })).toBeInTheDocument();
  await click('Retry results');
  expect(await screen.findByRole('link', { name: b.name })).toBeInTheDocument();
  expect(tries).toBe(2);
});
test('changing filters ignores an outstanding old-page response and resets pagination', async () => {
  const old = pending();
  handler = async url => {
    const query = new URL(url, 'http://localhost').searchParams;
    if (query.has('cursor')) return old.promise;
    return query.has('q') ? feed([b]) : feed([a], 'old');
  };
  mount(); await ready(); await click('Load more');
  fireEvent.change(screen.getByLabelText('Search items'), { target: { value: 'lamp' } }); await submit();
  expect(await screen.findByRole('link', { name: b.name })).toBeInTheDocument();
  await act(async () => old.resolve(feed([{ ...a, name: 'Stale result' }])));
  expect(screen.queryByRole('link', { name: 'Stale result' })).not.toBeInTheDocument();
  expect(screen.queryByRole('link', { name: a.name })).not.toBeInTheDocument();
});
test('location metadata failures do not block anonymous browsing and have an independent retry', async () => {
  let calls = 0;
  locationHandler = async () => ++calls === 1 ? reply(500, { error: { message: 'Metadata failed' } }) : reply(200, places);
  mount(); await ready();
  expect(await screen.findByRole('alert')).toHaveTextContent('Location options could not be loaded');
  await click('Retry location options');

  expect(await screen.findByRole('option', { name: 'Berkeley' })).toBeInTheDocument();
});
test('loading, empty, error and retry states support searching again', async () => {
  const request = pending(); handler = () => request.promise;
  mount(); expect(screen.getByText('Loading listings…')).toBeInTheDocument();
  await act(async () => request.resolve(reply(500, { error: { message: 'Listings failed' } })));
  expect(await screen.findByRole('alert')).toHaveTextContent('Listings failed');
  handler = async () => feed([]); await click('Retry results');
  expect(await screen.findByText(/No available items in this metro/)).toBeInTheDocument();
});
test('anonymous direct detail shows full content, general location, pickup window and a copyable direct URL', async () => {
  handler = async () => reply(200, { item: b });
  const writeText = jest.fn().mockResolvedValue(); Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
  mount(`/app/items/${b.id}`);
  expect(await screen.findByRole('heading', { name: b.name, level: 1 })).toBeInTheDocument();
  expect(screen.getByText(b.description)).toBeInTheDocument(); expect(screen.getByText('Available Later')).toBeInTheDocument();
  expect(screen.getByLabelText('Share this listing')).toHaveValue(`http://localhost/app/items/${b.id}`);
  await click('Copy link');
  expect(await screen.findByText('Link copied.')).toBeInTheDocument(); expect(writeText).toHaveBeenCalledWith(`http://localhost/app/items/${b.id}`);
  expect(screen.queryByRole('button', { name: /reserve|request pickup/i })).not.toBeInTheDocument();
});
test('clipboard failure keeps the shareable URL accessible for manual copying', async () => {
  handler = async () => reply(200, { item: a });
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: jest.fn().mockRejectedValue(new Error('blocked')) } });
  mount(`/app/items/${a.id}`); await screen.findByRole('heading', { name: a.name });
  await click('Copy link');
  expect(await screen.findByText('Copy the link from the field above.')).toBeInTheDocument();
});
test('detail navigation returns to the applied filters and direct unavailable links reveal no item data', async () => {
  handler = async url => url.includes(a.id) ? reply(200, { item: a }) : feed([a]);
  mount('/app/items?city=Oakland&availability=now'); await ready(); await act(async () => { fireEvent.click(screen.getByRole('link', { name: a.name })); });
  expect(await screen.findByRole('heading', { name: a.name, level: 1 })).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Back to free items' })).toHaveAttribute('href', '/app/items?city=Oakland&availability=now&stateId=06&metroId=41860');
  handler = async () => reply(404, { error: { message: 'Listing unavailable' } });
  await click('Refresh listings');
  expect(await screen.findByRole('alert')).toHaveTextContent('This listing is no longer available');
  expect(screen.queryByLabelText('Share this listing')).not.toBeInTheDocument();
  expect(screen.queryByRole('heading', { name: a.name })).not.toBeInTheDocument();
});
test('focus refresh keeps an unsubmitted search draft while checking current public visibility', async () => {
  mount(); await ready(); fireEvent.change(screen.getByLabelText('Search items'), { target: { value: 'Unsaved search' } });
  await act(async () => { fireEvent(window, new Event('focus')); });
  expect(screen.getByLabelText('Search items')).toHaveValue('Unsaved search');
  expect(apiCalls().length).toBe(2);
});
test('filters stay visible without a toggle and editing them neither fetches nor discards an unsubmitted search', async () => {
  mount(); await ready();
  expect(screen.queryByRole('button', { name: /^Filters/ })).not.toBeInTheDocument();
  expect(screen.getByLabelText('City')).toBeVisible();
  expect(screen.getByRole('button', { name: 'Find free items' })).toBeVisible();
  expect(screen.queryByRole('button', { name: 'Refresh listings' })).not.toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('Search items'), { target: { value: 'Unsaved kitchen search' } });
  const count = fetch.mock.calls.length;
  expect(screen.getByLabelText('City')).toBeVisible();
  expect(screen.getByLabelText('City')).toBeVisible();
  expect(screen.getByLabelText('Search items')).toHaveValue('Unsaved kitchen search');
  expect(fetch).toHaveBeenCalledTimes(count);
});
test('shared URL conditions remain visible with their saved values', async () => {
  mount('/app/items?q=lamp&city=Oakland&availability=later&sort=deadline'); await ready();
  expect(screen.queryByRole('button', { name: /^Filters/ })).not.toBeInTheDocument();
  expect(screen.getByLabelText('Applied filters')).toHaveTextContent('Search: lamp · City: Oakland · Pickup: later · Sort: earliest pickup deadline');
  expect(screen.getByLabelText('City')).toBeVisible();
  expect(screen.getByLabelText('City')).toHaveValue('Oakland');
  expect(screen.getByLabelText('Pickup availability')).toHaveValue('later');
});
test('an incomplete common date filter has an actionable error and retains visible focus after applying', async () => {
  mount(); await ready();
  fireEvent.change(screen.getByLabelText('Pickup availability'), { target: { value: 'date' } });
  const reads = apiCalls().length;
  await submit();
  expect(screen.getByRole('alert')).toHaveTextContent('Choose today or a later pickup date');
  expect(screen.getByLabelText('Pickup date (UTC)')).toHaveFocus();
  expect(screen.getByLabelText('Pickup date (UTC)')).toHaveAttribute('aria-invalid', 'true');
  expect(apiCalls()).toHaveLength(reads);
  fireEvent.change(screen.getByLabelText('Pickup date (UTC)'), { target: { value: day(2) } });
  await submit(); await ready();
  expect(screen.getByLabelText('Pickup date (UTC)')).toBeVisible();
  expect(screen.getByLabelText('Pickup date (UTC)')).toBeVisible();
  expect(screen.getByLabelText('Applied filters')).toHaveTextContent(day(2));
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});
test('Find free items refreshes results/options without adding an identical history entry', async () => {
  mount(['/app/items?q=before', '/app/items?q=lamp']); await ready();
  const reads = apiCalls().length, locations = fetch.mock.calls.filter(([url]) => url.includes('/api/items/locations')).length;
  await submit(); await ready();
  expect(apiCalls()).toHaveLength(reads + 1);
  expect(fetch.mock.calls.filter(([url]) => url.includes('/api/items/locations'))).toHaveLength(locations + 1);
  await click('Clear filters'); await ready();
  await click('Browser back'); await ready();
  expect(screen.getByLabelText('Search items')).toHaveValue('lamp');
  await click('Browser back'); await ready();
  expect(screen.getByLabelText('Search items')).toHaveValue('before');
});

test('an unselected region asks where to browse without requesting any listings or showing a false zero', async () => {
  mount('/app/items', true);
  expect(screen.getByRole('heading', { name: 'Where would you like to find free items?' })).toBeInTheDocument();
  expect(screen.getByLabelText('State')).toBeVisible(); expect(screen.getByLabelText('Metro area')).toBeDisabled();
  expect(apiCalls()).toHaveLength(0); expect(screen.queryByText(/0 available/)).not.toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('State'), { target: { value: '06' } });
  expect(apiCalls()).toHaveLength(0);
  await act(async () => fireEvent.change(screen.getByLabelText('Metro area'), { target: { value: '41860' } })); await ready();
  expect(JSON.parse(localStorage.getItem('moveout.browse-region.v1'))).toEqual({ stateId: '06', metroId: '41860' });
  expect(screen.getByRole('button', { name: 'Change region' })).toHaveFocus();
});
test('a valid saved preference restores an unscoped URL and never writes an account or plan', async () => {
  localStorage.setItem('moveout.browse-region.v1', JSON.stringify({ stateId: '06', metroId: '41860' }));
  mount('/app/items', true); await ready();
  expect(screen.getByLabelText('Current URL')).toHaveTextContent('stateId=06&metroId=41860');
  expect(fetch.mock.calls.every(([, options]) => options.method === 'GET')).toBe(true);
});
test('an explicit URL overrides the saved preference and changing region clears granular filters', async () => {
  localStorage.setItem('moveout.browse-region.v1', JSON.stringify({ stateId: '06', metroId: '31080' }));
  mount('/app/items?stateId=06&metroId=41860&city=Oakland&neighborhood=Temescal&q=seat'); await ready();
  expect(screen.getByLabelText('Current URL')).toHaveTextContent('metroId=41860');
  await click('Change region');
  handler = async () => feed([{ ...a, metroId: '31080', name: 'Other metro item' }]);
  await act(async () => fireEvent.change(screen.getByLabelText('Metro area'), { target: { value: '31080' } }));
  await screen.findByRole('link', { name: 'Other metro item' });
  const url = screen.getByLabelText('Current URL').textContent;
  expect(url).toContain('metroId=31080'); expect(url).toContain('q=seat'); expect(url).not.toContain('city='); expect(url).not.toContain('neighborhood=');
  expect(fetch.mock.calls.every(([, options]) => options.method === 'GET')).toBe(true);
});
test.each(['not-json', JSON.stringify({ stateId: '06', metroId: 'unknown' })])('invalid stored preference %s cannot authorize a global search', async value => {
  localStorage.setItem('moveout.browse-region.v1', value); mount('/app/items', true);
  expect(screen.getByRole('heading', { name: 'Where would you like to find free items?' })).toBeInTheDocument(); expect(apiCalls()).toHaveLength(0);
});
test('blocked local storage does not prevent choosing a valid URL region', async () => {
  const get = jest.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('Blocked'); });
  const set = jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('Blocked'); });
  mount(); await ready(); expect(screen.getByRole('link', { name: a.name })).toBeInTheDocument(); get.mockRestore(); set.mockRestore();
});
test('an uncovered state explains limited coverage instead of showing an empty marketplace', async () => {
  mount('/app/items?stateId=02', true);
  expect(screen.getByText('No metros are listed for this state yet.')).toBeInTheDocument();
  expect(apiCalls()).toHaveLength(0); expect(screen.queryByText(/0 available|No available items/)).not.toBeInTheDocument();
});
test('controlled category/type/condition filters combine with text and reset incompatible type selection', async () => {
  mount(); await ready();
  fireEvent.change(screen.getByLabelText('Category'), { target: { value: 'living-room' } });
  fireEvent.change(screen.getByLabelText('Item type'), { target: { value: 'sofa' } });
  fireEvent.change(screen.getByLabelText('Condition'), { target: { value: 'good' } });
  fireEvent.change(screen.getByLabelText('Search items'), { target: { value: 'couch' } }); await submit();
  expect(screen.getByLabelText('Current URL')).toHaveTextContent('categoryId=living-room&itemTypeId=sofa&condition=good');
  fireEvent.change(screen.getByLabelText('Category'), { target: { value: 'office-lighting' } });
  expect(screen.getByLabelText('Item type')).toHaveValue(''); expect(screen.queryByRole('option', { name: 'Sofa' })).not.toBeInTheDocument();
});
test('the heading uses the backend filtered total, not the number of loaded rows', async () => {
  handler = async () => feed([a], 'more', 24); mount(); await ready();
  expect(screen.getByRole('heading', { name: /24 available/ })).toBeInTheDocument(); expect(screen.getByText('Showing 1 item')).toBeInTheDocument();
});
test('a changed total during pagination refreshes the first page instead of appending a mixed availability set', async () => {
  let reads = 0;
  handler = async url => ++reads === 1 ? feed([a], 'more', 2) : feed([b], null, 1);
  mount(); await ready(); await click('Load more'); await screen.findByRole('link', { name: b.name });
  expect(screen.queryByRole('link', { name: a.name })).not.toBeInTheDocument(); expect(reads).toBe(3);
  expect(screen.getByRole('heading', { name: /1 available/ })).toBeInTheDocument();
  expect(screen.getByText('Availability changed. Results have been refreshed.')).toBeVisible();
});
test.each([{ ...a, metroId: '31080' }, { ...a, isReserved: true }])('inconsistent regional response metadata cannot be advertised as available', async row => {
  handler = async () => feed([row]); mount();
  expect(await screen.findByRole('alert')).toHaveTextContent(/unavailable/i);
  expect(screen.queryByText(/No available items/)).not.toBeInTheDocument(); expect(screen.queryByRole('heading', { name: /\d+ available/ })).not.toBeInTheDocument();
});
test('missing counts are a service error instead of a fabricated empty or page-sized total', async () => {
  handler = async () => reply(200, { items: [], page: { hasMore: false, nextCursor: null } }); mount();
  expect(await screen.findByRole('alert')).toHaveTextContent(/unavailable/i); expect(screen.queryByText(/No available items/)).not.toBeInTheDocument();
});
test('owner cards remain visible with compact authoritative type and condition labels', async () => {
  handler = async () => feed([{ ...a, isOwner: true, classification: { itemType: { id: 'sofa', label: 'Sofa' }, condition: { id: 'good', label: 'Good' } } }]);
  mount(); await ready(); expect(screen.getByText('Your listing')).toBeInTheDocument(); expect(screen.getByText('Sofa · Kitchen & craft')).toBeInTheDocument(); expect(screen.getByText('Condition: Good')).toBeInTheDocument();
});

test('location-first hierarchy keeps the page title short, all filter controls visible', async () => {
  mount(); await ready();
  expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(/^Find free items$/);
  expect(screen.getByRole('region', { name: 'Browsing area' })).toHaveTextContent('San Francisco-Oakland-Berkeley · CA');
  for (const name of ['Category', 'Item type', 'Pickup availability', 'Sort items']) expect(screen.getByLabelText(name)).toBeVisible();
  expect(screen.getByLabelText('Item type')).toBeDisabled();
  expect(screen.getByLabelText('Item type')).toHaveTextContent('Choose a category first');
  for (const name of ['Condition', 'City', 'Neighborhood']) expect(screen.getByLabelText(name)).toBeVisible();
  const reads = apiCalls().length;
  await click('Change region'); expect(screen.getByLabelText('State')).toHaveFocus();
  expect(screen.getByRole('button', { name: 'Change region' })).toHaveAttribute('aria-expanded', 'true');
  await click('Change region'); expect(screen.getByLabelText('State')).not.toBeVisible(); expect(apiCalls()).toHaveLength(reads);
});
test('an invalid explicit URL never restores a different saved area or triggers a global query', () => {
  localStorage.setItem('moveout.browse-region.v1', JSON.stringify({ stateId: '06', metroId: '41860' }));
  mount('/app/items?stateId=06&metroId=unknown', true);
  expect(screen.getByText('This area selection is not supported. Choose a listed state and metro.')).toBeVisible();
  expect(apiCalls()).toHaveLength(0); expect(screen.queryByRole('heading', { name: /available/ })).not.toBeInTheDocument();
});
test('changing region removes the old cursor and local labels but retains shared classification and sort choices', async () => {
  mount('/app/items?stateId=06&metroId=41860&cursor=old&city=Oakland&neighborhood=Temescal&categoryId=living-room&itemTypeId=sofa&sort=deadline'); await ready();
  await click('Change region');
  handler = async () => feed([{ ...a, metroId: '31080' }]);
  await act(async () => fireEvent.change(screen.getByLabelText('Metro area'), { target: { value: '31080' } })); await ready();
  const query = new URL(screen.getByLabelText('Current URL').textContent, 'http://localhost').searchParams;
  for (const name of ['cursor', 'city', 'neighborhood']) expect(query.has(name)).toBe(false);
  expect(query.get('sort')).toBe('deadline'); expect(query.get('itemTypeId')).toBe('sofa'); expect(query.get('categoryId')).toBe('living-room');
  expect(screen.getByRole('button', { name: 'Change region' })).toHaveFocus();
});
test('Escape does not collapse filters or discard unsubmitted selections', async () => {
  mount(); await ready();
  fireEvent.change(screen.getByLabelText('Condition'), { target: { value: 'fair' } }); screen.getByLabelText('Condition').focus();
  screen.getByLabelText('Condition').focus(); fireEvent.keyDown(screen.getByLabelText('Condition'), { key: 'Escape' }); expect(screen.getByLabelText('Condition')).toHaveFocus();
  expect(screen.getByLabelText('Condition')).toBeVisible();
  expect(screen.getByLabelText('Condition')).toHaveValue('fair');
});

test('reset is offered only when useful and clears unsubmitted filters without losing the area', async () => {
  mount(); await ready(); expect(screen.queryByRole('button', { name: 'Clear filters' })).not.toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('Category'), { target: { value: 'living-room' } });
  await click('Clear filters'); await ready();
  expect(screen.getByLabelText('Category')).toHaveValue(''); expect(screen.getByLabelText('Current URL')).toHaveTextContent('metroId=41860');
  expect(screen.queryByRole('button', { name: 'Clear filters' })).not.toBeInTheDocument();
});

test.each([{ ...a, status: 'draft' }, { ...a, pickupTimeZone: 'not/a-zone' }, { ...a, effectiveAvailableUntil: '2026-02-30' }, { ...a, availability: 'reserved' }])('unsafe availability metadata produces a service error rather than a truthful-looking card', async row => {
  handler = async () => feed([row]); mount();
  expect(await screen.findByRole('alert')).toHaveTextContent(/unavailable/i);
  expect(screen.queryByRole('link', { name: a.name })).not.toBeInTheDocument();
  expect(screen.queryByRole('heading', { name: /\d+ available/ })).not.toBeInTheDocument();
});
test('cards expose real type/category, optional condition, location and UTC window without invented imagery', async () => {
  handler = async () => feed([{ ...b, classification: { category: { id: 'office-lighting', label: 'Office & Lighting' }, itemType: { id: 'lamp', label: 'Lamp' }, condition: null } }]);
  mount(); const link = await screen.findByRole('link', { name: b.name });
  const card = within(link.closest('li'));
  expect(card.getByRole('heading', { level: 3 })).toHaveTextContent(b.name);
  expect(card.getByText('Lamp · Office & Lighting')).toBeVisible();
  expect(card.getByText('Rockridge, Oakland, CA')).toBeVisible();
  expect(card.getByText('Free')).toBeVisible(); expect(card.getByText('(UTC)')).toBeVisible();
  expect(card.getByText(formatDate(b.availableFrom))).toHaveAttribute('datetime', b.availableFrom);
  expect(card.queryByText(/Condition:/)).not.toBeInTheDocument();
  expect(card.queryByRole('img')).not.toBeInTheDocument();
});
const formatDate = value => new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }).format(new Date(value + 'T00:00:00Z'));
test('next-page errors suppress current count claims and identify retained cards as previously loaded', async () => {
  handler = async url => url.includes('cursor=') ? reply(503, { error: { message: 'Search is busy' } }) : feed([a], 'next', 24);
  mount(); await ready(); await click('Load more');
  expect(await screen.findByRole('alert')).toHaveTextContent('Previously loaded items are shown below. Refresh to confirm availability.');
  expect(screen.queryByRole('heading', { name: /24 available/ })).not.toBeInTheDocument();
  expect(screen.queryByText(/Showing 1 item/)).not.toBeInTheDocument();
  expect(screen.getByRole('link', { name: a.name })).toBeVisible();
});
test('session changes clear owner-aware cards immediately and ignore an old account response', async () => {
  const old = pending(); let calls = 0;
  mockAuth = { status: 'authenticated', user: { id: 'account-a' } };
  handler = async () => ++calls === 1 ? feed([{ ...a, isOwner: true }]) : calls === 2 ? old.promise : feed([{ ...b, isOwner: false }]);
  mount(); await ready(); expect(screen.getByText('Your listing')).toBeVisible();
  await act(async () => { fireEvent(window, new Event('focus')); });
  mockAuth = { status: 'anonymous', user: null };
  fireEvent.change(screen.getByLabelText('Search items'), { target: { value: 'Session refresh' } });
  expect(screen.queryByText('Your listing')).not.toBeInTheDocument();
  await screen.findByRole('link', { name: b.name });
  await act(async () => old.resolve(feed([{ ...a, name: 'Stale owner listing', isOwner: true }])));
  expect(screen.queryByRole('link', { name: 'Stale owner listing' })).not.toBeInTheDocument();
  expect(screen.queryByText('Your listing')).not.toBeInTheDocument();
});
