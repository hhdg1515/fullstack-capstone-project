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
afterEach(() => jest.restoreAllMocks());
const formReady = async () => {
  const input = await screen.findByLabelText('Item name');
  if (input.closest('[hidden]')) fireEvent.click(screen.getByRole('button', { name: 'Add item' }));
  return input;
};
const name = value => fireEvent.change(screen.getByLabelText('Item name'), { target: { value } });
const submitDraft = () => fireEvent.submit(screen.getByRole('button', { name: 'Save draft & add another' }).closest('form'));

test('inventory loads an empty plan with inherited location/deadline and a name-only quick entry', async () => {
  mount(); await formReady();
  expect(screen.getByText(/No items yet/)).toBeInTheDocument();
  expect(screen.getByText('0 of 0 items cleared')).toBeInTheDocument();
  expect(screen.getByText(/Temescal, Oakland/)).toBeInTheDocument();
  expect(screen.getByLabelText('Category or tag (optional)')).not.toBeRequired();
  expect(screen.queryByLabelText('City')).not.toBeInTheDocument();
  expect(screen.queryByLabelText(/price|address|dimensions|brand/i)).not.toBeInTheDocument();
});
test('populated plans put existing items first and preserve a temporarily collapsed add draft', async () => {
  data = inventory([item]); mount(); await screen.findByRole('heading', { name: item.name });
  expect(screen.getByLabelText('Item name')).not.toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Add item' }));
  expect(screen.getByLabelText('Item name')).toBeVisible(); expect(screen.getByLabelText('Item name')).toHaveFocus();
  name('Unfinished new item'); fireEvent.click(screen.getByRole('button', { name: 'Back to items' }));
  expect(screen.getByLabelText('Item name')).not.toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Add item' }));
  expect(screen.getByLabelText('Item name')).toHaveValue('Unfinished new item');
  const section = screen.getByRole('region', { name: 'Inventory items' });
  expect(section.compareDocumentPosition(screen.getByLabelText('Item name')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
});
test.each([null, 'UTC', undefined])('pickup setup uses the server value %s without treating absent metadata as configured', async zone => {
  data = { ...inventory([]), plan: { ...plan, pickupTimeZone: zone } }; mount(); await formReady();
  if (zone === null) {
    expect(screen.getByRole('link', { name: 'Set pickup timezone' })).toHaveAttribute('href', `/app/plans/${plan.id}/edit`);
    expect(screen.getByText(/still save drafts and publish/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Publish & add another' })).toBeEnabled();
  } else if (zone === undefined) expect(screen.getByRole('link', { name: 'Check pickup setup' })).toBeInTheDocument();
  else expect(screen.queryByRole('link', { name: /pickup (timezone|setup)/ })).not.toBeInTheDocument();
});
test('quick entry adds multiple grouped belongings in the same plan and focuses the next name', async () => {
  const created = [];
  handler = async (url, options) => {
    const body = JSON.parse(options.body); created.push(body);
    const value = { ...item, id: `${created.length}`, name: body.name };
    data = inventory([...data.items, value]); return reply(201, { item: value });
  };
  mount(); await formReady();
  name('Box of kitchen supplies'); submitDraft();
  await waitFor(() => expect(screen.getByText('0 of 1 items cleared')).toBeInTheDocument());
  expect(screen.getByLabelText('Item name')).toHaveValue(''); expect(screen.getByLabelText('Item name')).toHaveFocus();
  name('Three identical chairs'); submitDraft();
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
  fireEvent.click(screen.getByRole('button', { name: 'Publish & add another' }));
  expect(await screen.findByText('Item published. Add another below.')).toBeInTheDocument();
  expect(await screen.findByRole('link', { name: 'Public listing' })).toBeInTheDocument();
});
test('client rejects invalid availability ranges and empty names without sending writes', async () => {
  mount(); await formReady(); submitDraft();
  expect(await screen.findByRole('alert')).toHaveTextContent('Give this item or group a name');
  name('Chairs');
  fireEvent.change(screen.getByLabelText('Available from (optional)'), { target: { value: date(10) } });
  fireEvent.change(screen.getByLabelText('Available until (optional)'), { target: { value: date(5) } });
  submitDraft(); expect(screen.getByRole('alert')).toHaveTextContent('Pickup dates must be in order');
  expect(fetch.mock.calls.some(([, options]) => options.method !== 'GET')).toBe(false);
});
test.each(['available', 'expired'])('reservation metadata stays distinct from %s publication state and clearance progress', async status => {
  data = inventory([{ ...item, status, isReserved: true }]); mount(); await formReady();
  expect(screen.getByText('Pickup arranged')).toBeInTheDocument();
  expect(screen.getByText('0 of 1 items cleared')).toBeInTheDocument();
  expect(screen.getAllByText(status === 'available' ? 'Published' : 'Expired').length).toBeGreaterThan(0);
});
test('all five item states, availability and real clearance progress remain distinguishable', async () => {
  data = inventory(['draft', 'available', 'unlisted', 'cleared', 'expired'].map((status, index) => ({ ...item, id: String(index), name: `${status} item`, status })));
  mount(); await formReady();
  expect(screen.getByText('1 of 5 items cleared')).toBeInTheDocument();
  for (const label of ['Draft', 'Published', 'Unlisted', 'Cleared', 'Expired']) expect(screen.getAllByText(label).length).toBeGreaterThan(0);
  fireEvent.change(screen.getByLabelText('Show items'), { target: { value: 'unlisted' } });
  expect(screen.getByRole('heading', { name: 'unlisted item' })).toBeInTheDocument();
  expect(screen.queryByRole('heading', { name: 'cleared item' })).not.toBeInTheDocument();
});
test.each([['available', 'Unlist', 'unlist', 'unlisted'], ['unlisted', 'Relist', 'publish', 'available'],
  ['unlisted', 'Mark', 'clear', 'cleared'], ['cleared', 'Reopen', 'reopen', 'draft']])('%s owner action confirms intent and uses the current item version', async (initial, label, action, next) => {
  data = inventory([{ ...item, status: initial, version: 7 }]);
  handler = async (url, options) => {
    expect(url).toBe(`${root}/${item.id}/actions`); expect(JSON.parse(options.body)).toEqual({ action, version: 7 });
    const updated = { ...item, status: next, version: 8 }; data = inventory([updated]); return reply(200, { item: updated });
  };
  mount(); await formReady();
  const accessibleName = action === 'clear' ? `Mark ${item.name} cleared` : action === 'reopen' ? `Reopen ${item.name} as draft` : `${label} ${item.name}`;
  const button = screen.getByRole('button', { name: accessibleName });
  await act(async () => { fireEvent.click(button); });
  await waitFor(() => expect(data.items[0].version).toBe(8));
  await waitFor(() => expect(screen.getByText(next === 'cleared' ? '1 of 1 items cleared' : '0 of 1 items cleared')).toBeInTheDocument());
  expect(window.confirm).toHaveBeenCalled();
});
test('cancelling a consequential action leaves the inventory unchanged', async () => {
  window.confirm.mockReturnValue(false); data = inventory([{ ...item, status: 'available' }]);
  mount(); await formReady(); fireEvent.click(screen.getByRole('button', { name: `Unlist ${item.name}` }));
  expect(fetch.mock.calls.some(([, options]) => options.method === 'POST')).toBe(false);
});
test('reopening with a past pickup end is rejected before sending an action or confirming publication', async () => {
  data = inventory([{ ...item, status: 'cleared', availableUntil: date(-1), effectiveAvailableUntil: date(-1) }]);
  mount(); await formReady();
  fireEvent.click(screen.getByRole('button', { name: `Reopen ${item.name} as draft` }));
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
  mount(`${root.replace('/api/move-out-plans', '/app/plans')}?edit=${item.id}`); await screen.findByRole('button', { name: 'Save changes' });
  name('Two boxes'); fireEvent.click(screen.getByRole('button', { name: 'Use plan availability' }));
  fireEvent.submit(screen.getByRole('button', { name: 'Save changes' }).closest('form'));
  expect(await screen.findByRole('heading', { name: 'Two boxes' })).toBeInTheDocument();
});
test('stale actions show an error and let the owner reload authoritative state', async () => {
  data = inventory([{ ...item, status: 'available' }]);
  handler = async () => { data = inventory([{ ...item, status: 'cleared', version: 2 }]); return reply(409, { error: { message: 'This item changed. Reload the inventory.' } }); };
  mount(); await formReady(); fireEvent.click(screen.getByRole('button', { name: `Unlist ${item.name}` }));
  expect(await screen.findByRole('alert')).toHaveTextContent('This item changed');
  fireEvent.click(screen.getByRole('button', { name: 'Reload inventory' }));
  expect(await screen.findByText('1 of 1 items cleared')).toBeInTheDocument();
});
test('refreshing an outdated edit replaces its values before adopting the new version', async () => {
  data = inventory([item]);
  mount(`/app/plans/${plan.id}/items?edit=${item.id}`); await screen.findByRole('button', { name: 'Save changes' });
  name('Outdated unsaved draft');
  data = inventory([{ ...item, name: 'Changed in another tab', version: 2 }]);
  fireEvent.click(screen.getByRole('button', { name: 'Refresh inventory' }));
  await waitFor(() => expect(screen.getByLabelText('Item name')).toHaveValue('Changed in another tab'));
  expect(screen.getByRole('heading', { name: 'Edit Changed in another tab' })).toBeInTheDocument();
  expect(window.confirm).toHaveBeenCalled();
});
test('saving an item disables competing inventory actions until the write finishes', async () => {
  data = inventory([item]);
  let finish;
  handler = () => new Promise(resolve => { finish = resolve; });
  mount(); await formReady(); name('Another item'); submitDraft();
  expect(screen.getByRole('button', { name: `Edit ${item.name}` })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Refresh inventory' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Saving…' })).toBeDisabled();
  await act(async () => { data = inventory([item, { ...item, id: 'second', name: 'Another item' }]); finish(reply(201, { item: data.items[1] })); });
  expect(await screen.findByText('0 of 2 items cleared')).toBeInTheDocument();
});
test('failed saves retain drafts and expired sessions remove the private form', async () => {
  handler = async () => reply(500, { error: { message: 'Try again' } });
  mount(); await formReady(); name('Unsaved belongings'); submitDraft();
  expect(await screen.findByRole('alert')).toHaveTextContent('Try again');
  expect(screen.getByLabelText('Item name')).toHaveValue('Unsaved belongings');
  handler = async () => reply(401, { error: { code: 'SESSION_EXPIRED', message: 'Please log in again' } });
  submitDraft(); expect(await screen.findByRole('heading', { name: 'Login' })).toBeInTheDocument();
  expect(screen.queryByLabelText('Item name')).not.toBeInTheDocument();
});
test('public discovery searches published listings without requiring sign-in or displaying private owner data', async () => {
  const visible = { ...item, status: 'available', city: plan.city, neighborhood: plan.neighborhood };
  handler = async url => reply(200, url.endsWith('/locations') ? { locations: [{ city: plan.city, neighborhoods: [plan.neighborhood] }] } : url.includes(item.id) ? { item: visible } : { items: [visible] });
  mount('/app/items');
  expect(await screen.findByRole('link', { name: item.name })).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('Neighborhood'), { target: { value: 'Temescal' } });
  fireEvent.click(screen.getByRole('button', { name: 'Find free items' }));
  await waitFor(() => expect(fetch.mock.calls.some(([url]) => url.includes('neighborhood=Temescal'))).toBe(true));
  fireEvent.click(await screen.findByRole('link', { name: item.name }));
  expect(await screen.findByRole('heading', { name: item.name })).toBeInTheDocument();
  expect(screen.queryByText(user.email)).not.toBeInTheDocument();
});
test('a withdrawn public detail disappears on refresh instead of retaining its old data', async () => {
  let visible = true;
  handler = async () => visible ? reply(200, { item }) : reply(404, { error: { message: 'Listing unavailable' } });
  mount(`/app/items/${item.id}`); await screen.findByRole('heading', { name: item.name });
  visible = false; fireEvent.click(screen.getByRole('button', { name: 'Refresh listings' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('This listing is no longer available');
  expect(screen.queryByRole('heading', { name: item.name })).not.toBeInTheDocument();
});
test('date validation keeps calendar boundaries and does not treat publication time as pickup availability', () => {
  expect(availabilityError({ availableFrom: date(5), availableUntil: date(10) }, plan, true)).toBe('');
  expect(availabilityError({ availableFrom: '', availableUntil: date(-1) }, plan, true)).toMatch(/today or later/);
  expect(availabilityError({ availableFrom: '', availableUntil: date(-1) }, plan, false)).toBe('');
  expect(availabilityError({ availableFrom: '2027-02-29', availableUntil: '' }, plan)).toMatch(/real calendar/);
});
