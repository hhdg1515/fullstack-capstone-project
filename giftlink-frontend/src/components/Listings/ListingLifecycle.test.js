import React from 'react';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import { createMemoryRouter, RouterProvider, Link } from 'react-router-dom';
import { UnsavedChangesProvider } from '../../forms/UnsavedChanges';
import ListingForm from './ListingForm';
import { createOwnerListing, updateOwnerListing } from '../../api/ownerListings';
jest.mock('../../api/usePublicCatalog', () => ({ __esModule: true, default: path => ({ data: require('../../test-support/catalogs')[path === '/api/regions' ? 'regions' : 'taxonomy'] }) }));
jest.mock('../../api/ownerListings', () => ({ createOwnerListing: jest.fn(), updateOwnerListing: jest.fn() }));
jest.mock('../../context/AuthContext', () => ({ useAppContext: () => ({ user: { id: 'local-owner' }, status: 'authenticated' }) }));

const item = { id:'a'.repeat(24), name:'Saved chair', version:1, classification:{}, location:{}, pickup:{} };
function mount(edit = false) {
  const router = createMemoryRouter([{ element:<UnsavedChangesProvider><Link to="/app/listings">My Listings</Link><ListingForm item={edit ? item : undefined}/></UnsavedChangesProvider>, path:'/edit' },
    {path:'/app/listings',element:<h1>Inventory destination</h1>}, {path:'/app/listings/:id',element:<h1>Saved destination</h1>}], {initialEntries:['/app/listings','/edit'],future:{v7_relativeSplatPath:true}});
  render(<RouterProvider router={router} future={{v7_startTransition:true}}/>); return router;
}
beforeEach(()=>{ jest.resetAllMocks(); jest.spyOn(window,'confirm').mockReturnValue(false); });
afterEach(()=>jest.restoreAllMocks());
test.each([false,true])('actual %s listing form guards navigation and Cancel; explicit discard prompts once', async edit=>{
 const router=mount(edit); fireEvent.change(screen.getByLabelText('Item name'),{target:{value:'Keep my edits'}});
 fireEvent.click(screen.getByText('My Listings')); await waitFor(()=>expect(window.confirm).toHaveBeenCalledTimes(1));
 expect(router.state.location.pathname).toBe('/edit'); expect(screen.getByLabelText('Item name')).toHaveValue('Keep my edits');
 fireEvent.click(screen.getByRole('button',{name:'Cancel'})); expect(window.confirm).toHaveBeenCalledTimes(2);
 expect(screen.getByLabelText('Item name')).toHaveValue('Keep my edits');
 window.confirm.mockReturnValue(true); fireEvent.click(screen.getByRole('button',{name:'Cancel'}));
 await screen.findByRole('heading',{name:'Inventory destination'}); expect(window.confirm).toHaveBeenCalledTimes(3);
});
test.each([false,true])('successful %s save releases guard before navigation and disables repeated submit',async edit=>{
 let done; (edit?updateOwnerListing:createOwnerListing).mockReturnValue(new Promise(r=>{done=r;})); mount(edit);
 fireEvent.change(screen.getByLabelText('Item name'),{target:{value:'Saved changes'}});
 fireEvent.click(screen.getAllByRole('button',{name:'Save Draft'})[0]);
 expect(screen.getAllByRole('button',{name:'Saving…'}).every(button=>button.disabled)).toBe(true);
 fireEvent.submit(screen.getByRole('form'));
 expect((edit?updateOwnerListing:createOwnerListing)).toHaveBeenCalledTimes(1);
 await act(async()=>done({item})); await screen.findByRole('heading',{name:'Saved destination'});
 expect(window.confirm).not.toHaveBeenCalled();
});
test.each([false,true])('definite %s save failure preserves values, guard and explicit retry', async edit=>{
 const save=edit?updateOwnerListing:createOwnerListing; save.mockRejectedValue({status:400,message:'Fix the item',fields:[{field:'description',message:'Shorten the description'}]}); mount(edit);
 fireEvent.change(screen.getByLabelText('Item name'),{target:{value:'Keep after failure'}}); fireEvent.click(screen.getAllByRole('button',{name:'Save Draft'})[0]);
 await screen.findByRole('alert'); expect(screen.getByLabelText('Item name')).toHaveValue('Keep after failure');
 expect(screen.getAllByRole('button',{name:'Save Draft'})[0]).toBeEnabled();
 fireEvent.click(screen.getByText('My Listings')); await waitFor(()=>expect(window.confirm).toHaveBeenCalledTimes(1));
 expect(screen.getByLabelText('Item name')).toHaveValue('Keep after failure');
});
test('uncertain creation preserves native unload and navigation protection without replay',async()=>{
 createOwnerListing.mockRejectedValue({status:503,message:'Unknown result'}); mount();
 fireEvent.change(screen.getByLabelText('Item name'),{target:{value:'Uncertain chair'}}); fireEvent.click(screen.getAllByRole('button',{name:'Save Draft'})[0]);
 await screen.findByText(/The save result is uncertain/);
 const event=new Event('beforeunload',{cancelable:true}); window.dispatchEvent(event); expect(event.defaultPrevented).toBe(true);
 fireEvent.submit(screen.getByRole('form')); expect(createOwnerListing).toHaveBeenCalledTimes(1);
 fireEvent.click(screen.getByRole('button',{name:'Cancel'})); expect(window.confirm).toHaveBeenCalledTimes(1); expect(screen.getByLabelText('Item name')).toHaveValue('Uncertain chair');
});
