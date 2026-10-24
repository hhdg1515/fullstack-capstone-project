import React, { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { apiRequest } from '../../api/client';
import '../MoveOutPlans/Plans.css';
import './Inventory.css';

export default function PublicItems() {
  const { itemId } = useParams();
  const [fields, setFields] = useState({ q: '', city: '', neighborhood: '' });
  const [search, setSearch] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState({});
  const path = itemId ? `/api/items/${encodeURIComponent(itemId)}` : `/api/items?${search}`;
  useEffect(() => {
    let active = true;
    setResult({ loading: true });
    apiRequest(path).then(data => { if (active) setResult({ data }); })
      .catch(error => { if (active) setResult({ error }); });
    const refresh = () => setAttempt(value => value + 1);
    window.addEventListener('focus', refresh);
    return () => { active = false; window.removeEventListener('focus', refresh); };
  }, [path, attempt]);
  const searchItems = event => { event.preventDefault(); setSearch(new URLSearchParams(fields).toString()); setAttempt(value => value + 1); };
  const items = result.data?.items || (result.data?.item ? [result.data.item] : []);
  return <main className="plans-page">
    {itemId && <Link to="/app/items">Free items</Link>}
    <h1>{itemId ? 'Free item' : 'Free items near your neighborhood'}</h1>
    {!itemId && <form className="plan-form" onSubmit={searchItems}>
      {['q', 'city', 'neighborhood'].map(name => <div className="plan-field" key={name}>
        <label htmlFor={`browse-${name}`}>{name === 'q' ? 'Item name' : name === 'city' ? 'City' : 'Neighborhood'}</label>
        <input id={`browse-${name}`} maxLength={100} value={fields[name]} onChange={event => setFields({ ...fields, [name]: event.target.value })} />
      </div>)}<button className="btn btn-primary">Find free items</button>
    </form>}
    <p>All listings are free. A future pickup start date is shown separately from publication.</p>
    <button className="btn btn-outline-secondary" onClick={() => setAttempt(value => value + 1)}>Refresh listings</button>
    {result.loading && <p role="status">Loading listings…</p>}
    {result.error && <p role="alert">{result.error.status === 404 ? 'This listing is no longer available.' : result.error.message}</p>}
    {result.data && !items.length && <p>No available items match. Try another search.</p>}
    <ul className="inventory-list">{items.map(item => <li className="plan-panel" key={item.id}>
      <h2>{itemId ? item.name : <Link to={`/app/items/${item.id}`}>{item.name}</Link>}</h2>
      <p>{item.neighborhood}, {item.city} · Free</p>
      <p>Pickup: {item.availableFrom || 'Immediately'} through {item.effectiveAvailableUntil}</p>
      {item.category && <p>{item.category}</p>}
      {itemId && <p className="public-item-description">{item.description}</p>}
    </li>)}</ul>
  </main>;
}
