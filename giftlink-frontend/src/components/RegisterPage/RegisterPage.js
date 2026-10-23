import React, { useEffect, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAppContext } from '../../context/AuthContext';
import './RegisterPage.css';

export default function RegisterPage() {
  const { register, isLoggedIn, status } = useAppContext();
  const navigate = useNavigate();
  const [details, setDetails] = useState({ firstName: '', lastName: '', email: '', password: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (isLoggedIn) navigate('/app', { replace: true }); }, [isLoggedIn, navigate]);
  const submit = async event => {
    event.preventDefault();
    setError('');
    setBusy(true);
    try { await register(details); }
    catch (failure) {
      setError(failure.fields?.map(field => `${field.field}: ${field.message}`).join('. ') || failure.message);
    } finally { setBusy(false); setDetails(previous => ({ ...previous, password: '' })); }
  };
  return <div className="container mt-5"><div className="row justify-content-center"><div className="col-md-6 col-lg-4">
    <form className="register-card p-4 border rounded" onSubmit={submit}>
      <h2 className="text-center mb-4">Register</h2>
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
      <p className="mt-4">Already a member? <Link to="/app/login">Login</Link></p>
    </form>
  </div></div></div>;
}
