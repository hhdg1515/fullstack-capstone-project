import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { ListingEditor, ListingRedirect } from './Listings';
import { getOwnerListing, actOnOwnerListing, updateOwnerListing } from '../../api/ownerListings';
jest.mock('../../api/usePublicCatalog', () => ({ __esModule: true, default: path => ({ data: require('../../test-support/catalogs')[path === '/api/regions' ? 'regions' : 'taxonomy'] }) }));
jest.mock('../../api/ownerListings', () => ({ getOwnerListing: jest.fn(), actOnOwnerListing: jest.fn(), updateOwnerListing: jest.fn(), createOwnerListing: jest.fn(), listOwnerListings: jest.fn() }));
const id = 'a'.repeat(24);
const listing = (status = 'available', capabilities = { editDraft: true, withdraw: true }) => ({ publicationEnabled: true, item: { id, name: 'Synthetic shelf', description: 'Useful household shelf', status, version: 3,
  classification: { category: { id: 'living-room' }, itemType: { id: 'bookshelf' } }, location: { stateId: '06', metroId: '31080', city: '', neighborhood: '' },
  pickup: { datePolicy: 'pickup-local', timeZone: 'America/Los_Angeles', timeZoneConfirmed: true, availableUntil: '2099-11-01' }, capabilities, photoPreview: { availability: 'none', images: [] } } });
const mount = (path = '/app/items/' + id + '/edit') => render(<MemoryRouter initialEntries={[path]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}><Routes>
  <Route path="/app/items/:itemId/edit" element={<ListingEditor />} /><Route path="/app/listings/:itemId" element={<ListingRedirect />} />
  <Route path="/app/listings" element={<h1>My Listings page</h1>} />
</Routes></MemoryRouter>);
beforeEach(() => { jest.clearAllMocks(); window.confirm = jest.fn(() => true); getOwnerListing.mockResolvedValue(listing()); updateOwnerListing.mockResolvedValue(listing()); });
test('Manage listing opens a published listing in the editor with one Publish action and Withdraw', async () => {
  mount(); expect(await screen.findByRole('heading', { name: 'Edit Listing' })).toBeInTheDocument();
  expect(screen.getByLabelText('Item name')).toHaveValue('Synthetic shelf'); expect(screen.getAllByRole('button', { name: 'Publish' })).toHaveLength(1);
  expect(screen.getByRole('button', { name: 'Withdraw listing' })).toBeInTheDocument(); expect(screen.queryByRole('button', { name: /Save draft/i })).not.toBeInTheDocument();
});
test('Publish saves the published listing in place once, then returns to My Listings', async () => {
  mount(); fireEvent.change(await screen.findByLabelText('Item name'), { target: { value: 'Renamed shelf' } }); fireEvent.click(screen.getByRole('button', { name: 'Publish' }));
  await screen.findByRole('heading', { name: 'My Listings page' }); expect(updateOwnerListing).toHaveBeenCalledTimes(1);
  expect(updateOwnerListing).toHaveBeenCalledWith(id, expect.objectContaining({ name: 'Renamed shelf', publish: true, version: 3, pickupTimeZone: 'America/Los_Angeles' }));
});
test('withdrawal asks first and confirms request cancellation separately before returning to My Listings', async () => {
  actOnOwnerListing.mockRejectedValueOnce({ code: 'PICKUP_CONFIRMATION_REQUIRED', message: 'This will cancel 2 outstanding pickup requests.' }).mockResolvedValueOnce(listing('unlisted'));
  mount(); fireEvent.click(await screen.findByRole('button', { name: 'Withdraw listing' }));
  await screen.findByRole('heading', { name: 'My Listings page' });
  expect(window.confirm).toHaveBeenCalledTimes(2); expect(window.confirm).toHaveBeenLastCalledWith('This will cancel 2 outstanding pickup requests.');
  expect(actOnOwnerListing.mock.calls.map(call => call[1])).toEqual([{ action: 'withdraw', version: 3 }, { action: 'withdraw', version: 3, confirmCancelRequests: true }]);
});
test('declining the withdrawal prompt sends nothing', async () => {
  window.confirm = jest.fn(() => false); mount(); fireEvent.click(await screen.findByRole('button', { name: 'Withdraw listing' }));
  expect(actOnOwnerListing).not.toHaveBeenCalled(); expect(screen.getByRole('heading', { name: 'Edit Listing' })).toBeInTheDocument();
});
test('drafts have no Withdraw action', async () => {
  getOwnerListing.mockResolvedValue(listing('draft', { editDraft: true, publish: true })); mount();
  await screen.findByRole('heading', { name: 'Edit Listing' }); expect(screen.queryByRole('button', { name: 'Withdraw listing' })).not.toBeInTheDocument();
});
test('old status-page links for editable items still open the editor', async () => {
  mount('/app/listings/' + id); expect(await screen.findByRole('heading', { name: 'Edit Listing' })).toBeInTheDocument();
});
test('an uneditable listing opens private saved details instead of bouncing back to My Listings', async () => {
  getOwnerListing.mockResolvedValue(listing('cleared', { editDraft: false })); mount();
  expect(await screen.findByRole('heading', { name: 'Synthetic shelf' })).toBeInTheDocument();
  expect(screen.getByText('Useful household shelf')).toBeInTheDocument();
  expect(screen.queryByRole('heading', { name: 'My Listings page' })).not.toBeInTheDocument();
  expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
});

test('an existing private draft can be saved without publishing while Publish stays explicit', async () => {
  const restored = listing('draft', { editDraft: true, publish: true }); restored.item.pickup.timeZone = 'UTC';
  getOwnerListing.mockResolvedValue(restored); updateOwnerListing.mockResolvedValue(restored); mount();
  const name = await screen.findByLabelText('Item name'); fireEvent.change(name, { target: { value: 'Private edited shelf' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save Draft', exact: true }));
  await screen.findByRole('heading', { name: 'My Listings page' });
  const body = updateOwnerListing.mock.calls[0][1]; expect(body.name).toBe('Private edited shelf'); expect(body.pickupTimeZone).toBe('UTC'); expect(body).not.toHaveProperty('publish');
});
