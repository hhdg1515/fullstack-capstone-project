jest.mock('../../api/photoPreparation', () => ({ ...jest.requireActual('../../api/photoPreparation'), preparePhoto: jest.fn(async file => file) }));
jest.mock('../../context/AuthContext', () => {
  const React = require('react'), Context = React.createContext();
  return { TestAuthContext: Context, useAppContext: () => React.useContext(Context) };
});
jest.mock('../../api/itemImages', () => ({ ...jest.requireActual('../../api/itemImages'), readPhotos: jest.fn(), readUpload: jest.fn(),
  reservePhoto: jest.fn(), uploadPhoto: jest.fn(), fileDigest: jest.fn(), uploadId: jest.fn(), securePhotoBrowser: jest.fn(() => true) }));
import React, { useEffect, useState } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createMemoryRouter, Link, Route, RouterProvider, Routes } from 'react-router-dom';
import { TestAuthContext } from '../../context/AuthContext';
import { UnsavedChangesProvider, useUnsavedForm } from '../../forms/UnsavedChanges';
import { fileDigest, photoError, readPhotos, readUpload, reservePhoto, securePhotoBrowser, uploadId, uploadPhoto } from '../../api/itemImages';
import ItemPhotos from './ItemPhotos';
import { preparePhoto } from '../../api/photoPreparation';

const plan = 'a'.repeat(24), item = { id: 'b'.repeat(24), name: 'Synthetic chair', status: 'draft' }, image = 'c'.repeat(24);
const owner = { id: 'owner-a', firstName: 'A' };
const operation = state => ({ id: image, state, cleanupPending: false, reservationExpired: false, createdAt: '2026-10-28T12:00:00Z' });
const readyImage = () => ({ ...operation('ready'), sortPosition: 0, thumbnail: { width: 200, height: 150, contentType: 'image/webp' }, display: { width: 200, height: 150, contentType: 'image/webp' } });
const metadata = () => ({ imageRevision: 0, images: [], uploads: [], capabilities: { metadata: true, binaryUpload: true, imageRead: true },
  limits: { photos: 5, inputBytes: 3145728, attempts: 50, successes: 20, accountBytes: 104857600, concurrent: 2, records: 1000 },
  allowance: { itemSlots: 5, attempts: 50, successes: 20, storageBytes: 104857600, concurrent: 2, records: 1000, newUploadsAllowed: true } });
