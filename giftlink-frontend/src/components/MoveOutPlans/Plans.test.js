import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { AuthProvider } from '../../context/AuthContext';
import RequireAuth from '../RequireAuth';
import Navbar from '../Navbar/Navbar';
import LoginPage from '../LoginPage/LoginPage';
import { MyPlans, CreatePlan, PlanDetail, EditPlan } from './Plans';
import { formatDeadline, utcToday } from './dates';

const user = { id: 'owner', firstName: 'Gift', lastName: 'Giver', email: 'private@example.test' };
const deadline = new Date(Date.now() + 10 * 86400000).toISOString().slice(0, 10);
const plan = { id: '64a000000000000000000001', title: 'Our move', moveOutDeadline: deadline,
  city: 'San Francisco', neighborhood: 'Sunset', status: 'active', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' };
const reply = (status, data) => ({ status, ok: status >= 200 && status < 300, json: async () => data });
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
function mount(path = '/app/plans') {
  return render(<MemoryRouter initialEntries={[path]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
    <AuthProvider><Navbar /><Routes>
      <Route path="/app/plans" element={<RequireAuth><MyPlans /></RequireAuth>} />
      <Route path="/app/plans/new" element={<RequireAuth><CreatePlan /></RequireAuth>} />
      <Route path="/app/plans/:planId" element={<RequireAuth><PlanDetail /></RequireAuth>} />
      <Route path="/app/plans/:planId/edit" element={<RequireAuth><EditPlan /></RequireAuth>} />
      <Route path="/app/login" element={<LoginPage />} />
    </Routes></AuthProvider>
  </MemoryRouter>);
}
function fillForm() {
  for (const [label, value] of [['Move-out deadline', deadline], ['City', ' San Francisco '], ['Neighborhood', ' Sunset '], ['Plan title (optional)', ' Our move ']]) {
    fireEvent.change(screen.getByLabelText(label), { target: { value } });
  }
}
const submit = label => fireEvent.submit(screen.getByRole('button', { name: label }).closest('form'));
beforeEach(() => { global.fetch = jest.fn().mockResolvedValueOnce(reply(200, { user })); });

test('private routes wait for the session and send anonymous users to login before fetching plans', async () => {
  const pending = deferred(); fetch.mockReset().mockReturnValueOnce(pending.promise);
  mount('/app/plans/new');
  expect(screen.queryByRole('heading', { name: 'Create move-out plan' })).not.toBeInTheDocument();
  expect(screen.getAllByRole('status').length).toBeGreaterThan(0);
  await act(async () => pending.resolve(reply(401, { error: { code: 'UNAUTHENTICATED' } })));
  expect(await screen.findByRole('heading', { name: 'Login' })).toBeInTheDocument();
  expect(fetch).toHaveBeenCalledTimes(1);
});
test('dashboard shows loading and an empty state linking directly to creation', async () => {
  const pending = deferred(); fetch.mockReturnValueOnce(pending.promise);
  mount();
  expect(await screen.findByText('Loading your plans…')).toBeInTheDocument();
  await act(async () => pending.resolve(reply(200, { plans: [] })));
  expect(await screen.findByText(/You have no move-out plans yet/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('link', { name: 'Create your first plan' }));
  expect(await screen.findByRole('heading', { name: 'Create move-out plan' })).toBeInTheDocument();
  expect(screen.getAllByRole('textbox')).toHaveLength(3);
  expect(screen.queryByLabelText(/address|apartment|HOA|tenancy/i)).not.toBeInTheDocument();
});
test('dashboard displays multiple plans, their dates, neighborhoods, statuses and untitled fallback', async () => {
  fetch.mockResolvedValueOnce(reply(200, { plans: [plan, { ...plan, id: 'two', title: '', neighborhood: 'Mission', status: 'completed' }] }));
  mount();
  expect(await screen.findByRole('link', { name: 'Our move' })).toHaveAttribute('href', `/app/plans/${plan.id}`);
  expect(screen.getByRole('link', { name: 'Move-out in Mission' })).toBeInTheDocument();
  expect(screen.getByText('Sunset, San Francisco')).toBeInTheDocument();
  expect(screen.getByText('Active')).toBeInTheDocument(); expect(screen.getByText('Completed')).toBeInTheDocument();
  expect(document.querySelector('time')).toHaveAttribute('datetime', deadline);
});
test('dashboard request failures offer a working retry', async () => {
  fetch.mockResolvedValueOnce(reply(500, { error: { message: 'Could not load plans' } })).mockResolvedValueOnce(reply(200, { plans: [] }));
  mount();
  expect(await screen.findByRole('alert')).toHaveTextContent('Could not load plans');
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
  expect(await screen.findByText(/You have no move-out plans yet/)).toBeInTheDocument();
});
test('creation validates required labels and past deadlines before sending a request', async () => {
  mount('/app/plans/new'); await screen.findByRole('heading', { name: 'Create move-out plan' });
  submit('Create plan');
  expect(await screen.findByRole('alert')).toHaveTextContent('Check the highlighted fields');
  expect(screen.getByLabelText('City')).toHaveAttribute('aria-invalid', 'true');
  fillForm();
  fireEvent.change(screen.getByLabelText('Move-out deadline'), { target: { value: '2000-01-01' } });
  submit('Create plan');
  expect(screen.getByText('Choose today or a later date (UTC).')).toBeInTheDocument();
  expect(fetch).toHaveBeenCalledTimes(1);
});
test('creation sends only the four plan fields through the existing cookie/CSRF client and prevents duplicate submits', async () => {
  const pending = deferred(); fetch.mockReturnValueOnce(pending.promise).mockResolvedValueOnce(reply(200, { plan }));
  mount('/app/plans/new'); await screen.findByRole('heading', { name: 'Create move-out plan' });
  fillForm(); submit('Create plan');
  expect(screen.getByRole('button', { name: 'Saving…' })).toBeDisabled();
  expect(screen.getByLabelText('City')).toBeDisabled();
  const [url, options] = fetch.mock.calls[1];
  expect(url).toMatch(/\/api\/move-out-plans$/); expect(options.method).toBe('POST');
  expect(options.credentials).toBe('include'); expect(options.headers['X-CSRF-Protection']).toBe('1');
  expect(JSON.parse(options.body)).toEqual({ title: plan.title, city: plan.city, neighborhood: plan.neighborhood, moveOutDeadline: deadline });
  await act(async () => pending.resolve(reply(201, { plan })));
  expect(await screen.findByRole('heading', { name: 'Our move' })).toBeInTheDocument();
  expect(screen.getByText('Plan created.')).toBeInTheDocument();
});
test('creation allows an omitted optional title and a deadline of today', async () => {
  fetch.mockResolvedValueOnce(reply(201, { plan })).mockResolvedValueOnce(reply(200, { plan }));
  mount('/app/plans/new'); await screen.findByRole('heading', { name: 'Create move-out plan' });
  fillForm(); fireEvent.change(screen.getByLabelText('Plan title (optional)'), { target: { value: '' } });
  fireEvent.change(screen.getByLabelText('Move-out deadline'), { target: { value: utcToday() } });
  submit('Create plan'); await screen.findByRole('heading', { name: 'Our move' });
  expect(JSON.parse(fetch.mock.calls[1][1].body).title).toBe('');
  expect(JSON.parse(fetch.mock.calls[1][1].body).moveOutDeadline).toBe(utcToday());
});
test('server validation errors retain the draft and are connected to the affected field', async () => {
  fetch.mockResolvedValueOnce(reply(400, { error: { code: 'VALIDATION_FAILED', message: 'Check your plan details',
    fields: [{ field: 'neighborhood', message: 'Check the neighborhood name' }] } }));
  mount('/app/plans/new'); await screen.findByRole('heading', { name: 'Create move-out plan' });
  fillForm(); submit('Create plan');
  expect(await screen.findByRole('alert')).toHaveTextContent('Check your plan details');
  expect(screen.getByLabelText('Neighborhood')).toHaveValue(' Sunset ');
  expect(screen.getByLabelText('Neighborhood')).toHaveAttribute('aria-describedby', 'plan-neighborhood-error');
  expect(screen.getByText('Check the neighborhood name')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Create plan' })).toBeEnabled();
});
test('a failed save preserves inputs and allows retry', async () => {
  fetch.mockRejectedValueOnce(new Error('offline'));
  mount('/app/plans/new'); await screen.findByRole('heading', { name: 'Create move-out plan' });
  fillForm(); submit('Create plan');
  expect(await screen.findByRole('alert')).toHaveTextContent('Unable to reach the server');
  expect(screen.getByLabelText('Plan title (optional)')).toHaveValue(' Our move ');
  expect(screen.getByRole('button', { name: 'Create plan' })).toBeEnabled();
});
test('detail shows the private plan and links to its edit form', async () => {
  fetch.mockResolvedValue(reply(200, { plan }));
  mount(`/app/plans/${plan.id}`);
  expect(await screen.findByRole('heading', { name: 'Our move' })).toBeInTheDocument();
  expect(screen.getByText('San Francisco')).toBeInTheDocument();
  expect(screen.getByText('Active')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('link', { name: 'Edit plan' }));
  expect(await screen.findByLabelText('Plan title (optional)')).toHaveValue('Our move');
});
test('a missing or inaccessible plan shows an unavailable state without an edit control', async () => {
  fetch.mockResolvedValueOnce(reply(404, { error: { message: 'Plan not found' } }));
  mount(`/app/plans/${plan.id}`);
  expect(await screen.findByRole('alert')).toHaveTextContent('This plan is unavailable.');
  expect(screen.queryByRole('link', { name: 'Edit plan' })).not.toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'My plans' })).toBeInTheDocument();
});
test('edit preloads fields and saves names, a cleared title, deadline and manual status with PATCH', async () => {
  const updated = { ...plan, title: '', neighborhood: 'Richmond', status: 'completed' };
  fetch.mockResolvedValueOnce(reply(200, { plan })).mockResolvedValueOnce(reply(200, { plan: updated })).mockResolvedValueOnce(reply(200, { plan: updated }));
  mount(`/app/plans/${plan.id}/edit`);
  expect(await screen.findByLabelText('City')).toHaveValue(plan.city);
  fireEvent.change(screen.getByLabelText('Plan title (optional)'), { target: { value: '' } });
  fireEvent.change(screen.getByLabelText('Neighborhood'), { target: { value: 'Richmond' } });
  fireEvent.change(screen.getByLabelText('Plan status'), { target: { value: 'completed' } });
  submit('Save changes');
  expect(await screen.findByText('Plan updated.')).toBeInTheDocument();
  const [url, options] = fetch.mock.calls.find(([, options]) => options.method === 'PATCH');
  expect(url).toMatch(new RegExp(`/api/move-out-plans/${plan.id}$`));
  expect(JSON.parse(options.body)).toEqual({ title: '', city: plan.city, neighborhood: 'Richmond', moveOutDeadline: deadline, status: 'completed' });
  expect(screen.getByRole('heading', { name: 'Move-out in Richmond' })).toBeInTheDocument();
  expect(screen.getByText('Completed')).toBeInTheDocument();
});
test('an expired calendar deadline can be kept while editing an existing plan', async () => {
  const past = { ...plan, moveOutDeadline: '2000-01-01' };
  fetch.mockResolvedValueOnce(reply(200, { plan: past })).mockResolvedValueOnce(reply(200, { plan: past })).mockResolvedValueOnce(reply(200, { plan: past }));
  mount(`/app/plans/${plan.id}/edit`); await screen.findByLabelText('Move-out deadline');
  expect(screen.getByLabelText('Move-out deadline')).not.toHaveAttribute('min');
  submit('Save changes');
  expect(await screen.findByText('Plan updated.')).toBeInTheDocument();
});
test('an expired session while loading plans returns to login and removes private content', async () => {
  fetch.mockResolvedValueOnce(reply(401, { error: { code: 'SESSION_EXPIRED' } }));
  mount();
  expect(await screen.findByRole('heading', { name: 'Login' })).toBeInTheDocument();
  expect(screen.getByText('Your session ended. Please log in again.')).toBeInTheDocument();
  expect(screen.queryByRole('heading', { name: 'My move-out plans' })).not.toBeInTheDocument();
});
test('an expired session during editing removes the private form and prompts login', async () => {
  fetch.mockResolvedValueOnce(reply(200, { plan })).mockResolvedValueOnce(reply(401, { error: { code: 'SESSION_EXPIRED' } }));
  mount(`/app/plans/${plan.id}/edit`); await screen.findByLabelText('City');
  submit('Save changes');
  expect(await screen.findByRole('heading', { name: 'Login' })).toBeInTheDocument();
  expect(screen.queryByLabelText('City')).not.toBeInTheDocument();
});
test('background validation of the same account preserves an unsaved plan draft', async () => {
  fetch.mockResolvedValueOnce(reply(200, { plan })).mockResolvedValueOnce(reply(200, { user: { ...user } }));
  mount(`/app/plans/${plan.id}/edit`); await screen.findByLabelText('City');
  fireEvent.change(screen.getByLabelText('City'), { target: { value: 'Unsaved city' } });
  await act(async () => { fireEvent(window, new Event('focus')); });
  await waitFor(() => expect(fetch).toHaveBeenCalledTimes(3));
  expect(screen.getByLabelText('City')).toHaveValue('Unsaved city');
});
test('changing accounts hides the previous private plans while the new list loads', async () => {
  const pending = deferred();
  fetch.mockResolvedValueOnce(reply(200, { plans: [plan] })).mockResolvedValueOnce(reply(200, { user: { ...user, id: 'other' } }))
    .mockReturnValueOnce(pending.promise);
  mount(); await screen.findByRole('link', { name: 'Our move' });
  await act(async () => { fireEvent(window, new Event('focus')); });
  await screen.findByText('Loading your plans…');
  expect(screen.queryByRole('link', { name: 'Our move' })).not.toBeInTheDocument();
  await act(async () => pending.resolve(reply(200, { plans: [] })));
  expect(await screen.findByText(/You have no move-out plans yet/)).toBeInTheDocument();
});
test('changing accounts discards a draft from the previous account’s creation form', async () => {
  fetch.mockResolvedValueOnce(reply(200, { user: { ...user, id: 'other' } }));
  mount('/app/plans/new'); await screen.findByRole('heading', { name: 'Create move-out plan' });
  fillForm();
  await act(async () => { fireEvent(window, new Event('focus')); });
  expect(screen.getByLabelText('City')).toHaveValue('');
  expect(screen.getByLabelText('Plan title (optional)')).toHaveValue('');
});
test('calendar date display does not shift a January 1 deadline into the previous year', () => {
  expect(formatDeadline('2028-01-01')).toBe('Jan 1, 2028');
});
test('deadline conflicts name affected items, preserve the proposed date, and link to explicit item-date resolution', async () => {
  fetch.mockResolvedValueOnce(reply(200, { plan })).mockResolvedValueOnce(reply(409, { error: {
    code: 'ITEM_DATE_CONFLICT', message: 'Resolve item dates first', conflicts: [{ id: 'item-one', name: 'Late chair', availableFrom: null, availableUntil: deadline }]
  } }));
  mount(`/app/plans/${plan.id}/edit`); await screen.findByLabelText('Move-out deadline');
  const proposed = new Date(Date.now() + 5 * 86400000).toISOString().slice(0, 10);
  fireEvent.change(screen.getByLabelText('Move-out deadline'), { target: { value: proposed } });
  submit('Save changes');
  expect(await screen.findByRole('alert')).toHaveTextContent('Resolve item dates first');
  const link = screen.getByRole('link', { name: 'Late chair (opens new tab)' });
  expect(link).toHaveAttribute('target', '_blank');
  expect(link).toHaveAttribute('href', `/app/plans/${plan.id}/items?edit=item-one`);
  expect(screen.getByLabelText('Move-out deadline')).toHaveValue(proposed);
  expect(screen.getByRole('button', { name: 'Save changes' })).toBeEnabled();
});
