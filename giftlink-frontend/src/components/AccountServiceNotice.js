import React from 'react';
import { useAppContext } from '../context/AuthContext';

export default function AccountServiceNotice() {
  const { status, error, refreshSession } = useAppContext();
  if (status !== 'error') return null;
  return <section className="alert alert-warning" role="alert" aria-label="Account service unavailable">
    <h2 className="h5">Account service is temporarily unavailable</h2>
    <p>{error}</p>
    <p>You can explore the site. Registration, login and private pages need a connection to the service.</p>
    <button type="button" className="btn btn-outline-secondary" onClick={() => refreshSession().catch(() => {})}>Retry connection</button>
  </section>;
}
