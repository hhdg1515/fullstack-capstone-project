import { selectItemType } from '../../test-support/selectItemType';
jest.mock('../../api/photoPreparation', () => ({ ...jest.requireActual('../../api/photoPreparation'), preparePhoto: jest.fn(async file => file) }));
jest.mock('../../context/AuthContext', () => {
  const React = require('react'); const Context = React.createContext();
  return { TestAuthContext: Context, useAppContext: () => React.useContext(Context) };
});
jest.mock('../../api/usePublicCatalog', () => ({ __esModule: true, default: () => ({ data: require('../../test-support/catalogs').taxonomy }) }));
jest.mock('../../api/itemImages', () => ({ ...jest.requireActual('../../api/itemImages'), readPhotos: jest.fn(), readUpload: jest.fn(),
  reorderPhotos: jest.fn(), deletePhoto: jest.fn(), reservePhoto: jest.fn(), uploadPhoto: jest.fn(), fileDigest: jest.fn(), uploadId: jest.fn(), securePhotoBrowser: () => true }));
import React, { useEffect, useState } from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { createMemoryRouter, RouterProvider, Routes, Route, Link } from 'react-router-dom';
import { TestAuthContext } from '../../context/AuthContext';
import { UnsavedChangesProvider } from '../../forms/UnsavedChanges';
import { deletePhoto, reorderPhotos, fileDigest, readPhotos, readUpload, reservePhoto, uploadId, uploadPhoto, photoError } from '../../api/itemImages';
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
function mount(strict = false) {
  const router = createMemoryRouter([{ path: '*', element: <Scene /> }], { initialEntries: ['/app/plans/' + plan.id + '/items'], future: { v7_relativeSplatPath: true } });
  const app = <RouterProvider router={router} future={{ v7_startTransition: true }} />;
  render(strict ? <React.StrictMode>{app}</React.StrictMode> : app); return router;
}
const select = async (count = 1) => act(async () => { fireEvent.change(screen.getByLabelText('Choose photos'), { target: { files: Array.from({ length: count }, () => new File(['local'], 'private.png', { type: 'image/png' })) } }); });
const stage = async (count = 1) => { await screen.findByLabelText('Item name'); fireEvent.change(screen.getByLabelText('Item name'), { target: { value: 'Synthetic chair' } }); await select(count); await screen.findByAltText('Local preview of selected photo ' + count); };
const save = async (count = 1, label = 'Save draft') => { const name = count ? `${label} with ${count} ${count === 1 ? 'photo' : 'photos'}` : 'Save Draft'; await waitFor(() => expect(screen.getByRole('button', { name, exact: true })).toBeEnabled()); await click(screen.getByRole('button', { name, exact: true })); };
const create = async (count = 1) => { await stage(count); await save(count); };
const pending = async (count = 1) => waitFor(() => expect(screen.getByRole('button', { name: `Upload remaining ${count} ${count === 1 ? 'photo' : 'photos'}`, exact: true })).toBeEnabled());
const ready = async count => waitFor(() => expect(screen.getAllByAltText(/Uploaded photo/)).toHaveLength(count));
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
    const data = media[id]; const image = { id: imageId, state: 'ready', sortPosition: data.images.length, createdAt: '2026-10-29T12:00:00Z', thumbnail: { width: 400, height: 300, contentType: 'image/webp' }, display: { width: 800, height: 600, contentType: 'image/webp' }, cleanupPending: false, reservationExpired: false };
    data.images.push(image); data.imageRevision++; data.allowance.itemSlots--; return { imageRevision: data.imageRevision, upload: image };
  });
  readUpload.mockImplementation(async (p, id, imageId) => ({ imageRevision: media[id].imageRevision, upload: [...media[id].images, ...media[id].uploads].find(image => image.id === imageId) }));
  reorderPhotos.mockImplementation(async (p, id, revision, ids) => { const data = media[id]; const images = ids.map((imageId, index) => ({ ...data.images.find(image => image.id === imageId), sortPosition: index })); media[id] = { ...data, images, imageRevision: data.imageRevision + 1 }; return { imageRevision: media[id].imageRevision, images }; });
  deletePhoto.mockImplementation(async (p, id, imageId) => { const data = media[id], image = data.images.find(image => image.id === imageId); const images = data.images.filter(image => image.id !== imageId).map((image, sortPosition) => ({ ...image, sortPosition })); const upload = { ...image, state: 'delete_pending', sortPosition: null, cleanupPending: true }; media[id] = { ...data, images, uploads: [...data.uploads, upload], imageRevision: data.imageRevision + 1 }; return { imageRevision: media[id].imageRevision, upload }; });
  global.fetch = jest.fn(async (url, options) => {
    if (options.method === 'GET') return reply({ plan, items: items.map(item => ({ ...item, photoPreview: { availability: 'none', imageRevision: 0, images: [] } })),
      progress: { total: items.length, cleared: 0 }, photoCapabilities: capabilities });
    const body = JSON.parse(options.body); writes.push({ url, body, method: options.method });
    if (createFault === 'validation') return reply({ error: { code: 'VALIDATION_FAILED', message: 'Check the name.', fields: [{ field: 'name', message: 'Check the name.' }] } }, 400);
    if (options.method === 'POST') {
      const item = { ...makeItem(nextId), ...body, status: body.publish ? 'available' : 'draft', isPublic: body.publish === true }; items.push(item);
      if (createFault === 'lost') throw Error('Synthetic response loss');
      return reply({ item }, 201);
    }
    const item = { ...items[0], ...body, version: items[0].version + 1 }; items[0] = item; return reply({ item });
  });
});
afterEach(async () => { await act(async () => {}); jest.restoreAllMocks(); jest.clearAllMocks(); });

