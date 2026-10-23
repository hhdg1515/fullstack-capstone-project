import React, { useEffect, useState } from 'react';
import { useAppContext } from '../../context/AuthContext';
import './Profile.css';

export default function Profile() {
  const { user, updateProfile } = useAppContext();
  const [details, setDetails] = useState({ firstName: user.firstName, lastName: user.lastName });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  useEffect(() => { setDetails({ firstName: user.firstName, lastName: user.lastName }); }, [user.firstName, user.lastName]);
  const submit = async event => {
    event.preventDefault(); setBusy(true); setError(''); setMessage('');
    try { await updateProfile(details); setMessage('Account updated.'); }
    catch (failure) { setError(failure.fields?.map(field => `${field.field}: ${field.message}`).join('. ') || failure.message); }
    finally { setBusy(false); }
  };
  return <div className="profile-container"><h1>Your account</h1>
    <p><b>Email:</b> {user.email}</p>
    <form onSubmit={submit}>
      {['firstName', 'lastName'].map(field => <label key={field} htmlFor={field}>
        {field === 'firstName' ? 'First name' : 'Last name'}
        <input id={field} required maxLength={80} value={details[field]} onChange={event => setDetails({ ...details, [field]: event.target.value })} />
      </label>)}
      {error && <p role="alert">{error}</p>}
      {message && <p role="status">{message}</p>}
      <button disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
    </form>
  </div>;
}
