import React from 'react';
import { Link } from 'react-router-dom';
import './Journeys.css';

export default function Home() {
  return <main className="journey-home">
    <header className="home-intro">
      <p className="journey-kicker">Free things. A little closer to home.</p>
      <h1>Move lighter.<br />Settle smarter.</h1>
      <p className="home-lead">Give away what you can’t take. Find what you need next.</p>
    </header>
    <div className="home-paths">
      <section className="home-path home-give" aria-labelledby="home-give-title">
        <span className="path-symbol" aria-hidden="true">↗</span>
        <h2 id="home-give-title">Give Away</h2>
        <p>Clear your space. Give useful things a second life.</p>
        <p>Bring your belongings together in a move-out plan, arrange pickups, and see what’s cleared.</p>
        <Link className="journey-button" to="/app/plans">Start Giving</Link>
        <small>Sign in to organize your giveaway.</small>
      </section>
      <section className="home-path home-find" aria-labelledby="home-find-title">
        <span className="path-symbol" aria-hidden="true">↙</span>
        <h2 id="home-find-title">Find Free Items</h2>
        <p>Find useful things for your next space.</p>
        <p>Explore any neighborhood, choose a pickup window, and discover something you can use.</p>
        <Link className="journey-button" to="/app/items">Explore Free Items</Link>
        <small>Browse freely. Sign in when you request pickup.</small>
      </section>
    </div>
    <p className="home-reassurance">Everything is free. One account lets you give and find, wherever life takes you.</p>
  </main>;
}