test('one labeled submit saves first then sends the selected batch exactly once in its saved card', async () => {
  let finish; const send = uploadPhoto.getMockImplementation(); uploadPhoto.mockImplementationOnce((...args) => new Promise(resolve => { finish = async () => resolve(await send(...args)); }));
  mount(); await stage(2);
  expect(screen.getByRole('button', { name: 'Save draft with 2 photos' })).toBeVisible();
  expect(screen.getByRole('button', { name: 'Publish with 2 photos' })).toBeVisible();
  expect(writes).toHaveLength(0); expect(reservePhoto).not.toHaveBeenCalled(); expect(uploadPhoto).not.toHaveBeenCalled();
  await save(2); await waitFor(() => expect(uploadPhoto).toHaveBeenCalledTimes(1));
  expect(writes).toHaveLength(1); expect(writes[0].method).toBe('POST'); expect(uploadPhoto.mock.calls[0][1]).toBe(nextId);
  const card = screen.getByRole('heading', { name: 'Synthetic chair', exact: true }).closest('li');
  expect(within(card).getByAltText('Local preview of selected photo 1')).toBeVisible(); expect(unload()).toBe(true);
  expect(screen.queryByRole('button', { name: /^Upload/ })).not.toBeInTheDocument(); expect(window.confirm).not.toHaveBeenCalled();
  await act(async () => finish()); await ready(2);
  await waitFor(() => expect(screen.queryByLabelText('Item name')).not.toBeInTheDocument());
  expect(uploadPhoto).toHaveBeenCalledTimes(2); expect(reservePhoto).toHaveBeenCalledTimes(2); expect(unload()).toBe(false);
  expect(URL.revokeObjectURL).toHaveBeenCalledTimes(2); expect(screen.queryByText(/Reloading will lose/)).not.toBeInTheDocument();
  fireEvent.error(within(card).getByAltText('Uploaded photo 1'));
  await click(screen.getByRole('button', { name: 'Refresh inventory' }));
  await waitFor(() => expect(within(card).getByAltText('Uploaded photo 1')).toBeVisible());
  expect(uploadPhoto).toHaveBeenCalledTimes(2);
  await waitFor(() => expect(screen.getByRole('button', { name: 'Add item', exact: true })).toBeEnabled());
  await click(screen.getByRole('button', { name: 'Add item', exact: true })); expect(await screen.findByLabelText('Item name')).toHaveValue('');
});

test('a definitively rejected save retains text/files and sends no photos until a new explicit submit', async () => {
  createFault = 'validation'; mount(); await create();
  await waitFor(() => expect(screen.getByLabelText('Item name')).toHaveFocus());
  expect(screen.getByLabelText('Item name')).toHaveValue('Synthetic chair'); expect(screen.getByAltText('Local preview of selected photo 1')).toBeVisible();
  expect(reservePhoto).not.toHaveBeenCalled(); createFault = ''; await save(); await ready(1);
  expect(writes).toHaveLength(2); expect(uploadPhoto).toHaveBeenCalledTimes(1);
});

