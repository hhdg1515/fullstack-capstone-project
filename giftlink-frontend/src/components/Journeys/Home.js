import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { apiRequest } from '../../api/client';
import { publicImageUrl, publicItemMedia } from '../../api/publicItemMedia';
import './Journeys.css';

// The belt shows real published listings with photos from the visitor's saved
// browsing area (or the Bay Area); it hides itself when there are too few.
const defaultRegion = { stateId: '06', metroId: '41860' };
function savedRegion() {
  try {
    const value = JSON.parse(localStorage.getItem('moveout.browse-region.v1'));
    if (value && typeof value.stateId === 'string' && typeof value.metroId === 'string') return { stateId: value.stateId, metroId: value.metroId };
  } catch { /* An unreadable preference falls back to the default area. */ }
  return defaultRegion;
}
function ListingBelt() {
  const [items, setItems] = useState([]);
  useEffect(() => {
    let active = true;
    apiRequest(`/api/items?${new URLSearchParams(savedRegion())}`, { validate: data => Array.isArray(data.items) })
      .then(data => {
        if (!active) return;
        setItems(data.items.filter(item => item && typeof item.id === 'string' && typeof item.name === 'string' && publicItemMedia(item)?.coverImage).slice(0, 12));
      })
      .catch(() => { /* The belt is decorative; the page works without it. */ });
    return () => { active = false; };
  }, []);
  if (items.length < 3) return null;
  const card = (item, copy) => {
    const cover = publicItemMedia(item).coverImage.thumbnail;
    return <li key={(copy ? 'copy-' : '') + item.id} aria-hidden={copy || undefined}>
      <Link className="home-belt-card" to={`/app/items/${item.id}`} tabIndex={copy ? -1 : undefined} aria-label={copy ? undefined : item.name}>
        <img src={publicImageUrl(cover)} width={cover.width} height={cover.height} alt="" crossOrigin="use-credentials" loading="lazy" decoding="async" />
        {item.free !== false && <span className="home-belt-free">Free</span>}
        <span className="home-belt-caption"><strong>{item.name}</strong><span>{[item.neighborhood, item.city].filter(Boolean).join(', ')}</span></span>
      </Link>
    </li>;
  };
  return <section className="home-belt" aria-label="Recently listed items">
    <ul className="home-belt-track">{items.map(item => card(item, false))}{items.map(item => card(item, true))}</ul>
  </section>;
}
const faqs = [
  ['Who is this for?', 'People clearing out before a move, and neighbors looking for useful secondhand items nearby.'],
  ["Can I request a heavy item if I cannot move it myself?", 'Yes, if you can arrange suitable help and transport. Agree on pickup arrangements with the giver first. Do not assume they can lift, carry or deliver it.'],
  ['Are all items free?', 'No. Look for the Free label. For other items, agree on the price in chat before arranging pickup.'],
  ['Is it free to publish a listing?', 'Yes. Creating an account and publishing a listing are free.'],
  ['Does the site provide delivery or moving help?', 'No. You arrange collection, transport and any lifting help directly with the other person.'],
  ['Does sending a request reserve the item?', 'No. A request or chat does not reserve the item. Agree on pickup directly with the giver.'],
  ['Will my home address appear on my listing?', 'No. Listings show a general pickup area, not a street address. Share exact pickup instructions privately, only when needed.']
];
export default function Home() {
  return <main className="journey-home">
    <section className="home-hero">
      <div className="home-hero-inner">
        <p className="journey-kicker">Useful things. A little closer to home.</p>
        <h1>Move lighter.<br /><span>Settle smarter.</span></h1>
        <div className="home-hero-row">
          <div className="home-actions">
            <div className="home-action-row">
              <Link className="home-action home-action--primary" to="/app/items">Explore Items<span aria-hidden="true">→</span></Link>
              <Link className="home-action home-action--ghost" to="/app/listings">Start Giving</Link>
            </div>
          </div>
        </div>
      </div>
      <ListingBelt />
    </section>
    <section className="home-how" aria-labelledby="home-how-title">
      <div className="home-how-head">
        <h2 id="home-how-title">How it works</h2>
      </div>
      <ol className="home-steps">
        <li><span aria-hidden="true">01</span><h3>List</h3></li>
        <li><span aria-hidden="true">02</span><h3>Request</h3></li>
        <li><span aria-hidden="true">03</span><h3>Pick up</h3></li>
      </ol>
    </section>
    <section className="home-faq" aria-labelledby="home-faq-title">
      <h2 id="home-faq-title">FAQ</h2>
      <div className="home-faq-list">{faqs.map(([question, answer]) => <details key={question}>
        <summary>{question}</summary>
        <p>{answer}</p>
      </details>)}</div>
    </section>
    <p className="home-reassurance">One account lets you donate and find, wherever life takes you.</p>
  </main>;
}
