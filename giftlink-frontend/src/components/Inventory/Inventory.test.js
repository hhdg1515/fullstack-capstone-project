import { selectItemType } from '../../test-support/selectItemType';
jest.mock('../../api/usePublicCatalog', () => ({ __esModule: true, default: path => ({ data: require('../../test-support/catalogs')[path === '/api/regions' ? 'regions' : 'taxonomy'] }) }));
import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { AuthProvider } from '../../context/AuthContext';
import RequireAuth from '../RequireAuth';
import LoginPage from '../LoginPage/LoginPage';
import Inventory from './Inventory';
import PublicItems from './PublicItems';
import { availabilityError } from './ItemForm';

const user = { id: 'owner', firstName: 'Giver', lastName: 'Neighbor', email: 'private@example.test' };
const date = offset => new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10);
const plan = { id: '64a000000000000000000001', city: 'Oakland', neighborhood: 'Temescal', status: 'active', moveOutDeadline: date(20) };
const item = { id: '64a000000000000000000002', planId: plan.id, name: 'Box of kitchen supplies', description: '', category: '',
  status: 'draft', availableFrom: null, availableUntil: null, effectiveAvailableUntil: plan.moveOutDeadline, version: 1, publishedAt: null, isPublic: false };
const inventory = items => ({ plan, items, progress: { total: items.length, cleared: items.filter(value => value.status === 'cleared').length } });
const reply = (status, data) => ({ status, ok: status >= 200 && status < 300, json: async () => data });
const root = `/api/move-out-plans/${plan.id}/items`;
let data;
let handler;
function mount(path = `/app/plans/${plan.id}/items`) {
  return render(<MemoryRouter initialEntries={[path]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}><AuthProvider><Routes>
    <Route path="/app/plans/:planId/items" element={<RequireAuth><Inventory /></RequireAuth>} />
    <Route path="/app/items" element={<PublicItems />} /><Route path="/app/items/:itemId" element={<PublicItems />} />
    <Route path="/app/login" element={<LoginPage />} />
  </Routes></AuthProvider></MemoryRouter>);
}
beforeEach(() => {
  data = inventory([]); handler = async () => reply(500, { error: { message: 'Unexpected operation' } });
  global.fetch = jest.fn(async (url, options) => {
    if (url.endsWith('/api/me')) return reply(200, { user });
    if (url === root && options.method === 'GET') return reply(200, data);
    return handler(url, options);
  });
  jest.spyOn(window, 'confirm').mockReturnValue(true);
});
afterEach(async () => { await act(async () => {}); jest.restoreAllMocks(); });
const formReady = async () => {
  await waitFor(() => expect(screen.getByRole('button', { name: 'Add item' })).toBeEnabled());
  if (!screen.queryByLabelText('Item name')) await click(screen.getByRole('button', { name: 'Add item' }));
  return screen.findByLabelText('Item name');
};
const click = async target => act(async () => { fireEvent.click(target); });
const name = value => fireEvent.change(screen.getByLabelText('Item name'), { target: { value } });
const submitDraft = async () => act(async () => { fireEvent.submit(screen.getByRole('button', { name: 'Save Draft' }).closest('form')); });

