import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import ListingForm from './ListingForm';
import { createOwnerListing, updateOwnerListing } from '../../api/ownerListings';
jest.mock('../../api/usePublicCatalog', () => ({ __esModule: true, default: path => ({ data: require('../../test-support/catalogs')[path === '/api/regions' ? 'regions' : 'taxonomy'] }) }));
jest.mock('../../api/ownerListings', () => ({ createOwnerListing: jest.fn(), updateOwnerListing: jest.fn() }));
const record = { id:'a'.repeat(24), name:'Chair', version:3, classification:{}, location:{stateId:'06',metroId:'31080',city:'',neighborhood:''}, pickup:{timeZone:'America/Los_Angeles',timeZoneConfirmed:true,availableUntil:'2027-11-12'} };
function mount(item) { return render(<MemoryRouter future={{v7_startTransition:true,v7_relativeSplatPath:true}}><ListingForm item={item}/></MemoryRouter>); }
const submit = () => fireEvent.click(screen.getAllByRole('button',{name:'Save Draft',exact:true})[0]);
beforeEach(() => { jest.clearAllMocks(); createOwnerListing.mockResolvedValue({item:record}); updateOwnerListing.mockResolvedValue({item:record}); });
test('name-only drafts require no publication context and duplicate submits issue one POST', async () => {
 let resolve; createOwnerListing.mockReturnValue(new Promise(done => {resolve=done;})); mount();
 fireEvent.change(screen.getByLabelText('Item name'),{target:{value:'Chair'}}); submit(); fireEvent.submit(screen.getByRole('form'));
 expect(createOwnerListing).toHaveBeenCalledTimes(1); expect(createOwnerListing.mock.calls[0][0]).toMatchObject({name:'Chair',stateId:null,metroId:null,availableUntil:null,pickupTimeZoneConfirmed:true});
 expect(typeof createOwnerListing.mock.calls[0][0].pickupTimeZone).toBe('string'); await act(async()=>resolve({item:record}));
});
test('the pickup timezone is never asked for: a new listing silently uses its metro timezone', async () => {
 mount(); expect(screen.queryByLabelText(/timezone/i)).not.toBeInTheDocument();
 fireEvent.change(screen.getByLabelText('Item name'),{target:{value:'Chair'}}); fireEvent.change(screen.getByLabelText('State'),{target:{value:'06'}}); fireEvent.change(screen.getByLabelText('Metro area'),{target:{value:'31080'}}); submit();
 await waitFor(()=>expect(createOwnerListing).toHaveBeenCalled()); expect(createOwnerListing.mock.calls[0][0]).toMatchObject({pickupTimeZone:'America/Los_Angeles',pickupTimeZoneConfirmed:true});
});
test('local validation focuses and associates the first invalid field, without sending', async () => {
 mount(); submit(); await waitFor(()=>expect(screen.getByLabelText('Item name')).toHaveFocus()); expect(screen.getByRole('alert')).toHaveTextContent('Check the highlighted');
 expect(screen.getByLabelText('Item name')).toHaveAttribute('aria-describedby','name-error'); expect(createOwnerListing).not.toHaveBeenCalled();
 fireEvent.change(screen.getByLabelText('Item name'),{target:{value:'Chair'}}); expect(screen.getByLabelText('Item name')).toHaveAttribute('aria-invalid','false');
});
test.each([['metroId','Metro area'],['categoryId','Item type'],['condition','Condition (optional)']])('backend %s errors map to the actual control and summary',async(field,label)=>{
 createOwnerListing.mockRejectedValue({status:400,message:'Check details',fields:[{field,message:'Fix this selection'}]}); mount();
 fireEvent.change(screen.getByLabelText('Item name'),{target:{value:'Chair'}}); if(field==='metroId') fireEvent.change(screen.getByLabelText('State'),{target:{value:'06'}}); submit();
 await waitFor(()=>expect(screen.getByLabelText(label)).toHaveAttribute('aria-invalid','true')); expect(screen.getByLabelText(label)).toHaveFocus(); expect(screen.getByRole('alert')).toHaveTextContent('Fix this selection');
});
test('stale edits retain values and block replay; stale conflicts are not field errors', async()=>{
 updateOwnerListing.mockRejectedValue({status:409,message:'Stale'}); mount(record); fireEvent.change(screen.getByLabelText('Item name'),{target:{value:'Keep edit'}}); submit();
 await screen.findByText(/This draft changed/); expect(screen.getByLabelText('Item name')).toHaveValue('Keep edit'); expect(screen.getAllByRole('button',{name:'Save Draft'})[0]).toBeDisabled(); expect(updateOwnerListing).toHaveBeenCalledTimes(1);
});
test('ambiguous create keeps contents, disables resubmission and offers owner inspection',async()=>{
 createOwnerListing.mockRejectedValue({status:0,message:'Network interrupted'}); mount(); fireEvent.change(screen.getByLabelText('Item name'),{target:{value:'Keep draft'}}); submit();
 await screen.findByText(/The save result is uncertain/); expect(screen.getByLabelText('Item name')).toHaveValue('Keep draft'); submit(); expect(createOwnerListing).toHaveBeenCalledTimes(1);
});

