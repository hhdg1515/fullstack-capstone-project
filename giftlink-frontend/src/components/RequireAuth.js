import React from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAppContext } from '../context/AuthContext';

export default function RequireAuth({ children }) {
  const { status, error, refreshSession } = useAppContext();
  const location = useLocation();
  if (status === 'loading') return <p role="status">Checking your session…</p>;
  if (status === 'error') return <div role="alert">{error} <button onClick={() => refreshSession().catch(() => {})}>Retry</button></div>;
  if (status !== 'authenticated') return <Navigate to="/app/login" replace state={{ from: location.pathname }} />;
  return children;
}
