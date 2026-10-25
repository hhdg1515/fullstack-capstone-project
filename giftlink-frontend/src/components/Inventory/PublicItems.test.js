import React from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useLocation, useNavigate } from 'react-router-dom';
import PublicItems from './PublicItems';

const day = offset => new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10);
const a = { id: '64a000000000000000000001', name: 'Kitchen supplies', description: 'A full box of cookware and utensils.', category: 'Kitchen & craft',
  city: 'Oakland', neighborhood: 'Temescal', status: 'available', availability: 'now', availableFrom: null, availableUntil: null,
  effectiveAvailableUntil: day(20), moveOutDeadline: day(20), publishedAt: '2026-01-01T12:00:00.000Z' };
const b = { ...a, id: '64a000000000000000000002', name: 'Reading lamp', availability: 'later', availableFrom: day(5), neighborhood: 'Rockridge' };
const places = { locations: [{ city: 'Oakland', neighborhoods: ['Temescal', 'Rockridge'] }, { city: 'Berkeley', neighborhoods: ['Temescal', 'Downtown'] }], truncated: false };
const reply = (status, data) => ({ status, ok: status >= 200 && status < 300, json: async () => data });
const feed = (items, cursor = null) => reply(200, { items, today: day(0), page: { limit: 12, hasMore: Boolean(cursor), nextCursor: cursor } });
const pending = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
let handler;
let locationHandler;
function Navigation() {
  const location = useLocation(); const navigate = useNavigate();
  return <><output aria-label="Current URL">{location.pathname}{location.search}</output><button onClick={() => navigate(-1)}>Browser back</button></>;
}
function mount(path = '/app/items') {
  return render(<MemoryRouter initialEntries={Array.isArray(path) ? path : [path]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
    <Navigation /><Routes><Route path="/app/items" element={<PublicItems />} /><Route path="/app/items/:itemId" element={<PublicItems />} /></Routes>
  </MemoryRouter>);
}
beforeEach(() => {
  handler = async () => feed([a, b]); locationHandler = async () => reply(200, places);
  global.fetch = jest.fn(async (url, options) => url.endsWith('/locations') ? locationHandler(url, options) : handler(url, options));
});
const ready = () => screen.findByRole('link', { name: a.name });
const submit = async () => { await act(async () => { fireEvent.submit(screen.getByRole('button', { name: 'Find free items' }).closest('form')); }); };
const click = async name => { await act(async () => { fireEvent.click(screen.getByRole('button', { name })); }); };
const apiCalls = () => fetch.mock.calls.filter(([url]) => !url.endsWith('/locations'));

test('anonymous discovery needs no account or location and shows useful now/later text cards', async () => {
  mount(); await ready();
  expect(screen.getByLabelText('City')).toHaveValue(''); expect(screen.getByLabelText('Neighborhood')).toHaveValue('');
  const cards = screen.getByRole('list', { name: 'Available items' });
  expect(within(cards).getByText('Available Now')).toBeInTheDocument(); expect(within(cards).getByText('Available Later')).toBeInTheDocument();
  expect(within(cards).getAllByText(a.category)).toHaveLength(2); expect(within(cards).getByText(/Pickup from: Immediately/)).toBeInTheDocument();
  expect(within(cards).getByText('Temescal, Oakland · Free')).toBeInTheDocument();
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
  mount(); await ready(); await click(/^Filters/); await screen.findByRole('option', { name: 'Oakland' });
  fireEvent.change(screen.getByLabelText('Neighborhood'), { target: { value: 'Rockridge' } });
  fireEvent.change(screen.getByLabelText('City'), { target: { value: 'Berkeley' } });
  expect(screen.getByLabelText('Neighborhood')).toHaveValue('');
  expect(within(screen.getByLabelText('Neighborhood')).queryByRole('option', { name: 'Rockridge' })).not.toBeInTheDocument();
  await submit(); await waitFor(() => expect(screen.getByLabelText('Current URL')).toHaveTextContent('city=Berkeley'));
  expect(screen.getByLabelText('Current URL')).not.toHaveTextContent('neighborhood=');
});
test('neighborhood-only filtering spans cities and does not require an eligibility location', async () => {
  mount(); await ready(); await click(/^Filters/); await screen.findByRole('option', { name: 'Oakland' });
  expect(within(screen.getByLabelText('Neighborhood')).getAllByRole('option', { name: 'Temescal' })).toHaveLength(1);
  fireEvent.change(screen.getByLabelText('Neighborhood'), { target: { value: 'Temescal' } }); await submit();
  await waitFor(() => expect(screen.getByLabelText('Current URL')).toHaveTextContent('neighborhood=Temescal'));
  expect(screen.getByLabelText('Current URL')).not.toHaveTextContent('city=');
});
test.each(['now', 'later'])('applies the %s availability filter without confusing it with publication order', async availability => {
  mount(); await ready(); await click(/^Filters/);
  fireEvent.change(screen.getByLabelText('Pickup availability'), { target: { value: availability } }); await submit();
  await waitFor(() => expect(apiCalls().some(([url]) => new URL(url, 'http://localhost').searchParams.get('availability') === availability)).toBe(true));
});
test('selected pickup dates and deadline sorting are preserved together in the request and URL', async () => {
  mount(); await ready(); await click(/^Filters/);
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
  await waitFor(() => expect(screen.getByLabelText('Current URL')).toHaveTextContent(/^\/app\/items$/));
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
  await click(/^Filters/);
  expect(await screen.findByRole('option', { name: 'Berkeley' })).toBeInTheDocument();
});
test('loading, empty, error and retry states support searching again', async () => {
  const request = pending(); handler = () => request.promise;
  mount(); expect(screen.getByText('Loading listings…')).toBeInTheDocument();
  await act(async () => request.resolve(reply(500, { error: { message: 'Listings failed' } })));
  expect(await screen.findByRole('alert')).toHaveTextContent('Listings failed');
  handler = async () => feed([]); await click('Retry results');
  expect(await screen.findByText(/No available items match/)).toBeInTheDocument();
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
  expect(screen.getByRole('link', { name: 'Back to free items' })).toHaveAttribute('href', '/app/items?city=Oakland&availability=now');
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
test('filters start collapsed and opening or closing them neither fetches nor discards an unsubmitted search', async () => {
  mount(); await ready();
  expect(screen.getByRole('button', { name: 'Filters' })).toHaveAttribute('aria-expanded', 'false');
  expect(screen.getByLabelText('City')).not.toBeVisible();
  expect(screen.getByRole('button', { name: 'Find free items' })).toBeVisible();
  expect(screen.queryByRole('button', { name: 'Refresh listings' })).not.toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('Search items'), { target: { value: 'Unsaved kitchen search' } });
  const count = fetch.mock.calls.length;
  await click('Filters'); expect(screen.getByLabelText('City')).toBeVisible();
  await click('Filters'); expect(screen.getByLabelText('City')).not.toBeVisible();
  expect(screen.getByLabelText('Search items')).toHaveValue('Unsaved kitchen search');
  expect(fetch).toHaveBeenCalledTimes(count);
});
test('shared URL conditions remain visible while controls are collapsed and reopen with their saved values', async () => {
  mount('/app/items?q=lamp&city=Oakland&availability=later&sort=deadline'); await ready();
  expect(screen.getByRole('button', { name: 'Filters (3)' })).toHaveAttribute('aria-expanded', 'false');
  expect(screen.getByLabelText('Applied filters')).toHaveTextContent('Search: lamp · City: Oakland · Pickup: later · Sort: earliest pickup deadline');
  await click('Filters (3)'); expect(screen.getByLabelText('City')).toBeVisible();
  expect(screen.getByLabelText('City')).toHaveValue('Oakland');
  expect(screen.getByLabelText('Pickup availability')).toHaveValue('later');
});
test('an incomplete date filter reopens with an actionable error and safe focus, then applies without hiding focus', async () => {
  mount(); await ready(); await click('Filters');
  fireEvent.change(screen.getByLabelText('Pickup availability'), { target: { value: 'date' } });
  await click('Filters'); const reads = apiCalls().length;
  await submit();
  expect(screen.getByRole('alert')).toHaveTextContent('Choose today or a later pickup date');
  expect(screen.getByLabelText('Pickup date (UTC)')).toHaveFocus();
  expect(screen.getByLabelText('Pickup date (UTC)')).toHaveAttribute('aria-invalid', 'true');
  expect(apiCalls()).toHaveLength(reads);
  fireEvent.change(screen.getByLabelText('Pickup date (UTC)'), { target: { value: day(2) } });
  await submit(); await ready();
  expect(screen.getByRole('button', { name: 'Filters (1)' })).toHaveFocus();
  expect(screen.getByLabelText('Pickup date (UTC)')).not.toBeVisible();
  expect(screen.getByLabelText('Applied filters')).toHaveTextContent(day(2));
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});
test('Find free items refreshes results/options without adding an identical history entry', async () => {
  mount(['/app/items?q=before', '/app/items?q=lamp']); await ready();
  const reads = apiCalls().length, locations = fetch.mock.calls.filter(([url]) => url.endsWith('/locations')).length;
  await submit(); await ready();
  expect(apiCalls()).toHaveLength(reads + 1);
  expect(fetch.mock.calls.filter(([url]) => url.endsWith('/locations'))).toHaveLength(locations + 1);
  await click('Clear filters'); await ready();
  await click('Browser back'); await ready();
  expect(screen.getByLabelText('Search items')).toHaveValue('lamp');
  await click('Browser back'); await ready();
  expect(screen.getByLabelText('Search items')).toHaveValue('before');
});
