import { fireEvent, screen } from '@testing-library/react';
import { taxonomy } from './catalogs';
export function selectItemType(id) {
  const type = taxonomy.categories.flatMap(category => category.itemTypes).find(row => row.id === id);
  fireEvent.change(screen.getByLabelText('Item type'), { target: { value: type.label } });
  fireEvent.click(screen.getByRole('option', { name: new RegExp('^' + type.label + ' ') }));
}
