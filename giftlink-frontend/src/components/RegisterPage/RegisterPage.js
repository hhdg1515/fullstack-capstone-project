import React, { useEffect, useState } from 'react';
import { useNavigate, Link, useLocation } from 'react-router-dom';
import { useAppContext } from '../../context/AuthContext';
import './RegisterPage.css';
import { authDestination } from '../authDestination';
import AccountServiceNotice from '../AccountServiceNotice';
import { useUnsavedForm } from '../../forms/UnsavedChanges';
import useFormErrors, { nameErrors, emailError } from '../../forms/useFormErrors';

export default function RegisterPage() {
  const { register, isLoggedIn, status } = useAppContext();
  const navigate = useNavigate();
  const requested = useLocation().state?.from;
  const destination = authDestination(requested);
  const [details, setDetails] = useState({ firstName: '', lastName: '', email: '', password: '' });
  useUnsavedForm(details, { firstName: '', lastName: '', email: '', password: '' });
  const [busy, setBusy] = useState(false);
  const validation = useFormErrors(busy);
  const { errors, error } = validation;
  useEffect(() => { if (isLoggedIn) navigate(destination, { replace: true }); }, [isLoggedIn, navigate, destination]);
  const submit = async event => {
    event.preventDefault();
    if (busy) return;
    validation.reset();
    const issues = nameErrors(details);
    const invalidEmail = emailError(details.email, validation.formRef.current.elements.email);
    if (invalidEmail) issues.email = invalidEmail;
    if (Array.from(details.password).length < 12 || new Blob([details.password]).size > 72) issues.password = 'Use at least 12 characters and at most 72 UTF-8 bytes.';
    if (Object.keys(issues).length) { validation.show(issues); return; }
    setBusy(true);
    try { await register(details); }
    catch (failure) {
      validation.failure(failure, ['firstName', 'lastName', 'email', 'password']);
    } finally { setBusy(false); setDetails(previous => ({ ...previous, password: '' })); }
  };
  return <main className="container mt-5"><div className="row justify-content-center"><div className="col-md-6 col-lg-4">
    <form ref={validation.formRef} noValidate aria-busy={busy} className="register-card p-4 border rounded" onSubmit={submit}>
      <h1 className="h2 text-center mb-4">Register</h1>
      <p>Give and find with the same account. You can do both at any time.</p>
      <AccountServiceNotice />
      {['firstName', 'lastName', 'email', 'password'].map(field => <div className="mb-3" key={field}>
        <label htmlFor={field} className="form-label">{{ firstName: 'First name', lastName: 'Last name', email: 'Email', password: 'Password' }[field]}</label>
        <input name={field} disabled={busy} {...validation.fieldProps(field, field === 'password' ? 'password-help' : undefined)} id={field} type={field === 'password' ? 'password' : field === 'email' ? 'email' : 'text'}
          autoComplete={{ firstName: 'given-name', lastName: 'family-name', email: 'username', password: 'new-password' }[field]}
          required minLength={field === 'password' ? 12 : undefined} maxLength={field.includes('Name') ? 80 : field === 'email' ? 254 : undefined}
          className="form-control" value={details[field]} onChange={event => { setDetails({ ...details, [field]: event.target.value }); validation.clear(field); }} />
        {errors[field] && <p id={`${field}-error`} className="text-danger">{errors[field]}</p>}
      </div>)}
      <p id="password-help">Use a password of at least 12 characters, at most 72 UTF-8 bytes.</p>
      {error && <p ref={validation.summaryRef} tabIndex={-1} className="text-danger" role="alert">{error}</p>}
      <button className="btn btn-primary w-100" disabled={busy || status === 'loading'}>{busy ? 'Registering…' : 'Register'}</button>
      <p className="mt-4">Already a member? <Link to="/app/login" state={{ from: requested }}>Login</Link></p>
    </form>
  </div></div></main>;
}