let data, updateScene, sequence;
function TextDraft() {
  const [text, setText] = useState(''); useUnsavedForm({ text }, { text: '' });
  return <label>Independent item text<input value={text} onChange={event => setText(event.target.value)} /></label>;
}
function Scene() {
  const [state, setState] = useState({ user: owner, status: 'authenticated', item, open: true }); updateScene = setState;
  useEffect(() => {
    const expired = () => setState(value => ({ ...value, user: null, status: 'anonymous' }));
    window.addEventListener('giftlink:unauthorized', expired); return () => window.removeEventListener('giftlink:unauthorized', expired);
  }, []);
  return <TestAuthContext.Provider value={state}><UnsavedChangesProvider><p>Actor {state.user?.firstName || 'anonymous'}</p><Routes>
    <Route path="/" element={<><TextDraft />{state.open && <ItemPhotos planId={plan} item={state.item} onClose={() => setState(value => ({ ...value, open: false }))} />}<Link to="/away">Leave page</Link></>} />
    <Route path="/away" element={<h1>Away</h1>} />
  </Routes></UnsavedChangesProvider></TestAuthContext.Provider>;
}
function mount() {
  const router = createMemoryRouter([{ path: '*', element: <Scene /> }], { future: { v7_relativeSplatPath: true } });
  const rendered = render(<RouterProvider router={router} future={{ v7_startTransition: true }} />); return { router, ...rendered };
}
const choose = async (files = [new File(['synthetic'], 'private-address-and-name.png', { type: 'image/png' })]) => act(async () => { fireEvent.change(screen.getByLabelText('Choose photos'), { target: { files } }); });
const loaded = async () => waitFor(() => expect(screen.getByLabelText('Choose photos')).toBeEnabled());
const refreshPhotos = async () => {
  if (!screen.queryByRole('button', { name: 'Refresh photos' })) await click(screen.getByText('Photo tips'));
  await click(screen.getByRole('button', { name: 'Refresh photos' }));
};
const begin = async () => { const button = await screen.findByRole('button', { name: 'Upload 1 photo' }); await waitFor(() => expect(button).toBeEnabled()); await click(button); };
const click = async target => act(async () => { fireEvent.click(target); });
const unload = () => { const event = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(event); return event.defaultPrevented; };
beforeEach(() => {
  preparePhoto.mockImplementation(async file => file);
  data = metadata(); sequence = 0;
  readPhotos.mockImplementation(async () => data); readUpload.mockResolvedValue({ imageRevision: 0, upload: operation('reserved') });
  reservePhoto.mockResolvedValue({ imageRevision: 0, upload: operation('reserved') }); fileDigest.mockResolvedValue('d'.repeat(64));
  uploadId.mockImplementation(() => '00000000-0000-4000-8000-' + String(++sequence).padStart(12, '0')); securePhotoBrowser.mockReturnValue(true);
  uploadPhoto.mockImplementation(async () => { data = { ...data, imageRevision: 1, images: [readyImage()], allowance: { ...data.allowance, itemSlots: 4 } }; return { imageRevision: 1, upload: operation('ready') }; });
  URL.createObjectURL = jest.fn(() => 'blob:synthetic-' + sequence); URL.revokeObjectURL = jest.fn();
  jest.spyOn(window, 'confirm').mockReturnValue(false);
});
afterEach(async () => { await act(async () => {}); jest.clearAllMocks(); jest.restoreAllMocks(); });

