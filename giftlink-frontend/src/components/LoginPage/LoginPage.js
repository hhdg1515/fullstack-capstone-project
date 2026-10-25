import React, { useEffect, useState } from 'react';
import { useNavigate, useLocation, Link } from 'react-router-dom';
import { useAppContext } from '../../context/AuthContext';
import './LoginPage.css';
import { authDestination } from '../authDestination';
import AccountServiceNotice from '../AccountServiceNotice';
import { useUnsavedForm } from '../../forms/UnsavedChanges';
import useFormErrors, { emailError } from '../../forms/useFormErrors';

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
  return <main className="container mt-5"><div className="row justify-content-center"><div className="col-md-6 col-lg-4">
    <form ref={validation.formRef} noValidate aria-busy={busy} className="login-card p-4 border rounded" onSubmit={submit}>
      <h1 className="h2 text-center mb-4">Login</h1>
      <p>One account to give away items and request pickups. Browsing is always open to everyone.</p>
      <AccountServiceNotice />
      {sessionMessage && <p role="status">{sessionMessage}</p>}
      {status === 'loading' && <p role="status">Checking your session…</p>}
      <label htmlFor="email" className="form-label">Email</label>
      <input name="email" disabled={busy} {...validation.fieldProps('email')} id="email" type="email" autoComplete="username" required maxLength={254} className="form-control mb-3" value={email} onChange={event => { setEmail(event.target.value); validation.clear('email'); }} />
      {errors.email && <p id="email-error" className="text-danger">{errors.email}</p>}
      <label htmlFor="password" className="form-label">Password</label>
      <input name="password" disabled={busy} {...validation.fieldProps('password')} id="password" type="password" autoComplete="current-password" required className="form-control mb-3" value={password} onChange={event => { setPassword(event.target.value); validation.clear('password'); }} />
      {errors.password && <p id="password-error" className="text-danger">{errors.password}</p>}
      {error && <p ref={validation.summaryRef} tabIndex={-1} className="text-danger" role="alert">{error}</p>}
      <button className="btn btn-primary w-100" disabled={busy || status === 'loading'}>{busy ? 'Logging in…' : 'Login'}</button>
      <p className="mt-4">New here? <Link to="/app/register" state={{ from: requested }}>Register Here</Link></p>
    </form>
  </div></div></main>;
}
