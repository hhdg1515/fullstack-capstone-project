import React from 'react';
import { render, screen, act, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
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
  await screen.findByRole('button', { name: 'Logout' });
  await waitFor(() => expect(typeof release).toBe('function'));
  fireEvent.click(screen.getByText('Switch account'));
  await screen.findByRole('link', { name: 'Private B', exact: true });
  await act(async () => release(reply(status === 200 ? { items: [item('Private A')], nextCursor: null } : { error: { code: 'SESSION_EXPIRED', message: 'Old account' } }, status)));
  expect(screen.getByRole('link', { name: 'Private B', exact: true })).toBeVisible();
  expect(screen.queryByText('Private A', { exact: true })).not.toBeInTheDocument();
});


function CurrentRoute() { const location = useLocation(); return <output aria-label="Private route">{location.pathname}</output>; }
test.each([200, 401, 503])('closed owner details discard late A %s after B login', async status => {
  let current = a, release; const path = '/api/me/items/' + 'a'.repeat(24);
  global.fetch = jest.fn((url) => {
    if (url === '/api/me') return Promise.resolve(reply({ user: current }));
    if (url === '/api/auth/login') { current = b; return Promise.resolve(reply({})); }
    if (url === path) return current === a ? new Promise(resolve => { release = resolve; }) : Promise.resolve(reply({ error: { code: 'ITEM_NOT_FOUND', message: 'Not owned by B' } }, 404));
    throw new Error('Unexpected route');
  });
  render(<MemoryRouter initialEntries={['/app/listings/' + 'a'.repeat(24)]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}><AuthProvider><App /><Switch /></AuthProvider></MemoryRouter>);
  await waitFor(() => expect(typeof release).toBe('function')); fireEvent.click(screen.getByText('Switch account'));
  await screen.findByText('Not owned by B');
  const closed = { ...item('Private closed A'), status: 'cleared', description: 'Private closed description', capabilities: { editDraft: false, reopenDraft: true } };
  await act(async () => release(reply(status === 200 ? { item: closed } : { error: { code: 'SESSION_EXPIRED', message: 'Old account' } }, status)));
  expect(screen.getByText('Not owned by B')).toBeVisible(); expect(screen.queryByText(/Private closed/)).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Logout' })).toBeVisible(); expect(screen.queryByRole('button', { name: 'Relist as draft' })).not.toBeInTheDocument();
});
test.each([200, 401, 503])('a late A relist result %s cannot navigate or overwrite B', async status => {
  let current = a, release; const id = 'a'.repeat(24), closed = { ...item('Private closed A'), status: 'cleared', capabilities: { editDraft: false, reopenDraft: true } };
  global.fetch = jest.fn((url) => {
    if (url === '/api/me') return Promise.resolve(reply({ user: current }));
    if (url === '/api/auth/login') { current = b; return Promise.resolve(reply({})); }
    if (url === '/api/me/items/' + id) return Promise.resolve(current === a ? reply({ item: closed }) : reply({ error: { code: 'ITEM_NOT_FOUND', message: 'Not owned by B' } }, 404));
    if (url === '/api/items/' + id + '/actions') return new Promise(resolve => { release = resolve; });
    throw new Error('Unexpected route');
  });
  const confirm = jest.spyOn(window, 'confirm').mockReturnValue(true);
  try {
    render(<MemoryRouter initialEntries={['/app/listings/' + id]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}><AuthProvider><App /><Switch /><CurrentRoute /></AuthProvider></MemoryRouter>);
    fireEvent.click(await screen.findByRole('button', { name: 'Relist as draft' })); await waitFor(() => expect(typeof release).toBe('function'));
    fireEvent.click(screen.getByText('Switch account')); await screen.findByText('Not owned by B');
    await act(async () => release(reply(status === 200 ? { item: { ...closed, status: 'draft', version: 2, capabilities: { editDraft: true } } } : { error: { code: 'SESSION_EXPIRED', message: 'Old account' } }, status)));
    expect(screen.getByLabelText('Private route')).toHaveTextContent('/app/listings/' + id);
    expect(screen.queryByRole('heading', { name: 'Edit Listing' })).not.toBeInTheDocument(); expect(screen.queryByText('Private closed A')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Logout' })).toBeVisible();
  } finally { confirm.mockRestore(); }
});
