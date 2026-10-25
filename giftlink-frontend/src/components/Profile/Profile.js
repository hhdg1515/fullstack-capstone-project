import React, { useEffect, useState } from 'react';
import { useAppContext } from '../../context/AuthContext';
import './Profile.css';
import { useUnsavedForm } from '../../forms/UnsavedChanges';

export default function Profile() {
  const { user, updateProfile } = useAppContext();
  const [details, setDetails] = useState({ firstName: user.firstName, lastName: user.lastName });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const guard = useUnsavedForm(details, { firstName: user.firstName, lastName: user.lastName });
  useEffect(() => { if (!guard.dirty) setDetails({ firstName: user.firstName, lastName: user.lastName }); }, [user.firstName, user.lastName, guard.dirty]);
  const submit = async event => {
    event.preventDefault(); setBusy(true); setError(''); setMessage('');
    try { await updateProfile(details); guard.markSaved(); setMessage('Account updated.'); }
    catch (failure) { setError(failure.fields?.map(field => `${field.field}: ${field.message}`).join('. ') || failure.message); }
    finally { setBusy(false); }
  };
  return <main className="profile-container"><h1>Your account</h1>
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
  </main>;
}
