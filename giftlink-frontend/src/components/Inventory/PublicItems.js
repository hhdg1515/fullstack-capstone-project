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
import { PageHeader, Surface, Feedback } from '../../design-system/primitives';
import './Discovery.css';
import PublicItemCard from './PublicItemCard';
import PublicItemGallery from './PublicItemPhotos';
import { validPickupTimeZone } from '../../forms/pickupTime';

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
  const auth = useAppContext(); const viewer = auth?.status === 'authenticated' ? auth.user.id : 'anonymous';
  const directory = usePublicCatalog('/api/regions'), catalog = usePublicCatalog('/api/item-taxonomy');
  const stateId = params.get('stateId') || '', metroId = params.get('metroId') || '';
  const selected = selectedMetro(directory.data, stateId, metroId);
  const invalidRegion = directory.data && ((stateId && !directory.data.states.some(row => row.id === stateId)) || (metroId && !selected));
  const regionCodes = selected ? selected.stateIds.map(id => directory.data.states.find(row => row.id === id)?.code).filter(Boolean).join('–') : '';
  const feedMatchesRegion = data => validFeed(data) && data.items.every(item => item.metroId === metroId && selected.stateIds.includes(item.stateId));
  const scope = `${viewer}:${query}`;
  const [fields, setFields] = useState(() => fieldsFrom(params));
  const [regionEditing, setRegionEditing] = useState(false);
  const regionPanel = useRef(), regionButton = useRef(), focusAfterRegion = useRef(false);
  const [filtersOpen, setFiltersOpen] = useState(false), [filterError, setFilterError] = useState('');
  const filterRegion = useRef(), filterToggle = useRef(), dateInput = useRef();
  const [attempt, setAttempt] = useState(0), [locationAttempt, setLocationAttempt] = useState(0);
  const [places, setPlaces] = useState({ locations: [] }), [result, setResult] = useState({});
  const revision = useRef(null), moreFlight = useRef(false), changedAvailability = useRef(null);
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
    const refreshedAvailability = changedAvailability.current === scope; changedAvailability.current = null;
    setResult({ key: scope, loading: Boolean(selected), items: [] });
    if (selected) apiRequest(`/api/items?${query}`, { validate: data => validFeed(data) && data.items.every(item => item.metroId === metroId && selected.stateIds.includes(item.stateId)) }).then(data => {
      if (current.active) setResult({ key: scope, items: data.items, total: data.total, page: data.page, refreshedAvailability });
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
  const canClear = (applied.length > 0 || Object.entries(fields).some(([name, value]) => !['stateId', 'metroId'].includes(name) && value && !((name === 'availability' && value === 'all') || (name === 'sort' && value === 'newest'))));
  const filterCount = applied.length - (params.get('q') ? 1 : 0);
  const closeFilters = () => {
    if (filterRegion.current?.contains(document.activeElement) || document.activeElement?.closest('.discovery-extra-option')) filterToggle.current?.focus();
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
      if (data.total !== visible.total) { changedAvailability.current = scope; setAttempt(value => value + 1); return; }
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
  return <main className="ui-page discovery-page discovery-feed">
    <JourneyNav journey="find" />
    <PageHeader title="Find free items" />
    <Surface aria-label="Browsing area" className={`discovery-area${selected ? ' discovery-area--selected' : ''}`}>
      {selected && <div className="discovery-area-heading">
        <p className="discovery-area-name">{selected.shortLabel || selected.label.split(', ')[0]}{regionCodes ? ` · ${regionCodes}` : ''}</p>
        <button ref={regionButton} type="button" className="ui-button ui-button--secondary" aria-expanded={regionEditing} aria-controls="discovery-region-options"
          onClick={() => setRegionEditing(value => !value)}>Change region</button>
      </div>}
      <div id="discovery-region-options" ref={regionPanel} hidden={Boolean(selected) && !regionEditing}>
        {!selected && <h2>Where would you like to find free items?</h2>}
        {invalidRegion && <p role="status">This area selection is not supported. Choose a listed state and metro.</p>}
        <div className="discovery-region-fields"><RegionFields directory={directory} values={{ stateId, metroId }} onChange={changeRegion}
          prefix="browse-region" browsing fieldClassName="ui-field" showHelp={false} /></div>
        <p className="discovery-help">Choose a metro to browse. Coverage uses {directory.data?.vintage?.metros || 'dated'} Census definitions; not every area is listed. No GPS or address needed.</p>
      </div>
    </Surface>
    {selected && <>
    <Surface as="form" aria-label="Search and filters" className={`discovery-filters${filtersOpen ? ' discovery-filters--expanded' : ''}${category ? ' discovery-filters--has-category' : ''}`} onSubmit={submit} noValidate
      onKeyDown={event => { if (event.key === 'Escape' && filtersOpen) { event.preventDefault(); closeFilters(); filterToggle.current?.focus(); } }}>
      <div className="ui-field discovery-search"><div className="discovery-search-heading"><label htmlFor="browse-q">Search items</label>
        <button type="button" ref={filterToggle} className="ui-button ui-button--secondary" aria-expanded={filtersOpen} aria-controls="discovery-common-options discovery-filter-options"
          onClick={() => filtersOpen ? closeFilters() : setFiltersOpen(true)}>Filters{filterCount ? ` (${filterCount})` : ''}</button></div>
        <input id="browse-q" name="q" maxLength={100} placeholder="Name, description or item type" value={fields.q} onChange={change} /></div>
      <div id="discovery-common-options" className="discovery-common-options">
        <div className="ui-field"><label htmlFor="browse-category">Category</label><select id="browse-category" name="categoryId" value={fields.categoryId} onChange={change} disabled={catalog.loading || Boolean(catalog.error)}>
          <option value="">All categories</option>{catalog.data?.categories.map(entry => <option value={entry.id} key={entry.id}>{entry.label}</option>)}
        </select></div>
        <div className="ui-field discovery-type-option"><label htmlFor="browse-type">Item type</label><select id="browse-type" name="itemTypeId" value={fields.itemTypeId} onChange={change} disabled={!category || catalog.loading || Boolean(catalog.error)}>
          <option value="">{category ? 'All item types' : 'Choose a category first'}</option>{category?.itemTypes.map(entry => <option value={entry.id} key={entry.id}>{entry.label}</option>)}
        </select></div>
        <div className="ui-field discovery-extra-option"><label htmlFor="browse-availability">Pickup availability</label><select id="browse-availability" name="availability" value={fields.availability} onChange={change}>
          <option value="all">Any pickup window</option><option value="now">Available Now</option><option value="later">Available Later</option><option value="date">On a selected date</option></select></div>
        {fields.availability === 'date' && <div className="ui-field discovery-extra-option"><label htmlFor="browse-date">Pickup date (UTC)</label>
          <input id="browse-date" ref={dateInput} type="date" name="date" required min={utcToday()} value={fields.date} onChange={change}
            aria-invalid={Boolean(filterError)} aria-describedby={filterError ? 'browse-date-error' : undefined} />
          {filterError && <p id="browse-date-error" role="alert" className="ui-field-error">{filterError}</p>}</div>}
        <div className="ui-field discovery-extra-option"><label htmlFor="browse-sort">Sort items</label><select id="browse-sort" name="sort" value={fields.sort} onChange={change}>
          <option value="newest">Newest publication</option><option value="deadline">Earliest pickup deadline</option></select></div>
      </div>
      <div id="discovery-filter-options" ref={filterRegion} className="discovery-options" hidden={!filtersOpen}>
        <div className="ui-field"><label htmlFor="browse-condition">Condition</label><select id="browse-condition" name="condition" value={fields.condition} onChange={change} disabled={catalog.loading || Boolean(catalog.error)}>
          <option value="">Any condition</option>{catalog.data?.conditions.map(entry => <option value={entry.id} key={entry.id}>{entry.label}</option>)}
        </select></div>
        <div className="ui-field"><label htmlFor="browse-city">City</label><select id="browse-city" name="city" value={city} onChange={change}><option value="">All cities</option>
          {cities.map(value => <option key={key(value)} value={value}>{value}</option>)}</select></div>
        <div className="ui-field"><label htmlFor="browse-neighborhood">Neighborhood</label><select id="browse-neighborhood" name="neighborhood" value={neighborhood} onChange={change}><option value="">All neighborhoods</option>
          {neighborhoods.map(value => <option key={key(value)} value={value}>{value}</option>)}</select></div>
      </div>
      {filtersOpen && <p className="discovery-help">Pickup windows use UTC calendar dates. City/neighborhood options belong to this metro.</p>}
      <div className="discovery-search-actions"><button className="ui-button">Find free items</button>{canClear && <button type="button" className="ui-button ui-button--secondary" onClick={clear}>Clear filters</button>}</div>
    </Surface>
    <p className="discovery-summary" aria-label="Applied filters">{applied.length ? applied.join(' · ') : 'No account needed to browse.'}</p>
    {catalog.error && <Feedback error><p>Item filter options are unavailable.</p><button className="ui-button ui-button--secondary" onClick={catalog.retry}>Retry item filters</button></Feedback>}
    {places.loading && <p role="status" className="discovery-help">Loading location options…</p>}
    {places.error && <Feedback error><p>Location options could not be loaded. You can still browse this metro.</p><button className="ui-button ui-button--secondary" onClick={() => setLocationAttempt(value => value + 1)}>Retry location options</button></Feedback>}
    {places.truncated && <p>Location suggestions are limited. Shared city/neighborhood filters still work beyond these suggestions.</p>}
    <section aria-label="Search results" aria-busy={visible.loading || visible.moreLoading || false}>
      {!visible.loading && !visible.error && Number.isSafeInteger(visible.total) && <h2 className="discovery-results-heading">{visible.total} available {visible.total === 1 ? 'item' : 'items'}</h2>}
      {visible.refreshedAvailability && <Feedback>Availability changed. Results have been refreshed.</Feedback>}
      {visible.loading && <Feedback>Loading listings…</Feedback>}
      {visible.error && <Feedback error><h2>Could not load items</h2><p>{visible.error.message}</p>{visible.moreError && <p>Previously loaded items are shown below. Refresh to confirm availability.</p>}<button className="ui-button ui-button--secondary" onClick={() => visible.moreError && !['STALE_CURSOR', 'INVALID_CURSOR'].includes(visible.error.code) ? loadMore() : restart()}>
        {['STALE_CURSOR', 'INVALID_CURSOR'].includes(visible.error.code) ? 'Start again' : 'Retry results'}</button></Feedback>}
      {!visible.loading && !visible.error && visible.total === 0 && <Surface className="discovery-empty"><h3>{applied.length ? 'Try a different filter' : 'No items here yet'}</h3><p>{applied.length ? 'No available items match these filters. Clear filters or try another search.' : 'No available items in this metro yet. Try another region or check back later.'}</p></Surface>}
      {Boolean(visible.items?.length) && !visible.error && <p role="status" className="discovery-loaded">Showing {visible.items.length} {visible.items.length === 1 ? 'item' : 'items'}</p>}
      <ul className="discovery-grid" aria-label="Available items">{visible.items?.map(item => <PublicItemCard key={item.id} item={item} search={query} stateCode={directory.data.states.find(row => row.id === item.stateId)?.code} />)}</ul>
      {visible.page?.hasMore && <button className="ui-button discovery-more" disabled={visible.moreLoading} onClick={loadMore}>{visible.moreLoading ? 'Loading more…' : 'Load more'}</button>}
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
  return <main className="ui-page plans-page discovery-page">
    <JourneyNav journey="find" discoverySearch={previous || ''} />
    <Link to={`/app/items${typeof previous === 'string' && previous.startsWith('?') ? previous : ''}`}>Back to free items</Link>
    {current.loading && <p role="status">Loading listing…</p>}
    {current.error && <div role="alert"><p>{current.error.status === 404 ? 'This listing is no longer available.' : current.error.message}</p>
      <button className="btn btn-outline-secondary ui-button ui-button--secondary" onClick={() => setAttempt(value => value + 1)}>Retry listing</button></div>}
    {item && <article className="plan-panel">
      <h1>{item.name}</h1><p>{item.neighborhood}, {item.city} · Free</p>
      <ItemLabels item={item} />
      <PublicItemGallery key={`${scope}:${attempt}`} item={item} />
      <PickupWindow item={item} />
      <h2>Description</h2><p className="public-item-description">{item.description || 'No additional description provided.'}</p>
      {item.isOwner === true ? <p role="status">Your listing. Manage this item from My plans.</p> : item.isReserved === true ? <p role="status">This item has an accepted pickup. Check back if it becomes available.</p> : item.pickupTimeZone ? <><p>Pickup timezone: {item.pickupTimeZone}</p><Link className="btn btn-primary ui-button" to={`/app/items/${item.id}/request`} state={{ discoverySearch: previous }}>Request pickup</Link>
        <p>A request does not reserve the item. The giver must accept an appointment.</p></> : <p>The giver needs to set a pickup timezone before this listing can receive requests.</p>}
      {typeof item.isReserved !== 'boolean' && <p>Current pickup availability will be checked when you send a request.</p>}
      {item.publishedAt && <p>First published: <time dateTime={item.publishedAt}>{formatDeadline(item.publishedAt.slice(0, 10))}</time>. Publication is separate from pickup dates.</p>}
      <div className="plan-field"><label htmlFor="share-listing">Share this listing</label><input id="share-listing" type="url" readOnly value={shareUrl} onFocus={event => event.target.select()} /></div>
      <button className="btn btn-outline-primary ui-button ui-button--secondary" onClick={copy}>Copy link</button>
      <button className="btn btn-outline-secondary ui-button ui-button--secondary" onClick={() => setAttempt(value => value + 1)}>Refresh listings</button>
      {message && <p role="status">{message}</p>}
    </article>}
  </main>;
}
export default function PublicItems() {
  const { itemId } = useParams();
  return itemId ? <PublicItemDetail key={itemId} itemId={itemId} /> : <Discovery />;
}
