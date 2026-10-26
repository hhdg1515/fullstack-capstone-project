import React, { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useParams, useSearchParams } from 'react-router-dom';
import { apiRequest } from '../../api/client';
import { formatDeadline, isCalendarDate, utcToday } from '../MoveOutPlans/dates';
import '../MoveOutPlans/Plans.css';
import './Inventory.css';
import JourneyNav from '../Journeys/JourneyNav';
import { useAppContext } from '../../context/AuthContext';
import usePublicCatalog from '../../api/usePublicCatalog';
import RegionFields from '../MoveOutPlans/RegionFields';
import ItemLabels from './ItemLabels';

const normalize = value => value.trim().replace(/\s+/g, ' ');
const key = value => normalize(value).toLowerCase();
const fieldsFrom = params => ({ stateId: params.get('stateId') || '', metroId: params.get('metroId') || '', categoryId: params.get('categoryId') || '', itemTypeId: params.get('itemTypeId') || '', condition: params.get('condition') || '', q: params.get('q') || '', city: params.get('city') || '', neighborhood: params.get('neighborhood') || '',
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
    <ItemLabels item={item} />
    <PickupWindow item={item} />
    {item.isOwner === true && <p>Your listing</p>}
    {item.description && <p>{item.description.length > 160 ? `${item.description.slice(0, 160)}…` : item.description}</p>}
  </li>;
}
const preferenceKey = 'moveout.browse-region.v1';
const selectedMetro = (directory, stateId, metroId) => directory?.states.some(state => state.id === stateId) &&
  directory.metros.find(metro => metro.id === metroId && metro.stateIds.includes(stateId));
const rememberRegion = (stateId, metroId) => {
  try { if (stateId && metroId) localStorage.setItem(preferenceKey, JSON.stringify({ stateId, metroId })); else localStorage.removeItem(preferenceKey); }
  catch { /* A browser preference is optional, never identity or a plan update. */ }
};
const preferredRegion = directory => {
  try {
    const value = JSON.parse(localStorage.getItem(preferenceKey));
    if (value && Object.keys(value).sort().join(',') === 'metroId,stateId' && selectedMetro(directory, value.stateId, value.metroId)) return value;
    localStorage.removeItem(preferenceKey);
  } catch { /* Invalid or blocked storage must not prevent choosing a region. */ }
  return null;
};
const validFeed = data => Array.isArray(data.items) && Number.isSafeInteger(data.total) && data.total >= data.items.length &&
  data.items.every(item => item && typeof item.id === 'string' && typeof item.name === 'string' && item.isReserved === false &&
    typeof item.isOwner === 'boolean' && typeof item.pickupTimeZone === 'string' && Boolean(item.pickupTimeZone)) &&
  data.page && typeof data.page.hasMore === 'boolean' && (data.page.hasMore ? typeof data.page.nextCursor === 'string' && Boolean(data.page.nextCursor) : data.page.nextCursor === null);
const sameQuery = (a, b) => { const x = new URLSearchParams(a), y = new URLSearchParams(b); x.sort(); y.sort(); return x.toString() === y.toString(); };
function Discovery() {
  const [params, setParams] = useSearchParams(); const query = params.toString();
  const auth = useAppContext(); const viewer = auth?.status === 'authenticated' ? auth.user.id : 'anonymous';
  const directory = usePublicCatalog('/api/regions'), catalog = usePublicCatalog('/api/item-taxonomy');
  const stateId = params.get('stateId') || '', metroId = params.get('metroId') || '';
  const selected = selectedMetro(directory.data, stateId, metroId);
  const feedMatchesRegion = data => validFeed(data) && data.items.every(item => item.metroId === metroId && selected.stateIds.includes(item.stateId));
  const scope = `${viewer}:${query}`;
  const [fields, setFields] = useState(() => fieldsFrom(params));
  const [regionEditing, setRegionEditing] = useState(false);
  const regionPanel = useRef(), regionButton = useRef(), focusAfterRegion = useRef(false);
  const [filtersOpen, setFiltersOpen] = useState(false), [filterError, setFilterError] = useState('');
  const filterRegion = useRef(), filterToggle = useRef(), dateInput = useRef();
  const [attempt, setAttempt] = useState(0), [locationAttempt, setLocationAttempt] = useState(0);
  const [places, setPlaces] = useState({ locations: [] }), [result, setResult] = useState({});
  const revision = useRef(null), moreFlight = useRef(false);
  useEffect(() => { if (filterError && filtersOpen) dateInput.current?.focus(); }, [filterError, filtersOpen]);
  useEffect(() => { setFields(fieldsFrom(new URLSearchParams(query))); setFilterError(''); }, [query]);
  useEffect(() => {
    if (!directory.data || params.has('stateId') || params.has('metroId')) return;
    const preference = preferredRegion(directory.data);
    if (preference) {
      const next = new URLSearchParams(query); next.set('stateId', preference.stateId); next.set('metroId', preference.metroId);
      setParams(next, { replace: true });
    }
  }, [directory.data, params, query, setParams]);
  useEffect(() => { if (selected) rememberRegion(stateId, selected.id); }, [selected, stateId]);
  useEffect(() => {
    if (focusAfterRegion.current && selected) { focusAfterRegion.current = false; regionButton.current?.focus(); }
    if (regionEditing) regionPanel.current?.querySelector('select')?.focus();
  }, [selected, regionEditing]);
  useEffect(() => {
    const current = { active: true }; revision.current = current; moreFlight.current = false;
    setResult({ key: scope, loading: Boolean(selected), items: [] });
    if (selected) apiRequest(`/api/items?${query}`, { validate: data => validFeed(data) && data.items.every(item => item.metroId === metroId && selected.stateIds.includes(item.stateId)) }).then(data => {
      if (current.active) setResult({ key: scope, items: data.items, total: data.total, page: data.page });
    }).catch(error => { if (current.active) setResult({ key: scope, items: [], error }); });
    return () => { current.active = false; };
  }, [scope, query, metroId, selected, attempt]);
  useEffect(() => {
    let active = true; setPlaces({ loading: Boolean(selected), locations: [] });
    if (selected) apiRequest(`/api/items/locations?${new URLSearchParams({ stateId, metroId })}`, {
      validate: data => Array.isArray(data.locations) && data.locations.every(place => typeof place.city === 'string' && Array.isArray(place.neighborhoods) && place.neighborhoods.every(value => typeof value === 'string'))
    }).then(data => { if (active) setPlaces({ ...data, loading: false }); })
      .catch(error => { if (active) setPlaces({ loading: false, locations: [], error }); });
    return () => { active = false; };
  }, [stateId, metroId, selected, locationAttempt]);
  useEffect(() => {
    const refresh = () => { setAttempt(value => value + 1); setLocationAttempt(value => value + 1); };
    window.addEventListener('focus', refresh); return () => window.removeEventListener('focus', refresh);
  }, []);
  const visible = result.key === scope ? result : { loading: Boolean(selected), items: [] };
  const city = places.locations.find(place => key(place.city) === key(fields.city))?.city || normalize(fields.city);
  const neighborhoods = Array.from(new Map(places.locations.filter(place => !city || key(place.city) === key(city))
    .flatMap(place => place.neighborhoods).map(value => [key(value), value])).values()).sort((a, b) => a.localeCompare(b));
  const neighborhood = neighborhoods.find(value => key(value) === key(fields.neighborhood)) || normalize(fields.neighborhood);
  const cities = places.locations.map(place => place.city);
  if (city && !cities.includes(city)) cities.unshift(city);
  if (neighborhood && !neighborhoods.includes(neighborhood)) neighborhoods.unshift(neighborhood);
  const category = catalog.data?.categories.find(entry => entry.id === fields.categoryId);
  const applied = [];
  if (params.get('q')) applied.push(`Search: ${params.get('q')}`);
  for (const name of ['city', 'neighborhood']) if (params.get(name)) applied.push(`${name === 'city' ? 'City' : 'Neighborhood'}: ${params.get(name)}`);
  for (const [name, label] of [['categoryId', 'Category'], ['itemTypeId', 'Item type'], ['condition', 'Condition']]) {
    const id = params.get(name);
    const entries = name === 'categoryId' ? catalog.data?.categories : name === 'condition' ? catalog.data?.conditions : catalog.data?.categories.flatMap(entry => entry.itemTypes);
    if (id) applied.push(`${label}: ${entries?.find(entry => entry.id === id)?.label || 'Check selection'}`);
  }
  if (params.get('availability') && params.get('availability') !== 'all') applied.push(`Pickup: ${params.get('availability') === 'date' ? params.get('date') || 'choose a date' : params.get('availability')}`);
  if (params.get('sort') === 'deadline') applied.push('Sort: earliest pickup deadline');
  const filterCount = applied.length - (params.get('q') ? 1 : 0);
  const closeFilters = () => {
    if (filterRegion.current?.contains(document.activeElement)) filterToggle.current?.focus();
    setFiltersOpen(false);
  };
  const changeRegion = changes => {
    const next = new URLSearchParams(query);
    for (const name of ['cursor', 'city', 'neighborhood']) next.delete(name);
    if (changes.stateId !== undefined) {
      if (changes.stateId) next.set('stateId', changes.stateId); else { next.delete('stateId'); rememberRegion(); }
      next.delete('metroId');
    } else if (changes.metroId) {
      next.set('metroId', changes.metroId); focusAfterRegion.current = true; setRegionEditing(false);
    } else next.delete('metroId');
    setParams(next, { replace: sameQuery(next, query) });
  };
  const submit = event => {
    event.preventDefault(); if (!selected) return;
    if (fields.availability === 'date' && (!isCalendarDate(fields.date) || fields.date < utcToday())) {
      setFilterError('Choose today or a later pickup date (UTC).'); setFiltersOpen(true); return;
    }
    setFilterError(''); closeFilters();
    const next = new URLSearchParams({ stateId, metroId });
    for (const [name, value] of Object.entries({ q: normalize(fields.q), city, neighborhood, categoryId: fields.categoryId, itemTypeId: fields.itemTypeId,
      condition: fields.condition, availability: fields.availability, date: fields.availability === 'date' ? fields.date : '', sort: fields.sort })) {
      if (value && !((name === 'availability' && value === 'all') || (name === 'sort' && value === 'newest'))) next.set(name, value);
    }
    if (sameQuery(next, query)) setAttempt(value => value + 1); else setParams(next);
    setLocationAttempt(value => value + 1);
  };
  const restart = () => { const next = new URLSearchParams(query); next.delete('cursor'); if (sameQuery(next, query)) setAttempt(value => value + 1); else setParams(next, { replace: true }); };
  const clear = () => {
    setFilterError(''); closeFilters(); const next = new URLSearchParams({ stateId, metroId });
    if (sameQuery(next, query)) setAttempt(value => value + 1); else setParams(next);
    setFields(fieldsFrom(next)); setLocationAttempt(value => value + 1);
  };
  const loadMore = async () => {
    if (moreFlight.current || visible.loading || visible.moreLoading || !visible.page?.nextCursor) return;
    const current = revision.current, next = new URLSearchParams(query); next.set('cursor', visible.page.nextCursor);
    moreFlight.current = true; setResult(previous => ({ ...previous, moreLoading: true, error: null }));
    try {
      const data = await apiRequest(`/api/items?${next}`, { validate: feedMatchesRegion }); if (!current.active) return;
      if (data.total !== visible.total) { setAttempt(value => value + 1); return; }
      setResult(previous => ({ ...previous, moreLoading: false, page: data.page,
        items: Array.from(new Map([...previous.items, ...data.items].map(item => [item.id, item])).values()) }));
    } catch (error) {
      if (current.active) setResult(previous => ({ ...previous, moreLoading: false, error, moreError: true,
        page: ['STALE_CURSOR', 'INVALID_CURSOR'].includes(error.code) ? { hasMore: false, nextCursor: null } : previous.page }));
    } finally { if (current.active) moreFlight.current = false; }
  };
  const change = event => {
    const { name, value } = event.target; if (['availability', 'date'].includes(name)) setFilterError('');
    setFields(previous => ({ ...previous, [name]: value, ...(name === 'city' ? { neighborhood: '' } : {}),
      ...(name === 'availability' ? { date: '' } : {}), ...(name === 'categoryId' ? { itemTypeId: '' } : {}) }));
  };
  return <main className="plans-page discovery-page">
    <JourneyNav journey="find" /><h1>{selected ? `Free items in ${selected.label}` : 'Find free items'}{selected && Number.isSafeInteger(visible.total) ? ` — ${visible.total} available` : ''}</h1>
    {!selected && <h2>Where would you like to find free items?</h2>}
    {selected && <p><button ref={regionButton} type="button" className="btn btn-outline-secondary" onClick={() => setRegionEditing(value => !value)}>Change region</button></p>}
    <div ref={regionPanel} hidden={Boolean(selected) && !regionEditing}>
      <RegionFields directory={directory} values={{ stateId, metroId }} onChange={changeRegion} prefix="browse-region" browsing />
    </div>
    {!selected && directory.data && <p>Choose a listed metro to load items. Coverage is limited; selecting a state alone does not search every city.</p>}
    {selected && <>
    <small>Curated metro coverage ({directory.data.vintage?.metros || 'dated'} Census definitions).</small>
    <form className="discovery-filters" onSubmit={submit} noValidate>
      <div className="plan-field discovery-search"><div className="discovery-search-heading"><label htmlFor="browse-q">Search items</label>
        <button type="button" ref={filterToggle} className="btn btn-outline-secondary" aria-expanded={filtersOpen} aria-controls="discovery-filter-options"
          onClick={() => filtersOpen ? closeFilters() : setFiltersOpen(true)}>Filters{filterCount ? ` (${filterCount})` : ''}</button></div>
        <input id="browse-q" name="q" maxLength={100} placeholder="Name, description or item type" value={fields.q} onChange={change} /></div>
      <div id="discovery-filter-options" ref={filterRegion} className="discovery-options" hidden={!filtersOpen}>
        <div className="plan-field"><label htmlFor="browse-category">Category</label><select id="browse-category" name="categoryId" value={fields.categoryId} onChange={change} disabled={catalog.loading || Boolean(catalog.error)}>
          <option value="">All categories</option>{catalog.data?.categories.map(entry => <option value={entry.id} key={entry.id}>{entry.label}</option>)}
        </select></div>
        <div className="plan-field"><label htmlFor="browse-type">Item type</label><select id="browse-type" name="itemTypeId" value={fields.itemTypeId} onChange={change} disabled={!category || catalog.loading || Boolean(catalog.error)}>
          <option value="">All item types</option>{category?.itemTypes.map(entry => <option value={entry.id} key={entry.id}>{entry.label}</option>)}
        </select></div>
        <div className="plan-field"><label htmlFor="browse-condition">Condition</label><select id="browse-condition" name="condition" value={fields.condition} onChange={change} disabled={catalog.loading || Boolean(catalog.error)}>
          <option value="">Any condition</option>{catalog.data?.conditions.map(entry => <option value={entry.id} key={entry.id}>{entry.label}</option>)}
        </select></div>
        <div className="plan-field"><label htmlFor="browse-city">City</label><select id="browse-city" name="city" value={city} onChange={change}><option value="">All cities</option>
          {cities.map(value => <option key={key(value)} value={value}>{value}</option>)}</select></div>
        <div className="plan-field"><label htmlFor="browse-neighborhood">Neighborhood</label><select id="browse-neighborhood" name="neighborhood" value={neighborhood} onChange={change}><option value="">All neighborhoods</option>
          {neighborhoods.map(value => <option key={key(value)} value={value}>{value}</option>)}</select></div>
        <div className="plan-field"><label htmlFor="browse-availability">Pickup availability</label><select id="browse-availability" name="availability" value={fields.availability} onChange={change}>
          <option value="all">Any pickup window</option><option value="now">Available Now</option><option value="later">Available Later</option><option value="date">On a selected date</option></select></div>
        {fields.availability === 'date' && <div className="plan-field"><label htmlFor="browse-date">Pickup date (UTC)</label>
          <input id="browse-date" ref={dateInput} type="date" name="date" required min={utcToday()} value={fields.date} onChange={change}
            aria-invalid={Boolean(filterError)} aria-describedby={filterError ? 'browse-date-error' : undefined} />
          {filterError && <p id="browse-date-error" role="alert" className="plan-field-error">{filterError}</p>}</div>}
        <div className="plan-field"><label htmlFor="browse-sort">Sort items</label><select id="browse-sort" name="sort" value={fields.sort} onChange={change}>
          <option value="newest">Newest publication</option><option value="deadline">Earliest pickup deadline</option></select></div>
        <small>Pickup windows use UTC calendar dates. City/neighborhood options belong to this metro.</small>
      </div>
      <div className="plan-actions discovery-search-actions"><button className="btn btn-primary">Find free items</button><button type="button" className="btn btn-outline-secondary" onClick={clear}>Clear filters</button></div>
    </form>
    <p className="discovery-summary" aria-label="Applied filters">{applied.length ? applied.join(' · ') : 'All eligible items in this metro. No account needed to browse.'}</p>
    {catalog.error && <p role="alert">Item filter options are unavailable. <button onClick={catalog.retry}>Retry item filters</button></p>}
    {places.loading && <p role="status">Loading location options…</p>}
    {places.error && <div role="alert">Location options could not be loaded. <button onClick={() => setLocationAttempt(value => value + 1)}>Retry location options</button></div>}
    {places.truncated && <p>Location suggestions are limited. Shared city/neighborhood filters still work beyond these suggestions.</p>}
    <section aria-label="Search results" aria-busy={visible.loading || visible.moreLoading || false}>
      {visible.loading && <p role="status">Loading listings…</p>}
      {visible.error && <div role="alert"><p>{visible.error.message}</p><button className="btn btn-outline-secondary" onClick={() => visible.moreError && !['STALE_CURSOR', 'INVALID_CURSOR'].includes(visible.error.code) ? loadMore() : restart()}>
        {['STALE_CURSOR', 'INVALID_CURSOR'].includes(visible.error.code) ? 'Start again' : 'Retry results'}</button></div>}
      {!visible.loading && !visible.error && visible.total === 0 && <p>{applied.length ? 'No available items match these filters. Clear filters or try another search.' : 'No available items in this metro yet. Try another region or check back later.'}</p>}
      {Boolean(visible.items?.length) && <p role="status">Showing {visible.items.length} {visible.items.length === 1 ? 'item' : 'items'}</p>}
      <ul className="discovery-grid" aria-label="Available items">{visible.items?.map(item => <Card key={item.id} item={item} search={query} />)}</ul>
      {visible.page?.hasMore && <button className="btn btn-primary discovery-more" disabled={visible.moreLoading} onClick={loadMore}>{visible.moreLoading ? 'Loading more…' : 'Load more'}</button>}
    </section>
    </>}
  </main>;
}
function PublicItemDetail({ itemId }) {
  const auth = useAppContext();
  const viewer = auth?.status === 'authenticated' ? auth.user.id : 'anonymous';
  const scope = `${viewer}:${itemId}`;
  const location = useLocation();
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState({});
  const [message, setMessage] = useState('');
  useEffect(() => {
    let active = true;
    setResult({ key: scope, loading: true }); setMessage('');
    apiRequest(`/api/items/${encodeURIComponent(itemId)}`).then(data => { if (active) setResult({ key: scope, item: data.item }); })
      .catch(error => { if (active) setResult({ key: scope, error }); });
    const refresh = () => setAttempt(value => value + 1);
    window.addEventListener('focus', refresh);
    return () => { active = false; window.removeEventListener('focus', refresh); };
  }, [itemId, scope, attempt]);
  const current = result.key === scope ? result : { loading: true };
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
      <ItemLabels item={item} />
      <PickupWindow item={item} />
      <h2>Description</h2><p className="public-item-description">{item.description || 'No additional description provided.'}</p>
      {item.isOwner === true ? <p role="status">Your listing. Manage this item from My plans.</p> : item.isReserved === true ? <p role="status">This item has an accepted pickup. Check back if it becomes available.</p> : item.pickupTimeZone ? <><p>Pickup timezone: {item.pickupTimeZone}</p><Link className="btn btn-primary" to={`/app/items/${item.id}/request`} state={{ discoverySearch: previous }}>Request pickup</Link>
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
