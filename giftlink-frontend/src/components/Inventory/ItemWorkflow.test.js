jest.mock('../../api/photoPreparation', () => ({ ...jest.requireActual('../../api/photoPreparation'), preparePhoto: jest.fn(async file => file) }));
jest.mock('../../context/AuthContext', () => {
  const React = require('react'); const Context = React.createContext();
  return { TestAuthContext: Context, useAppContext: () => React.useContext(Context) };
});
jest.mock('../../api/usePublicCatalog', () => ({ __esModule: true, default: () => ({ data: require('../../test-support/catalogs').taxonomy }) }));
jest.mock('../../api/itemImages', () => ({ ...jest.requireActual('../../api/itemImages'), readPhotos: jest.fn(), readUpload: jest.fn(),
  reservePhoto: jest.fn(), uploadPhoto: jest.fn(), fileDigest: jest.fn(), uploadId: jest.fn(), securePhotoBrowser: () => true }));
import React, { useEffect, useState } from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { createMemoryRouter, RouterProvider, Routes, Route, Link } from 'react-router-dom';
import { TestAuthContext } from '../../context/AuthContext';
import { UnsavedChangesProvider } from '../../forms/UnsavedChanges';
import { fileDigest, readPhotos, readUpload, reservePhoto, uploadId, uploadPhoto, photoError } from '../../api/itemImages';
import Inventory from './Inventory';
import { preparePhoto } from '../../api/photoPreparation';
const plan = { id: 'a'.repeat(24), city: 'Oakland', neighborhood: 'Local test', status: 'active', pickupTimeZone: 'America/Los_Angeles', moveOutDeadline: '2099-01-01' };
const capabilities = { metadata: true, binaryUpload: true, imageRead: true };
const root = '/api/move-out-plans/' + plan.id + '/items';
const makeItem = (id = 'b'.repeat(24), name = 'Synthetic chair') => ({ id, planId: plan.id, name, description: '', category: '', status: 'draft',
  availableFrom: null, availableUntil: null, effectiveAvailableUntil: plan.moveOutDeadline, version: 1, isPublic: false });
