import React from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAppContext } from '../../context/AuthContext';

export default function Navbar() {
    const { isLoggedIn, setIsLoggedIn, userName, setUserName } = useAppContext();
    const navigate = useNavigate();

    const handleLogout = () => {
        sessionStorage.removeItem('auth-token');
        sessionStorage.removeItem('name');
        sessionStorage.removeItem('email');
        setIsLoggedIn(false);
        setUserName('');
        navigate('/app');
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
                    {isLoggedIn ? (
                        <>
                            <li className="nav-item">
                                <button type="button" className="nav-link btn btn-link text-dark" onClick={profileSection}>
                                    Welcome, {userName}
                                </button>
                            </li>
                            <li className="nav-item">
                                <button type="button" className="nav-link btn btn-link login-btn" onClick={handleLogout}>Logout</button>
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
        </nav>
    );
}
