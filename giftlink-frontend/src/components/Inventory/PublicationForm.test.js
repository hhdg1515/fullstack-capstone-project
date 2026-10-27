import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import ItemForm from './ItemForm';
import { taxonomy } from '../../test-support/catalogs';
const plan = { status: 'active', moveOutDeadline: '2099-01-01' };
const change = (label, value) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
beforeEach(() => { global.fetch = jest.fn(async () => ({ ok: true, status: 200, json: async () => taxonomy })); jest.spyOn(window, 'confirm').mockReturnValue(true); });
afterEach(() => jest.restoreAllMocks());
const ready = () => screen.findByRole('option', { name: 'Living Room' });
const complete = () => { change('Item name', 'Sofa'); change('Category', 'living-room'); change('Item type', 'sofa'); change('Description', 'Comfortable sofa.'); };

test('publication validates details and focuses the first field; drafts still need only a name', async () => {
  const save = jest.fn(); render(<ItemForm plan={plan} onSave={save} />); await ready();
  change('Item name', 'Sofa'); fireEvent.click(screen.getByRole('button', { name: 'Publish' }));
  expect(screen.getByLabelText('Category')).toHaveFocus(); expect(save).not.toHaveBeenCalled();
  expect(screen.getByLabelText('Category')).toHaveAccessibleDescription('Choose a category before publishing.');
  fireEvent.submit(screen.getByRole('button', { name: 'Save Draft' }).closest('form'));
  await waitFor(() => expect(save).toHaveBeenCalledTimes(1)); expect(save.mock.calls[0][1]).toBe(false);
});
test('completed details publish once even if the submit handler is invoked twice before settling', async () => {
  let done; const save = jest.fn(() => new Promise(resolve => { done = resolve; }));
  render(<ItemForm plan={plan} onSave={save} />); await ready(); complete();
  const button = screen.getByRole('button', { name: 'Publish' });
  fireEvent.click(button); fireEvent.click(button);
  expect(save).toHaveBeenCalledTimes(1); expect(save.mock.calls[0][1]).toBe(true);
  await act(async () => done());
});
test('editing an incomplete legacy post remains possible while validated posts retain required details', async () => {
  const save = jest.fn(); const legacy = { name: 'Legacy chair', status: 'available' };
  const { rerender } = render(<ItemForm key="old" plan={plan} item={legacy} onSave={save} />); await ready();
  fireEvent.submit(screen.getByRole('button', { name: 'Save Changes' }).closest('form'));
  await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
  rerender(<ItemForm key="new" plan={plan} item={{ ...legacy, requiresPublicationDetails: true }} onSave={save} />); await ready();
  fireEvent.submit(screen.getByRole('button', { name: 'Save Changes' }).closest('form'));
  expect(screen.getByLabelText('Category')).toHaveFocus(); expect(save).toHaveBeenCalledTimes(1);
});
test('creation inherits its end without an end control or reset button; editing preserves the override', async () => {
  const { rerender } = render(<ItemForm plan={plan} onSave={jest.fn()} />); await ready();
  expect(screen.queryByLabelText('Available until (optional)')).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Use plan availability' })).not.toBeInTheDocument();
  expect(screen.getByText(/Pickup ends 2099-01-01/)).toBeInTheDocument();
  rerender(<ItemForm key="edit" plan={plan} item={{ name: 'Old', status: 'draft', availableUntil: '2098-12-01' }} onSave={jest.fn()} />); await ready();
  expect(screen.getByLabelText('Available until (optional)')).toHaveValue('2098-12-01');
});