const metadata = () => ({ imageRevision: 0, images: [], uploads: [], capabilities, allowance: { itemSlots: 5, newUploadsAllowed: true } });
const reply = (data, status = 200) => ({ ok: status < 400, status, headers: new Headers({ 'Content-Type': 'application/json' }), json: async () => data });
let items, media, writes, createFault, nextId, sequence, operationSequence, setActor;
function Scene() {
  const [user, update] = useState({ id: 'owner-a', firstName: 'Synthetic' }); setActor = update;
  useEffect(() => { const expire = () => update(null); window.addEventListener('giftlink:unauthorized', expire); return () => window.removeEventListener('giftlink:unauthorized', expire); }, []);
  return <TestAuthContext.Provider value={{ user, status: user ? 'authenticated' : 'anonymous' }}><UnsavedChangesProvider><Routes>
    <Route path="/app/plans/:planId/items" element={<>{user ? <Inventory /> : <h1>Login required</h1>}<Link to="/away">Leave inventory</Link></>} />
    <Route path="/away" element={<h1>Away</h1>} />
  </Routes></UnsavedChangesProvider></TestAuthContext.Provider>;
}
function mount() {
  const router = createMemoryRouter([{ path: '*', element: <Scene /> }], { initialEntries: ['/app/plans/' + plan.id + '/items'], future: { v7_relativeSplatPath: true } });
  render(<RouterProvider router={router} future={{ v7_startTransition: true }} />); return router;
}
const select = async (count = 1) => act(async () => { fireEvent.change(screen.getByLabelText('Choose photos'), { target: { files: Array.from({ length: count }, () => new File(['local'], 'private.png', { type: 'image/png' })) } }); });
const create = async (count = 1) => { await screen.findByLabelText('Item name'); fireEvent.change(screen.getByLabelText('Item name'), { target: { value: 'Synthetic chair' } }); await select(count); await screen.findByAltText('Local preview of selected photo ' + count); await waitFor(() => expect(screen.getByRole('button', { name: 'Save Draft', exact: true })).toBeEnabled()); await click(screen.getByRole('button', { name: 'Save Draft', exact: true })); };
const pending = async (count = 1) => { await waitFor(() => expect(screen.getByRole('button', { name: `Upload ${count} ${count === 1 ? 'photo' : 'photos'}`, exact: true })).toBeEnabled()); };
const click = async target => act(async () => { fireEvent.click(target); });
const submit = async target => act(async () => { fireEvent.submit(target); });
const unload = () => { const event = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(event); return event.defaultPrevented; };
beforeEach(() => {
  preparePhoto.mockImplementation(async file => file);
  items = []; media = {}; writes = []; createFault = ''; nextId = 'b'.repeat(24); sequence = 0; operationSequence = 0;
  jest.spyOn(window, 'confirm').mockReturnValue(false);
  URL.createObjectURL = jest.fn(() => 'blob:local-' + sequence); URL.revokeObjectURL = jest.fn();
  uploadId.mockImplementation(() => '00000000-0000-4000-8000-' + String(++sequence).padStart(12, '0')); fileDigest.mockResolvedValue('f'.repeat(64));
  readPhotos.mockImplementation(async (p, id) => media[id] ||= metadata());
  reservePhoto.mockImplementation(async (p, id) => ({ imageRevision: media[id].imageRevision, upload: { id: String(++operationSequence).padStart(24, 'c'), state: 'reserved', cleanupPending: false, reservationExpired: false } }));
  uploadPhoto.mockImplementation(async (p, id, imageId) => {
    const data = media[id]; const image = { id: imageId, state: 'ready', sortPosition: data.images.length, thumbnail: { width: 400, height: 300 }, cleanupPending: false, reservationExpired: false };
    data.images.push(image); data.imageRevision++; data.allowance.itemSlots--; return { imageRevision: data.imageRevision, upload: image };
  });
  readUpload.mockImplementation(async (p, id, imageId) => ({ imageRevision: media[id].imageRevision, upload: media[id].images.find(image => image.id === imageId) }));
  global.fetch = jest.fn(async (url, options) => {
    if (options.method === 'GET') return reply({ plan, items: items.map(item => ({ ...item, photoPreview: { availability: 'none', imageRevision: 0, images: [] } })),
      progress: { total: items.length, cleared: 0 }, photoCapabilities: capabilities });
    const body = JSON.parse(options.body); writes.push({ url, body, method: options.method });
    if (createFault === 'validation') return reply({ error: { code: 'VALIDATION_FAILED', message: 'Check the name.', fields: [{ field: 'name', message: 'Check the name.' }] } }, 400);
    if (options.method === 'POST') {
      const item = { ...makeItem(nextId), ...body }; items.push(item);
      if (createFault === 'lost') throw Error('Synthetic response loss');
      return reply({ item }, 201);
    }
    const item = { ...items[0], ...body, version: items[0].version + 1 }; items[0] = item; return reply({ item });
  });
});
afterEach(async () => { await act(async () => {}); jest.restoreAllMocks(); jest.clearAllMocks(); });

test('stages before save, preserves previews across ID binding and offers explicit Upload N inside the saved card', async () => {
  mount(); await create(2); await pending(2);
  expect(writes).toHaveLength(1); expect(readPhotos).toHaveBeenCalledWith(plan.id, nextId);
  expect(reservePhoto).not.toHaveBeenCalled(); expect(uploadPhoto).not.toHaveBeenCalled();
  expect(screen.queryByRole('button', { name: 'Save Draft' })).not.toBeInTheDocument();
  const card = screen.getByRole('heading', { name: 'Synthetic chair', exact: true }).closest('li');
  expect(within(card).getByAltText('Local preview of selected photo 1')).toBeVisible();
  expect(within(card).getByRole('button', { name: 'Upload 2 photos' })).toBeVisible();
  expect(URL.revokeObjectURL).not.toHaveBeenCalled(); expect(unload()).toBe(true);
  await click(screen.getByRole('button', { name: 'Upload 2 photos' }));
  await waitFor(() => expect(within(card).getAllByRole('img', { name: /Uploaded photo/ })).toHaveLength(2));
  expect(uploadPhoto).toHaveBeenCalledTimes(2); expect(reservePhoto).toHaveBeenCalledTimes(2);
  expect(uploadPhoto.mock.calls.every(call => call[1] === nextId)).toBe(true);
  await waitFor(() => expect(screen.queryByLabelText('Item name')).not.toBeInTheDocument());
  expect(unload()).toBe(false); expect(URL.revokeObjectURL).toHaveBeenCalledTimes(2);
  fireEvent.error(within(card).getByAltText('Uploaded photo 1'));
  expect(within(card).getByText('Photo unavailable. Refresh to check again.')).toBeVisible();
  await click(screen.getByRole('button', { name: 'Refresh inventory' }));
  await waitFor(() => expect(within(card).getByAltText('Uploaded photo 1')).toBeVisible());
  await waitFor(() => expect(screen.getByRole('button', { name: 'Add item', exact: true })).toBeEnabled());
  await click(screen.getByRole('button', { name: 'Add item', exact: true }));
  expect(await screen.findByLabelText('Item name')).toHaveValue('');
});

