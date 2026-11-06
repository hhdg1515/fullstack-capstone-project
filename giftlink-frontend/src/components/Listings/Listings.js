import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom';
import ListingFormView from './ListingForm';
import { listOwnerListings, getOwnerListing, actOnOwnerListing } from '../../api/ownerListings';
import Inventory from '../Inventory/Inventory';
import { PageHeader, Surface, Feedback } from '../../design-system/primitives';
import { urlConfig } from '../../config';
import './Listings.css';
const statuses = { draft: 'Draft', available: 'Published', unlisted: 'Withdrawn', cleared: 'Cleared', expired: 'Expired' };

function Failure({ error, retry, restart }) {
  const disabled = error?.code === 'OWNER_LISTINGS_DISABLED';
  return <div role="alert"><p>{disabled ? 'My Listings is temporarily unavailable.' : error.message}</p>
    {!disabled && restart && <button className="ui-button" onClick={restart}>Refresh listings</button>}
    {!disabled && !restart && retry && <button className="ui-button" onClick={retry}>Retry</button>}</div>;
}
function OwnerPreview({ item }) {
  const [failed, setFailed] = useState(false);
  const image = item.photoPreview?.images?.[0];
  const ready = item.photoPreview?.availability === 'ready' && /^[a-f0-9]{24}$/.test(image?.id);
  return <div className="owner-listing-preview">{ready && !failed ? <img width="120" height="90" alt={item.name} crossOrigin="use-credentials" loading="lazy" decoding="async" src={`${urlConfig.backendUrl}/api/item-images/${image.id}/thumbnail`} onError={() => setFailed(true)} /> :
    <span>{failed || item.photoPreview?.availability === 'unavailable' ? 'Photo unavailable' : item.photoPreview?.availability === 'disabled' ? 'Photos unavailable' : 'No photo'}</span>}</div>;
}
export function MyListings() {
  const [items, setItems] = useState([]), [cursor, setCursor] = useState(null), [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false), [error, setError] = useState(null); const pending = useRef(false), alive = useRef(false), failedMore = useRef(false), nextFocus = useRef(null);
  const load = async more => {
    if (pending.current) return; pending.current = true; setBusy(true); setError(null); failedMore.current = more;
    try { const result = await listOwnerListings(more ? { cursor } : {}); if (!alive.current) return;
      if (more) nextFocus.current = result.items.find(item => !items.some(row => row.id === item.id))?.id;
      setItems(old => more ? [...old, ...result.items.filter(item => !old.some(row => row.id === item.id))] : result.items); setCursor(result.nextCursor); setLoaded(true); }
    catch (failure) { if (alive.current) setError(failure); } finally { pending.current = false; if (alive.current) setBusy(false); }
  };
  useEffect(() => { alive.current = true; load(false); return () => { alive.current = false; }; }, []); // eslint-disable-line react-hooks/exhaustive-deps
  // Layout effect: move focus in the same commit that shows the new card.
  useLayoutEffect(() => { if (!busy && nextFocus.current) { document.getElementById('owner-listing-' + nextFocus.current)?.focus(); nextFocus.current = null; } }, [items, busy]);
  const badCursor = error && [400,409].includes(error.status);
  return <main className="ui-page owner-listings"><PageHeader title="My Listings" action={error?.code !== 'OWNER_LISTINGS_DISABLED' && <Link className="ui-button" to="/app/listings/new">Create Listing</Link>} />
    <p><Link to="/app/pickups/incoming">Incoming requests</Link></p>
    {busy && <Feedback>Loading listings…</Feedback>}{error && <Failure error={error} retry={() => load(failedMore.current)} restart={badCursor ? () => load(false) : undefined} />}
    {loaded && !items.length && !busy && !error && <Surface><p>No listings yet.</p><p>Save a private draft with just an item name.</p></Surface>}
    <ul className="owner-listing-grid" aria-label="Your listings" aria-busy={busy}>{items.map(item => <Surface as="li" key={item.id}>
      {item.pendingRequests > 0 && <Link className="owner-listing-requests" to="/app/pickups/incoming" aria-label={item.pendingRequests + (item.pendingRequests === 1 ? ' pickup request' : ' pickup requests') + ' for ' + item.name}>
        {item.pendingRequests} {item.pendingRequests === 1 ? 'request' : 'requests'}</Link>}
      <OwnerPreview key={item.id + ':' + (item.photoPreview?.images?.[0]?.id || '')} item={item} />
      <h2>{item.status === 'available' ? <Link id={'owner-listing-' + item.id} to={'/app/items/' + item.id}>{item.name}</Link> :
        item.capabilities.editDraft || item.capabilities.legacyEditor ? <Link id={'owner-listing-' + item.id} to={'/app/items/' + item.id + '/edit'}>{item.name}</Link> : <Link id={'owner-listing-' + item.id} to={'/app/listings/' + item.id}>{item.name}</Link>}</h2>
      <p>{item.classification?.itemType?.label || 'Type not selected'}{item.classification?.category?.label ? ' · ' + item.classification.category.label : ''}</p>
      <p className="owner-listing-condition" aria-hidden={!item.classification?.condition?.label || undefined}>{item.classification?.condition?.label || '\u00a0'}</p>
      <p>{statuses[item.status] || 'Status unavailable'}{item.pickupSummary?.reserved ? ' · Reserved' : ''}</p>
      <p>{[item.location.metroLabel, item.location.stateLabel, item.location.city, item.location.neighborhood].filter(Boolean).join(' · ') || 'Location not selected'}</p>
      <p>{item.pickup.availableUntil ? 'Pickup deadline: ' + item.pickup.availableUntil : 'No pickup deadline'}</p>
      {(item.capabilities.editDraft || item.capabilities.legacyEditor) ? <Link className="ui-button ui-button--secondary" aria-label={'Manage ' + item.name} to={'/app/items/' + item.id + '/edit'}>Manage listing</Link> : <Link className="ui-button ui-button--secondary" aria-label={'View ' + item.name} to={'/app/listings/' + item.id}>View listing</Link>}</Surface>)}</ul>
    {cursor && !error && <button className="ui-button" disabled={busy} onClick={() => load(true)}>Load More</button>}</main>;
}
// Editable listings keep their established editor route. Closed listings have
// an owner-only read view instead of losing their detail entry altogether.
export function ListingRedirect() {
  const { itemId } = useParams();
  return <SavedListing key={itemId} itemId={itemId} />;
}
function SavedListing({ itemId }) {
  const [state, setState] = useState({}), [attempt, setAttempt] = useState(0);
  const [busy, setBusy] = useState(false), [blocked, setBlocked] = useState(false), [error, setError] = useState(null);
  const alive = useRef(false), flight = useRef(false); const navigate = useNavigate();
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => {
    let active = true; setState({});
    getOwnerListing(itemId).then(result => {
      if (result?.item?.id !== itemId) throw new Error('This listing is unavailable.');
      if (active) { setState(result); setBlocked(false); setError(null); }
    }).catch(failure => { if (active) setState({ error: failure }); });
    return () => { active = false; };
  }, [itemId, attempt]);
  const item = state.item;
  const relist = async () => {
    if (flight.current || blocked || !item?.capabilities.reopenDraft) return;
    if (!window.confirm('Restore this item as a private draft? Previous pickup requests and conversations will stay closed. You must publish it again.')) return;
    flight.current = true; setBusy(true); setError(null);
    try {
      const result = await actOnOwnerListing(itemId, { action: 'reopen', version: item.version, confirmRelist: true });
      if (!alive.current) return;
      if (result?.item?.id !== itemId || result.item.status !== 'draft' || result.item.version <= item.version) throw new Error('Restoring could not be confirmed. Check the listing before trying again.');
      navigate('/app/items/' + itemId + '/edit', { replace: true });
    } catch (failure) { if (alive.current) { setError(failure); setBlocked(true); } }
    finally { if (alive.current) { flight.current = false; setBusy(false); } }
  };
  if (item?.capabilities.editDraft || item?.capabilities.legacyEditor || state.error?.code === 'OWNER_LISTINGS_DISABLED') return <Navigate replace to={'/app/items/' + itemId + '/edit'} />;
  const rows = item ? [
    ['Status', statuses[item.status] || 'Status unavailable'],
    ['Type', item.classification?.customItemType || item.classification?.itemType?.label],
    ['Category', item.classification?.category?.label], ['Condition', item.classification?.condition?.label],
    ['Pickup area', [item.location.metroLabel, item.location.stateLabel, item.location.city, item.location.neighborhood].filter(Boolean).join(' · ')],
    ['Pickup deadline', item.pickup.availableUntil], ['Pickup timezone', item.pickup.timeZone]
  ].filter(([, value]) => value) : [];
  return <main className="ui-page owner-listing-detail">
    <Link to="/app/listings">Back to My Listings</Link>
    {!item && !state.error && <p role="status">Loading listing…</p>}
    {state.error && <Failure error={state.error} retry={() => setAttempt(value => value + 1)} />}
    {item && <><PageHeader title={item.name} action={item.capabilities.reopenDraft && <button className="ui-button" disabled={busy || blocked} onClick={relist}>Relist as draft</button>} />
      {error && <Feedback error><p>{error.message}</p><button className="ui-button ui-button--secondary" disabled={busy} onClick={() => setAttempt(value => value + 1)}>Check listing</button></Feedback>}
      <Surface>
        {item.photoPreview?.availability === 'ready' && item.photoPreview.images.length > 0 ? <ul className="owner-listing-photos" aria-label="Saved photos">
          {item.photoPreview.images.slice(0, 5).map((image, index) => <li key={image.id}><OwnerPreview item={{ ...item, name: item.name + ' — photo ' + (index + 1), photoPreview: { availability: 'ready', images: [image] } }} /></li>)}
        </ul> : <OwnerPreview item={item} />}
        {item.description && <p className="owner-listing-description">{item.description}</p>}
        <dl className="owner-listing-facts">{rows.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
      </Surface></>}
  </main>;
}
export function ListingEditor() {
  const { itemId } = useParams(); const [state, setState] = useState({});
  useEffect(() => { let active = true; setState({}); getOwnerListing(itemId).then(result => active && setState(result)).catch(error => active && setState({ error })); return () => { active = false; }; }, [itemId]);
  if (state.item?.capabilities.legacyEditor || state.error?.code === 'OWNER_LISTINGS_DISABLED') return <Inventory />;
  if (state.error) return <main className="ui-page"><Failure error={state.error} /></main>;
  if (!state.item) return <p role="status">Loading listing…</p>;
  if (!state.item.capabilities.editDraft) return <Navigate replace to={'/app/listings/' + itemId} />;
  return <ListingFormView key={itemId} item={state.item} photoCapabilities={state.photoCapabilities || null} publicationEnabled={state.publicationEnabled === true}
    withdraw={state.item.capabilities.withdraw ? confirmed => actOnOwnerListing(itemId, { action: 'withdraw', version: state.item.version, ...(confirmed ? { confirmCancelRequests: true } : {}) }) : null} />;
}
// Create Listing learns the server's independent-photo capability; the form
// renders immediately and photos appear only if the server allows them.
export function ListingForm() {
  const [photoCapabilities, setPhotoCapabilities] = useState(null), [publicationEnabled, setPublicationEnabled] = useState(false);
  useEffect(() => { let active = true; listOwnerListings({ limit: 1 }).then(result => { if (active) { setPhotoCapabilities(result.photoCapabilities || null); setPublicationEnabled(result.publicationEnabled === true); } }).catch(() => {}); return () => { active = false; }; }, []);
  return <ListingFormView photoCapabilities={photoCapabilities} publicationEnabled={publicationEnabled} />;
}
