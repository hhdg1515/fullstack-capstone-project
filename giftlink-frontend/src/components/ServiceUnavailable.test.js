import React from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import App from '../App';
import { AuthProvider } from '../context/AuthContext';

const html = () => ({ status: 200, ok: true, headers: new Headers({ 'content-type': 'text/html' }), json: jest.fn() });
const reply = (data, status = 200) => ({ status, ok: status < 400, json: async () => data });
const user = { id: 'one', firstName: 'Neighbor', lastName: 'Member', email: 'neighbor@example.test' };
const gift = { id: 'legacy-one', name: 'Useful chair', description: 'A real gift from the service.', category: 'Living', condition: 'New' };
const click = element => act(async () => { fireEvent.click(element); });
function mount(path) {
  return render(<MemoryRouter initialEntries={[path]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}><AuthProvider><App /></AuthProvider></MemoryRouter>);
}
beforeEach(() => {
  global.fetch = jest.fn(async () => html());
  jest.spyOn(window, 'scrollTo').mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

test('frontend-only hosting keeps the homepage usable and Account opens login with an honest service notice', async () => {
  mount('/'); expect(screen.getByRole('link', { name: 'Start Giving' })).toBeInTheDocument();
  await screen.findByText('Account service is temporarily unavailable. You can still explore the site.');
  await click(within(screen.getByRole('navigation', { name: 'Primary' })).getByRole('link', { name: 'Account' }));
  expect(await screen.findByRole('heading', { name: 'Login' })).toBeInTheDocument();
  expect(screen.getByRole('alert', { name: 'Account service unavailable' })).toHaveTextContent('temporarily unavailable');
  expect(screen.queryByText(/Cannot read|Unexpected token/)).not.toBeInTheDocument();
});
test('protected pages show recoverable service failure instead of treating it as login or exposing private UI', async () => {
  mount('/app/plans'); expect(await screen.findByRole('heading', { name: 'Unable to open this private page' })).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Back to home' })).toHaveAttribute('href', '/');
  fetch.mockResolvedValue(reply({ error: { code: 'UNAUTHENTICATED' } }, 401));
  await click(screen.getByRole('button', { name: 'Retry connection' }));
  expect(await screen.findByRole('heading', { name: 'Login' })).toBeInTheDocument();
  expect(screen.queryByRole('heading', { name: 'My move-out plans' })).not.toBeInTheDocument();
});
test.each(['/app/login', '/app/register'])('%s never pretends that HTML responses created an account or session', async path => {
  mount(path); await screen.findByRole('alert', { name: 'Account service unavailable' });
  const label = path.endsWith('register') ? 'Register' : 'Login';
  for (const [field, value] of [['Email', user.email], ['Password', 'long-test-password'], ...(label === 'Register' ? [['First name', 'Local'], ['Last name', 'Test']] : [])]) {
    fireEvent.change(screen.getByLabelText(field), { target: { value } });
  }
  await act(async () => { fireEvent.submit(screen.getByRole('button', { name: label, exact: true }).closest('form')); });
  await waitFor(() => expect(fetch.mock.calls.some(([, options]) => options.method === 'POST')).toBe(true));
  expect(screen.queryByText(/Signed in as/)).not.toBeInTheDocument();
  expect(screen.getByRole('heading', { name: label })).toBeInTheDocument();
  expect(screen.queryByText(/Cannot read|Unexpected token/)).not.toBeInTheDocument();
});
test('login recovers without a frontend mode switch and confirms the backend user before displaying an account', async () => {
  mount('/app/profile'); await screen.findByRole('button', { name: 'Retry connection' });
  await click(screen.getByRole('link', { name: 'Login or register' }));
  await screen.findByRole('heading', { name: 'Login' });
  fetch.mockImplementation(async (url, options) => reply({ user }));
  fireEvent.change(screen.getByLabelText('Email'), { target: { value: user.email } });
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'long-real-password' } });
  await act(async () => { fireEvent.submit(screen.getByRole('button', { name: 'Login', exact: true }).closest('form')); });
  expect(await screen.findByRole('heading', { name: 'Your account' })).toBeInTheDocument();
  expect(screen.getByText(user.email)).toBeInTheDocument();
  expect(fetch.mock.calls.at(-1)[0]).toMatch(/\/api\/me$/);
});
test('legacy gift collection has loading/error/retry and empty states with no JSON exception logs', async () => {
  const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
  mount('/app'); expect(screen.getByText('Loading gifts…')).toBeInTheDocument();
  await screen.findByRole('button', { name: 'Retry gifts' });
  fetch.mockResolvedValue(reply([])); await click(screen.getByRole('button', { name: 'Retry gifts' }));
  expect(await screen.findByText('No gifts are available yet.')).toBeInTheDocument();
  expect(consoleError).not.toHaveBeenCalled();
});
test.each(['/app', '/app/search', '/app/product/legacy-one'])('legacy %s retries against a recovering real JSON API', async path => {
  mount(path); const label = path === '/app' ? 'Retry gifts' : path === '/app/search' ? 'Retry search' : 'Retry gift';
  await screen.findByRole('button', { name: label });
  fetch.mockImplementation(async url => reply(url.endsWith('/api/gifts/legacy-one') ? gift : [gift]));
  await click(screen.getByRole('button', { name: label })); expect(await screen.findByText(gift.name)).toBeInTheDocument();
});
test('legacy search retries the submitted filters rather than replacing them with the unfiltered collection', async () => {
  mount('/app/search'); await screen.findByRole('button', { name: 'Retry search' });
  fireEvent.change(screen.getByPlaceholderText('Search for items...'), { target: { value: 'chair' } });
  await click(screen.getByRole('button', { name: 'Search', exact: true })); await screen.findByRole('button', { name: 'Retry search' });
  fetch.mockResolvedValue(reply([gift])); await click(screen.getByRole('button', { name: 'Retry search' }));
  await screen.findByText(gift.name); expect(fetch.mock.calls.at(-1)[0]).toMatch(/\/api\/search\?name=chair&/);
});
test('discovery handles the same missing-backend response through its existing retry UI', async () => {
  mount('/app/items'); await screen.findByRole('button', { name: 'Retry region options' });
  expect(screen.getByText(/Region options are unavailable/)).toBeInTheDocument();
  expect(screen.queryByText(/0 available|No available items/)).not.toBeInTheDocument();
  expect(fetch.mock.calls.some(([url]) => url.includes('/api/items?'))).toBe(false);
  expect(screen.queryByText(/Cannot read|Unexpected token/)).not.toBeInTheDocument();
});
