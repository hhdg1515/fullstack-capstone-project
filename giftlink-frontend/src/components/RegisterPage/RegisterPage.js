import React, { useEffect, useState } from 'react';
import { useNavigate, Link, useLocation } from 'react-router-dom';
import { useAppContext } from '../../context/AuthContext';
import './RegisterPage.css';
import { authDestination } from '../authDestination';
import AccountServiceNotice from '../AccountServiceNotice';

export default function RegisterPage() {
  const { register, isLoggedIn, status } = useAppContext();
  const navigate = useNavigate();
  const requested = useLocation().state?.from;
  const destination = authDestination(requested);
  const [details, setDetails] = useState({ firstName: '', lastName: '', email: '', password: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (isLoggedIn) navigate(destination, { replace: true }); }, [isLoggedIn, navigate, destination]);
  const submit = async event => {
    event.preventDefault();
    setError('');
    setBusy(true);
    try { await register(details); }
    catch (failure) {
      setError(failure.fields?.map(field => `${field.field}: ${field.message}`).join('. ') || failure.message);
    } finally { setBusy(false); setDetails(previous => ({ ...previous, password: '' })); }
  };
  return <main className="container mt-5"><div className="row justify-content-center"><div className="col-md-6 col-lg-4">
    <form className="register-card p-4 border rounded" onSubmit={submit}>
      <h1 className="h2 text-center mb-4">Register</h1>
      <p>Give and find with the same account. You can do both at any time.</p>
      <AccountServiceNotice />
      {['firstName', 'lastName', 'email', 'password'].map(field => <div className="mb-3" key={field}>
        <label htmlFor={field} className="form-label">{{ firstName: 'First name', lastName: 'Last name', email: 'Email', password: 'Password' }[field]}</label>
        <input id={field} type={field === 'password' ? 'password' : field === 'email' ? 'email' : 'text'}
          autoComplete={{ firstName: 'given-name', lastName: 'family-name', email: 'username', password: 'new-password' }[field]}
          required minLength={field === 'password' ? 12 : undefined} maxLength={field.includes('Name') ? 80 : field === 'email' ? 254 : undefined}
          className="form-control" value={details[field]} onChange={event => setDetails({ ...details, [field]: event.target.value })} />
      </div>)}
      <p>Use a password of at least 12 characters, at most 72 UTF-8 bytes.</p>
      {error && <p className="text-danger" role="alert">{error}</p>}
      <button className="btn btn-primary w-100" disabled={busy || status === 'loading'}>{busy ? 'Registering…' : 'Register'}</button>
      <p className="mt-4">Already a member? <Link to="/app/login" state={{ from: requested }}>Login</Link></p>
    </form>
  </div></div></main>;
}
