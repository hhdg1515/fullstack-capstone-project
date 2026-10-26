import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import PlanForm from './PlanForm';
import { regions } from '../../test-support/catalogs';

const response = (data, status = 200) => ({ ok: status < 400, status, json: async () => data });
const mount = props => render(<MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}><PlanForm onSave={jest.fn()} {...props} /></MemoryRouter>);
const select = (label, value) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
const ready = () => screen.findByRole('option', { name: 'California' });
beforeEach(() => { global.fetch = jest.fn(async () => response(regions)); });

test('state filters metros, clears the previous selection and fills only an empty timezone', async () => {
  mount(); await ready(); select('State', '06');
  expect(screen.getByRole('option', { name: 'San Francisco-Oakland-Berkeley, CA' })).toBeInTheDocument();
  expect(screen.queryByRole('option', { name: 'Portland-Vancouver-Hillsboro, OR-WA' })).not.toBeInTheDocument();
  select('Metro area', '41860'); expect(screen.getByLabelText(/Pickup timezone/)).toHaveValue('America/Los_Angeles');
  select('State', '41'); expect(screen.getByLabelText('Metro area')).toHaveValue('');
  expect(screen.getByLabelText(/Pickup timezone/)).toHaveValue('America/Los_Angeles');
});
test('ambiguous coverage keeps timezone explicit and uncovered states explain their limit', async () => {
  mount(); await ready(); select('State', '41'); select('Metro area', '38900');
  expect(screen.getByLabelText(/Pickup timezone/)).toHaveValue('');
  select('State', '02'); expect(screen.getByText('No metros are listed for this state yet.')).toBeInTheDocument();
  expect(screen.getByText(/will not appear in metro discovery/)).toBeInTheDocument();
});
test('legacy labels and an existing explicit timezone survive assigning a canonical region', async () => {
  const save = jest.fn();
  mount({ onSave: save, initialPlan: { id: 'plan', title: 'Move', status: 'active', city: 'Oakland', neighborhood: 'Temescal', moveOutDeadline: '2099-01-01', pickupTimeZone: 'UTC' } });
  await ready(); select('State', '06'); select('Metro area', '41860');
  expect(screen.getByLabelText(/Pickup timezone/)).toHaveValue('UTC');
  fireEvent.submit(screen.getByRole('button', { name: 'Save changes' }).closest('form'));
  await waitFor(() => expect(save).toHaveBeenCalled());
  expect(save.mock.calls[0][0]).toMatchObject({ stateId: '06', metroId: '41860', city: 'Oakland', neighborhood: 'Temescal', pickupTimeZone: 'UTC' });
});
test('a failed catalog is recoverable and never invents empty coverage', async () => {
  fetch.mockResolvedValueOnce(response({ error: { message: 'Unavailable' } }, 503));
  mount(); expect(await screen.findByRole('alert')).toHaveTextContent('Region options are unavailable');
  expect(screen.queryByText(/No metros are listed/)).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Retry region options' })); await ready();
  expect(screen.getByLabelText('State')).toBeEnabled();
});
test('malformed catalog entries produce a recoverable service error instead of a selector crash', async () => {
  fetch.mockResolvedValueOnce(response({ states: [{}], metros: [{}] }));
  mount(); expect(await screen.findByRole('alert')).toHaveTextContent('Region options are unavailable');
  fireEvent.click(screen.getByRole('button', { name: 'Retry region options' })); await ready();
});
test('a valid existing timezone is contextual, with an accessible correction control', async () => {
  mount({ initialPlan: { id: 'plan', title: '', status: 'active', city: 'Oakland', neighborhood: 'Temescal', moveOutDeadline: '2099-01-01', pickupTimeZone: 'UTC' } });
  await ready(); const field = screen.getByLabelText('Pickup timezone (needed to receive requests)');
  expect(screen.getByText('Pickup timezone: UTC')).toBeVisible(); expect(field).not.toBeVisible();
  fireEvent.click(screen.getByText('Change pickup timezone'));
  // jsdom does not implement the native summary toggle; exercise its resulting state.
  const details = field.closest('details'); details.open = true; fireEvent(details, new Event('toggle'));
  expect(field).toBeVisible(); select('State', '06'); select('Metro area', '41860'); expect(field).toHaveValue('UTC');
});
test('server timezone validation opens the correction control and focuses its associated error', async () => {
  const problem = Object.assign(new Error('Check timezone.'), { fields: [{ field: 'pickupTimeZone', message: 'Choose a valid IANA timezone.' }] });
  mount({ onSave: jest.fn().mockRejectedValue(problem), initialPlan: { id: 'plan', title: '', status: 'active', city: 'Oakland', neighborhood: 'Temescal', moveOutDeadline: '2099-01-01', pickupTimeZone: 'UTC' } });
  await ready(); fireEvent.submit(screen.getByRole('button', { name: 'Save changes' }).closest('form'));
  const field = screen.getByLabelText('Pickup timezone (needed to receive requests)');
  await waitFor(() => expect(field).toHaveFocus()); expect(field).toBeVisible(); expect(field).toHaveAccessibleDescription(/Choose a valid IANA timezone/);
});
