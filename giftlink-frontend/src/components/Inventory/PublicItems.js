import React, { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useParams, useSearchParams } from 'react-router-dom';
import { apiRequest } from '../../api/client';
import { formatDeadline, isCalendarDate, utcToday } from '../MoveOutPlans/dates';
import '../MoveOutPlans/Plans.css';
import './Inventory.css';
import JourneyNav from '../Journeys/JourneyNav';
import { useAppContext } from '../../context/AuthContext';
import usePublicCatalog from '../../api/usePublicCatalog';
import { Feedback } from '../../design-system/primitives';
import './Discovery.css';
import PublicItemCard from './PublicItemCard';
import PublicItemGallery from './PublicItemPhotos';
import { validPickupTimeZone } from '../../forms/pickupTime';
import { placeLabel } from '../Pickups/placeLabel';

const normalize = value => value.trim().replace(/\s+/g, ' ');
const key = value => normalize(value).toLowerCase();
const fieldsFrom = params => ({ categoryId: params.get('categoryId') || '', itemTypeId: params.get('itemTypeId') || '', condition: params.get('condition') || '', q: params.get('q') || '', city: params.get('city') || '', neighborhood: params.get('neighborhood') || '',
  sort: params.get('sort') || 'newest' });
const laterPickup = item => (item.availability || (item.availableFrom && item.availableFrom > utcToday() ? 'later' : 'now')) === 'later';
function AvailabilityChip({ item }) {
  const later = laterPickup(item), known = item.isReserved !== true && item.pickupTimeZone !== null && typeof item.isReserved === 'boolean';
  return <span className={`ui-status${known ? (later ? ' ui-status--later' : ' ui-status--now') : ''}`}>
    {item.isReserved === true ? 'Pickup arranged' : item.pickupTimeZone === null ? 'Pickup setup needed' : typeof item.isReserved !== 'boolean' ? 'Pickup window' : later ? 'Available Later' : 'Available Now'}
  </span>;
}
function PickupWindow({ item }) {
  return <div className="public-item-window">
    <p><span>Pickup from</span>{item.availableFrom ? <time dateTime={item.availableFrom}>{formatDeadline(item.availableFrom)}</time> : <strong>Immediately</strong>}</p>
    <span className="public-item-window-arrow" aria-hidden="true">→</span>
    <p><span>Pickup until</span><time dateTime={item.effectiveAvailableUntil}>{formatDeadline(item.effectiveAvailableUntil)}</time></p>
  </div>;
}
function Specs({ item }) {
  const classification = item.classification || {};
  const rows = [['Type', classification.customItemType || classification.itemType?.label], ['Category', classification.category?.label || item.category], ['Condition', classification.condition?.label]]
    .filter(([, value]) => typeof value === 'string' && value);
  return rows.length ? <dl className="public-item-specs">{rows.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl> : null;
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
    typeof item.isOwner === 'boolean' && validPickupTimeZone(item.pickupTimeZone) && item.status === 'available' &&
    typeof item.city === 'string' && typeof item.neighborhood === 'string' && isCalendarDate(item.effectiveAvailableUntil) &&
    (item.availableFrom == null || (isCalendarDate(item.availableFrom) && item.availableFrom <= item.effectiveAvailableUntil)) &&
    ['now', 'later'].includes(item.availability) && (item.availability !== 'later' || isCalendarDate(item.availableFrom))) &&
  data.page && typeof data.page.hasMore === 'boolean' && (data.page.hasMore ? typeof data.page.nextCursor === 'string' && Boolean(data.page.nextCursor) : data.page.nextCursor === null);
const sameQuery = (a, b) => { const x = new URLSearchParams(a), y = new URLSearchParams(b); x.sort(); y.sort(); return x.toString() === y.toString(); };
function Discovery() {
  const [params, setParams] = useSearchParams(); const query = params.toString();
  const auth = useAppContext(); const viewer = auth?.status === 'authenticated' ? auth.user.id : auth?.status || 'anonymous';
  const directory = usePublicCatalog('/api/regions'), catalog = usePublicCatalog('/api/item-taxonomy');
  const stateId = params.get('stateId') || '', metroId = params.get('metroId') || '';
  const selected = selectedMetro(directory.data, stateId, metroId);
  const invalidRegion = directory.data && ((stateId && !directory.data.states.some(row => row.id === stateId)) || (metroId && !selected));
  const feedMatchesRegion = data => validFeed(data) && data.items.every(item => item.metroId === metroId && selected.stateIds.includes(item.stateId));
  const scope = `${viewer}:${query}`;
  const [fields, setFields] = useState(() => fieldsFrom(params));
  // Filters apply as they change; `pushed` marks URL updates that came from the
  // form itself so a slower URL round-trip never overwrites newer typing.
  const pushed = useRef(null);
  const [attempt, setAttempt] = useState(0), [locationAttempt, setLocationAttempt] = useState(0);
  const [places, setPlaces] = useState({ locations: [] }), [result, setResult] = useState({});
  const revision = useRef(null), moreFlight = useRef(false), changedAvailability = useRef(null);
  useEffect(() => {
    const own = pushed.current !== null && sameQuery(query, pushed.current); pushed.current = null;
    if (!own) setFields(fieldsFrom(new URLSearchParams(query)));
  }, [query]);
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
    const current = { active: true }; revision.current = current; moreFlight.current = false;
    const refreshedAvailability = changedAvailability.current === scope; changedAvailability.current = null;
    setResult({ key: scope, loading: Boolean(selected), items: [] });
    if (selected) apiRequest(`/api/items?${query}`, { validate: data => validFeed(data) && data.items.every(item => item.metroId === metroId && selected.stateIds.includes(item.stateId)) }).then(data => {
      if (current.active) setResult({ key: scope, items: data.items, total: data.total, page: data.page, dateMinimum: data.dateMinimum, refreshedAvailability });
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
  }, [stateId, metroId, selected, locationAttempt, viewer]);
  useEffect(() => {
    const refresh = () => { setAttempt(value => value + 1); setLocationAttempt(value => value + 1); };
    window.addEventListener('focus', refresh); return () => window.removeEventListener('focus', refresh);
  }, []);
  const visible = result.key === scope ? result : { loading: Boolean(selected), items: [] };
  const city = places.locations.find(place => key(place.city) === key(fields.city))?.city || normalize(fields.city);
  const neighborhoods = Array.from(new Map(places.locations.filter(place => !city || key(place.city) === key(city))
    .flatMap(place => place.neighborhoods).filter(Boolean).map(value => [key(value), value])).values()).sort((a, b) => a.localeCompare(b));
  const neighborhood = neighborhoods.find(value => key(value) === key(fields.neighborhood)) || normalize(fields.neighborhood);
  const cities = places.locations.map(place => place.city).filter(Boolean);
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
  if (params.get('sort') === 'deadline') applied.push('Sort: earliest pickup deadline');
  const canReset = applied.length > 0 || Object.entries(fields).some(([name, value]) => value && !(name === 'sort' && value === 'newest'));
  const metros = (directory.data?.metros || []).slice().sort((a, b) => a.label.localeCompare(b.label));
  const changeMetro = event => {
    const metro = directory.data.metros.find(row => row.id === event.target.value);
    const next = new URLSearchParams(query);
    for (const name of ['cursor', 'city', 'neighborhood']) next.delete(name);
    if (metro) { next.set('stateId', metro.stateIds.includes(stateId) ? stateId : metro.stateIds[0]); next.set('metroId', metro.id); }
    else { next.delete('stateId'); next.delete('metroId'); rememberRegion(); }
    setParams(next, { replace: sameQuery(next, query) });
  };
  const filterQuery = () => {
    const next = new URLSearchParams({ stateId, metroId });
    for (const [name, value] of Object.entries({ q: normalize(fields.q), city, neighborhood, categoryId: fields.categoryId, itemTypeId: fields.itemTypeId, condition: fields.condition, sort: fields.sort })) {
      if (value && !(name === 'sort' && value === 'newest')) next.set(name, value);
    }
    return next;
  };
  const apply = next => { pushed.current = next.toString(); setParams(next, { replace: true }); };
  useEffect(() => {
    if (!selected) return undefined;
    const next = filterQuery(); if (sameQuery(next, query)) return undefined;
    const timer = setTimeout(() => apply(next), 300);
    return () => clearTimeout(timer);
  }, [selected, query, fields, city, neighborhood]); // eslint-disable-line react-hooks/exhaustive-deps
  const submit = event => {
    event.preventDefault(); if (!selected) return;
    // Enter commits the search: show the normalized text the server receives.
    setFields(previous => ({ ...previous, q: normalize(previous.q) }));
    const next = filterQuery(); if (sameQuery(next, query)) setAttempt(value => value + 1); else apply(next);
  };
  const restart = () => { const next = new URLSearchParams(query); next.delete('cursor'); if (sameQuery(next, query)) setAttempt(value => value + 1); else setParams(next, { replace: true }); };
  const reset = () => {
    const next = new URLSearchParams({ stateId, metroId }); setFields(fieldsFrom(next));
    if (sameQuery(next, query)) setAttempt(value => value + 1); else { pushed.current = next.toString(); setParams(next); }
  };
  const loadMore = async () => {
    if (moreFlight.current || visible.loading || visible.moreLoading || !visible.page?.nextCursor) return;
    const current = revision.current, next = new URLSearchParams(query); next.set('cursor', visible.page.nextCursor);
    moreFlight.current = true; setResult(previous => ({ ...previous, moreLoading: true, error: null }));
    try {
      const data = await apiRequest(`/api/items?${next}`, { validate: feedMatchesRegion }); if (!current.active) return;
      if (data.total !== visible.total) { changedAvailability.current = scope; setAttempt(value => value + 1); return; }
      setResult(previous => ({ ...previous, moreLoading: false, page: data.page,
        items: Array.from(new Map([...previous.items, ...data.items].map(item => [item.id, item])).values()) }));
    } catch (error) {
      if (current.active) setResult(previous => ({ ...previous, moreLoading: false, error, moreError: true,
        page: ['STALE_CURSOR', 'INVALID_CURSOR'].includes(error.code) ? { hasMore: false, nextCursor: null } : previous.page }));
    } finally { if (current.active) moreFlight.current = false; }
  };
  const change = event => {
    const { name, value } = event.target;
    setFields(previous => ({ ...previous, [name]: value, ...(name === 'city' ? { neighborhood: '' } : {}), ...(name === 'categoryId' ? { itemTypeId: '' } : {}) }));
  };
  const filtersOff = !selected || catalog.loading || Boolean(catalog.error);
  const chip = (label, pressed, onClick) => <button type="button" key={label} className="discovery-chip" aria-pressed={pressed} disabled={filtersOff} onClick={onClick}>{label}</button>;
  return <main className="ui-page discovery-page discovery-feed">
    <div className="discovery-head">
      <h1>Find items</h1>
      <JourneyNav journey="find" />
    </div>
    {directory.error && <Feedback error><p>Region options are unavailable.</p><button className="ui-button ui-button--secondary" onClick={directory.retry}>Retry region options</button></Feedback>}
    {directory.loading && <p role="status" className="discovery-help">Loading region options…</p>}
    <form aria-label="Search and filters" className="discovery-filters" onSubmit={submit} noValidate>
      {/* Where (metro → city → neighborhood) and search share one command bar. */}
      <div className="discovery-bar">
        <div className="discovery-where" role="group" aria-label="Where">
          <div className="discovery-segment"><label htmlFor="browse-metro">Metro area</label><select id="browse-metro" name="metroId" value={selected ? selected.id : ''} onChange={changeMetro} disabled={directory.loading || Boolean(directory.error)}>
            <option value="">{directory.loading ? 'Loading metro areas…' : 'Choose a metro area'}</option>{metros.map(metro => <option key={metro.id} value={metro.id}>{metro.label}</option>)}</select></div>
          <div className="discovery-segment"><label htmlFor="browse-city">City</label><select id="browse-city" name="city" value={city} onChange={change} disabled={!selected}><option value="">All cities</option>
            {cities.map(value => <option key={key(value)} value={value}>{value}</option>)}</select></div>
          <div className="discovery-segment"><label htmlFor="browse-neighborhood">Neighborhood</label><select id="browse-neighborhood" name="neighborhood" value={neighborhood} onChange={change} disabled={!selected}><option value="">All neighborhoods</option>
            {neighborhoods.map(value => <option key={key(value)} value={value}>{value}</option>)}</select></div>
        </div>
        <div className="discovery-segment discovery-search"><label htmlFor="browse-q">Search items</label>
          <input id="browse-q" name="q" maxLength={100} placeholder="Name, description or item type" value={fields.q} onChange={change} disabled={!selected} /></div>
      </div>
      <div className="discovery-row">
        <div className="discovery-chips" role="group" aria-label="Category">
          {chip('All', !fields.categoryId, () => setFields(previous => ({ ...previous, categoryId: '', itemTypeId: '' })))}
          {catalog.data?.categories.map(entry => chip(entry.label, fields.categoryId === entry.id,
            () => setFields(previous => ({ ...previous, categoryId: previous.categoryId === entry.id ? '' : entry.id, itemTypeId: '' }))))}
        </div>
        <div className="discovery-pills">
          <div className="discovery-pill"><label htmlFor="browse-condition">Condition</label><select id="browse-condition" name="condition" value={fields.condition} onChange={change} disabled={filtersOff}>
            <option value="">Any</option>{catalog.data?.conditions.map(entry => <option value={entry.id} key={entry.id}>{entry.label}</option>)}
          </select></div>
          <div className="discovery-pill"><label htmlFor="browse-sort">Sort items</label><select id="browse-sort" name="sort" value={fields.sort} onChange={change} disabled={!selected}>
            <option value="newest">Newest</option><option value="deadline">Earliest deadline</option></select></div>
          {selected && canReset && <button type="button" className="discovery-reset" onClick={reset}>Reset</button>}
        </div>
      </div>
      {category && <div className="discovery-chips discovery-type-chips" role="group" aria-label="Item type">
        <span aria-hidden="true">Item type</span>
        {chip('All item types', !fields.itemTypeId, () => setFields(previous => ({ ...previous, itemTypeId: '' })))}
        {category.itemTypes.map(entry => chip(entry.label, fields.itemTypeId === entry.id, () => setFields(previous => ({ ...previous, itemTypeId: entry.id }))))}
      </div>}
      {invalidRegion && <p role="status" className="discovery-help">This area is not supported. Choose a listed metro area.</p>}
    </form>
    {!selected && !directory.loading && !directory.error && <div className="discovery-first"><h2>Choose a metro area</h2><p>Pick a metro area above to see items near you.</p></div>}
    {selected && <>
    {catalog.error && <Feedback error><p>Item filter options are unavailable.</p><button className="ui-button ui-button--secondary" onClick={catalog.retry}>Retry item filters</button></Feedback>}
    {places.loading && <p role="status" className="discovery-help">Loading location options…</p>}
    {places.error && <Feedback error><p>Location options could not be loaded. You can still browse this metro.</p><button className="ui-button ui-button--secondary" onClick={() => setLocationAttempt(value => value + 1)}>Retry location options</button></Feedback>}
    {places.truncated && <p>Location suggestions are limited. Shared city/neighborhood filters still work beyond these suggestions.</p>}
    <section aria-label="Search results" aria-busy={visible.loading || visible.moreLoading || false}>
      <div className="discovery-results-head">
        {!visible.loading && !visible.error && Number.isSafeInteger(visible.total) && <h2 className="discovery-results-heading"><span className="discovery-count">{visible.total}</span> available {visible.total === 1 ? 'item' : 'items'}</h2>}
        {visible.loading && <p role="status" className="discovery-loading">Loading listings…</p>}
        <p className="discovery-summary" aria-label="Applied filters">{applied.length ? applied.join(' · ') : 'No account needed to browse.'}</p>
      </div>
      {visible.refreshedAvailability && <Feedback>Availability changed. Results have been refreshed.</Feedback>}
      {visible.loading && !visible.items?.length && <ul className="discovery-grid discovery-skeleton" aria-hidden="true">{[1, 2, 3, 4, 5, 6, 7, 8].map(n => <li key={n}><span /><span /><span /></li>)}</ul>}
      {visible.error && <div role="alert" className="discovery-error"><h2>Could not load items</h2><p>{visible.error.message}</p>{visible.moreError && <p>Previously loaded items are shown below. Refresh to confirm availability.</p>}<button className="ui-button" onClick={() => visible.moreError && !['STALE_CURSOR', 'INVALID_CURSOR'].includes(visible.error.code) ? loadMore() : restart()}>
        {['STALE_CURSOR', 'INVALID_CURSOR'].includes(visible.error.code) ? 'Start again' : 'Retry results'}</button></div>}
      {!visible.loading && !visible.error && visible.total === 0 && <div className="discovery-empty"><h3>{applied.length ? 'Try a different filter' : 'No items here yet'}</h3><p>{applied.length ? 'No available items match these filters. Reset or try another search.' : 'No available items in this metro yet. Try another region or check back later.'}</p></div>}
      <ul className="discovery-grid" aria-label="Available items">{visible.items?.map(item => <PublicItemCard key={item.id} item={item} search={query} stateCode={directory.data.states.find(row => row.id === item.stateId)?.code} />)}</ul>
      {Boolean(visible.items?.length) && !visible.error && <p role="status" className="discovery-loaded">Showing {visible.items.length} {visible.items.length === 1 ? 'item' : 'items'}</p>}
      {visible.page?.hasMore && <button className="ui-button discovery-more" disabled={visible.moreLoading} onClick={loadMore}>{visible.moreLoading ? 'Loading more…' : 'Load more'}</button>}
    </section>
    </>}
  </main>;
}
function PublicItemDetail({ itemId }) {
  const auth = useAppContext();
  const viewer = auth?.status === 'authenticated' ? auth.user.id : auth?.status || 'anonymous';
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
  // The copy confirmation is a short toast.
  useEffect(() => { if (!message) return undefined; const timer = setTimeout(() => setMessage(''), 2500); return () => clearTimeout(timer); }, [message]);
  const owner = item?.isOwner === true;
  return <main className="ui-page discovery-page public-item-page">
    <JourneyNav journey="find" discoverySearch={previous || ''} />
    <Link className="public-item-back" to={`/app/items${typeof previous === 'string' && previous.startsWith('?') ? previous : ''}`}><span aria-hidden="true">←</span>Back to items</Link>
    {current.loading && <p role="status">Loading listing…</p>}
    {current.error && <div role="alert"><p>{current.error.status === 404 ? 'This listing is no longer available.' : current.error.message}</p>
      <button className="ui-button ui-button--secondary" onClick={() => setAttempt(value => value + 1)}>Retry listing</button></div>}
    {item && <article className="public-item-layout">
      <div className="public-item-main">
        <PublicItemGallery key={`${scope}:${attempt}`} item={item} />
        <section className="public-item-about"><h2>Description</h2><p className="public-item-description">{item.description || 'No additional description provided.'}</p></section>
      </div>
      <aside className="public-item-aside">
        <div className="public-item-chips"><AvailabilityChip item={item} />{owner && <span className="ui-status ui-status--owner">Your listing</span>}</div>
        <div className="public-item-heading"><h1>{item.name}</h1><p>{placeLabel(item)}</p></div>
        <Specs item={item} />
        <PickupWindow item={item} />
        <div className="public-item-action">
          {owner && auth?.status === 'authenticated' && <Link className="ui-button public-item-cta" to={`/app/items/${item.id}/edit`}>{item.listingModel === 2 ? 'Manage listing' : 'Edit item'}</Link>}
          {owner ? <p role="status">Your listing.</p> : item.isReserved === true ? <p role="status">This item has an accepted pickup. Check back if it becomes available.</p> : item.pickupTimeZone ? <><Link className="ui-button public-item-cta" to={`/app/items/${item.id}/request`} state={{ discoverySearch: previous }}>Request pickup<span aria-hidden="true">→</span></Link>
            <p>A request does not reserve the item. The giver must accept an appointment.</p></> : <p>The giver needs to set a pickup timezone before this listing can receive requests.</p>}
          {typeof item.isReserved !== 'boolean' && <p>Current pickup availability will be checked when you send a request.</p>}
        </div>
        <div className="public-item-share">
          <label htmlFor="share-listing">Share this listing</label>
          <div><input id="share-listing" type="url" readOnly value={shareUrl} onFocus={event => event.target.select()} /><button className="ui-button ui-button--secondary" onClick={copy}>Copy link</button></div>
          {message && <p role="status" className="public-item-toast">{message}</p>}
          <p className="public-item-published">{item.publishedAt && <>First published: <time dateTime={item.publishedAt}>{formatDeadline(item.publishedAt.slice(0, 10))}</time>. Publication is separate from pickup dates. </>}
            <button className="public-item-refresh" onClick={() => setAttempt(value => value + 1)}>Refresh listings</button></p>
        </div>
      </aside>
    </article>}
  </main>;
}
export default function PublicItems() {
  const { itemId } = useParams();
  return itemId ? <PublicItemDetail key={itemId} itemId={itemId} /> : <Discovery />;
}