test('a rejected save retains item text and files and sends no reservation or binary content', async () => {
  createFault = 'validation'; mount(); await create();
  await waitFor(() => expect(screen.getByLabelText('Item name')).toHaveFocus());
  expect(screen.getByLabelText('Item name')).toHaveValue('Synthetic chair');
  expect(await screen.findByAltText('Local preview of selected photo 1')).toBeVisible();
  expect(reservePhoto).not.toHaveBeenCalled(); expect(URL.revokeObjectURL).not.toHaveBeenCalled();
  createFault = ''; await waitFor(() => expect(screen.getByRole('button', { name: 'Save Draft', exact: true })).toBeEnabled()); await click(screen.getByRole('button', { name: 'Save Draft', exact: true })); await pending();
  expect(writes).toHaveLength(2); expect(uploadPhoto).not.toHaveBeenCalled();
});

test('an uncertain item creation cannot repeat POST and requires explicit selection of an authoritative saved item', async () => {
  createFault = 'lost'; mount(); await create();
  await screen.findByText(/Save not confirmed. Check inventory/);
  expect(screen.getByRole('button', { name: 'Save Draft', exact: true })).toBeDisabled();
  await submit(screen.getByRole('button', { name: 'Save Draft', exact: true }).closest('form'));
  expect(writes).toHaveLength(1); expect(uploadPhoto).not.toHaveBeenCalled();
  window.confirm.mockReturnValue(true); await click(screen.getByRole('button', { name: 'Refresh inventory' }));
  const edit = await screen.findByRole('button', { name: 'Edit Synthetic chair', exact: true });
  await click(edit); await pending();
  expect(await screen.findByAltText('Local preview of selected photo 1')).toBeVisible(); expect(URL.revokeObjectURL).not.toHaveBeenCalled();
  expect(writes).toHaveLength(1); expect(reservePhoto).not.toHaveBeenCalled();
});

test('refreshing and declining close/navigation retain unsent files and warn that reload cannot preserve them', async () => {
  const router = mount(); await create(); await pending();
  await click(screen.getByRole('button', { name: 'Refresh inventory' })); await pending();
  expect(await screen.findByAltText('Local preview of selected photo 1')).toBeVisible(); expect(URL.revokeObjectURL).not.toHaveBeenCalled();
  await click(screen.getByRole('button', { name: 'Done', exact: true })); expect(window.confirm).toHaveBeenLastCalledWith(expect.stringContaining('cannot be restored after reloading'));
  await click(screen.getByRole('link', { name: 'Leave inventory' }));
  await waitFor(() => expect(router.state.location.pathname).not.toBe('/away'));
  expect(unload()).toBe(true); expect(screen.getByText(/Reloading will lose them/)).toBeVisible();
});

test('upload uncertainty stops the selected batch, retains remaining files and never automatically resends', async () => {
  uploadPhoto.mockImplementationOnce(async (p, id, imageId) => {
    media[id].images.push({ id: imageId, state: 'ready', thumbnail: { width: 400, height: 300 } }); media[id].imageRevision++;
    throw photoError({ status: 0 }, true);
  });
  mount(); await create(2); await pending(2); await click(screen.getByRole('button', { name: 'Upload 2 photos' }));
  await screen.findByText('Upload not confirmed. Check status.'); expect(uploadPhoto).toHaveBeenCalledTimes(1);
  expect(screen.getAllByAltText(/Local preview/)).toHaveLength(2);
  await click(screen.getByRole('button', { name: 'Check upload 1 status' }));
  await waitFor(() => expect(screen.getByRole('img', { name: 'Uploaded photo 1' })).toBeVisible());
  expect(uploadPhoto).toHaveBeenCalledTimes(1); await pending(1);
  expect(reservePhoto).toHaveBeenCalledTimes(1);
});

