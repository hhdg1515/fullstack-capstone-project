import React, { useState } from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import ItemTypeSelector, { rankedItemTypes } from './ItemTypeSelector';
const taxonomy = require('../../../../giftlink-backend/data/item-taxonomy.json');
function Scene() {
  const [selection, setSelection] = useState(['', '']);
  return <><ItemTypeSelector categories={taxonomy.categories} categoryId={selection[0]} itemTypeId={selection[1]} onChange={(...value) => setSelection(value)} onSearch={() => {}} /><output>{selection.join(':')}</output></>;
}
test('rank order is exact label, exact synonym, label prefix, synonym prefix, then substring with stable catalog ties', () => {
  const entries = [['substring', 'A tv shelf', []], ['synonym-prefix', 'Video equipment', ['tv screen']], ['label-prefix', 'TV Stand', []], ['synonym', 'Television', ['tv']], ['exact', 'TV', []], ['tie', 'TV Table', []]]
    .map(([id, label, searchTerms]) => ({ id, label, searchTerms, category: { label: 'Household' } }));
  expect(rankedItemTypes(entries, '  TV ').map(v => v.id)).toEqual(['exact', 'synonym', 'label-prefix', 'tie', 'synonym-prefix', 'substring']);
  expect(rankedItemTypes(entries, '')).toBe(entries);
});
test('tv puts Television above TV Stand and keyboard selection derives its unchanged canonical category', () => {
  render(<Scene />); const input = screen.getByRole('combobox', { name: 'Item type' });
  fireEvent.change(input, { target: { value: 'tv' } }); expect(screen.getAllByRole('option')[0]).toHaveTextContent('Television');
  fireEvent.keyDown(input, { key: 'ArrowDown' }); expect(input).toHaveAttribute('aria-activedescendant', screen.getAllByRole('option')[0].id);
  fireEvent.keyDown(input, { key: 'Enter' }); expect(input).toHaveValue('Television'); expect(screen.getByRole('status')).toHaveTextContent('living-room:television');
  expect(input).toHaveAttribute('aria-expanded', 'false');
});
test.each([['microwave oven', 'Microwave', 'dining-kitchen:microwave'], ['looking glass', 'Mirror', 'other-household:mirror'], ['settee', 'Sofa', 'living-room:sofa']])('%s selects an accurate canonical type', (query, label, selected) => {
  render(<Scene />); fireEvent.change(screen.getByRole('combobox'), { target: { value: query } });
  const option = screen.getAllByRole('option')[0]; expect(option).toHaveTextContent(label); fireEvent.click(option); expect(screen.getByRole('status')).toHaveTextContent(selected);
});
test('no match keeps an explicit Other fallback and Escape closes the list without inventing a classification', () => {
  render(<Scene />); const input = screen.getByRole('combobox'); fireEvent.change(input, { target: { value: 'unlisted household thing' } });
  expect(screen.getByText('No matching types. Choose Other.')).toBeVisible(); expect(screen.getAllByRole('option')).toHaveLength(1);
  fireEvent.keyDown(input, { key: 'End' }); fireEvent.keyDown(input, { key: 'Enter' }); expect(input).toHaveValue('Other');
  fireEvent.focus(input); fireEvent.keyDown(input, { key: 'Escape' }); expect(input).toHaveAttribute('aria-expanded', 'false');
});

test('a pointer click outside the in-flow list activates its target before dismissal, while keyboard blur closes immediately', () => {
  const save = jest.fn(); render(<><Scene /><button onClick={save}>Save draft</button></>);
  const input = screen.getByRole('combobox'), button = screen.getByRole('button', { name: 'Save draft' });
  act(() => input.focus()); expect(input).toHaveAttribute('aria-expanded', 'true');
  fireEvent.pointerDown(button); act(() => button.focus());
  expect(input).toHaveAttribute('aria-expanded', 'true'); // No layout shift before pointerup/click.
  fireEvent.pointerUp(button); fireEvent.click(button);
  expect(save).toHaveBeenCalledTimes(1); expect(input).toHaveAttribute('aria-expanded', 'false');
  act(() => input.focus()); act(() => button.focus()); expect(input).toHaveAttribute('aria-expanded', 'false');
});
