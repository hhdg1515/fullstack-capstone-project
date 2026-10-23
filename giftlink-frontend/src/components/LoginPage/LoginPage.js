import React, { useEffect, useState } from 'react';
import { useNavigate, useLocation, Link } from 'react-router-dom';
import { useAppContext } from '../../context/AuthContext';
import './LoginPage.css';

export default function LoginPage() {
  const { login, isLoggedIn, sessionMessage, status } = useAppContext();
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const requested = location.state?.from;
  const destination = typeof requested === 'string' && requested.startsWith('/app/') &&
    !['/app/login', '/app/register'].includes(requested) ? requested : '/app';
  useEffect(() => { if (isLoggedIn) navigate(destination, { replace: true }); }, [isLoggedIn, navigate, destination]);
  const submit = async event => {
    event.preventDefault();
    setError('');
    setBusy(true);
    try { await login({ email, password }); }
    catch (failure) { setError(failure.message); }
    finally { setBusy(false); setPassword(''); }
  };
  return <div className="container mt-5"><div className="row justify-content-center"><div className="col-md-6 col-lg-4">
    <form className="login-card p-4 border rounded" onSubmit={submit}>
      <h2 className="text-center mb-4">Login</h2>
      {sessionMessage && <p role="status">{sessionMessage}</p>}
      {status === 'loading' && <p role="status">Checking your session…</p>}
      <label htmlFor="email" className="form-label">Email</label>
      <input id="email" type="email" autoComplete="username" required maxLength={254} className="form-control mb-3" value={email} onChange={event => setEmail(event.target.value)} />
      <label htmlFor="password" className="form-label">Password</label>
      <input id="password" type="password" autoComplete="current-password" required className="form-control mb-3" value={password} onChange={event => setPassword(event.target.value)} />
      {error && <p className="text-danger" role="alert">{error}</p>}
      <button className="btn btn-primary w-100" disabled={busy || status === 'loading'}>{busy ? 'Logging in…' : 'Login'}</button>
      <p className="mt-4">New here? <Link to="/app/register">Register Here</Link></p>
    </form>
  </div></div></div>;
}