test('existing-item photo uploads leave unsaved text and its discard guard independent', async () => {
  items = [makeItem()]; mount(); await click(await screen.findByRole('button', { name: 'Edit Synthetic chair', exact: true }));
  const text = await screen.findByLabelText('Description'); fireEvent.change(text, { target: { value: 'Keep this unsaved text.' } });
  await waitFor(() => expect(screen.getByRole('button', { name: 'Add photos' })).toBeEnabled()); await select(); await pending();
  await click(screen.getByRole('button', { name: 'Upload 1 photo', exact: true }));
  await screen.findByAltText('Uploaded photo 1'); expect(text).toHaveValue('Keep this unsaved text.');
  expect(writes).toHaveLength(0); expect(unload()).toBe(true);
  await click(screen.getByRole('button', { name: 'Cancel edit' })); expect(text).toBeVisible();
});

test('account switches revoke private previews and do not carry staged files into another editor', async () => {
  mount(); await screen.findByLabelText('Item name'); await select(); expect(unload()).toBe(true);
  act(() => setActor({ id: 'owner-b', firstName: 'Other synthetic' }));
  await screen.findByLabelText('Item name'); expect(screen.queryByAltText(/Local preview/)).not.toBeInTheDocument();
  expect(URL.revokeObjectURL).toHaveBeenCalledTimes(1); expect(uploadPhoto).not.toHaveBeenCalled();
});


