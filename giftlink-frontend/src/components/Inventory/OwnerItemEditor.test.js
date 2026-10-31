jest.mock('../../context/AuthContext', () => ({ useAppContext: () => mockAuth }));
jest.mock('../../api/usePublicCatalog', () => ({ __esModule: true, default: () => ({ data: require('../../test-support/catalogs').taxonomy }) }));
import React from 'react';
import { render, screen, act, fireEvent, waitFor } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { UnsavedChangesProvider } from '../../forms/UnsavedChanges';
import Inventory from './Inventory';
let mockAuth; const planId = 'a'.repeat(24), itemId = 'b'.repeat(24);
let item, handler;
const reply = (status, data) => ({ status, ok: status >= 200 && status < 300, json: async () => data });
function mount(path = `/app/items/${itemId}/edit`) {
  const router = createMemoryRouter([{ path: '/app/items/:itemId/edit', element: <UnsavedChangesProvider><Inventory /></UnsavedChangesProvider> }], { initialEntries: [path], future: { v7_relativeSplatPath: true } });
  return render(<RouterProvider router={router} future={{ v7_startTransition: true }} />);
}
beforeEach(() => {
  mockAuth = { status: 'authenticated', user: { id: 'owner' } };
  item = { id: itemId, planId, name: 'Synthetic sofa', description: 'Good household sofa.', status: 'available', isPublic: true, version: 1,
    availableFrom: null, availableUntil: null, effectiveAvailableUntil: '2099-01-01', classification: { category: { id: 'living-room' }, itemType: { id: 'sofa' } } };
  jest.spyOn(window, 'confirm').mockReturnValue(true);
  handler = async (url, options) => {
    if (url.endsWith('/edit-context')) return reply(200, { itemId, planId });
    if (options.method === 'PATCH') { item = { ...item, ...JSON.parse(options.body), version: item.version + 1 }; return reply(200, { item }); }
    return reply(200, { plan: { id: planId, status: 'active', moveOutDeadline: '2099-01-01', city: 'Oakland', neighborhood: 'Local', pickupTimeZone: 'UTC' }, items: [item], progress: { total: 1, cleared: 0 }, photoCapabilities: { metadata: false, imageRead: false, binaryUpload: false } });
  };
  global.fetch = jest.fn((...args) => handler(...args));
});
afterEach(() => jest.restoreAllMocks());
test('direct owner editing uses the same authorized plan/item save and a single focused form', async () => {
  mount(); const input = await screen.findByRole('textbox', { name: 'Item name' }); expect(input).toHaveValue(item.name);
  await waitFor(() => expect(input).toHaveFocus()); expect(screen.queryByRole('button', { name: 'Add item', exact: true })).not.toBeInTheDocument();
  expect(document.querySelectorAll('.inventory-form')).toHaveLength(1); fireEvent.change(input, { target: { value: 'Updated sofa' } });
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Save Changes' })));
  expect(await screen.findByRole('heading', { name: 'Updated sofa', exact: true })).toBeVisible();
  const [url, request] = fetch.mock.calls.find(([, options]) => options.method === 'PATCH'); expect(url).toBe(`/api/move-out-plans/${planId}/items/${itemId}`);
  expect(JSON.parse(request.body)).toMatchObject({ version: 1, name: 'Updated sofa', publish: false });
});
test.each([401, 403, 404])('denied edit context %s reveals no form or private metadata', async status => {
  handler = async () => reply(status, { error: { message: 'This item is unavailable.' } }); mount();
  expect(await screen.findByText('This item is unavailable.')).toBeVisible(); expect(screen.queryByLabelText('Item name')).not.toBeInTheDocument();
  expect(fetch).toHaveBeenCalledTimes(1);
});
test('stale edits retain the draft and focus an actionable failure without repeating PATCH', async () => {
  const original = handler; handler = (url, options) => options.method === 'PATCH' ? reply(409, { error: { code: 'ITEM_CHANGED', message: 'Item changed. Reload inventory.' } }) : original(url, options);
  mount(); fireEvent.change(await screen.findByLabelText('Item name'), { target: { value: 'Keep this edit' } });
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Save Changes' })));
  expect(await screen.findByRole('alert')).toHaveTextContent('Item changed'); expect(screen.getByLabelText('Item name')).toHaveValue('Keep this edit');
  expect(fetch.mock.calls.filter(([, options]) => options.method === 'PATCH')).toHaveLength(1);
});
