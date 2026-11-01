import React from 'react';
import { render, screen, act, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import App from '../../App';
import { AuthProvider, useAppContext } from '../../context/AuthContext';
jest.mock('../../api/usePublicCatalog', () => ({ __esModule: true, default: path => ({ data: require('../../test-support/catalogs')[path === '/api/regions' ? 'regions' : 'taxonomy'] }) }));
const a = { id: 'account-a', firstName: 'OwnerA', lastName: 'Test', email: 'a@example.test' };
const b = { ...a, id: 'account-b', firstName: 'OwnerB', email: 'b@example.test' };
const item = name => ({ id: 'a'.repeat(24), name, version: 1, classification: {}, capabilities: { editDraft: true }, location: {}, pickup: {}, photoPreview: { availability: 'disabled', images: [] } });
const reply = (data, status = 200) => ({ ok: status < 400, status, headers: { get: () => 'application/json' }, json: async () => data });
function Switch() { const auth = useAppContext(); return <button onClick={() => auth.login({ email: b.email, password: 'synthetic' })}>Switch account</button>; }
test.each([200, 401, 503])('actual AuthProvider/router discards delayed A %s after B login', async status => {
  let current = a, release;
  global.fetch = jest.fn((url, options) => {
    if (url === '/api/me') return Promise.resolve(reply({ user: current }));
    if (url === '/api/auth/login') { current = b; return Promise.resolve(reply({})); }
    if (url === '/api/me/items') return current === a ? new Promise(resolve => { release = resolve; }) : Promise.resolve(reply({ items: [item('Private B')], nextCursor: null }));
    throw new Error('Unexpected route');
  });
  render(<MemoryRouter initialEntries={['/app/listings']} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}><AuthProvider><App /><Switch /></AuthProvider></MemoryRouter>);
  await screen.findByText('Signed in as OwnerA');
  await waitFor(() => expect(typeof release).toBe('function'));
  fireEvent.click(screen.getByText('Switch account'));
  await screen.findByRole('link', { name: 'Private B', exact: true });
  await act(async () => release(reply(status === 200 ? { items: [item('Private A')], nextCursor: null } : { error: { code: 'SESSION_EXPIRED', message: 'Old account' } }, status)));
  expect(screen.getByText('Signed in as OwnerB')).toBeVisible();
  expect(screen.getByRole('link', { name: 'Private B', exact: true })).toBeVisible();
  expect(screen.queryByText('Private A', { exact: true })).not.toBeInTheDocument();
});