test('published-item batch confirmation occurs once and a cancelled confirmation sends nothing', async () => {
  items = [{ ...makeItem(), status: 'available', isPublic: true }]; mount();
  await click(await screen.findByRole('button', { name: 'Edit Synthetic chair', exact: true }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Add photos' })).toBeEnabled()); await select(2); await pending(2);
  await click(screen.getByRole('button', { name: 'Upload 2 photos' })); expect(window.confirm).toHaveBeenCalledTimes(1); expect(uploadPhoto).not.toHaveBeenCalled();
  window.confirm.mockReturnValue(true); await click(screen.getByRole('button', { name: 'Upload 2 photos' }));
  await waitFor(() => expect(uploadPhoto).toHaveBeenCalledTimes(2)); expect(window.confirm).toHaveBeenCalledTimes(2); expect(writes).toHaveLength(0);
});

test('partial success and a later ambiguous PUT retain confirmed thumbnails and safely continue only after status review', async () => {
  const send = uploadPhoto.getMockImplementation(); uploadPhoto.mockImplementationOnce(send).mockImplementationOnce(async (...args) => { await send(...args); throw photoError({ status: 0 }, true); });
  mount(); await create(3); await pending(3); await click(screen.getByRole('button', { name: 'Upload 3 photos' }));
  await screen.findByText('Upload not confirmed. Check status.');
  expect(screen.getByAltText('Uploaded photo 1')).toBeVisible(); expect(screen.getAllByAltText(/Local preview/)).toHaveLength(2); expect(uploadPhoto).toHaveBeenCalledTimes(2);
  await click(screen.getByRole('button', { name: 'Check upload 1 status' })); await screen.findByAltText('Uploaded photo 2'); await pending(1);
  await click(screen.getByRole('button', { name: 'Upload 1 photo', exact: true })); await screen.findByAltText('Uploaded photo 3');
  expect(uploadPhoto).toHaveBeenCalledTimes(3); expect(reservePhoto).toHaveBeenCalledTimes(3);
});

test('quota exhaustion after partial success retains the ready image and unrelated files without an inventory reload', async () => {
  const reserve = reservePhoto.getMockImplementation(); reservePhoto.mockImplementationOnce(reserve).mockRejectedValueOnce(photoError({ status: 429, code: 'IMAGE_DAILY_UPLOADS' }));
  mount(); await create(3); await pending(3); await click(screen.getByRole('button', { name: 'Upload 3 photos' }));
  await screen.findByText(/Daily allowance used/); expect(screen.getByAltText('Uploaded photo 1')).toBeVisible(); expect(screen.getAllByAltText(/Local preview/)).toHaveLength(2);
  expect(uploadPhoto).toHaveBeenCalledTimes(1); expect(reservePhoto).toHaveBeenCalledTimes(2);
  const inventoryReads = fetch.mock.calls.filter(([, options]) => options.method === 'GET').length;
  await click(screen.getByRole('button', { name: 'Refresh photos' }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Add photos' })).toBeEnabled());
  expect(fetch.mock.calls.filter(([, options]) => options.method === 'GET')).toHaveLength(inventoryReads);
  expect(screen.getByAltText('Uploaded photo 1')).toBeVisible(); expect(screen.getAllByAltText(/Local preview/)).toHaveLength(2);
});

test('session expiry between batch files clears private staged files and never sends the remaining files', async () => {
  const reserve = reservePhoto.getMockImplementation(); reservePhoto.mockImplementationOnce(reserve).mockRejectedValueOnce(photoError({ status: 401, code: 'SESSION_EXPIRED' }));
  mount(); await create(3); await pending(3); await click(screen.getByRole('button', { name: 'Upload 3 photos' }));
  await screen.findByRole('heading', { name: 'Login required' }); expect(uploadPhoto).toHaveBeenCalledTimes(1); expect(reservePhoto).toHaveBeenCalledTimes(2);
  expect(screen.queryByAltText(/Local preview|Uploaded photo/)).not.toBeInTheDocument(); expect(URL.revokeObjectURL).toHaveBeenCalledTimes(3);
});

test('a local compression failure does not discard an unrelated valid selection or send the original', async () => {
  preparePhoto.mockRejectedValueOnce(Object.assign(new Error('Could not prepare this photo.'), { code: 'PHOTO_PREPARATION_FAILED' }));
  mount(); await screen.findByLabelText('Item name'); fireEvent.change(screen.getByLabelText('Item name'), { target: { value: 'Synthetic chair' } }); await select(2);
  await screen.findByAltText('Local preview of selected photo 2'); await click(screen.getByRole('button', { name: 'Save Draft', exact: true })); await pending(1);
  expect(screen.getByText('Could not prepare this photo.')).toBeVisible(); expect(screen.getByAltText('Local preview of selected photo 2')).toBeVisible();
  expect(uploadPhoto).not.toHaveBeenCalled(); await click(screen.getByRole('button', { name: 'Upload 1 photo' }));
  await screen.findByAltText('Uploaded photo 1'); expect(uploadPhoto).toHaveBeenCalledTimes(1); expect(screen.getByText('Could not prepare this photo.')).toBeVisible();
});


test('a failed metadata refresh after confirmed readiness retains the thumbnail and unrelated staged files', async () => {
  const send = uploadPhoto.getMockImplementation();
  uploadPhoto.mockImplementationOnce(async (...args) => {
    const result = await send(...args);
    Object.assign(result.upload, { createdAt: '2026-10-29T12:00:00Z', thumbnail: { width: 400, height: 300, contentType: 'image/webp' },
      display: { width: 800, height: 600, contentType: 'image/webp' } });
    readPhotos.mockRejectedValueOnce(photoError({ status: 503 })); return result;
  });
  mount(); await create(3); await pending(3); await click(screen.getByRole('button', { name: 'Upload 3 photos' }));
  await screen.findByText('Photo uploaded. Refresh photos to update status.');
  expect(screen.getByAltText('Uploaded photo 1')).toBeVisible(); expect(screen.getAllByAltText(/Local preview/)).toHaveLength(2);
  expect(uploadPhoto).toHaveBeenCalledTimes(1); expect(reservePhoto).toHaveBeenCalledTimes(1); expect(unload()).toBe(true);
  await click(screen.getByRole('button', { name: 'Refresh photos' })); await pending(2);
  expect(screen.getByAltText('Uploaded photo 1')).toBeVisible(); expect(uploadPhoto).toHaveBeenCalledTimes(1);
  await click(screen.getByRole('button', { name: 'Upload 2 photos' })); await screen.findByAltText('Uploaded photo 3');
  expect(uploadPhoto).toHaveBeenCalledTimes(3); expect(reservePhoto).toHaveBeenCalledTimes(3);
});
