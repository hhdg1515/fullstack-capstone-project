import React from 'react';
import {render,screen,fireEvent} from '@testing-library/react';
import {MemoryRouter} from 'react-router-dom';
import {MyListings} from './Listings';
import {listOwnerListings,getOwnerListing} from '../../api/ownerListings';
jest.mock('../../api/ownerListings',()=>({listOwnerListings:jest.fn(),getOwnerListing:jest.fn()}));
const item=(id,name)=>({id,name,status:'draft',capabilities:{editDraft:true},location:{},pickup:{},classification:{},photoPreview:{availability:'disabled',images:[]}});
const mount=()=>render(<MemoryRouter future={{v7_startTransition:true,v7_relativeSplatPath:true}}><MyListings/></MemoryRouter>);
beforeEach(()=>jest.resetAllMocks());
test('loading does not masquerade as empty; resolved empty inventory offers creation',async()=>{let done;listOwnerListings.mockReturnValue(new Promise(r=>{done=r;}));mount();expect(screen.getByRole('status')).toHaveTextContent('Loading');expect(screen.queryByText('No listings yet.')).not.toBeInTheDocument();done({items:[],nextCursor:null});expect(await screen.findByText('No listings yet.')).toBeVisible();expect(screen.getByRole('link',{name:'Create Listing'})).toHaveAttribute('href','/app/listings/new');});
test('failed next-page retry retains loaded cards and retries the same cursor without sorting',async()=>{const a=item('a','First'),b=item('b','Second');listOwnerListings.mockResolvedValueOnce({items:[a],nextCursor:'page2'}).mockRejectedValueOnce({status:503,message:'Unavailable'}).mockResolvedValueOnce({items:[a,b],nextCursor:null});mount();await screen.findByText('First');fireEvent.click(screen.getByText('Load More'));await screen.findByRole('alert');expect(screen.getByText('First')).toBeVisible();fireEvent.click(screen.getByText('Retry'));await screen.findByText('Second');expect(listOwnerListings.mock.calls.slice(1).map(call=>call[0])).toEqual([{cursor:'page2'},{cursor:'page2'}]);expect(screen.getAllByRole('heading',{level:2}).map(e=>e.textContent)).toEqual(['First','Second']);expect(screen.getByRole('link',{name:'Second',exact:true})).toHaveFocus();});
test('invalid cursor requires explicit refresh from the beginning',async()=>{listOwnerListings.mockResolvedValueOnce({items:[item('a','First')],nextCursor:'old'}).mockRejectedValueOnce({status:409,message:'Stale cursor'}).mockResolvedValueOnce({items:[item('b','Current')],nextCursor:null});mount();await screen.findByText('First');fireEvent.click(screen.getByText('Load More'));fireEvent.click(await screen.findByText('Refresh listings'));await screen.findByText('Current');expect(listOwnerListings.mock.calls[2][0]).toEqual({});expect(screen.queryByText('First')).not.toBeInTheDocument();});
test('disabled feed is a definite state without retry loops',async()=>{listOwnerListings.mockRejectedValue({status:503,code:'OWNER_LISTINGS_DISABLED',message:'Disabled'});mount();await screen.findByRole('alert');expect(screen.queryByRole('button',{name:'Retry'})).not.toBeInTheDocument();expect(screen.queryByRole('link',{name:'Create Listing'})).not.toBeInTheDocument();expect(listOwnerListings).toHaveBeenCalledTimes(1);expect(screen.queryByRole('link',{name:'Existing plan inventory'})).not.toBeInTheDocument();});
test('broken authorized preview falls back without hiding item navigation',async()=>{const row=item('a','Photo chair');row.photoPreview={availability:'ready',images:[{id:'a'.repeat(24)}]};listOwnerListings.mockResolvedValue({items:[row],nextCursor:null});mount();fireEvent.error(await screen.findByAltText('Photo chair'));expect(screen.getByText('Photo unavailable')).toBeVisible();expect(screen.getByRole('link',{name:'Manage Photo chair'})).toBeVisible();});
test('initial outage is recoverable and is never reported as an empty inventory',async()=>{
 listOwnerListings.mockRejectedValueOnce({status:503,message:'Service unavailable'}).mockResolvedValueOnce({items:[item('a','Recovered')],nextCursor:null});mount();
 await screen.findByRole('alert');expect(screen.queryByText('No listings yet.')).not.toBeInTheDocument();fireEvent.click(screen.getByRole('button',{name:'Retry'}));
 await screen.findByText('Recovered');expect(listOwnerListings.mock.calls.map(call=>call[0])).toEqual([{},{}]);
});
test('an in-flight page prevents duplicate Load More and keeps current cards usable',async()=>{
 let done;listOwnerListings.mockResolvedValueOnce({items:[item('a','Current')],nextCursor:'next'}).mockReturnValueOnce(new Promise(r=>{done=r;}));mount();await screen.findByText('Current');
 fireEvent.click(screen.getByText('Load More'));fireEvent.click(screen.getByText('Load More'));expect(listOwnerListings).toHaveBeenCalledTimes(2);expect(screen.getByText('Load More')).toBeDisabled();expect(screen.getByRole('link',{name:'Current',exact:true})).toBeVisible();
 done({items:[item('b','New page')],nextCursor:null});await screen.findByText('New page');
});
test('mixed v1/v2 cards keep authoritative statuses and the approved editor entry route',async()=>{
 const legacy={...item('a','Legacy'),status:'available',capabilities:{legacyEditor:true},pickupSummary:{reserved:true}},draft=item('b','Independent');
 listOwnerListings.mockResolvedValue({items:[legacy,draft],nextCursor:null});mount();await screen.findByText('Legacy');expect(screen.getByText('Published · Reserved')).toBeVisible();expect(screen.getByText('Draft',{exact:true})).toBeVisible();
 expect(screen.getByRole('link',{name:'Manage Legacy'})).toHaveAttribute('href','/app/items/a/edit');expect(screen.getByRole('link',{name:'Manage Independent'})).toHaveAttribute('href','/app/items/b/edit');
 expect(screen.getByRole('link',{name:'Legacy',exact:true})).toHaveAttribute('href','/app/items/a');expect(screen.getByRole('link',{name:'Independent',exact:true})).toHaveAttribute('href','/app/items/b/edit');expect(screen.queryByRole('img')).toBeNull();
});
test('untrusted preview identifiers cannot become external image requests',async()=>{
 const row=item('a','Safe fallback');row.photoPreview={availability:'ready',images:[{id:'https://untrusted.invalid/private'}]};listOwnerListings.mockResolvedValue({items:[row],nextCursor:null});mount();await screen.findByText('Safe fallback');expect(screen.queryByRole('img')).toBeNull();expect(screen.getByText('No photo')).toBeVisible();
});
test('cards with open pickup requests show a count that opens Incoming requests',async()=>{
 const busy={...item('a','Busy desk'),status:'available',pendingRequests:2},quiet={...item('b','Quiet lamp'),status:'available',pendingRequests:0};
 listOwnerListings.mockResolvedValue({items:[busy,quiet],nextCursor:null});mount();await screen.findByText('Busy desk');
 expect(screen.getByRole('link',{name:'2 pickup requests for Busy desk'})).toHaveAttribute('href','/app/pickups/incoming');expect(screen.getByText('2 requests')).toBeVisible();
 expect(screen.queryByRole('link',{name:/pickup requests? for Quiet lamp/})).not.toBeInTheDocument();
});