test('uncertain item creation cannot repeat POST or upload until explicit authoritative item review and submit', async () => {
  createFault = 'lost'; mount(); await create(2); await screen.findByText(/Save not confirmed. Check inventory/);
  const button = screen.getByRole('button', { name: 'Save draft with 2 photos' }); expect(button).toBeDisabled(); await submit(button.closest('form'));
  expect(writes).toHaveLength(1); expect(reservePhoto).not.toHaveBeenCalled();
  window.confirm.mockReturnValue(true); await click(screen.getByRole('button', { name: 'Refresh inventory' }));
  await click(await screen.findByRole('button', { name: 'Edit Synthetic chair', exact: true }));
  expect(screen.getAllByAltText(/Local preview/)).toHaveLength(2); expect(uploadPhoto).not.toHaveBeenCalled();
  createFault = ''; await save(2); await ready(2);
  expect(writes.filter(write => write.method === 'POST')).toHaveLength(1); expect(writes.filter(write => write.method === 'PATCH')).toHaveLength(1);
  expect(items).toHaveLength(1); expect(uploadPhoto).toHaveBeenCalledTimes(2);
});

test('photo navigation uses explicit accessible choices, preserves on Escape and discards only on the labeled action', async () => {
  const router = mount(); await stage(2); await click(screen.getByRole('link', { name: 'Leave inventory' }));
  const dialog = await screen.findByRole('dialog', { name: 'Leave photos behind?' });
  expect(within(dialog).getByRole('button', { name: 'Stay and keep photos' })).toHaveFocus();
  expect(dialog).toHaveAccessibleDescription(expect.stringContaining('Unsaved text changes'));
  const keep = within(dialog).getByRole('button', { name: 'Stay and keep photos' }), leave = within(dialog).getByRole('button', { name: 'Leave and discard photos' });
  fireEvent.keyDown(keep, { key: 'Tab', shiftKey: true }); expect(leave).toHaveFocus();
  fireEvent.keyDown(leave, { key: 'Tab' }); expect(keep).toHaveFocus();
  await act(async () => fireEvent.keyDown(dialog, { key: 'Escape' })); await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  expect(router.state.location.pathname).not.toBe('/away'); expect(screen.getAllByAltText(/Local preview/)).toHaveLength(2); expect(unload()).toBe(true);
  await click(screen.getByRole('button', { name: 'Cancel', exact: true }));
  await screen.findByRole('dialog'); await click(screen.getByRole('button', { name: 'Stay and keep photos' }));
  expect(screen.getByLabelText('Item name')).toHaveValue('Synthetic chair'); expect(URL.revokeObjectURL).not.toHaveBeenCalled();
  await click(screen.getByRole('link', { name: 'Leave inventory' })); await click(await screen.findByRole('button', { name: 'Leave and discard photos' }));
  await screen.findByRole('heading', { name: 'Away' }); expect(URL.revokeObjectURL).toHaveBeenCalledTimes(2); expect(unload()).toBe(false);
  expect(window.confirm).not.toHaveBeenCalled(); expect(writes).toHaveLength(0);
});

