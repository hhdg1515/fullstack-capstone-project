import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useAppContext } from '../../context/AuthContext';
import './Journeys.css';

// Navigation describes this task, never an account role or location preference.
export default function JourneyNav({ journey, planId, discoverySearch = '' }) {
  const { pathname, search } = useLocation();
  const giving = journey === 'give';
  const anonymous = useAppContext()?.status === 'anonymous';
  const browse = pathname === '/app/items' ? search : discoverySearch;
  const links = giving ? [
    { to: '/app/plans', label: 'My plans', active: pathname === '/app/plans' },
    ...(planId ? [{ to: `/app/plans/${planId}/items`, label: 'Items & clearance progress', active: pathname.endsWith('/items') }] : []),
    { to: '/app/pickups/incoming', label: 'Incoming requests', active: pathname.startsWith('/app/pickups') }
  ] : [
    { to: `/app/items${browse}`, label: 'Browse listings', active: pathname.startsWith('/app/items') },
    { to: '/app/pickups', label: 'My pickup requests', active: pathname.startsWith('/app/pickups'), requiresAuth: true }
  ];
  return <nav className="journey-nav" aria-label={giving ? 'Give Away' : 'Find Free Items'}>
    <p className="journey-kicker">{giving ? 'Give Away' : 'Find Free Items'}</p>
    <ul>{links.map(link => <li key={link.label}><Link to={link.to} aria-current={link.active ? 'location' : undefined}
      aria-describedby={anonymous && link.requiresAuth ? 'journey-sign-in' : undefined}>{link.label}</Link>
      {anonymous && link.requiresAuth && <small className="journey-sign-in" id="journey-sign-in">Sign in required</small>}</li>)}</ul>
  </nav>;
}
