import React, { useEffect, useState } from 'react';
import { useNavigate, useLocation, Link } from 'react-router-dom';
import { useAppContext } from '../../context/AuthContext';
import './LoginPage.css';
import { authDestination } from '../authDestination';
import AccountServiceNotice from '../AccountServiceNotice';

export default function LoginPage() {
  const { login, isLoggedIn, sessionMessage, status } = useAppContext();
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const requested = location.state?.from;
  const destination = authDestination(requested);
  useEffect(() => { if (isLoggedIn) navigate(destination, { replace: true }); }, [isLoggedIn, navigate, destination]);
  const submit = async event => {
    event.preventDefault();
    setError('');
    setBusy(true);
    try { await login({ email, password }); }
    catch (failure) { setError(failure.message); }
    finally { setBusy(false); setPassword(''); }
  };
  return <main className="container mt-5"><div className="row justify-content-center"><div className="col-md-6 col-lg-4">
    <form className="login-card p-4 border rounded" onSubmit={submit}>
      <h1 className="h2 text-center mb-4">Login</h1>
      <p>One account to give away items and request pickups. Browsing is always open to everyone.</p>
      <AccountServiceNotice />
      {sessionMessage && <p role="status">{sessionMessage}</p>}
      {status === 'loading' && <p role="status">Checking your session…</p>}
      <label htmlFor="email" className="form-label">Email</label>
      <input id="email" type="email" autoComplete="username" required maxLength={254} className="form-control mb-3" value={email} onChange={event => setEmail(event.target.value)} />
      <label htmlFor="password" className="form-label">Password</label>
      <input id="password" type="password" autoComplete="current-password" required className="form-control mb-3" value={password} onChange={event => setPassword(event.target.value)} />
      {error && <p className="text-danger" role="alert">{error}</p>}
      <button className="btn btn-primary w-100" disabled={busy || status === 'loading'}>{busy ? 'Logging in…' : 'Login'}</button>
      <p className="mt-4">New here? <Link to="/app/register" state={{ from: requested }}>Register Here</Link></p>
    </form>
  </div></div></main>;
}
