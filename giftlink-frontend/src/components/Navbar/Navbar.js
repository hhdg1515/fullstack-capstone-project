import React, { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAppContext } from '../../context/AuthContext';
import './Navbar.css';
import { useDiscardChanges } from '../../forms/UnsavedChanges';

const hostedDemo = () => typeof window !== 'undefined' && !['localhost', '127.0.0.1', '[::1]', ''].includes(window.location.hostname);
export default function Navbar() {
  const { isLoggedIn, logout, status } = useAppContext();
  const drafts = useDiscardChanges();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const menuButton = useRef(null);
  const location = useLocation(); const navigate = useNavigate();
  useEffect(() => { setOpen(false); }, [location.pathname, location.search, location.hash]);
  const editingItem = /^\/app\/items\/[^/]+\/edit\/?$/.test(location.pathname);
  const give = editingItem || (location.pathname.startsWith('/app/plans') || location.pathname.startsWith('/app/listings')) || location.pathname === '/app/pickups/incoming' || location.state?.journey === 'give';
  const find = !editingItem && (location.pathname.startsWith('/app/items') || location.pathname === '/app/pickups' || location.state?.journey === 'find');
  const handleLogout = async () => {
    if (drafts && !await drafts.requestDiscard({ release: false })) return;
    setBusy(true); setError('');
    try { await logout(); drafts?.discard(); setOpen(false); navigate('/'); }
    catch { setError('Logout could not be confirmed. Please try again.'); }
    finally { setBusy(false); }
  };
  return <header className={'site-header' + (location.pathname === '/' ? ' site-header--dark' : '')} onKeyDown={event => {
    if (event.key === 'Escape' && open) { setOpen(false); menuButton.current?.focus(); }
  }}>
    {hostedDemo() && <p className="site-demo-note">Demo site: please don't enter real personal information.</p>}
    <div className="site-header-inner">
      <Link className="site-brand" to="/" onClick={() => setOpen(false)}><span className="site-brand-mark" aria-hidden="true" />Movelight</Link>
      <button className="site-menu-button" ref={menuButton} aria-expanded={open} aria-controls="primary-navigation" onClick={() => setOpen(value => !value)}>{open ? 'Close menu' : 'Menu'}</button>
      <nav id="primary-navigation" className={`site-navigation ${open ? 'is-open' : ''}`} aria-label="Primary">
        <ul onClick={() => setOpen(false)}>
          <li><Link to={location.pathname === '/app/items' ? location.pathname + location.search : '/app/items'} aria-current={find ? 'location' : undefined}>Find</Link></li>
          <li><Link to="/app/listings" aria-current={give ? 'location' : undefined}>Donate</Link></li>
        </ul>
        <div className="site-session">
          {status === 'loading' ? <span role="status">Checking session…</span> : isLoggedIn ? <>
            <button onClick={handleLogout} disabled={busy}>{busy ? 'Logging out…' : 'Logout'}</button>
          </> : <><Link to="/app/login">Log in</Link><Link className="site-register" to="/app/register">Register</Link></>}
        </div>
      </nav>
    </div>
    {status === 'error' && <p className="site-nav-error" role="status">Account service is temporarily unavailable. You can still explore the site.</p>}
    {error && <p className="site-nav-error" role="alert">{error}</p>}
  </header>;
}
