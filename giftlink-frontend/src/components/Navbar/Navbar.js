import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAppContext } from '../../context/AuthContext';

export default function Navbar() {
    const { isLoggedIn, userName, logout, status } = useAppContext();
    const [error, setError] = useState('');
    const [busy, setBusy] = useState(false);
    const navigate = useNavigate();

    const handleLogout = async () => {
        setBusy(true); setError('');
        try { await logout(); navigate('/app'); }
        catch { setError('Logout could not be confirmed. Please try again.'); }
        finally { setBusy(false); }
    };

    const profileSection = () => {
        navigate('/app/profile');
    };

    return (
        <nav className="navbar navbar-expand-lg navbar-light bg-light" id="navbar_container">
            <Link className="navbar-brand" to="/app">GiftLink</Link>
            <div className="navbar-collapse" id="navbarNav">
                <ul className="navbar-nav">
                    <li className="nav-item"><a className="nav-link" href="/home.html">Home</a></li>
                    <li className="nav-item"><Link className="nav-link" to="/app">Gifts</Link></li>
                    <li className="nav-item"><Link className="nav-link" to="/app/search">Search</Link></li>
                </ul>
                <ul className="navbar-nav ml-auto">
                    {status === 'loading' ? <li role="status">Checking session…</li> : isLoggedIn ? (
                        <>
                            <li className="nav-item">
                                <button type="button" className="nav-link btn btn-link text-dark" onClick={profileSection}>
                                    Welcome, {userName}
                                </button>
                            </li>
                            <li className="nav-item">
                                <button type="button" className="nav-link btn btn-link login-btn" onClick={handleLogout} disabled={busy}>{busy ? 'Logging out…' : 'Logout'}</button>
                            </li>
                        </>
                    ) : (
                        <>
                            <li className="nav-item"><Link className="nav-link login-btn" to="/app/login">Login</Link></li>
                            <li className="nav-item"><Link className="nav-link register-btn" to="/app/register">Register</Link></li>
                        </>
                    )}
                </ul>
            </div>
            {error && <p role="alert">{error}</p>}
        </nav>
    );
}