test('requires an explicitly saved item and makes no invisible save or metadata request', async () => {
  mount(); act(() => updateScene(value => ({ ...value, item: { name: 'Unsaved item' } })));
  expect(screen.getByText('Save this item before adding photos.')).toBeInTheDocument(); expect(screen.queryByLabelText('Choose photos')).not.toBeInTheDocument();
  expect(reservePhoto).not.toHaveBeenCalled();
});
test('keeps the default panel minimal with a count, Add photos and accessible collapsed tips', async () => {
  mount(); await loaded();
  expect(screen.getByRole('heading', { name: 'Photos for Synthetic chair' })).toBeInTheDocument();
  expect(screen.getByText('0 / 5')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Add photos' })).toHaveAccessibleDescription(expect.stringContaining('Remove visible addresses'));
  expect(screen.getByText(/Up to 5 photos/)).not.toBeVisible();
  expect(screen.queryByText('Photo allowance')).not.toBeInTheDocument();
  expect(screen.queryByText(/No ready photos|Photos selected|Maximum 5 photos/)).not.toBeInTheDocument();
  expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
  expect(reservePhoto).not.toHaveBeenCalled(); expect(uploadPhoto).not.toHaveBeenCalled();
});
test('Add photos opens the native picker but selection still requires explicit Upload', async () => {
  mount(); await loaded(); const picker = screen.getByLabelText('Choose photos'); const open = jest.spyOn(picker, 'click');
  await click(screen.getByRole('button', { name: 'Add photos' })); expect(open).toHaveBeenCalledTimes(1);
  await choose(); expect(screen.getByRole('button', { name: 'Upload 1 photo' })).toHaveTextContent('Upload');
  expect(reservePhoto).not.toHaveBeenCalled(); expect(uploadPhoto).not.toHaveBeenCalled();
});
test('ready photos show thumbnails without permanent success labels or quota notices', async () => {
  data.images = [readyImage()]; data.allowance.itemSlots = 4;
  mount(); await loaded(); expect(screen.getByText('1 / 5')).toBeInTheDocument();
  expect(screen.getByAltText('Uploaded photo 1')).toBeVisible();
  expect(screen.getByText('Photo 1 uploaded.')).toHaveClass('visually-hidden');
  expect(screen.queryByText(/Photo ready|Shared capacity|At last refresh|Ready/)).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /remove|cover|reorder/i })).not.toBeInTheDocument();
});
test('counts saved photos and local selections together without duplicate counting after readiness', async () => {
  const old = { ...readyImage(), id: 'e'.repeat(24) }; data.images = [old]; data.allowance.itemSlots = 4;
  uploadPhoto.mockImplementation(async () => { data = { ...data, imageRevision: 1, images: [old, readyImage()] }; return { imageRevision: 1, upload: operation('ready') }; });
  mount(); await loaded(); await choose(); expect(screen.getByText('2 / 5')).toBeInTheDocument();
  await begin(); await screen.findByAltText('Uploaded photo 2'); expect(screen.getByText('2 / 5')).toBeInTheDocument(); expect(unload()).toBe(false);
});
test('file selection creates local previews only, keeps filenames private and never persists a binary draft', async () => {
  const storage = jest.spyOn(Storage.prototype, 'setItem'); mount(); await loaded(); await choose();
  expect(await screen.findByAltText('Local preview of selected photo 1')).toHaveAttribute('src', 'blob:synthetic-1');
  expect(screen.queryByText('private-address-and-name.png')).not.toBeInTheDocument(); expect(fileDigest).not.toHaveBeenCalled();
  expect(reservePhoto).not.toHaveBeenCalled(); expect(uploadPhoto).not.toHaveBeenCalled(); expect(storage).not.toHaveBeenCalled(); expect(unload()).toBe(true);
});
test('rejects a sixth selection and counts saved/pending slots before creating object URLs', async () => {
  mount(); await loaded(); await choose(Array.from({ length: 6 }, () => new File(['a'], 'a.png', { type: 'image/png' })));
  expect(await screen.findByRole('alert')).toHaveTextContent(/up to 5/); expect(URL.createObjectURL).not.toHaveBeenCalled();
  expect(screen.getByLabelText('Choose photos')).toHaveAttribute('aria-invalid', 'true');
  expect(screen.getByLabelText('Choose photos')).toHaveAccessibleDescription(expect.stringContaining('up to 5'));
  data = { ...data, allowance: { ...data.allowance, itemSlots: 1 } }; await refreshPhotos(); await loaded();
  await choose([new File(['a'], 'a.png', { type: 'image/png' }), new File(['b'], 'b.png', { type: 'image/png' })]); expect(URL.createObjectURL).not.toHaveBeenCalled();
});
test.each([['HEIC', () => new File(['a'], 'phone.heic', { type: 'image/heic' }), /Convert HEIC/],
  ['large', () => new File([new Uint8Array(20971521)], 'large.png', { type: 'image/png' }), /20 MiB/]])('makes %s errors immediately actionable without a forced metadata refresh', async (name, file, message) => {
  mount(); await loaded(); await choose([file()]); expect(await screen.findByRole('alert')).toHaveTextContent(message);
  await waitFor(() => expect(screen.getByRole('button', { name: 'Add photos' })).toHaveFocus()); expect(screen.getByLabelText('Choose photos')).toBeEnabled();
  await choose(); expect(await screen.findByAltText('Local preview of selected photo 2')).toBeInTheDocument(); expect(reservePhoto).not.toHaveBeenCalled();
});
test('distinguishes byte transfer from readiness and prevents duplicate in-flight sends', async () => {
  let finish, progress; uploadPhoto.mockImplementation((p, i, id, file, options) => { progress = options.onProgress; return new Promise(resolve => { finish = resolve; }); });
  mount(); await loaded(); await choose(); const upload = await screen.findByRole('button', { name: 'Upload 1 photo' }); await waitFor(() => expect(upload).toBeEnabled()); await click(upload); await click(upload); await waitFor(() => expect(uploadPhoto).toHaveBeenCalledTimes(1));
  expect(reservePhoto.mock.calls[0][2]).toEqual({ imageRevision: 0, clientUploadId: '00000000-0000-4000-8000-000000000001', byteLength: 9, sha256: 'd'.repeat(64) });
  act(() => progress(42, false)); expect(screen.getByRole('progressbar')).toHaveAttribute('value', '42');
  act(() => progress(100, true)); expect(screen.getByText(/not ready yet/)).toBeInTheDocument(); expect(screen.queryByText('Photo ready.')).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Upload 1 photo' })).not.toBeInTheDocument();
  await act(async () => { data = { ...data, images: [readyImage()], imageRevision: 1 }; finish({ imageRevision: 1, upload: operation('ready') }); });
  expect(await screen.findByAltText('Uploaded photo 1')).toHaveAttribute('src', '/api/item-images/' + image + '/thumbnail');
  expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:synthetic-1'); expect(unload()).toBe(false);
  await waitFor(() => expect(screen.getByRole('button', { name: 'Add photos' })).toHaveFocus()); expect(reservePhoto).toHaveBeenCalledTimes(1);
});
test('recovering an ambiguous PUT queries canonical status and never resends the file, even when a read still says reserved', async () => {
  uploadPhoto.mockRejectedValue(photoError({ status: 0 }, true)); mount(); await loaded(); await choose(); await begin();
  expect(await screen.findByText(/Upload not confirmed/)).toBeInTheDocument();
  await click(screen.getByRole('button', { name: 'Check upload 1 status' }));
  await waitFor(() => expect(readUpload).toHaveBeenCalledWith(plan, item.id, image, expect.any(String)));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Check upload 1 status' })).toBeEnabled());
  expect(screen.queryByRole('button', { name: 'Upload 1 photo' })).not.toBeInTheDocument(); expect(await screen.findByAltText('Local preview of selected photo 1')).toBeInTheDocument();
  readUpload.mockImplementation(async () => { data = { ...data, images: [readyImage()] }; return { imageRevision: 1, upload: operation('ready') }; });
  await click(screen.getByRole('button', { name: 'Check upload 1 status' })); expect(await screen.findByAltText('Uploaded photo 1')).toBeInTheDocument();
  expect(uploadPhoto).toHaveBeenCalledTimes(1); expect(reservePhoto).toHaveBeenCalledTimes(1);
});
test('recovers a lost reservation response by the same UUID before its first binary send', async () => {
  reservePhoto.mockRejectedValue(photoError({ status: 0 }, true)); mount(); await loaded(); await choose(); await begin(); await screen.findByText(/Upload not confirmed/);
  await click(screen.getByRole('button', { name: 'Check upload 1 status' }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Upload 1 photo' })).toBeEnabled());
  expect(readUpload).toHaveBeenCalledWith(plan, item.id, undefined, '00000000-0000-4000-8000-000000000001');
  await begin(); expect(await screen.findByAltText('Uploaded photo 1')).toBeInTheDocument(); expect(reservePhoto).toHaveBeenCalledTimes(1); expect(uploadPhoto).toHaveBeenCalledTimes(1);
});
test('a definite pre-claim busy rejection permits a manual same-reservation retry only after a successful status check', async () => {
  uploadPhoto.mockRejectedValueOnce(photoError({ status: 429, code: 'IMAGE_PROCESSOR_BUSY' }, true));
  mount(); await loaded(); await choose(); await begin(); await screen.findByRole('alert');
  await click(screen.getByRole('button', { name: 'Check upload 1 status' }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Upload 1 photo' })).toBeEnabled());
  await begin(); await screen.findByAltText('Uploaded photo 1'); expect(reservePhoto).toHaveBeenCalledTimes(1);
  expect(uploadPhoto).toHaveBeenCalledTimes(2); expect(uploadPhoto.mock.calls[0][2]).toBe(uploadPhoto.mock.calls[1][2]);
});
test('a missing lost reservation permits only an explicit same-UUID retry, never an automatic replacement', async () => {
  reservePhoto.mockRejectedValueOnce(photoError({ status: 0 }, true)); readUpload.mockRejectedValue(photoError({ status: 404, code: 'IMAGE_UNAVAILABLE' }));
  mount(); await loaded(); await choose(); await begin(); await screen.findByText(/Upload not confirmed/); expect(reservePhoto).toHaveBeenCalledTimes(1);
  await click(screen.getByRole('button', { name: 'Check upload 1 status' }));
  const retry = await screen.findByRole('button', { name: 'Retry upload 1' }); await waitFor(() => expect(retry).toBeEnabled());
  expect(reservePhoto).toHaveBeenCalledTimes(1); await click(retry); await screen.findByAltText('Uploaded photo 1');
  expect(reservePhoto).toHaveBeenCalledTimes(2); expect(reservePhoto.mock.calls[0][2].clientUploadId).toBe(reservePhoto.mock.calls[1][2].clientUploadId); expect(uploadId).toHaveBeenCalledTimes(1);
});
test.each([['IMAGE_DAILY_ATTEMPTS', /daily attempt limit/i], ['IMAGE_DAILY_UPLOADS', /daily allowance/i],
  ['IMAGE_STORAGE_CAPACITY', /Photo storage is full/], ['IMAGE_UPLOAD_CAPACITY', /Uploads are pending/],
  ['IMAGE_RECORD_LIMIT', /Contact support/], ['IMAGE_ITEM_LIMIT', /5 photo spaces/], ['IMAGE_CHANGED', /Refresh and try/]])('retains local files on %s and does not retry the write', async (code, message) => {
  reservePhoto.mockRejectedValue(photoError({ status: code === 'IMAGE_CHANGED' ? 409 : 429, code })); mount(); await loaded(); await choose(); await begin();
  expect(await screen.findByRole('alert')).toHaveTextContent(message); expect(await screen.findByAltText('Local preview of selected photo 1')).toBeInTheDocument();
  expect(reservePhoto).toHaveBeenCalledTimes(1); expect(uploadPhoto).not.toHaveBeenCalled();
});
test('does not confuse failed uploads needing cleanup with ready photos or released capacity', async () => {
  data.uploads = [{ ...operation('failed'), cleanupPending: true }]; data.allowance.itemSlots = 4;
  mount(); await loaded(); screen.getByText('Upload history').closest('details').open = true;
  expect(screen.getByText(/Upload needs review/)).toBeInTheDocument(); expect(screen.getByText(/Space may still be held/)).toBeInTheDocument();
  expect(screen.queryByAltText('Uploaded photo 1')).not.toBeInTheDocument();
});
test('renders unavailable capability truthfully and cannot send or reserve on a disabled server', async () => {
  data.capabilities.binaryUpload = false; mount(); await screen.findByText(/Photo uploads are unavailable/);
  await waitFor(() => expect(screen.getByRole('button', { name: 'Refresh photos' })).toBeEnabled());
  expect(screen.getByLabelText('Choose photos')).toBeDisabled(); expect(screen.queryByRole('button', { name: 'Upload 1 photo' })).not.toBeInTheDocument();
  expect(reservePhoto).not.toHaveBeenCalled();
});
test('unavailable metadata is not presented as an empty photo collection', async () => {
  readPhotos.mockRejectedValue(photoError({ status: 404, code: 'NOT_FOUND' })); mount(); await screen.findByText(/Photo uploads are unavailable/);
  await waitFor(() => expect(screen.getByRole('button', { name: 'Refresh photos' })).toBeEnabled());
  expect(screen.queryByText(/No ready photos/)).not.toBeInTheDocument(); expect(screen.getByLabelText('Choose photos')).toBeDisabled();
});
test('requires HTTPS-capable browser crypto instead of falling back to weak upload IDs', async () => {
  securePhotoBrowser.mockReturnValue(false); mount(); await screen.findByText(/Use a current browser/);
  await waitFor(() => expect(screen.getByRole('button', { name: 'Refresh photos' })).toBeEnabled());
  expect(screen.getByLabelText('Choose photos')).toBeDisabled(); expect(uploadId).not.toHaveBeenCalled();
});
test('revokes object URLs on local removal, accepted close and unmount without deleting server data', async () => {
  const view = mount(); await loaded(); await choose(); await click(screen.getByRole('button', { name: 'Remove selection 1' }));
  expect(URL.revokeObjectURL).toHaveBeenCalledTimes(1); await choose(); await click(screen.getByRole('button', { name: 'Close photos' }));
  expect(await screen.findByAltText('Local preview of selected photo 1')).toBeInTheDocument();
  window.confirm.mockReturnValue(true); await click(screen.getByRole('button', { name: 'Close photos' }));
  expect(screen.queryByLabelText('Choose photos')).not.toBeInTheDocument(); expect(URL.revokeObjectURL).toHaveBeenCalledTimes(2);
  view.unmount(); expect(uploadPhoto).not.toHaveBeenCalled(); expect(reservePhoto).not.toHaveBeenCalled();
});
test('warns before navigation/reload and leaves an unrelated text draft guarded after photo completion', async () => {
  const { router } = mount(); await loaded(); await choose(); await click(screen.getByRole('link', { name: 'Leave page' }));
  await waitFor(() => expect(window.confirm).toHaveBeenCalled()); expect(router.state.location.pathname).toBe('/'); expect(unload()).toBe(true);
  fireEvent.change(screen.getByLabelText('Independent item text'), { target: { value: 'Keep the unsaved item text' } }); await begin(); await screen.findByAltText('Uploaded photo 1');
  expect(screen.getByLabelText('Independent item text')).toHaveValue('Keep the unsaved item text'); expect(unload()).toBe(true);
  await click(screen.getByRole('link', { name: 'Leave page' })); expect(router.state.location.pathname).toBe('/');
});
test('switching items releases previews and ignores stale metadata results', async () => {
  const old = metadata(); old.images = [readyImage()]; let finish;
  mount(); await loaded(); await choose(); readPhotos.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  await refreshPhotos();
  act(() => updateScene(value => ({ ...value, item: { ...item, id: 'e'.repeat(24), name: 'Other saved item' } })));
  await loaded(); await act(async () => finish(old)); expect(screen.queryByAltText('Uploaded photo 1')).not.toBeInTheDocument();
  expect(screen.queryByAltText('Local preview of selected photo 1')).not.toBeInTheDocument(); expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:synthetic-1');
});
test('a late reservation/session error from the old account cannot send its file or log out the new account', async () => {
  let reject; reservePhoto.mockImplementation(() => new Promise((resolve, failure) => { reject = failure; }));
  mount(); await loaded(); await choose(); await begin(); await waitFor(() => expect(reservePhoto).toHaveBeenCalledTimes(1));
  act(() => updateScene(value => ({ ...value, user: { id: 'owner-b', firstName: 'B' } })));
  await loaded(); await act(async () => reject(photoError({ status: 401, code: 'SESSION_EXPIRED' })));
  expect(screen.getByText('Actor B')).toBeInTheDocument(); expect(uploadPhoto).not.toHaveBeenCalled();
  expect(screen.queryByAltText('Local preview of selected photo 1')).not.toBeInTheDocument(); expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:synthetic-1');
});
test('session expiration clears private file state immediately without waiting for a draft confirmation', async () => {
  reservePhoto.mockRejectedValue(photoError({ status: 401, code: 'SESSION_EXPIRED' })); mount(); await loaded(); await choose(); await begin();
  expect(await screen.findByText('Actor anonymous')).toBeInTheDocument(); expect(screen.queryByAltText('Local preview of selected photo 1')).not.toBeInTheDocument();
  expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:synthetic-1'); expect(window.confirm).not.toHaveBeenCalled();
});
