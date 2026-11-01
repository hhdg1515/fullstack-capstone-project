// UX-2C2: requester and owner views of pickups bound to independent (v2)
// listings. Dates are local to the item's confirmed zone; links follow roles.
import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { AuthProvider } from '../../context/AuthContext';
import RequireAuth from '../RequireAuth';
import PublicItems from '../Inventory/PublicItems';
import { RequestPickup, PickupDetail } from './Pickups';

jest.mock('./PickupConversation', () => () => <section id="conversation"><h3 id="conversation-heading" tabIndex={-1}>Pickup conversation</h3></section>);
const zone = 'America/Los_Angeles';
const item = { id: '64b000000000000000000001', name: 'Independent bookshelf', description: 'Synthetic.', city: '', neighborhood: '', metroLabel: 'Los Angeles-Long Beach-Anaheim, CA',
  pickupTimeZone: zone, isReserved: false, availableFrom: null, effectiveAvailableUntil: '2030-07-03', availableUntil: '2030-07-03', availability: 'now',
  listingModel: 2, datePolicy: 'pickup-local', images: [], imageAvailability: 'unavailable', publishedAt: '2030-06-01T00:00:00Z', isOwner: false };
const requestFor = role => ({ id: '64b000000000000000000002', role, status: 'accepted', version: 2, note: '', proposedAt: '2030-07-02T17:00:00.000Z', localDateTime: '2030-07-02T10:00',
  timeZone: zone, counterpart: { firstName: role === 'giver' ? 'Reader' : 'Giver' }, history: [{ action: 'pending', actor: 'receiver', at: '2030-06-02T00:00:00Z' }],
  item: { id: item.id, name: item.name, description: '', category: '', city: '', neighborhood: '', status: 'available', availableFrom: null, effectiveAvailableUntil: '2030-07-03', listingModel: 2, datePolicy: 'pickup-local' },
  rescheduling: { proposal: null, canPropose: true, canAccept: false, canDecline: false, reason: null } });
const response = (data, status = 200) => ({ ok: status < 400, status, headers: new Headers({ 'Content-Type': 'application/json' }), json: async () => data });
let me, records;
function mount(path) {
  return render(<MemoryRouter initialEntries={[path]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}><AuthProvider><Routes>
    <Route path="/app/items/:itemId/request" element={<RequireAuth><RequestPickup /></RequireAuth>} />
    <Route path="/app/items/:itemId" element={<PublicItems />} />
    <Route path="/app/pickups/:requestId" element={<RequireAuth><PickupDetail /></RequireAuth>} />
    <Route path="/app/listings/:itemId" element={<h1>Owner listing</h1>} />
  </Routes></AuthProvider></MemoryRouter>);
}
beforeEach(() => {
  me = { id: 'receiver', firstName: 'Reader', lastName: 'Neighbor', email: 'reader@example.test' }; records = [];
  global.fetch = jest.fn(async (url, options = {}) => {
    records.push([options.method || 'GET', url, options.body && JSON.parse(options.body)]);
    if (url.endsWith('/api/me')) return response({ user: me });
    if (url.includes('/api/items/')) return response({ item });
    if (url.endsWith('/api/pickup-requests') && options.method === 'POST') return response({ request: requestFor('receiver') }, 201);
    return response({ request: requestFor(me.id === 'giver' ? 'giver' : 'receiver') });
  });
});
afterEach(() => jest.restoreAllMocks());

test('requester sees local-date rules in the confirmed zone and submits that zone exactly', async () => {
  mount('/app/items/' + item.id + '/request');
  expect(await screen.findByText(/through 2030-07-03 in America\/Los_Angeles\. The listing ends at the end of that local date\./)).toBeVisible();
  expect(screen.queryByText(/UTC date/)).not.toBeInTheDocument();
  expect(screen.getByText('Los Angeles-Long Beach-Anaheim, CA')).toBeVisible(); // no empty ", " when city/neighborhood are omitted
  fireEvent.change(screen.getByLabelText('Pickup date and time'), { target: { value: '2030-07-02T10:00' } });
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Send pickup request' })); });
  const sent = records.find(([method, url]) => method === 'POST' && url.endsWith('/api/pickup-requests'));
  expect(sent[2]).toEqual({ itemId: item.id, localDateTime: '2030-07-02T10:00', timeZone: zone, note: '' });
});

test('owner of an independent listing is pointed to My Listings, never to a request form', async () => {
  Object.assign(item, { isOwner: true });
  try {
    mount('/app/items/' + item.id + '/request');
    expect(await screen.findByText('Your listing. You cannot request your own item. Manage it from My Listings.')).toBeVisible();
    expect(screen.queryByLabelText('Pickup date and time')).not.toBeInTheDocument();
  } finally { Object.assign(item, { isOwner: false }); }
});

test('giver detail links back to the private listing and labels local pickup dates', async () => {
  me = { ...me, id: 'giver', firstName: 'Giver' };
  mount('/app/pickups/64b000000000000000000002');
  expect(await screen.findByText(/Pickup window: Now through 2030-07-03 \(local dates in America\/Los_Angeles\)/)).toBeVisible();
  expect(screen.getByRole('link', { name: 'View item' })).toHaveAttribute('href', '/app/listings/' + item.id);
});

test('requester detail links to the listing page instead of the owner view', async () => {
  mount('/app/pickups/64b000000000000000000002');
  expect(await screen.findByRole('link', { name: 'View item' })).toHaveAttribute('href', '/app/items/' + item.id);
  expect(screen.queryByRole('link', { name: 'Manage listing' })).not.toBeInTheDocument();
});

test('a delayed request detail from the previous account never renders for the next account', async () => {
  let release; const pending = new Promise(resolve => { release = resolve; });
  global.fetch.mockImplementation(async (url, options = {}) => {
    if (url.endsWith('/api/me')) return response({ user: me });
    // The server answers per account: the original participant gets the request, anyone else a 404.
    if (url.includes('/api/pickup-requests/')) { const actor = me.id; await pending; return actor === 'receiver' ? response({ request: requestFor('receiver') }) : response({ error: { code: 'PICKUP_NOT_FOUND', message: 'Pickup request unavailable' } }, 404); }
    return response({});
  });
  mount('/app/pickups/64b000000000000000000002');
  await waitFor(() => expect(global.fetch.mock.calls.some(([url]) => url.includes('/api/pickup-requests/'))).toBe(true));
  // Session identity changes (another account signs in) before the old response arrives.
  me = { id: 'someone-else', firstName: 'Other', lastName: 'Account', email: 'other@example.test' };
  await act(async () => { window.dispatchEvent(new Event('focus')); });
  await act(async () => { release(); });
  expect(screen.queryByText('Independent bookshelf')).not.toBeInTheDocument();
});
