import React, { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useParams, useSearchParams } from 'react-router-dom';
import { apiRequest } from '../../api/client';
import { formatDeadline, isCalendarDate, utcToday } from '../MoveOutPlans/dates';
import '../MoveOutPlans/Plans.css';
import './Inventory.css';
import JourneyNav from '../Journeys/JourneyNav';

const normalize = value => value.trim().replace(/\s+/g, ' ');
const key = value => normalize(value).toLowerCase();
const fieldsFrom = params => ({ q: params.get('q') || '', city: params.get('city') || '', neighborhood: params.get('neighborhood') || '',
  availability: params.get('availability') || 'all', date: params.get('date') || '', sort: params.get('sort') || 'newest' });
function PickupWindow({ item }) {
  const later = (item.availability || (item.availableFrom && item.availableFrom > utcToday() ? 'later' : 'now')) === 'later';
  return <>
    <p><span className={`plan-status ${later ? 'pickup-later' : 'pickup-now'}`}>
      {item.isReserved === true ? 'Pickup arranged' : item.pickupTimeZone === null ? 'Pickup setup needed' : typeof item.isReserved !== 'boolean' ? 'Pickup window' : later ? 'Available Later' : 'Available Now'}
    </span></p>
    <p>Pickup from: {item.availableFrom ? <time dateTime={item.availableFrom}>{formatDeadline(item.availableFrom)}</time> : 'Immediately'}</p>
    <p>Pickup until: <time dateTime={item.effectiveAvailableUntil}>{formatDeadline(item.effectiveAvailableUntil)}</time></p>
  </>;
}
function Card({ item, search }) {
  return <li className="plan-panel discovery-card">
    <h2><Link to={`/app/items/${item.id}`} state={{ discoverySearch: search ? `?${search}` : '' }}>{item.name}</Link></h2>
    <p>{item.neighborhood}, {item.city} · Free</p>
    {item.category && <p className="discovery-category">{item.category}</p>}
    <PickupWindow item={item} />
    {item.description && <p>{item.description.length > 160 ? `${item.description.slice(0, 160)}…` : item.description}</p>}
  </li>;
}
function Discovery() {
  const [params, setParams] = useSearchParams();
  const query = params.toString();
  const [fields, setFields] = useState(() => fieldsFrom(params));
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [filterError, setFilterError] = useState('');
  const filterRegion = useRef(); const filterToggle = useRef(); const dateInput = useRef();
  const [attempt, setAttempt] = useState(0);
  const [locationAttempt, setLocationAttempt] = useState(0);
  const [places, setPlaces] = useState({ loading: true, locations: [] });
  const [result, setResult] = useState({});
  const revision = useRef(null);
  useEffect(() => { if (filterError && filtersOpen) dateInput.current?.focus(); }, [filterError, filtersOpen]);
  useEffect(() => { setFields(fieldsFrom(new URLSearchParams(query))); setFilterError(''); }, [query]);
  useEffect(() => {
    const current = { active: true }; revision.current = current;
    setResult({ key: query, loading: true, items: [] });
    apiRequest(`/api/items?${query}`).then(data => {
      if (current.active) setResult({ key: query, items: data.items, page: data.page, loading: false });
    }).catch(error => {
      if (current.active) setResult({ key: query, items: [], loading: false, error });
    });
    return () => { current.active = false; };
  }, [query, attempt]);
  useEffect(() => {
    let active = true;
    setPlaces(previous => ({ ...previous, loading: true, error: null }));
    apiRequest('/api/items/locations').then(data => {
      if (active) setPlaces({ locations: data.locations || [], truncated: data.truncated, loading: false });
    }).catch(error => { if (active) setPlaces(previous => ({ ...previous, loading: false, error })); });
    return () => { active = false; };
  }, [locationAttempt]);
  useEffect(() => {
    const refresh = () => { setAttempt(value => value + 1); setLocationAttempt(value => value + 1); };
    window.addEventListener('focus', refresh);
    return () => window.removeEventListener('focus', refresh);
  }, []);
  const visible = result.key === query ? result : { loading: true, items: [] };
  const city = places.locations.find(place => key(place.city) === key(fields.city))?.city || normalize(fields.city);
  const neighborhoods = Array.from(new Map(places.locations.filter(place => !city || key(place.city) === key(city))
    .flatMap(place => place.neighborhoods).map(value => [key(value), value])).values()).sort((a, b) => a.localeCompare(b));
  const neighborhood = neighborhoods.find(value => key(value) === key(fields.neighborhood)) || normalize(fields.neighborhood);
  const cities = places.locations.map(place => place.city);
  if (city && !cities.includes(city)) cities.unshift(city);
  if (neighborhood && !neighborhoods.includes(neighborhood)) neighborhoods.unshift(neighborhood);
  const applied = [];
  if (params.get('q')) applied.push(`Search: ${params.get('q')}`);
  if (params.get('city')) applied.push(`City: ${params.get('city')}`);
  if (params.get('neighborhood')) applied.push(`Neighborhood: ${params.get('neighborhood')}`);
  if (params.get('availability') && params.get('availability') !== 'all') applied.push(`Pickup: ${params.get('availability') === 'date' ? params.get('date') || 'choose a date' : params.get('availability')}`);
  if (params.get('sort') === 'deadline') applied.push('Sort: earliest pickup deadline');
  const filterCount = applied.length - (params.get('q') ? 1 : 0);
  const closeFilters = () => {
    if (filterRegion.current?.contains(document.activeElement)) filterToggle.current?.focus();
    setFiltersOpen(false);
  };
  const submit = event => {
    event.preventDefault();
    if (fields.availability === 'date' && (!isCalendarDate(fields.date) || fields.date < utcToday())) {
      setFilterError('Choose today or a later pickup date (UTC).');
      if (filtersOpen) dateInput.current?.focus();
      setFiltersOpen(true); return;
    }
    setFilterError(''); closeFilters();
    const next = new URLSearchParams();
    for (const [name, value] of Object.entries({ q: normalize(fields.q), city, neighborhood, availability: fields.availability,
      date: fields.availability === 'date' ? fields.date : '', sort: fields.sort })) {
      if (value && !((name === 'availability' && value === 'all') || (name === 'sort' && value === 'newest'))) next.set(name, value);
    }
    setParams(next, { replace: next.toString() === query }); setAttempt(value => value + 1); setLocationAttempt(value => value + 1);
  };
  const clear = () => { setFilterError(''); closeFilters(); setParams({}); setFields(fieldsFrom(new URLSearchParams())); setAttempt(value => value + 1); setLocationAttempt(value => value + 1); };
  const loadMore = async () => {
    if (visible.loading || visible.moreLoading || !visible.page?.nextCursor) return;
    const current = revision.current;
    const next = new URLSearchParams(query); next.set('cursor', visible.page.nextCursor);
    setResult(previous => ({ ...previous, moreLoading: true, error: null }));
    try {
      const data = await apiRequest(`/api/items?${next}`);
      if (!current.active) return;
      setResult(previous => ({ ...previous, moreLoading: false, page: data.page,
        items: Array.from(new Map([...previous.items, ...data.items].map(item => [item.id, item])).values()) }));
    } catch (error) {
      if (current.active) setResult(previous => ({ ...previous, moreLoading: false, error, moreError: true,
        page: ['STALE_CURSOR', 'INVALID_CURSOR'].includes(error.code) ? { hasMore: false, nextCursor: null } : previous.page }));
    }
  };
  const change = event => {
    const { name, value } = event.target;
    if (['availability', 'date'].includes(name)) setFilterError('');
    setFields(previous => ({ ...previous, [name]: value, ...(name === 'city' ? { neighborhood: '' } : {}), ...(name === 'availability' ? { date: '' } : {}) }));
  };
  return <main className="plans-page discovery-page">
    <JourneyNav journey="find" />
    <h1>Free items near your neighborhood</h1>
    <form className="discovery-filters" onSubmit={submit} noValidate>
      <div className="plan-field discovery-search"><div className="discovery-search-heading"><label htmlFor="browse-q">Search items</label>
        <button type="button" ref={filterToggle} className="btn btn-outline-secondary" aria-expanded={filtersOpen} aria-controls="discovery-filter-options"
          onClick={() => filtersOpen ? closeFilters() : setFiltersOpen(true)}>Filters{filterCount ? ` (${filterCount})` : ''}</button></div>
        <input id="browse-q" name="q" maxLength={100} placeholder="Name, description, or category" value={fields.q} onChange={change} /></div>
      <div id="discovery-filter-options" ref={filterRegion} className="discovery-options" hidden={!filtersOpen}>
      <div className="plan-field"><label htmlFor="browse-city">City</label>
        <select id="browse-city" name="city" value={city} onChange={change}><option value="">All cities</option>
          {cities.map(value => <option key={key(value)} value={value}>{value}</option>)}</select></div>
      <div className="plan-field"><label htmlFor="browse-neighborhood">Neighborhood</label>
        <select id="browse-neighborhood" name="neighborhood" value={neighborhood} onChange={change}><option value="">All neighborhoods</option>
          {neighborhoods.map(value => <option key={key(value)} value={value}>{value}</option>)}</select></div>
      <div className="plan-field"><label htmlFor="browse-availability">Pickup availability</label>
        <select id="browse-availability" name="availability" value={fields.availability} onChange={change}>
          <option value="all">Any pickup window</option><option value="now">Available Now</option><option value="later">Available Later</option><option value="date">On a selected date</option>
        </select></div>
      {fields.availability === 'date' && <div className="plan-field"><label htmlFor="browse-date">Pickup date (UTC)</label>
        <input id="browse-date" ref={dateInput} type="date" name="date" required min={utcToday()} value={fields.date} onChange={change}
          aria-invalid={Boolean(filterError)} aria-describedby={filterError ? 'browse-date-error' : undefined} />
        {filterError && <p id="browse-date-error" role="alert" className="plan-field-error">{filterError}</p>}</div>}
      <div className="plan-field"><label htmlFor="browse-sort">Sort items</label>
        <select id="browse-sort" name="sort" value={fields.sort} onChange={change}>
          <option value="newest">Newest publication</option><option value="deadline">Earliest pickup deadline</option>
        </select></div>
      <small>Pickup windows use UTC calendar dates. You can browse any neighborhood.</small>
      </div>
      <div className="plan-actions discovery-search-actions"><button className="btn btn-primary">Find free items</button>
        <button type="button" className="btn btn-outline-secondary" onClick={clear}>Clear filters</button></div>
    </form>
    <p className="discovery-summary" aria-label="Applied filters">{applied.length ? applied.join(' · ') : 'Showing all listings. No account needed to browse.'}</p>
    {places.loading && <p role="status">Loading location options…</p>}
    {places.error && <div role="alert">Location options could not be loaded. <button onClick={() => setLocationAttempt(value => value + 1)}>Retry location options</button></div>}
    {places.truncated && <p>Location suggestions are limited. Shared city/neighborhood filters still work beyond these suggestions.</p>}
    <section aria-label="Search results" aria-busy={visible.loading || visible.moreLoading || false}>
      {visible.loading && <p role="status">Loading listings…</p>}
      {visible.error && <div role="alert"><p>{visible.error.message}</p>
        <button className="btn btn-outline-secondary" onClick={() => visible.moreError && !['STALE_CURSOR', 'INVALID_CURSOR'].includes(visible.error.code) ? loadMore() : setAttempt(value => value + 1)}>
          {['STALE_CURSOR', 'INVALID_CURSOR'].includes(visible.error.code) ? 'Start again' : 'Retry results'}
        </button></div>}
      {!visible.loading && !visible.error && !visible.items?.length && <p>No available items match. Try another search or clear filters.</p>}
      {Boolean(visible.items?.length) && <p role="status">Showing {visible.items.length} {visible.items.length === 1 ? 'item' : 'items'}</p>}
      <ul className="discovery-grid" aria-label="Available items">{visible.items?.map(item => <Card key={item.id} item={item} search={query} />)}</ul>
      {visible.page?.hasMore && <button className="btn btn-primary discovery-more" disabled={visible.moreLoading} onClick={loadMore}>{visible.moreLoading ? 'Loading more…' : 'Load more'}</button>}
    </section>
  </main>;
}
function PublicItemDetail({ itemId }) {
  const location = useLocation();
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState({});
  const [message, setMessage] = useState('');
  useEffect(() => {
    let active = true;
    setResult({ key: itemId, loading: true }); setMessage('');
    apiRequest(`/api/items/${encodeURIComponent(itemId)}`).then(data => { if (active) setResult({ key: itemId, item: data.item }); })
      .catch(error => { if (active) setResult({ key: itemId, error }); });
    const refresh = () => setAttempt(value => value + 1);
    window.addEventListener('focus', refresh);
    return () => { active = false; window.removeEventListener('focus', refresh); };
  }, [itemId, attempt]);
  const current = result.key === itemId ? result : { loading: true };
  const item = current.item;
  const previous = location.state?.discoverySearch;
  const shareUrl = `${window.location.origin}${location.pathname}`;
  const copy = async () => {
    try { await navigator.clipboard.writeText(shareUrl); setMessage('Link copied.'); }
    catch { setMessage('Copy the link from the field above.'); }
  };
  return <main className="plans-page discovery-page">
    <JourneyNav journey="find" discoverySearch={previous || ''} />
    <Link to={`/app/items${typeof previous === 'string' && previous.startsWith('?') ? previous : ''}`}>Back to free items</Link>
    {current.loading && <p role="status">Loading listing…</p>}
    {current.error && <div role="alert"><p>{current.error.status === 404 ? 'This listing is no longer available.' : current.error.message}</p>
      <button className="btn btn-outline-secondary" onClick={() => setAttempt(value => value + 1)}>Retry listing</button></div>}
    {item && <article className="plan-panel">
      <h1>{item.name}</h1><p>{item.neighborhood}, {item.city} · Free</p>
      {item.category && <p className="discovery-category">{item.category}</p>}
      <PickupWindow item={item} />
      <h2>Description</h2><p className="public-item-description">{item.description || 'No additional description provided.'}</p>
      {item.isReserved === true ? <p role="status">This item has an accepted pickup. Check back if it becomes available.</p> : item.pickupTimeZone ? <><p>Pickup timezone: {item.pickupTimeZone}</p><Link className="btn btn-primary" to={`/app/items/${item.id}/request`} state={{ discoverySearch: previous }}>Request pickup</Link>
        <p>A request does not reserve the item. The giver must accept an appointment.</p></> : <p>The giver needs to set a pickup timezone before this listing can receive requests.</p>}
      {typeof item.isReserved !== 'boolean' && <p>Current pickup availability will be checked when you send a request.</p>}
      {item.publishedAt && <p>First published: <time dateTime={item.publishedAt}>{formatDeadline(item.publishedAt.slice(0, 10))}</time>. Publication is separate from pickup dates.</p>}
      <div className="plan-field"><label htmlFor="share-listing">Share this listing</label><input id="share-listing" type="url" readOnly value={shareUrl} onFocus={event => event.target.select()} /></div>
      <button className="btn btn-outline-primary" onClick={copy}>Copy link</button>
      <button className="btn btn-outline-secondary" onClick={() => setAttempt(value => value + 1)}>Refresh listings</button>
      {message && <p role="status">{message}</p>}
    </article>}
  </main>;
}
export default function PublicItems() {
  const { itemId } = useParams();
  return itemId ? <PublicItemDetail key={itemId} itemId={itemId} /> : <Discovery />;
}