test('edits keep the listing\'s stored pickup timezone', async () => {
 mount(record); fireEvent.change(screen.getByLabelText('Pickup deadline'),{target:{value:'2027-11-13'}}); submit(); await waitFor(()=>expect(updateOwnerListing).toHaveBeenCalled());
 expect(updateOwnerListing.mock.calls[0][1]).toMatchObject({availableUntil:'2027-11-13',version:3,pickupTimeZone:'America/Los_Angeles',pickupTimeZoneConfirmed:true});
});

test('feature-disabled is a definite service state, not an uncertain creation or automatic retry', async () => {
 createOwnerListing.mockRejectedValue({status:503,code:'OWNER_LISTINGS_DISABLED',message:'Disabled'}); mount();
 fireEvent.change(screen.getByLabelText('Item name'),{target:{value:'Keep name'}}); submit();
 await screen.findByText(/Listing tools are temporarily unavailable/); expect(screen.queryByText(/The save result is uncertain/)).not.toBeInTheDocument();
 expect(screen.getByLabelText('Item name')).toHaveValue('Keep name'); expect(createOwnerListing).toHaveBeenCalledTimes(1);
 expect(screen.getAllByRole('button',{name:'Save Draft'})[0]).toBeDisabled();
});

test('with publication enabled the only submit action is Publish, which validates all fields', async () => {
 render(<MemoryRouter><ListingForm publicationEnabled /></MemoryRouter>);
 fireEvent.change(screen.getByLabelText('Item name'), {target:{value:'Shelf'}});
 expect(screen.queryByRole('button',{name:/Save draft/i})).not.toBeInTheDocument(); fireEvent.click(screen.getByRole('button',{name:'Publish'}));
 await waitFor(()=>expect(screen.getByLabelText('Description')).toHaveAttribute('aria-invalid','true'));
 expect(createOwnerListing).not.toHaveBeenCalled();
 expect(screen.getByRole('alert')).toHaveTextContent('Choose a metro before publishing.');
});
test('Publish sends one versioned request', async () => {
 const complete = {...record, description:'Useful shelf',classification:{category:{id:'living-room'},itemType:{id:'bookshelf'}}};
 render(<MemoryRouter><ListingForm item={complete} publicationEnabled /></MemoryRouter>);
 fireEvent.click(screen.getByRole('button',{name:'Publish'}));
 await waitFor(()=>expect(updateOwnerListing).toHaveBeenCalledTimes(1));
 expect(updateOwnerListing.mock.calls[0]).toEqual([record.id,expect.objectContaining({publish:true,version:3,categoryId:'living-room',itemTypeId:'bookshelf'})]);
 expect(updateOwnerListing.mock.calls[0][1]).toMatchObject({pickupTimeZone:'America/Los_Angeles',pickupTimeZoneConfirmed:true});
});
