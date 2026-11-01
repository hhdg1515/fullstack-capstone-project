import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { apiRequest, advanceSessionGeneration } from '../api/client';

const AppContext = createContext();
const userResponse = data => data && data.user && !Array.isArray(data.user) &&
  ['id', 'firstName', 'lastName', 'email'].every(field => typeof data.user[field] === 'string') && Boolean(data.user.id);

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [status, setStatus] = useState('loading');
  const [error, setError] = useState('');
  const [sessionMessage, setSessionMessage] = useState('');
  const revision = useRef(0);
  const hasSession = useRef(false);
  const userId = useRef(null);
  const invalidate = useCallback(() => { ++revision.current; }, []);

  const refreshSession = useCallback(async () => {
    const current = ++revision.current;
    if (!hasSession.current) setStatus('loading');
    setError('');
    try {
      const data = await apiRequest('/api/me', { notifyUnauthorized: false, validate: userResponse });
      if (current !== revision.current) return;
      if (userId.current !== data.user.id) { advanceSessionGeneration(); userId.current = data.user.id; }
      setUser(data.user);
      hasSession.current = true;
      setStatus('authenticated');
      setSessionMessage('');
      return data.user;
    } catch (failure) {
      if (current !== revision.current) return;
      // Reconfirming an already anonymous visitor does not change identity.
      // Otherwise every anonymous focus check invalidates concurrent public GETs.
      if (hasSession.current || userId.current !== null) advanceSessionGeneration();
      userId.current = null;
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
      advanceSessionGeneration(); userId.current = null;
      setUser(null);
      hasSession.current = false;
      setStatus('anonymous');
      setSessionMessage('Your session ended. Please log in again.');
    };
    window.addEventListener('giftlink:unauthorized', unauthorized);
    const checkSession = () => { refreshSession().catch(() => {}); };
    window.addEventListener('focus', checkSession);
    const restored = event => { if (event.persisted) {
      invalidate(); advanceSessionGeneration(); userId.current = null; hasSession.current = false;
      setUser(null); setStatus('loading'); checkSession();
    } };
    window.addEventListener('pageshow', restored);
    return () => {
      invalidate();
      window.removeEventListener('giftlink:unauthorized', unauthorized);
      window.removeEventListener('focus', checkSession);
      window.removeEventListener('pageshow', restored);
    };
  }, [refreshSession, invalidate]);

  const authenticate = async (path, details) => {
    const current = ++revision.current;
    advanceSessionGeneration(); userId.current = null; hasSession.current = false; setUser(null); setStatus('loading');
    try { await apiRequest(path, { method: 'POST', body: details, notifyUnauthorized: false }); }
    catch (failure) { if (current === revision.current) setStatus('anonymous'); throw failure; }
    if (current !== revision.current) throw new Error('Sign-in was superseded.');
    // Confirm the browser accepted the cookie instead of trusting the form response.
    const confirmed = await refreshSession();
    if (!confirmed) throw new Error('Could not confirm your session. Check cookies and try again.');
  };
  const login = details => authenticate('/api/auth/login', details);
  const register = details => authenticate('/api/auth/register', details);
  const logout = async () => {
    const current = ++revision.current;
    advanceSessionGeneration(); userId.current = null;
    setUser(null); hasSession.current = false; setStatus('loading');
    try { await apiRequest('/api/auth/logout', { method: 'POST', body: {}, notifyUnauthorized: false }); }
    catch (failure) {
      if (current === revision.current) await refreshSession().catch(() => {});
      throw failure;
    }
    if (current !== revision.current) return;
    ++revision.current;
    setStatus('anonymous'); setError(''); setSessionMessage('');
  };
  const updateProfile = async details => {
    const current = ++revision.current;
    const data = await apiRequest('/api/me', { method: 'PATCH', body: details, validate: userResponse });
    if (current === revision.current) setUser(data.user);
    return data.user;
  };

  return <AppContext.Provider value={{ user, status, error, sessionMessage, login, register, logout,
    refreshSession, updateProfile, isLoggedIn: status === 'authenticated', userName: user?.firstName || '' }}>
    {children}
  </AppContext.Provider>;
};
export const useAppContext = () => useContext(AppContext);
