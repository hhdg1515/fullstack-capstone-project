import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { ListingRedirect } from './Listings';
import { getOwnerListing, actOnOwnerListing } from '../../api/ownerListings';
jest.mock('../../api/ownerListings', () => ({ getOwnerListing: jest.fn(), actOnOwnerListing: jest.fn() }));
const id = 'a'.repeat(24);
const envelope = (status = 'cleared', version = 3) => ({ item: { id, name: 'Private completed shelf', description: 'Saved owner details.\nSecond line.', status, version,
  location: { metroLabel: 'San Francisco metro', city: 'Oakland' }, pickup: { availableUntil: '2030-01-01', timeZone: 'UTC' },
  classification: { itemType: { label: 'Bookshelf' } }, photoPreview: { availability: 'ready', images: [{ id: 'b'.repeat(24) }] },
  capabilities: { editDraft: status === 'draft', reopenDraft: status === 'cleared' } } });
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { resolve, promise }; };
function mount() {
  return render(<MemoryRouter initialEntries={['/app/listings/' + id]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}><Routes>
    <Route path="/app/listings/:itemId" element={<ListingRedirect />} />
    <Route path="/app/items/:itemId/edit" element={<h1>Draft editor</h1>} />
  </Routes></MemoryRouter>);
}
beforeEach(() => { jest.clearAllMocks(); getOwnerListing.mockResolvedValue(envelope()); jest.spyOn(window, 'confirm').mockReturnValue(true); });
afterEach(() => jest.restoreAllMocks());
test('closed owner detail shows saved content and an authorized thumbnail without editing or publishing', async () => {
  mount(); await screen.findByRole('heading', { name: 'Private completed shelf' });
  expect(screen.getByText(/Saved owner details/)).toBeVisible(); expect(screen.getByText('Bookshelf')).toBeVisible();
  expect(screen.getByText('UTC')).toBeVisible(); expect(screen.getByRole('link', { name: 'Back to My Listings' })).toHaveAttribute('href', '/app/listings');
  expect(screen.getByRole('img')).toHaveAttribute('src', '/api/item-images/' + 'b'.repeat(24) + '/thumbnail');
  expect(screen.queryByRole('textbox')).not.toBeInTheDocument(); expect(screen.queryByRole('button', { name: 'Publish' })).not.toBeInTheDocument();
});
test('declining the explicit draft confirmation sends no mutation', async () => {
  window.confirm.mockReturnValue(false); mount(); fireEvent.click(await screen.findByRole('button', { name: 'Relist as draft' }));
  expect(actOnOwnerListing).not.toHaveBeenCalled(); expect(screen.queryByRole('heading', { name: 'Draft editor' })).not.toBeInTheDocument();
});
test('one explicit confirmed action uses the exact version and cannot double-submit before authoritative success', async () => {
  const pending = deferred(); actOnOwnerListing.mockReturnValue(pending.promise); mount();
  const button = await screen.findByRole('button', { name: 'Relist as draft' });
  fireEvent.click(button); fireEvent.click(button); expect(actOnOwnerListing).toHaveBeenCalledTimes(1);
  expect(actOnOwnerListing).toHaveBeenCalledWith(id, { action: 'reopen', version: 3, confirmRelist: true });
  expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining('Previous pickup requests and conversations will stay closed'));
  expect(button).toBeDisabled(); expect(screen.queryByRole('heading', { name: 'Draft editor' })).not.toBeInTheDocument();
  await act(async () => pending.resolve(envelope('draft', 4))); expect(await screen.findByRole('heading', { name: 'Draft editor' })).toBeVisible();
});
test('an uncertain result blocks replay and canonical status inspection can continue into the existing draft', async () => {
  actOnOwnerListing.mockRejectedValue({ status: 503, message: 'Could not confirm restoration.' });
  getOwnerListing.mockResolvedValueOnce(envelope()).mockResolvedValueOnce(envelope('draft', 4)); mount();
  fireEvent.click(await screen.findByRole('button', { name: 'Relist as draft' })); await screen.findByRole('alert');
  expect(screen.getByRole('button', { name: 'Relist as draft' })).toBeDisabled(); expect(screen.getByText(/Saved owner details/)).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Check listing' })); await screen.findByRole('heading', { name: 'Draft editor' });
  expect(actOnOwnerListing).toHaveBeenCalledTimes(1); expect(getOwnerListing).toHaveBeenCalledTimes(2);
});
test('stale changes require an explicit read before a fresh confirmed version can be submitted', async () => {
  actOnOwnerListing.mockRejectedValueOnce({ status: 409, message: 'Listing changed.' }).mockResolvedValueOnce(envelope('draft', 6));
  getOwnerListing.mockResolvedValueOnce(envelope()).mockResolvedValueOnce(envelope('cleared', 5)); mount();
  fireEvent.click(await screen.findByRole('button', { name: 'Relist as draft' })); await screen.findByRole('alert');
  expect(actOnOwnerListing).toHaveBeenCalledTimes(1); fireEvent.click(screen.getByRole('button', { name: 'Check listing' }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Relist as draft' })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: 'Relist as draft' })); await screen.findByRole('heading', { name: 'Draft editor' });
  expect(actOnOwnerListing.mock.calls[1][1].version).toBe(5);
});
test('unavailable and mismatched private responses never reveal saved details', async () => {
  getOwnerListing.mockResolvedValue({ item: { ...envelope().item, id: 'c'.repeat(24) } }); mount();
  expect(await screen.findByRole('alert')).toHaveTextContent('unavailable'); expect(screen.queryByText(/Saved owner details/)).not.toBeInTheDocument();
  expect(screen.queryByRole('img')).not.toBeInTheDocument(); expect(screen.queryByRole('button', { name: 'Relist as draft' })).not.toBeInTheDocument();
});
test('the server can disable relisting without blocking the owner read view', async () => {
  const value = envelope(); value.item.capabilities.reopenDraft = false; getOwnerListing.mockResolvedValue(value); mount();
  await screen.findByRole('heading', { name: 'Private completed shelf' }); expect(screen.queryByRole('button', { name: 'Relist as draft' })).not.toBeInTheDocument();
});