test('uncertain PUT retains all selections and a remount never consumes the submit authorization twice', async () => {
  const send = uploadPhoto.getMockImplementation(); uploadPhoto.mockImplementationOnce(async (...args) => { await send(...args); throw photoError({ status: 0 }, true); });
  mount(); await create(2); await screen.findByText('Upload not confirmed. Check status.');
  expect(screen.getAllByAltText(/Local preview/)).toHaveLength(2); expect(uploadPhoto).toHaveBeenCalledTimes(1);
  await click(screen.getByRole('button', { name: 'Refresh inventory' }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Check upload 1 status' })).toBeEnabled());
  expect(uploadPhoto).toHaveBeenCalledTimes(1); expect(writes).toHaveLength(1);
  await click(screen.getByRole('button', { name: 'Check upload 1 status' })); await ready(1); await pending(1);
  expect(uploadPhoto).toHaveBeenCalledTimes(1);
  await click(screen.getByRole('button', { name: 'Upload remaining 1 photo' })); await ready(2);
  expect(uploadPhoto).toHaveBeenCalledTimes(2); expect(reservePhoto).toHaveBeenCalledTimes(2);
});

test('saving edits and photos together preserves later independent text changes during status recovery', async () => {
  const send = uploadPhoto.getMockImplementation(); uploadPhoto.mockImplementationOnce(async (...args) => { await send(...args); throw photoError({ status: 0 }, true); });
  items = [makeItem()]; mount(); await click(await screen.findByRole('button', { name: 'Edit Synthetic chair', exact: true }));
  fireEvent.change(await screen.findByLabelText('Description'), { target: { value: 'Explicitly save this text.' } }); await select(); await save();
  await screen.findByText('Upload not confirmed. Check status.'); expect(writes).toHaveLength(1); expect(writes[0].body.description).toBe('Explicitly save this text.');
  await click(screen.getByRole('button', { name: 'Edit Synthetic chair', exact: true }));
  fireEvent.change(screen.getByLabelText('Description'), { target: { value: 'Keep a later unsaved draft.' } });
  await click(screen.getByRole('button', { name: 'Check upload 1 status' })); await ready(1);
  expect(screen.getByLabelText('Description')).toHaveValue('Keep a later unsaved draft.'); expect(unload()).toBe(true); expect(writes).toHaveLength(1);
  await click(screen.getByRole('link', { name: 'Leave inventory' })); expect(window.confirm).toHaveBeenCalledWith('Discard unsaved changes?');
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});

test('account switches revoke private previews and cannot carry submit intents into another account', async () => {
  mount(); await stage(); expect(unload()).toBe(true);
  act(() => setActor({ id: 'owner-b', firstName: 'Other synthetic' }));
  await screen.findByLabelText('Item name'); expect(screen.queryByAltText(/Local preview/)).not.toBeInTheDocument();
  expect(URL.revokeObjectURL).toHaveBeenCalledTimes(1); expect(uploadPhoto).not.toHaveBeenCalled();
});

test('a public item uses one explicit labeled save for the entire batch without visibility dialogs', async () => {
  items = [{ ...makeItem(), status: 'available', isPublic: true }]; mount();
  await click(await screen.findByRole('button', { name: 'Edit Synthetic chair', exact: true }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Add photos' })).toBeEnabled()); await select(3); await save(3, 'Save changes'); await ready(3);
  expect(writes).toHaveLength(1); expect(uploadPhoto).toHaveBeenCalledTimes(3); expect(reservePhoto).toHaveBeenCalledTimes(3); expect(window.confirm).not.toHaveBeenCalled();
});

test('publication remains successful after partial upload failure; status review and continuation do not republish', async () => {
  const send = uploadPhoto.getMockImplementation(); uploadPhoto.mockImplementationOnce(send).mockImplementationOnce(async (...args) => { await send(...args); throw photoError({ status: 0 }, true); });
  mount(); await stage(3);
  selectItemType('sofa');
  fireEvent.change(screen.getByLabelText('Description'), { target: { value: 'Synthetic household chair.' } });
  await save(3, 'Publish'); await screen.findByText('Upload not confirmed. Check status.');
  expect(screen.getByText('Item published.')).toBeVisible(); expect(items[0].status).toBe('available'); expect(screen.getByAltText('Uploaded photo 1')).toBeVisible();
  expect(screen.getAllByAltText(/Local preview/)).toHaveLength(2); expect(uploadPhoto).toHaveBeenCalledTimes(2);
  await click(screen.getByRole('button', { name: 'Check upload 1 status' })); await ready(2); await pending(1);
  await click(screen.getByRole('button', { name: 'Upload remaining 1 photo' })); await ready(3);
  expect(writes).toHaveLength(1); expect(uploadPhoto).toHaveBeenCalledTimes(3); expect(window.confirm).not.toHaveBeenCalled(); expect(unload()).toBe(false);
});

test('quota exhaustion retains the ready image and unrelated files for explicit local recovery', async () => {
  const reserve = reservePhoto.getMockImplementation(); reservePhoto.mockImplementationOnce(reserve).mockRejectedValueOnce(photoError({ status: 429, code: 'IMAGE_DAILY_UPLOADS' }));
  mount(); await create(3); await screen.findByText(/Daily allowance used/);
  expect(screen.getByAltText('Uploaded photo 1')).toBeVisible(); expect(screen.getAllByAltText(/Local preview/)).toHaveLength(2);
  expect(uploadPhoto).toHaveBeenCalledTimes(1); expect(reservePhoto).toHaveBeenCalledTimes(2);
  const inventoryReads = fetch.mock.calls.filter(([, options]) => options.method === 'GET').length;
  await click(screen.getByRole('button', { name: 'Refresh photos' })); await pending(2);
  expect(uploadPhoto).toHaveBeenCalledTimes(1); expect(fetch.mock.calls.filter(([, options]) => options.method === 'GET')).toHaveLength(inventoryReads);
});

test('session expiry between batch files clears private staged state and sends no later files', async () => {
  const reserve = reservePhoto.getMockImplementation(); reservePhoto.mockImplementationOnce(reserve).mockRejectedValueOnce(photoError({ status: 401, code: 'SESSION_EXPIRED' }));
  mount(); await create(3); await screen.findByRole('heading', { name: 'Login required' });
  expect(uploadPhoto).toHaveBeenCalledTimes(1); expect(reservePhoto).toHaveBeenCalledTimes(2); expect(screen.queryByAltText(/Local preview|Uploaded photo/)).not.toBeInTheDocument();
  expect(URL.revokeObjectURL).toHaveBeenCalledTimes(3); expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});

test('a compression failure preserves other selections; valid photos upload only through the labeled submit', async () => {
  preparePhoto.mockRejectedValueOnce(Object.assign(new Error('Could not prepare this photo.'), { code: 'PHOTO_PREPARATION_FAILED' }));
  mount(); await stage(2); expect(screen.getByText('Could not prepare this photo.')).toBeVisible(); expect(uploadPhoto).not.toHaveBeenCalled();
  await save(1); await ready(1); expect(screen.getByText('Could not prepare this photo.')).toBeVisible(); expect(uploadPhoto).toHaveBeenCalledTimes(1); expect(unload()).toBe(true);
  await click(screen.getByRole('button', { name: 'Remove selection 1' })); await waitFor(() => expect(unload()).toBe(false));
  expect(screen.queryByText(/Reloading will lose/)).not.toBeInTheDocument();
});

test('failed metadata after confirmed readiness retains thumbnails; refreshing never starts remaining files', async () => {
  const send = uploadPhoto.getMockImplementation(); uploadPhoto.mockImplementationOnce(async (...args) => { const result = await send(...args); readPhotos.mockRejectedValueOnce(photoError({ status: 503 })); return result; });
  mount(); await create(3); await screen.findByText('Photo uploaded. Refresh photos to update status.');
  expect(screen.getByAltText('Uploaded photo 1')).toBeVisible(); expect(screen.getAllByAltText(/Local preview/)).toHaveLength(2); expect(uploadPhoto).toHaveBeenCalledTimes(1);
  await click(screen.getByRole('button', { name: 'Refresh photos' })); await pending(2); expect(uploadPhoto).toHaveBeenCalledTimes(1);
  await click(screen.getByRole('button', { name: 'Upload remaining 2 photos' })); await ready(3); expect(writes).toHaveLength(1);
});

test('a failed first metadata read consumes the intent without upload, requiring explicit recovery after refresh', async () => {
  readPhotos.mockRejectedValueOnce(photoError({ status: 503 })); mount(); await create(2);
  await screen.findByText(/Photo service unavailable/); expect(reservePhoto).not.toHaveBeenCalled();
  await click(screen.getByRole('button', { name: 'Refresh photos' })); await pending(2); expect(uploadPhoto).not.toHaveBeenCalled();
  await click(screen.getByRole('button', { name: 'Upload remaining 2 photos' })); await ready(2); expect(writes).toHaveLength(1);
});

test('duplicate submit while item save is pending cannot create duplicate items or batches', async () => {
  const original = fetch.getMockImplementation(); let finish;
  fetch.mockImplementation(async (url, options) => options.method === 'POST' ? new Promise(resolve => { finish = async () => resolve(await original(url, options)); }) : original(url, options));
  mount(); await stage(2); const button = screen.getByRole('button', { name: 'Save draft with 2 photos' }), form = button.closest('form');
  await click(button); await submit(form); expect(uploadPhoto).not.toHaveBeenCalled();
  await act(async () => finish()); await ready(2);
  expect(writes).toHaveLength(1); expect(items).toHaveLength(1); expect(uploadPhoto).toHaveBeenCalledTimes(2);
});

test('completion while a leave dialog is open removes the photo warning without discarding or duplicating work', async () => {
  let finish; const send = uploadPhoto.getMockImplementation(); uploadPhoto.mockImplementationOnce((...args) => new Promise(resolve => { finish = async () => resolve(await send(...args)); }));
  const router = mount(); await create(); await waitFor(() => expect(uploadPhoto).toHaveBeenCalledTimes(1));
  await click(screen.getByRole('link', { name: 'Leave inventory' })); await screen.findByRole('dialog');
  await act(async () => finish()); await ready(1); await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  expect(router.state.location.pathname).not.toBe('/away'); expect(unload()).toBe(false); expect(uploadPhoto).toHaveBeenCalledTimes(1);
  await click(screen.getByRole('link', { name: 'Leave inventory' })); await screen.findByRole('heading', { name: 'Away' }); expect(window.confirm).not.toHaveBeenCalled();
});


test('explicit leave during an active batch aborts the browser transfer and cannot send later files', async () => {
  let signal;
  uploadPhoto.mockImplementationOnce((p, id, op, file, options) => new Promise((resolve, reject) => {
    signal = options.signal; signal.addEventListener('abort', () => reject(photoError({ status: 0, code: 'REQUEST_ABORTED' }, true)));
  }));
  mount(); await create(3); await waitFor(() => expect(uploadPhoto).toHaveBeenCalledTimes(1));
  await click(screen.getByRole('link', { name: 'Leave inventory' })); await screen.findByRole('dialog');
  await click(screen.getByRole('button', { name: 'Leave and discard photos' })); await screen.findByRole('heading', { name: 'Away' });
  expect(signal.aborted).toBe(true); expect(uploadPhoto).toHaveBeenCalledTimes(1); expect(reservePhoto).toHaveBeenCalledTimes(1);
  expect(URL.revokeObjectURL).toHaveBeenCalledTimes(3); expect(unload()).toBe(false); expect(writes).toHaveLength(1);
});


test('StrictMode effect remounts cannot replay a successful submit or its photo batch', async () => {
  mount(true); await create(2); await ready(2);
  await waitFor(() => expect(screen.getByRole('button', { name: 'Refresh inventory' })).toBeEnabled());
  await click(screen.getByRole('button', { name: 'Refresh inventory' }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Add item', exact: true })).toBeEnabled());
  expect(writes).toHaveLength(1); expect(uploadPhoto).toHaveBeenCalledTimes(2); expect(reservePhoto).toHaveBeenCalledTimes(2); expect(unload()).toBe(false);
});

const readyPhoto = (letter, sortPosition) => ({ id: letter.repeat(24), state: 'ready', sortPosition, createdAt: '2026-10-29T12:00:00Z',
  thumbnail: { width: 400, height: 300, contentType: 'image/webp' }, display: { width: 800, height: 600, contentType: 'image/webp' }, cleanupPending: false, reservationExpired: false });
const photoIds = () => media[items[0].id].images.map(image => image.id);
async function editPhotos(count = 3) {
  items = [makeItem()]; media[items[0].id] = { ...metadata(), imageRevision: count, images: ['c', 'd', 'e'].slice(0, count).map(readyPhoto) };
  mount(); await click(await screen.findByRole('button', { name: 'Edit Synthetic chair' }));
  await screen.findByRole('button', { name: 'Delete photo 1' });
  await waitFor(() => expect(screen.getByRole('button', { name: 'Delete photo 1' })).toBeEnabled());
}
const confirmDelete = async position => { await click(screen.getByRole('button', { name: 'Delete photo ' + position })); await click(screen.getByRole('button', { name: 'Delete photo', exact: true })); };
test('owner cover and up/down changes persist canonical order without resetting text or selected photos', async () => {
  await editPhotos(); const description = screen.getByLabelText('Description'); fireEvent.change(description, { target: { value: 'Keep unsaved text' } }); await select();
  const preview = screen.getByAltText('Local preview of selected photo 1').getAttribute('src');
  await click(screen.getByRole('button', { name: 'Make photo 3 cover' }));
  expect(reorderPhotos).toHaveBeenCalledWith(plan.id, items[0].id, 3, ['e', 'c', 'd'].map(x => x.repeat(24)));
  await waitFor(() => expect(screen.getByRole('listitem', { name: 'Saved photo 1, Cover' })).toHaveFocus());
  expect(screen.getByAltText('Uploaded photo 1')).toHaveAttribute('src', '/api/item-images/' + 'e'.repeat(24) + '/thumbnail');
  await click(screen.getByRole('button', { name: 'Move photo 3 up' })); expect(photoIds()).toEqual(['e', 'd', 'c'].map(x => x.repeat(24)));
  await click(screen.getByRole('button', { name: 'Move photo 2 down' })); expect(photoIds()).toEqual(['e', 'c', 'd'].map(x => x.repeat(24)));
  expect(description).toHaveValue('Keep unsaved text'); expect(screen.getByAltText('Local preview of selected photo 1')).toHaveAttribute('src', preview);
  expect(writes).toHaveLength(0); expect(uploadPhoto).not.toHaveBeenCalled(); expect(unload()).toBe(true);
});
test('delete confirmation starts on Keep, traps focus, and ordinary/cover deletion use deterministic remaining photos', async () => {
  await editPhotos(); screen.getByRole('button', { name: 'Delete photo 1' }).focus(); await click(screen.getByRole('button', { name: 'Delete photo 1' }));
  expect(screen.getByRole('button', { name: 'Keep photo' })).toHaveFocus(); expect(screen.getByRole('dialog')).toHaveAccessibleDescription(expect.stringContaining('next photo'));
  fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Tab', shiftKey: true }); expect(screen.getByRole('button', { name: 'Delete photo', exact: true })).toHaveFocus();
  fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' }); expect(deletePhoto).not.toHaveBeenCalled();
  expect(screen.getByRole('button', { name: 'Delete photo 1' })).toHaveFocus();
  await confirmDelete(2); expect(photoIds()).toEqual(['c', 'e'].map(x => x.repeat(24)));
  expect(screen.getByText('Photo deleted. Cleanup pending.')).toBeVisible();
  await confirmDelete(1); expect(photoIds()).toEqual(['e'.repeat(24)]);
  expect(screen.getByAltText('Uploaded photo 1')).toHaveAttribute('src', '/api/item-images/' + 'e'.repeat(24) + '/thumbnail');
  expect(unload()).toBe(false);
});
test('ambiguous deletion keeps the old thumbnail and pending files until explicit canonical checks, with no second POST', async () => {
  await editPhotos(2); await select(); const perform = deletePhoto.getMockImplementation();
  deletePhoto.mockImplementationOnce(async (...args) => { await perform(...args); throw photoError({ status: 0 }, true); });
  await confirmDelete(1); await screen.findByText('Photo change not confirmed. Check changes before continuing.');
  expect(screen.getAllByAltText(/Uploaded photo/)).toHaveLength(2); expect(screen.getByAltText('Local preview of selected photo 1')).toBeVisible();
  expect(screen.getByRole('button', { name: 'Delete photo 2' })).toBeDisabled(); expect(uploadPhoto).not.toHaveBeenCalled();
  await click(screen.getByRole('button', { name: 'Check photo changes' }));
  expect(readUpload).toHaveBeenCalledWith(plan.id, items[0].id, 'c'.repeat(24)); expect(screen.getAllByAltText(/Uploaded photo/)).toHaveLength(1);
  expect(deletePhoto).toHaveBeenCalledTimes(1); expect(screen.getByAltText('Local preview of selected photo 1')).toBeVisible();
});
test('stale order and quota failures require a read and review, never automatic replay', async () => {
  await editPhotos(2); reorderPhotos.mockRejectedValueOnce(photoError({ status: 409, code: 'IMAGE_CHANGED' }));
  await click(screen.getByRole('button', { name: 'Make photo 2 cover' })); await screen.findByText('Photo change not confirmed. Check changes before continuing.');
  expect(reorderPhotos).toHaveBeenCalledTimes(1); await click(screen.getByRole('button', { name: 'Check photo changes' }));
  expect(screen.getByText('Photos changed. Review the current order.')).toBeVisible();
  reorderPhotos.mockRejectedValueOnce(photoError({ status: 429, code: 'IMAGE_CONTROL_LIMIT' }));
  await click(screen.getByRole('button', { name: 'Make photo 2 cover' })); expect(await screen.findByRole('alert')).toHaveTextContent('Too many requests');
  expect(reorderPhotos).toHaveBeenCalledTimes(2);
  readPhotos.mockRejectedValueOnce(photoError({ status: 429, code: 'IMAGE_CONTROL_LIMIT' }));
  await click(screen.getByRole('button', { name: 'Check photo changes' })); expect(await screen.findByRole('alert')).toHaveTextContent('Too many requests');
  await click(screen.getByRole('button', { name: 'Check photo changes' })); expect(reorderPhotos).toHaveBeenCalledTimes(2);
});
test('uncertain management survives editor close/remount with no automatic mutation or file upload', async () => {
  await editPhotos(2); reorderPhotos.mockRejectedValueOnce(photoError({ status: 0 }, true));
  await click(screen.getByRole('button', { name: 'Make photo 2 cover' })); await screen.findByRole('button', { name: 'Check photo changes' });
  await click(screen.getByRole('button', { name: 'Cancel edit' })); await click(screen.getByRole('button', { name: 'Edit Synthetic chair' }));
  expect(await screen.findByRole('button', { name: 'Check photo changes' })).toBeEnabled();
  expect(screen.getByRole('button', { name: 'Make photo 2 cover' })).toBeDisabled(); expect(reorderPhotos).toHaveBeenCalledTimes(1);
  await click(screen.getByRole('button', { name: 'Check photo changes' })); expect(screen.getByRole('button', { name: 'Make photo 2 cover' })).toBeEnabled();
});
test('failed canonical read after deletion acknowledgment retains the UI until recovery succeeds', async () => {
  await editPhotos(2); readPhotos.mockRejectedValueOnce(photoError({ status: 503 })); await confirmDelete(1);
  await screen.findByText('Photo change not confirmed. Check changes before continuing.'); expect(screen.getAllByAltText(/Uploaded photo/)).toHaveLength(2);
  await click(screen.getByRole('button', { name: 'Check photo changes' })); expect(screen.getAllByAltText(/Uploaded photo/)).toHaveLength(1); expect(deletePhoto).toHaveBeenCalledTimes(1);
});
test('in-flight management disables other submissions and a late expired session clears private drafts', async () => {
  await editPhotos(2); await select(); let reject;
  deletePhoto.mockImplementationOnce(() => new Promise((resolve, fail) => { reject = fail; }));
  await confirmDelete(1); fireEvent.click(screen.getByRole('button', { name: 'Make photo 2 cover' }));
  expect(reorderPhotos).not.toHaveBeenCalled(); expect(screen.getByRole('button', { name: 'Save draft with 1 photo' })).toBeDisabled();
  await act(async () => reject(photoError({ status: 401, code: 'SESSION_EXPIRED' })));
  expect(await screen.findByRole('heading', { name: 'Login required' })).toBeVisible(); expect(screen.queryAllByRole('img')).toHaveLength(0); expect(unload()).toBe(false);
});

test('a delete status/list race stays unresolved rather than falsely claiming the photo is still present', async () => {
  await editPhotos(2); deletePhoto.mockRejectedValueOnce(photoError({ status: 0 }, true));
  await confirmDelete(1); await screen.findByRole('button', { name: 'Check photo changes' });
  const previous = media[items[0].id].images[0];
  readUpload.mockResolvedValueOnce({ imageRevision: 2, upload: previous });
  media[items[0].id] = { ...media[items[0].id], imageRevision: 3, images: [{ ...media[items[0].id].images[1], sortPosition: 0 }] };
  await click(screen.getByRole('button', { name: 'Check photo changes' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Could not check photo changes. Try again.');
  expect(screen.queryByText('Photo is still present. Review it before deleting again.')).not.toBeInTheDocument(); expect(deletePhoto).toHaveBeenCalledTimes(1);
});
