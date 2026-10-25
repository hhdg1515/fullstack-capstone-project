import React, { useState } from 'react';
import { useAppContext } from '../../context/AuthContext';
import './Profile.css';
import { useUnsavedForm } from '../../forms/UnsavedChanges';
import useFormErrors, { nameErrors } from '../../forms/useFormErrors';

export default function Profile() {
  const { user, updateProfile } = useAppContext();
  const [details, setDetails] = useState({ firstName: user.firstName, lastName: user.lastName });
  const [busy, setBusy] = useState(false);
  const validation = useFormErrors(busy);
  const { errors, error } = validation;
  const [message, setMessage] = useState('');
  const guard = useUnsavedForm(details, { firstName: user.firstName, lastName: user.lastName });
  const submit = async event => {
    event.preventDefault(); if (busy) return; validation.reset(); setMessage('');
    const issues = nameErrors(details);
    if (Object.keys(issues).length) { validation.show(issues); return; }
    setBusy(true);
    try {
      const saved = await updateProfile(details);
      setDetails({ firstName: saved.firstName, lastName: saved.lastName });
      guard.markSaved(); setMessage('Account updated.');
    }
    catch (failure) { validation.failure(failure, ['firstName', 'lastName']); }
    finally { setBusy(false); }
  };
  return <main className="profile-container"><h1>Your account</h1>
    <p><b>Email:</b> {user.email}</p>
    <form ref={validation.formRef} noValidate onSubmit={submit} aria-busy={busy}>
      {['firstName', 'lastName'].map(field => <div className="profile-field" key={field}><label htmlFor={field}>
        {field === 'firstName' ? 'First name' : 'Last name'}</label>
        <input type="text" name={field} disabled={busy} {...validation.fieldProps(field)} id={field} required maxLength={80} value={details[field]} onChange={event => { setDetails({ ...details, [field]: event.target.value }); validation.clear(field); }} />
        {errors[field] && <span id={`${field}-error`} className="profile-field-error">{errors[field]}</span>}
      </div>)}
      {error && <p ref={validation.summaryRef} tabIndex={-1} role="alert">{error}</p>}
      {message && <p role="status">{message}</p>}
      <button disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
    </form>
  </main>;
}
