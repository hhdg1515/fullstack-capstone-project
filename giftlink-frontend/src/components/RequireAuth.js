import React from 'react';
import { Link, Navigate, useLocation } from 'react-router-dom';
import { useAppContext } from '../context/AuthContext';
import AccountServiceNotice from './AccountServiceNotice';

export default function RequireAuth({ children }) {
  const { status } = useAppContext();
  const location = useLocation();
  if (status === 'loading') return <p role="status">Checking your session…</p>;
  if (status === 'error') return <main className="plans-page"><h1>Unable to open this private page</h1><AccountServiceNotice />
    <p><Link to="/">Back to home</Link></p>
    <Link to="/app/login" state={{ from: location.pathname + location.search + location.hash }}>Login or register</Link>
  </main>;
  if (status !== 'authenticated') return <Navigate to="/app/login" replace state={{ from: location.pathname + location.search + location.hash }} />;
  return children;
}
