import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { apiRequest } from '../api/client';

const AppContext = createContext();

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [status, setStatus] = useState('loading');
  const [error, setError] = useState('');
  const [sessionMessage, setSessionMessage] = useState('');
  const revision = useRef(0);
  const hasSession = useRef(false);
  const invalidate = useCallback(() => { ++revision.current; }, []);

  const refreshSession = useCallback(async () => {
    const current = ++revision.current;
    if (!hasSession.current) setStatus('loading');
    setError('');
    try {
      const data = await apiRequest('/api/me', { notifyUnauthorized: false });
      if (current !== revision.current) return;
      setUser(data.user);
      hasSession.current = true;
      setStatus('authenticated');
      setSessionMessage('');
      return data.user;
    } catch (failure) {
      if (current !== revision.current) return;
      setUser(null);
      hasSession.current = false;
      if (failure.status === 401) {
        setStatus('anonymous');
        if (failure.code === 'SESSION_EXPIRED') setSessionMessage('Your session ended. Please log in again.');
        return null;
      }
      setStatus('error');
      setError(failure.message);
      throw failure;
    }
  }, []);

  useEffect(() => {
    // One-time migration: no browser-stored identity or bearer token is trusted.
    try {
      for (const key of ['auth-token', 'name', 'email']) sessionStorage.removeItem(key);
    } catch { /* Legacy storage may be blocked; server sessions do not need it. */ }
    refreshSession().catch(() => {});
    const unauthorized = () => {
      invalidate();
      setUser(null);
      hasSession.current = false;
      setStatus('anonymous');
      setSessionMessage('Your session ended. Please log in again.');
    };
    window.addEventListener('giftlink:unauthorized', unauthorized);
    const checkSession = () => { refreshSession().catch(() => {}); };
    window.addEventListener('focus', checkSession);
    return () => {
      invalidate();
      window.removeEventListener('giftlink:unauthorized', unauthorized);
      window.removeEventListener('focus', checkSession);
    };
  }, [refreshSession, invalidate]);

  const authenticate = async (path, details) => {
    ++revision.current;
    await apiRequest(path, { method: 'POST', body: details, notifyUnauthorized: false });
    // Confirm the browser accepted the cookie instead of trusting the form response.
    const confirmed = await refreshSession();
    if (!confirmed) throw new Error('Could not confirm your session. Check cookies and try again.');
  };
  const login = details => authenticate('/api/auth/login', details);
  const register = details => authenticate('/api/auth/register', details);
  const logout = async () => {
    ++revision.current;
    await apiRequest('/api/auth/logout', { method: 'POST', body: {}, notifyUnauthorized: false });
    ++revision.current;
    setUser(null);
    hasSession.current = false;
    setStatus('anonymous');
    setError('');
    setSessionMessage('');
  };
  const updateProfile = async details => {
    const current = ++revision.current;
    const data = await apiRequest('/api/me', { method: 'PATCH', body: details });
    if (current === revision.current) setUser(data.user);
    return data.user;
  };

  return <AppContext.Provider value={{ user, status, error, sessionMessage, login, register, logout,
    refreshSession, updateProfile, isLoggedIn: status === 'authenticated', userName: user?.firstName || '' }}>
    {children}
  </AppContext.Provider>;
};
export const useAppContext = () => useContext(AppContext);
