import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import AreaSelect from './AreaSelect';

test('area menu supports keyboard selection, Escape, outside dismissal and disabled controls', () => {
  const change = jest.fn(); const view = disabled => <><label htmlFor="area">Area</label><AreaSelect id="area" name="area" value="a" disabled={disabled} onChange={change}><option value="a">First</option><option value="b">Second</option></AreaSelect><button>Outside</button></>;
  const { rerender } = render(view(false)); const select = screen.getByLabelText('Area');
  fireEvent.keyDown(select, { key: 'ArrowDown' }); expect(screen.getByRole('listbox')).toBeVisible();
  fireEvent.keyDown(select, { key: 'End' }); fireEvent.keyDown(select, { key: 'Enter' });
  expect(change).toHaveBeenCalledWith({ target: { name: 'area', value: 'b' } }); expect(select).toHaveFocus();
  expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  fireEvent.click(select); fireEvent.pointerDown(screen.getByRole('button', { name: 'Outside' }));
  expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  fireEvent.click(select); fireEvent.keyDown(select, { key: 'Escape' }); expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  rerender(view(true)); fireEvent.click(select); expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
});
