import React, { useEffect, useState } from 'react';
import { useNavigate, useLocation, Link } from 'react-router-dom';
import { useAppContext } from '../../context/AuthContext';
import './LoginPage.css';
import { authDestination } from '../authDestination';
import AccountServiceNotice from '../AccountServiceNotice';
import { useUnsavedForm } from '../../forms/UnsavedChanges';
import useFormErrors, { emailError } from '../../forms/useFormErrors';
import { Feedback, PageHeader, Surface } from '../../design-system/primitives';

export default function LoginPage() {
  const { login, isLoggedIn, sessionMessage, status } = useAppContext();
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  useUnsavedForm({ email, password }, { email: '', password: '' });
  const [busy, setBusy] = useState(false);
  const validation = useFormErrors(busy);
  const { errors, error } = validation;
  const requested = location.state?.from;
  const destination = authDestination(requested);
  useEffect(() => { if (isLoggedIn) navigate(destination, { replace: true }); }, [isLoggedIn, navigate, destination]);
  const submit = async event => {
    event.preventDefault();
    if (busy) return;
    validation.reset();
    const issues = {};
    const invalidEmail = emailError(email, validation.formRef.current.elements.email);
    if (invalidEmail) issues.email = invalidEmail;
    if (!password) issues.password = 'Enter your password.';
    if (Object.keys(issues).length) { validation.show(issues); return; }
    setBusy(true);
    try { await login({ email, password }); }
    catch (failure) { validation.failure(failure, ['email', 'password']); }
    finally { setBusy(false); setPassword(''); }
  };
  return <main className="ui-page ui-page--form">
    <Surface as="form" ref={validation.formRef} noValidate aria-busy={busy} className="login-card" onSubmit={submit}>
      <PageHeader title="Login" description="One account to give and find." />
      <AccountServiceNotice />
      {sessionMessage && <Feedback>{sessionMessage}</Feedback>}
      {status === 'loading' && <Feedback>Checking your session…</Feedback>}
      <div className="ui-field">
      <label htmlFor="email" className="form-label">Email</label>
      <input name="email" disabled={busy} {...validation.fieldProps('email')} id="email" type="email" autoComplete="username" required maxLength={254} value={email} onChange={event => { setEmail(event.target.value); validation.clear('email'); }} />
      {errors.email && <p id="email-error" className="ui-field-error">{errors.email}</p>}
      </div><div className="ui-field">
      <label htmlFor="password" className="form-label">Password</label>
      <input name="password" disabled={busy} {...validation.fieldProps('password')} id="password" type="password" autoComplete="current-password" required value={password} onChange={event => { setPassword(event.target.value); validation.clear('password'); }} />
      {errors.password && <p id="password-error" className="ui-field-error">{errors.password}</p>}
      </div>
      {error && <Feedback ref={validation.summaryRef} tabIndex={-1} error>{error}</Feedback>}
      <button className="ui-button ui-button--block" disabled={busy || status === 'loading'}>{busy ? 'Logging in…' : 'Login'}</button>
      <p className="login-register">New here? <Link to="/app/register" state={{ from: requested }}>Register Here</Link></p>
    </Surface>
  </main>;
}
