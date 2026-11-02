// UX-2C1: one explicit Save Draft authorizes a bounded upload of the staged,
// browser-prepared photos to the saved independent item, never before.
jest.mock('../../api/photoPreparation', () => ({ ...jest.requireActual('../../api/photoPreparation'), preparePhoto: jest.fn(async file => file) }));
jest.mock('../../context/AuthContext', () => {
  const React = require('react'); const Context = React.createContext();
  return { TestAuthContext: Context, useAppContext: () => React.useContext(Context) };
});
jest.mock('../../api/usePublicCatalog', () => ({ __esModule: true, default: path => ({ data: require('../../test-support/catalogs')[path === '/api/regions' ? 'regions' : 'taxonomy'] }) }));
jest.mock('../../api/ownerListings', () => ({ createOwnerListing: jest.fn(), updateOwnerListing: jest.fn() }));
jest.mock('../../api/itemImages', () => ({ ...jest.requireActual('../../api/itemImages'), readPhotos: jest.fn(), readUpload: jest.fn(),
  deletePhoto: jest.fn(), reservePhoto: jest.fn(), uploadPhoto: jest.fn(), fileDigest: jest.fn(), uploadId: jest.fn(), securePhotoBrowser: () => true }));
import React, { useState } from 'react';
import { act, fireEvent, render, screen, waitFor, createEvent } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { TestAuthContext } from '../../context/AuthContext';
import { UnsavedChangesProvider } from '../../forms/UnsavedChanges';
import { createOwnerListing, updateOwnerListing } from '../../api/ownerListings';
import { fileDigest, readPhotos, readUpload, reservePhoto, uploadId, uploadPhoto, photoError } from '../../api/itemImages';
import ListingForm from './ListingForm';
import { preparePhoto } from '../../api/photoPreparation';
const capabilities = { metadata: true, binaryUpload: true, imageRead: true };
const saved = { id: 'd'.repeat(24), name: 'Lamp', status: 'draft', version: 1, classification: {}, capabilities: { photos: true },
  location: { stateId: '06', metroId: '31080', city: '', neighborhood: '' }, pickup: { timeZone: 'America/Los_Angeles', timeZoneConfirmed: true, availableUntil: '2099-01-01' } };
let media, sequence, operations, setActor;
function Scene({ item, caps, publicationEnabled }) {
  const [user, update] = useState({ id: 'owner-a' }); setActor = update;
  return <TestAuthContext.Provider value={{ user, status: user ? 'authenticated' : 'anonymous' }}><UnsavedChangesProvider>
    {user && <ListingForm key={user.id} item={item} photoCapabilities={caps} publicationEnabled={publicationEnabled} />}</UnsavedChangesProvider></TestAuthContext.Provider>;
}
function mount(item, caps = capabilities, publicationEnabled = false) {
  const router = createMemoryRouter([{ path: '/app/listings/new', element: <Scene item={item} caps={caps} publicationEnabled={publicationEnabled} /> }, { path: '/app/listings/:id', element: <h1>Saved detail</h1> }],
    { initialEntries: ['/app/listings/new'], future: { v7_relativeSplatPath: true } });
  render(<RouterProvider router={router} future={{ v7_startTransition: true }} />); return router;
}
const select = async (count = 1) => act(async () => { fireEvent.change(screen.getByLabelText('Choose photos'), { target: { files: Array.from({ length: count }, () => new File(['local'], 'private.png', { type: 'image/png' })) } }); });
const fillDeadline = () => {
  fireEvent.change(screen.getByLabelText('Pickup deadline'), { target: { value: '2099-01-01' } });
  fireEvent.change(screen.getByLabelText('Pickup timezone'), { target: { value: 'America/Los_Angeles' } });
  fireEvent.click(screen.getByLabelText('Confirm this pickup timezone'));
};
const button = name => screen.getAllByRole('button', { name, exact: true })[0];
beforeEach(() => {
  jest.clearAllMocks(); preparePhoto.mockImplementation(async file => file); media = { imageRevision: 0, images: [], uploads: [], capabilities, allowance: { itemSlots: 5, newUploadsAllowed: true },
    limits: { photos: 5 } }; sequence = 0; operations = 0;
  URL.createObjectURL = jest.fn(() => 'blob:local-' + sequence); URL.revokeObjectURL = jest.fn();
  uploadId.mockImplementation(() => '00000000-0000-4000-8000-' + String(++sequence).padStart(12, '0')); fileDigest.mockResolvedValue('f'.repeat(64));
  createOwnerListing.mockResolvedValue({ item: saved }); updateOwnerListing.mockResolvedValue({ item: { ...saved, version: 2 } });
  readPhotos.mockImplementation(async () => media);
  reservePhoto.mockImplementation(async () => ({ imageRevision: media.imageRevision, upload: { id: String(++operations).padStart(24, 'c'), state: 'reserved', cleanupPending: false, reservationExpired: false, createdAt: '2026-11-01T00:00:00Z' } }));
  uploadPhoto.mockImplementation(async (planId, itemId, imageId) => {
    const image = { id: imageId, state: 'ready', sortPosition: media.images.length, createdAt: '2026-11-01T00:00:00Z', cleanupPending: false, reservationExpired: false,
      thumbnail: { width: 400, height: 300, contentType: 'image/webp' }, display: { width: 800, height: 600, contentType: 'image/webp' } };
    media = { ...media, images: media.images.concat(image), imageRevision: media.imageRevision + 1 }; return { imageRevision: media.imageRevision, upload: image };
  });
});