test('inventory loads an empty plan with inherited location/deadline and a name-only quick entry', async () => {
  mount(); await formReady();
  expect(screen.getByText(/No items yet/)).toBeInTheDocument();
  expect(screen.getByText('0 of 0 items cleared')).toBeInTheDocument();
  expect(screen.getByText(/Temescal, Oakland/)).toBeInTheDocument();
  expect(screen.getByLabelText('Item type')).not.toBeRequired();
  expect(screen.queryByLabelText('City')).not.toBeInTheDocument();
  expect(screen.queryByLabelText(/price|address|dimensions|brand/i)).not.toBeInTheDocument();
});
test('populated plans open Add explicitly and warn before discarding a new draft', async () => {
  data = inventory([item]); mount(); await screen.findByRole('heading', { name: item.name });
  expect(screen.queryByLabelText('Item name')).not.toBeInTheDocument();
  await formReady(); name('Unfinished new item'); window.confirm.mockReturnValue(false);
  await click(screen.getByRole('button', { name: 'Cancel', exact: true }));
  expect(screen.getByLabelText('Item name')).toHaveValue('Unfinished new item');
  window.confirm.mockReturnValue(true); await click(screen.getByRole('button', { name: 'Cancel', exact: true }));
  expect(screen.queryByLabelText('Item name')).not.toBeInTheDocument();
  await formReady(); expect(screen.getByLabelText('Item name')).toHaveValue('');
});
test.each([null, 'UTC', undefined, 'Not/A_Zone'])('pickup setup uses the server value %s without treating absent metadata as configured', async zone => {
  data = { ...inventory([]), plan: { ...plan, pickupTimeZone: zone } }; mount(); await formReady();
  if (zone === null) {
    expect(screen.getByRole('link', { name: 'Set pickup timezone' })).toHaveAttribute('href', `/app/plans/${plan.id}/edit`);
    expect(screen.getByText(/still save drafts and publish/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Publish' })).toBeEnabled();
  } else if (zone === undefined || zone === 'Not/A_Zone') expect(screen.getByRole('link', { name: 'Check pickup setup' })).toBeInTheDocument();
  else expect(screen.queryByRole('link', { name: /pickup (timezone|setup)/ })).not.toBeInTheDocument();
});
test('saved items close creation; another blank form opens only after Add item', async () => {
  const created = [];
  handler = async (url, options) => {
    const body = JSON.parse(options.body); created.push(body);
    const value = { ...item, id: String(created.length).padStart(24, '0'), name: body.name };
    data = inventory([...data.items, value]); return reply(201, { item: value });
  };
  mount(); await formReady();
  name('Box of kitchen supplies'); await submitDraft();
  await waitFor(() => expect(screen.getByText('0 of 1 items cleared')).toBeInTheDocument());
  expect(screen.queryByLabelText('Item name')).not.toBeInTheDocument(); await formReady();
  expect(screen.getByLabelText('Item name')).toHaveValue(''); expect(screen.getByLabelText('Item name')).toHaveFocus();
  name('Three identical chairs'); await submitDraft();
  await waitFor(() => expect(screen.getByText('0 of 2 items cleared')).toBeInTheDocument());
  expect(created.map(value => value.name)).toEqual(['Box of kitchen supplies', 'Three identical chairs']);
  expect(created.every(value => !('city' in value) && !('planId' in value) && value.publish === false)).toBe(true);
});
test('publish entry sends explicit publication intent and does not confuse it with pickup dates', async () => {
  handler = async (url, options) => {
    const body = JSON.parse(options.body);
    expect(body.publish).toBe(true); expect(body.availableFrom).toBe(date(5));
    const published = { ...item, status: 'available', isPublic: true, availableFrom: date(5), publishedAt: new Date().toISOString() };
    data = inventory([published]); return reply(201, { item: published });
  };
  mount(); await formReady(); name(item.name);
  fireEvent.change(screen.getByLabelText('Available from (optional)'), { target: { value: date(5) } });
  selectItemType('sofa');
  fireEvent.change(screen.getByLabelText('Description'), { target: { value: 'A comfortable sofa.' } });
  await click(screen.getByRole('button', { name: 'Publish' }));
  expect(await screen.findByText('Item published.')).toBeInTheDocument();
  expect(await screen.findByRole('link', { name: 'Public listing' })).toBeInTheDocument();
});
test('client rejects invalid availability ranges and empty names without sending writes', async () => {
  mount(); await formReady(); await submitDraft();
  expect(await screen.findByRole('alert')).toHaveTextContent('Check the highlighted fields');
  expect(screen.getByText('Give this item or group a name of 1–160 characters.')).toBeInTheDocument();
  expect(screen.getByLabelText('Item name')).toHaveFocus();
  name('Chairs');
  fireEvent.change(screen.getByLabelText('Available from (optional)'), { target: { value: date(21) } });
  await submitDraft(); expect(screen.getByLabelText('Available from (optional)')).toHaveFocus();
  expect(screen.getByText('Choose a start date on or before the end date.')).toBeInTheDocument();
  expect(screen.getByLabelText('Available from (optional)')).toHaveAccessibleDescription('Choose a start date on or before the end date.');
  expect(fetch.mock.calls.some(([, options]) => options.method !== 'GET')).toBe(false);
});
test.each(['available', 'expired'])('reservation metadata stays distinct from %s publication state and clearance progress', async status => {
  data = inventory([{ ...item, status, isReserved: true }]); mount(); await formReady();
  expect(screen.getByText(/Pickup arranged/)).toBeInTheDocument();
  expect(screen.getByText('0 of 1 items cleared')).toBeInTheDocument();
  expect(screen.getAllByText(status === 'available' ? 'Reserved' : 'Expired').length).toBeGreaterThan(0);
});
test('all five item states, availability and real clearance progress remain distinguishable', async () => {
  data = inventory(['draft', 'available', 'unlisted', 'cleared', 'expired'].map((status, index) => ({ ...item, id: String(index), name: `${status} item`, status, isPublic: status === 'available' })));
  mount(); await formReady();
  expect(screen.getByText('1 of 5 items cleared')).toBeInTheDocument();
  for (const label of ['Draft', 'Posted', 'Hidden', 'Cleared', 'Expired']) expect(screen.getAllByText(label).length).toBeGreaterThan(0);
  fireEvent.change(screen.getByLabelText('Show items'), { target: { value: 'Hidden' } });
  expect(screen.getByRole('heading', { name: 'unlisted item' })).toBeInTheDocument();
  expect(screen.queryByRole('heading', { name: 'cleared item' })).not.toBeInTheDocument();
});
test.each([['available', 'Hide', 'unlist', 'unlisted'], ['unlisted', 'Publish', 'publish', 'available'],
  ['unlisted', 'Mark', 'clear', 'cleared'], ['cleared', 'Reopen', 'reopen', 'draft']])('%s owner action confirms intent and uses the current item version', async (initial, label, action, next) => {
  data = inventory([{ ...item, status: initial, version: 7, description: 'A household item.', classification: { category: { id: 'other-household' }, itemType: { id: 'other' } } }]);
  handler = async (url, options) => {
    expect(url).toBe(`${root}/${item.id}/actions`); expect(JSON.parse(options.body)).toEqual({ action, version: 7 });
    const updated = { ...item, status: next, version: 8 }; data = inventory([updated]); return reply(200, { item: updated });
  };
  mount(); await formReady();
  const accessibleName = action === 'clear' ? `Mark ${item.name} cleared` : action === 'reopen' ? `Reopen ${item.name} as draft` : `${label} ${item.name}`;
  if (['clear', 'reopen'].includes(action)) screen.getByText('More actions').closest('details').open = true;
  const button = screen.getByRole('button', { name: accessibleName });
  await click(button);
  await waitFor(() => expect(data.items[0].version).toBe(8));
  await waitFor(() => expect(screen.getByText(next === 'cleared' ? '1 of 1 items cleared' : '0 of 1 items cleared')).toBeInTheDocument());
  expect(window.confirm).toHaveBeenCalled();
});
test('cancelling a consequential action leaves the inventory unchanged', async () => {
  window.confirm.mockReturnValue(false); data = inventory([{ ...item, status: 'available' }]);
  mount(); await formReady(); await click(screen.getByRole('button', { name: `Hide ${item.name}` }));
  expect(fetch.mock.calls.some(([, options]) => options.method === 'POST')).toBe(false);
});
test('reopening with a past pickup end is rejected before sending an action or confirming publication', async () => {
  data = inventory([{ ...item, status: 'cleared', availableUntil: date(-1), effectiveAvailableUntil: date(-1) }]);
  mount(); await formReady(); screen.getByText('More actions').closest('details').open = true;
  await click(screen.getByRole('button', { name: `Reopen ${item.name} as draft` }));
  expect(await screen.findByRole('alert')).toHaveTextContent('today or later');
  expect(window.confirm).not.toHaveBeenCalled();
  expect(fetch.mock.calls.some(([, options]) => options.method === 'POST')).toBe(false);
});
test('editing and clearing date overrides uses PATCH and preserves the plan association', async () => {
  data = inventory([{ ...item, availableFrom: date(5), availableUntil: date(10) }]);
  handler = async (url, options) => {
    expect(url).toBe(`${root}/${item.id}`); expect(options.method).toBe('PATCH');
    const body = JSON.parse(options.body); expect(body.version).toBe(1); expect(body.availableFrom).toBeNull(); expect(body.availableUntil).toBeNull();
    expect(body.planId).toBeUndefined(); expect(body.ownerId).toBeUndefined();
    const updated = { ...item, name: body.name, version: 2 }; data = inventory([updated]); return reply(200, { item: updated });
  };
  mount(`${root.replace('/api/move-out-plans', '/app/plans')}?edit=${item.id}`); await screen.findByRole('button', { name: 'Save Draft' });
  name('Two boxes');
  fireEvent.change(screen.getByLabelText('Available from (optional)'), { target: { value: '' } });
  fireEvent.change(screen.getByLabelText('Available until (optional)'), { target: { value: '' } });
  await submitDraft();
  expect(await screen.findByRole('heading', { name: 'Two boxes' })).toBeInTheDocument();
});
test('stale actions show an error and let the owner reload authoritative state', async () => {
  data = inventory([{ ...item, status: 'available' }]);
  handler = async () => { data = inventory([{ ...item, status: 'cleared', version: 2 }]); return reply(409, { error: { message: 'This item changed. Reload the inventory.' } }); };
  mount(); await formReady(); await click(screen.getByRole('button', { name: `Hide ${item.name}` }));
  expect(await screen.findByRole('alert')).toHaveTextContent('This item changed');
  await click(screen.getByRole('button', { name: 'Reload inventory' }));
  expect(await screen.findByText('1 of 1 items cleared')).toBeInTheDocument();
});
test('refreshing an outdated edit replaces its values before adopting the new version', async () => {
  data = inventory([item]);
  mount(`/app/plans/${plan.id}/items?edit=${item.id}`); await screen.findByRole('button', { name: 'Save Draft' });
  name('Outdated unsaved draft');
  data = inventory([{ ...item, name: 'Changed in another tab', version: 2 }]);
  await click(screen.getByRole('button', { name: 'Refresh inventory' }));
  await waitFor(() => expect(screen.getByLabelText('Item name')).toHaveValue('Changed in another tab'));
  expect(screen.getByRole('heading', { name: 'Edit Changed in another tab' })).toBeInTheDocument();
  expect(window.confirm).toHaveBeenCalled();
});
test('saving an item disables competing inventory actions until the write finishes', async () => {
  data = inventory([item]);
  let finish;
  handler = () => new Promise(resolve => { finish = resolve; });
  mount(); await formReady(); name('Another item'); await submitDraft();
  expect(screen.getByRole('button', { name: `Edit ${item.name}` })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Refresh inventory' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Saving…' })).toBeDisabled();
  await act(async () => { data = inventory([item, { ...item, id: '64a000000000000000000003', name: 'Another item' }]); finish(reply(201, { item: data.items[1] })); });
  expect(await screen.findByText('0 of 2 items cleared')).toBeInTheDocument();
});
test('failed saves retain drafts and expired sessions remove the private form', async () => {
  handler = async () => reply(400, { error: { message: 'Check item details' } });
  mount(); await formReady(); name('Unsaved belongings'); await submitDraft();
  expect(await screen.findByRole('alert')).toHaveTextContent('Check item details');
  expect(screen.getByLabelText('Item name')).toHaveValue('Unsaved belongings');
  handler = async () => reply(401, { error: { code: 'SESSION_EXPIRED', message: 'Please log in again' } });
  await submitDraft(); expect(await screen.findByRole('heading', { name: 'Login' })).toBeInTheDocument();
  expect(screen.queryByLabelText('Item name')).not.toBeInTheDocument();
});
test('public discovery searches published listings without requiring sign-in or displaying private owner data', async () => {
  const visible = { ...item, status: 'available', availability: 'now', stateId: '06', metroId: '41860', isOwner: false, isReserved: false, pickupTimeZone: 'UTC', city: plan.city, neighborhood: plan.neighborhood };
  handler = async url => reply(200, url.includes('/api/items/locations') ? { locations: [{ city: plan.city, neighborhoods: [plan.neighborhood] }] } : url.includes(item.id) ? { item: visible } : { items: [visible], total: 1, page: { hasMore: false, nextCursor: null } });
  mount('/app/items?stateId=06&metroId=41860');
  expect(await screen.findByRole('link', { name: item.name })).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('Neighborhood'), { target: { value: 'Temescal' } });
  await click(screen.getByRole('button', { name: 'Find free items' }));
  await waitFor(() => expect(fetch.mock.calls.some(([url]) => url.includes('neighborhood=Temescal'))).toBe(true));
  await click(await screen.findByRole('link', { name: item.name }));
  expect(await screen.findByRole('heading', { name: item.name })).toBeInTheDocument();
  expect(screen.queryByText(user.email)).not.toBeInTheDocument();
});
test('a withdrawn public detail disappears on refresh instead of retaining its old data', async () => {
  let visible = true;
  handler = async () => visible ? reply(200, { item }) : reply(404, { error: { message: 'Listing unavailable' } });
  mount(`/app/items/${item.id}`); await screen.findByRole('heading', { name: item.name });
  visible = false; await click(screen.getByRole('button', { name: 'Refresh listings' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('This listing is no longer available');
  expect(screen.queryByRole('heading', { name: item.name })).not.toBeInTheDocument();
});
test('date validation keeps calendar boundaries and does not treat publication time as pickup availability', () => {
  expect(availabilityError({ availableFrom: date(5), availableUntil: date(10) }, plan, true)).toBe('');
  expect(availabilityError({ availableFrom: '', availableUntil: date(-1) }, plan, true)).toMatch(/today or later/);
  expect(availabilityError({ availableFrom: '', availableUntil: date(-1) }, plan, false)).toBe('');
  expect(availabilityError({ availableFrom: '2027-02-29', availableUntil: '' }, plan)).toMatch(/real calendar/);
});

test('server validation focuses the affected control after the failed save', async () => {
  handler = async () => reply(400, { error: { message: 'Check item details', fields: [{ field: 'condition', message: 'Choose a listed condition.' }] } });
  mount(); await formReady(); name('Desk'); await submitDraft();
  await waitFor(() => expect(screen.getByLabelText('Condition (optional)')).toHaveFocus());
  expect(screen.getByLabelText('Condition (optional)')).toBeVisible();
  expect(screen.getByLabelText('Condition (optional)')).toHaveAccessibleDescription('Choose a listed condition.');
  expect(screen.getByLabelText('Item name')).toHaveValue('Desk');
  expect(screen.getByRole('alert')).not.toHaveTextContent('condition:');
});

test('only verified handoffs are Picked Up, while manual and unknown clearance remain Cleared', async () => {
  data = inventory([{ ...item, id: 'done', name: 'Confirmed handoff', status: 'cleared', isPickedUp: true },
    { ...item, id: 'manual', name: 'Manual clearance', status: 'cleared', isPickedUp: false }]);
  mount(); await screen.findByRole('heading', { name: 'Confirmed handoff' });
  expect(screen.getByText('Handoff confirmed in the pickup request.')).toBeInTheDocument();
  expect(screen.getByText('2 of 2 items cleared')).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('Show items'), { target: { value: 'Picked Up' } });
  expect(screen.queryByRole('heading', { name: 'Manual clearance' })).not.toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('Show items'), { target: { value: 'Cleared' } });
  expect(screen.getByRole('heading', { name: 'Manual clearance' })).toBeInTheDocument();
  expect(screen.queryByRole('heading', { name: 'Confirmed handoff' })).not.toBeInTheDocument();
});
test('an incomplete draft opens its existing editor instead of posting an invalid publish action', async () => {
  data = inventory([item]); mount(); await screen.findByRole('heading', { name: item.name });
  await click(screen.getByRole('button', { name: 'Edit ' + item.name }));
  expect(screen.getByLabelText('Item name')).toBeVisible(); expect(screen.getByLabelText('Item name')).toHaveValue(item.name);
  expect(fetch.mock.calls.some(([, options]) => options.method !== 'GET')).toBe(false);
});
