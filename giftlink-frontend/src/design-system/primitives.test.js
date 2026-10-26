import React, { createRef } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { Feedback, PageHeader, Surface } from './primitives';

test('page header keeps the task heading and native action accessible', () => {
  render(<PageHeader title="My plans" description="Choose a plan." action={<a href="/app/plans/new">Create a plan</a>} />);
  expect(screen.getByRole('heading', { level: 1, name: 'My plans' })).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Create a plan' })).toHaveAttribute('href', '/app/plans/new');
});

test('surface preserves form submission, form ref, busy state and native controls', () => {
  const ref = createRef(), submit = jest.fn(event => event.preventDefault());
  render(<Surface as="form" ref={ref} onSubmit={submit} aria-label="Login" aria-busy="true">
    <label htmlFor="email">Email</label><input id="email" name="email" /><button>Login</button>
  </Surface>);
  fireEvent.submit(screen.getByRole('form', { name: 'Login' }));
  expect(submit).toHaveBeenCalledTimes(1);
  expect(ref.current.elements.email).toBe(screen.getByLabelText('Email'));
  expect(ref.current).toHaveAttribute('aria-busy', 'true');
});

test('feedback distinguishes live status from an actionable focused error', () => {
  const ref = createRef();
  const { rerender } = render(<Feedback>Loading your plans…</Feedback>);
  expect(screen.getByRole('status')).toHaveTextContent('Loading your plans…');
  rerender(<Feedback ref={ref} error tabIndex={-1}>Could not load plans. <button>Retry</button></Feedback>);
  ref.current.focus();
  expect(screen.getByRole('alert')).toHaveFocus();
  expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  expect(screen.queryByRole('status')).not.toBeInTheDocument();
});