test('one Save Draft with photos creates once, then uploads each prepared photo to the independent item route', async () => {
  const router = mount(); fireEvent.change(screen.getByLabelText('Item name'), { target: { value: 'Lamp' } }); fillDeadline();
  await select(2); await screen.findByAltText('Local preview of selected photo 2');
  expect(reservePhoto).not.toHaveBeenCalled();
  await act(async () => { fireEvent.click(button('Save draft with 2 photos')); });
  await waitFor(() => expect(router.state.location.pathname).toBe('/app/listings/' + saved.id));
  expect(createOwnerListing).toHaveBeenCalledTimes(1); expect(reservePhoto).toHaveBeenCalledTimes(2); expect(uploadPhoto).toHaveBeenCalledTimes(2);
  // planId null selects /api/items/:itemId/images; never a plan route.
  expect(reservePhoto.mock.calls.every(call => call[0] === null && call[1] === saved.id)).toBe(true);
  expect(uploadPhoto.mock.calls.every(call => call[0] === null && call[1] === saved.id)).toBe(true);
});

test('photos require a confirmed timezone and deadline before any save or upload', async () => {
  mount(); fireEvent.change(screen.getByLabelText('Item name'), { target: { value: 'Lamp' } });
  await select(1); await screen.findByAltText('Local preview of selected photo 1');
  await act(async () => { fireEvent.click(button('Save draft with 1 photo')); });
  expect(await screen.findAllByText('Add a pickup deadline to save photos.')).not.toHaveLength(0);
  expect(screen.getAllByText('Confirm the pickup timezone to save photos.')).not.toHaveLength(0);
  expect(createOwnerListing).not.toHaveBeenCalled(); expect(reservePhoto).not.toHaveBeenCalled();
  expect(screen.getByAltText('Local preview of selected photo 1')).toBeVisible();
});

test('a lost upload response keeps the saved draft locked, recovers by status read without replay, then uploads the rest', async () => {
  const committed = uploadPhoto.getMockImplementation();
  uploadPhoto.mockImplementationOnce(async (...args) => { await committed(...args); throw photoError({ status: 503 }, true); });
  readUpload.mockImplementation(async (planId, itemId, imageId) => ({ imageRevision: media.imageRevision, upload: media.images.find(image => image.id === imageId) }));
  const router = mount(); fireEvent.change(screen.getByLabelText('Item name'), { target: { value: 'Lamp' } }); fillDeadline();
  await select(2); await screen.findByAltText('Local preview of selected photo 2');
  await act(async () => { fireEvent.click(button('Save draft with 2 photos')); });
  expect(await screen.findByText('Draft saved. Some photos still need attention.')).toBeVisible();
  expect(router.state.location.pathname).toBe('/app/listings/new'); expect(createOwnerListing).toHaveBeenCalledTimes(1);
  expect(screen.getByLabelText('Item name')).not.toBeVisible(); expect(uploadPhoto).toHaveBeenCalledTimes(1);
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Check upload 1 status', exact: true })); });
  expect(readUpload).toHaveBeenCalledWith(null, saved.id, expect.any(String), expect.any(String)); expect(uploadPhoto).toHaveBeenCalledTimes(1);
  await waitFor(() => expect(screen.getByRole('button', { name: 'Upload remaining 1 photo', exact: true })).toBeEnabled());
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Upload remaining 1 photo', exact: true })); });
  await waitFor(() => expect(router.state.location.pathname).toBe('/app/listings/' + saved.id));
  expect(createOwnerListing).toHaveBeenCalledTimes(1); expect(uploadPhoto).toHaveBeenCalledTimes(2); expect(reservePhoto).toHaveBeenCalledTimes(2);
});

test('editing an existing draft saves text first and uploads only after the versioned PATCH', async () => {
  mount(saved); await screen.findByText('0 / 5');
  await select(1); await screen.findByAltText('Local preview of selected photo 1');
  await act(async () => { fireEvent.click(button('Save draft with 1 photo')); });
  await waitFor(() => expect(uploadPhoto).toHaveBeenCalledTimes(1));
  expect(updateOwnerListing).toHaveBeenCalledWith(saved.id, expect.objectContaining({ version: 1 }));
  expect(updateOwnerListing.mock.invocationCallOrder[0]).toBeLessThan(reservePhoto.mock.invocationCallOrder[0]);
});

