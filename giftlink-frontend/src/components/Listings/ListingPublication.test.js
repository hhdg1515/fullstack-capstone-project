import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { ListingDetail, ListingEditor } from './Listings';
import { getOwnerListing, actOnOwnerListing } from '../../api/ownerListings';
jest.mock('../../api/ownerListings', () => ({ getOwnerListing: jest.fn(), actOnOwnerListing: jest.fn() }));
const id = 'a'.repeat(24);
const listing = (status = 'draft', capabilities = { publish: true, editDraft: true }) => ({ item: { id, name: 'Synthetic shelf', description: 'Useful household shelf', status, version: 3,
  classification: {}, location: {}, pickup: { datePolicy: 'pickup-local', timeZone: 'America/Los_Angeles', timeZoneConfirmed: true, availableUntil: '2099-11-01' }, capabilities, photoPreview: { availability: 'none', images: [] } } });
const mount = () => render(<MemoryRouter initialEntries={['/app/listings/' + id]} future={{v7_startTransition:true,v7_relativeSplatPath:true}}><Routes><Route path="/app/listings/:itemId" element={<ListingDetail />} /></Routes></MemoryRouter>);
beforeEach(() => { jest.clearAllMocks(); getOwnerListing.mockResolvedValue(listing()); });
test('publication sends the authoritative version once and renders the server status and public entry', async () => {
  actOnOwnerListing.mockResolvedValue(listing('available', { withdraw: true })); mount();
  fireEvent.click(await screen.findByRole('button', {name:'Publish listing',exact:true}));
  await screen.findByText('Published'); expect(actOnOwnerListing).toHaveBeenCalledTimes(1);
  expect(actOnOwnerListing).toHaveBeenCalledWith(id, {action:'publish',version:3});
  expect(screen.getByRole('link',{name:'View public listing'})).toHaveAttribute('href','/app/items/'+id);
  expect(screen.queryByText(/Private draft/)).not.toBeInTheDocument();
});
test('withdrawal only cancels requests after explicit confirmation and then replaces the authoritative status', async () => {
  getOwnerListing.mockResolvedValue(listing('available',{withdraw:true}));
  actOnOwnerListing.mockRejectedValueOnce({code:'PICKUP_CONFIRMATION_REQUIRED',message:'This will cancel 2 outstanding pickup requests.'}).mockResolvedValueOnce(listing('unlisted',{publish:true,editDraft:true}));
  mount(); fireEvent.click(await screen.findByRole('button',{name:'Withdraw listing',exact:true}));
  await screen.findByRole('button',{name:'Withdraw and cancel requests'}); expect(actOnOwnerListing).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole('button',{name:'Keep listing'})); expect(screen.queryByRole('button',{name:'Withdraw and cancel requests'})).not.toBeInTheDocument();
  actOnOwnerListing.mockRejectedValueOnce({code:'PICKUP_CONFIRMATION_REQUIRED',message:'Review cancellation.'});
  // Re-open using the explicit pending decision, then confirm exactly once.
  actOnOwnerListing.mockReset().mockRejectedValueOnce({code:'PICKUP_CONFIRMATION_REQUIRED',message:'Review cancellation.'}).mockResolvedValueOnce(listing('unlisted',{publish:true,editDraft:true}));
  fireEvent.click(screen.getByRole('button',{name:'Withdraw listing',exact:true}));
  fireEvent.click(await screen.findByRole('button',{name:'Withdraw and cancel requests'})); await screen.findByText('Withdrawn');
  expect(actOnOwnerListing).toHaveBeenLastCalledWith(id,{action:'withdraw',version:3,confirmCancelRequests:true});
  expect(screen.queryByRole('button',{name:'Withdraw listing',exact:true})).not.toBeInTheDocument();
});
test('disabled publication stays private and failure never claims publication succeeded or retries automatically', async () => {
  getOwnerListing.mockResolvedValue(listing('draft',{editDraft:true})); mount(); await screen.findByText(/Private draft/);
  expect(screen.queryByRole('button',{name:'Publish listing'})).not.toBeInTheDocument(); expect(actOnOwnerListing).not.toHaveBeenCalled();
});
test('an uncertain action offers canonical refresh without replaying the mutation', async () => {
  actOnOwnerListing.mockRejectedValue({status:0,message:'Result uncertain. Refresh to inspect.'}); mount();
  fireEvent.click(await screen.findByRole('button',{name:'Publish listing',exact:true})); await screen.findByRole('alert');
  expect(screen.getByText('Draft',{exact:true})).toBeVisible(); getOwnerListing.mockResolvedValue(listing('available',{withdraw:true}));
  fireEvent.click(screen.getByRole('button',{name:'Refresh listing'})); await waitFor(()=>expect(screen.getByText('Published',{exact:true})).toBeVisible());
  expect(actOnOwnerListing).toHaveBeenCalledTimes(1);
});

test('Back or a direct edit URL for a published item follows server capabilities to the private detail', async () => {
  getOwnerListing.mockResolvedValue(listing('available',{withdraw:true,editDraft:false}));
  render(<MemoryRouter initialEntries={['/app/items/'+id+'/edit']} future={{v7_startTransition:true,v7_relativeSplatPath:true}}><Routes>
    <Route path="/app/items/:itemId/edit" element={<ListingEditor />} /><Route path="/app/listings/:itemId" element={<ListingDetail />} />
  </Routes></MemoryRouter>);
  await screen.findByRole('link',{name:'View public listing'}); expect(screen.queryByRole('form')).not.toBeInTheDocument();
  expect(screen.queryByRole('button',{name:'Save Draft'})).not.toBeInTheDocument(); expect(actOnOwnerListing).not.toHaveBeenCalled();
});
