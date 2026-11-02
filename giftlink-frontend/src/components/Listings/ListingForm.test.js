import React from 'react';
import { render, screen, fireEvent, waitFor, act, createEvent } from '@testing-library/react';
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
 expect(createOwnerListing).toHaveBeenCalledTimes(1); expect(createOwnerListing.mock.calls[0][0]).toMatchObject({name:'Chair',stateId:null,metroId:null,pickupTimeZone:null,availableUntil:null});
 expect(createOwnerListing.mock.calls[0][0]).not.toHaveProperty('pickupTimeZoneConfirmed'); await act(async()=>resolve({item:record}));
});
test('region suggestion is opt-in and using it never confirms it', () => {
 mount(); fireEvent.change(screen.getByLabelText('State'),{target:{value:'06'}}); fireEvent.change(screen.getByLabelText('Metro area'),{target:{value:'31080'}});
 expect(screen.getByLabelText('Pickup timezone')).toHaveValue(''); fireEvent.click(screen.getByRole('button',{name:'Use suggested timezone'}));
 expect(screen.getByLabelText('Pickup timezone')).toHaveValue('America/Los_Angeles'); expect(screen.getByLabelText('Confirm this pickup timezone')).not.toBeChecked();
});
test.each([['City (optional)','Other city'],['Neighborhood (optional)','Other neighborhood'],['Pickup timezone','UTC'],['Metro area','41860'],['State','36']])('changing %s invalidates a prior confirmation and sends false', async (label,value) => {
 mount(record); expect(screen.getByLabelText('Confirm this pickup timezone')).toBeChecked(); fireEvent.change(screen.getByLabelText(label),{target:{value}});
 expect(screen.getByLabelText('Confirm this pickup timezone')).not.toBeChecked(); submit(); await waitFor(()=>expect(updateOwnerListing).toHaveBeenCalled());
 expect(updateOwnerListing.mock.calls[0][1]).toMatchObject({version:3,pickupTimeZoneConfirmed:false});
});
test('explicit uncheck clears confirmation even with unchanged region; untouched confirmation is omitted', async () => {
 mount(record); fireEvent.click(screen.getByLabelText('Confirm this pickup timezone')); submit(); await waitFor(()=>expect(updateOwnerListing).toHaveBeenCalled());
 expect(updateOwnerListing.mock.calls[0][1].pickupTimeZoneConfirmed).toBe(false);
});
test('unchanged confirmed context is preserved without silently issuing fresh confirmation', async () => {
 mount(record); fireEvent.change(screen.getByLabelText('Item name'),{target:{value:'New chair'}}); submit(); await waitFor(()=>expect(updateOwnerListing).toHaveBeenCalled());
 expect(updateOwnerListing.mock.calls[0][1]).not.toHaveProperty('pickupTimeZoneConfirmed');
});
test('new confirmation includes the exact selected zone', async () => {
 mount(); fireEvent.change(screen.getByLabelText('Item name'),{target:{value:'Chair'}}); fireEvent.change(screen.getByLabelText('Pickup timezone'),{target:{value:'UTC'}}); fireEvent.click(screen.getByLabelText('Confirm this pickup timezone')); submit();
 await waitFor(()=>expect(createOwnerListing).toHaveBeenCalled()); expect(createOwnerListing.mock.calls[0][0]).toMatchObject({pickupTimeZone:'UTC',pickupTimeZoneConfirmed:true});
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

test('deadline-only edits retain the confirmed context without a new confirmation intent', async () => {
 mount(record); fireEvent.change(screen.getByLabelText('Pickup deadline'),{target:{value:'2027-11-13'}});
 expect(screen.getByLabelText('Confirm this pickup timezone')).toBeChecked(); submit(); await waitFor(()=>expect(updateOwnerListing).toHaveBeenCalled());
 expect(updateOwnerListing.mock.calls[0][1]).toMatchObject({availableUntil:'2027-11-13',version:3}); expect(updateOwnerListing.mock.calls[0][1]).not.toHaveProperty('pickupTimeZoneConfirmed');
});

test('feature-disabled is a definite service state, not an uncertain creation or automatic retry', async () => {
 createOwnerListing.mockRejectedValue({status:503,code:'OWNER_LISTINGS_DISABLED',message:'Disabled'}); mount();
 fireEvent.change(screen.getByLabelText('Item name'),{target:{value:'Keep name'}}); submit();
 await screen.findByText(/Listing tools are temporarily unavailable/); expect(screen.queryByText(/The save result is uncertain/)).not.toBeInTheDocument();
 expect(screen.getByLabelText('Item name')).toHaveValue('Keep name'); expect(createOwnerListing).toHaveBeenCalledTimes(1);
 expect(screen.getAllByRole('button',{name:'Save Draft'})[0]).toBeDisabled();
});

test('publication is separately gated; an explicit Publish action validates all fields and never silently confirms timezone', async () => {
 render(<MemoryRouter><ListingForm publicationEnabled /></MemoryRouter>);
 fireEvent.change(screen.getByLabelText('Item name'), {target:{value:'Shelf'}});
 const event = createEvent.submit(screen.getByRole('form')); Object.defineProperty(event, 'submitter', {value:screen.getAllByRole('button',{name:'Publish listing'})[0]}); fireEvent(screen.getByRole('form'), event);
 await waitFor(()=>expect(screen.getByLabelText('Description')).toHaveAttribute('aria-invalid','true'));
 expect(screen.getByLabelText('Confirm this pickup timezone')).not.toBeChecked(); expect(createOwnerListing).not.toHaveBeenCalled();
 expect(screen.getByRole('alert')).toHaveTextContent('Choose a metro before publishing.');
});
test('explicit publication sends one versioned request while the ordinary Save Draft path stays private', async () => {
 const complete = {...record, description:'Useful shelf',classification:{category:{id:'living-room'},itemType:{id:'bookshelf'}}};
 render(<MemoryRouter><ListingForm item={complete} publicationEnabled /></MemoryRouter>);
 const event = createEvent.submit(screen.getByRole('form')); Object.defineProperty(event, 'submitter', {value:screen.getAllByRole('button',{name:'Publish listing'})[0]}); fireEvent(screen.getByRole('form'), event);
 await waitFor(()=>expect(updateOwnerListing).toHaveBeenCalledTimes(1));
 expect(updateOwnerListing.mock.calls[0]).toEqual([record.id,expect.objectContaining({publish:true,version:3,categoryId:'living-room',itemTypeId:'bookshelf'})]);
 expect(updateOwnerListing.mock.calls[0][1]).not.toHaveProperty('pickupTimeZoneConfirmed');
});