test('without the server photo capability no photo controls appear and Save Draft is unchanged', async () => {
  mount(undefined, { metadata: false, binaryUpload: false, imageRead: false });
  expect(screen.queryByLabelText('Choose photos')).not.toBeInTheDocument();
  expect(screen.getAllByRole('button', { name: 'Save Draft', exact: true })).toHaveLength(2);
  expect(screen.getByText('Private drafts need only an item name. Publishing and photos are not available yet.')).toBeVisible();
});

test('an account switch discards staged previews and late uploads cannot navigate the next account', async () => {
  let finish; uploadPhoto.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const router = mount(); fireEvent.change(screen.getByLabelText('Item name'), { target: { value: 'Lamp' } }); fillDeadline();
  await select(1); await screen.findByAltText('Local preview of selected photo 1');
  await act(async () => { fireEvent.click(button('Save draft with 1 photo')); });
  await waitFor(() => expect(uploadPhoto).toHaveBeenCalledTimes(1));
  await act(async () => { setActor({ id: 'owner-b' }); });
  expect(screen.queryByAltText('Local preview of selected photo 1')).not.toBeInTheDocument();
  expect(URL.revokeObjectURL).toHaveBeenCalled();
  await act(async () => finish({ imageRevision: 1, upload: { id: 'c'.repeat(24), state: 'ready', sortPosition: 0, createdAt: '2026-11-01T00:00:00Z', cleanupPending: false, reservationExpired: false,
    thumbnail: { width: 400, height: 300, contentType: 'image/webp' }, display: { width: 800, height: 600, contentType: 'image/webp' } } }));
  expect(router.state.location.pathname).toBe('/app/listings/new');
  expect(screen.getByLabelText('Item name')).toHaveValue('');
});


const preparePublicForm = () => {
  fireEvent.change(screen.getByLabelText('Item name'), { target: { value: 'Shelf' } });
  fireEvent.change(screen.getByLabelText('Description'), { target: { value: 'Clean synthetic shelf' } });
  fireEvent.change(screen.getByRole('combobox', { name:'Item type',exact:true }), { target: { value: 'Sofa' } });
  fireEvent.click(screen.getByRole('option', { name:'Sofa Living Room',exact:true }));
  fireEvent.change(screen.getByLabelText('State'), { target: { value:'06' } });
  fireEvent.change(screen.getByLabelText('Metro area'), { target: { value:'31080' } }); fillDeadline();
};
const publishSelected = () => {
  const event = createEvent.submit(screen.getByRole('form')); Object.defineProperty(event, 'submitter', { value:button('Publish with 2 photos') }); fireEvent(screen.getByRole('form'), event);
};
test('one Publish with photos commits the item first, uploads sequentially and asks no per-photo confirmation', async () => {
  const confirm = jest.spyOn(window,'confirm').mockReturnValue(true);
  try {
    createOwnerListing.mockResolvedValue({ item:{...saved,status:'available'} }); const router = mount(undefined,capabilities,true); preparePublicForm();
    await select(2); await screen.findByAltText('Local preview of selected photo 2'); expect(uploadPhoto).not.toHaveBeenCalled();
    await act(async () => publishSelected()); await waitFor(()=>expect(router.state.location.pathname).toBe('/app/listings/'+saved.id));
    expect(createOwnerListing).toHaveBeenCalledTimes(1); expect(createOwnerListing.mock.calls[0][0].publish).toBe(true);
    expect(createOwnerListing.mock.invocationCallOrder[0]).toBeLessThan(reservePhoto.mock.invocationCallOrder[0]);
    expect(uploadPhoto).toHaveBeenCalledTimes(2); expect(confirm).not.toHaveBeenCalled();
  } finally { confirm.mockRestore(); }
});
test('publication remains successful after an ambiguous photo write, with retained files and status-only recovery', async () => {
  createOwnerListing.mockResolvedValue({ item:{...saved,status:'available'} });
  uploadPhoto.mockRejectedValueOnce(photoError({status:503},true));
  const router = mount(undefined,capabilities,true); preparePublicForm(); await select(2); await screen.findByAltText('Local preview of selected photo 2');
  await act(async () => publishSelected()); expect(await screen.findByText('Listing published. Some photos still need attention.')).toBeVisible();
  expect(screen.getByAltText('Local preview of selected photo 2')).toBeVisible(); expect(screen.getByRole('button',{name:'Check upload 1 status',exact:true})).toBeVisible();
  expect(createOwnerListing).toHaveBeenCalledTimes(1); expect(uploadPhoto).toHaveBeenCalledTimes(1); expect(router.state.location.pathname).toBe('/app/listings/new');
});
