import React, { useEffect, useRef, useState } from 'react';
import { Link, Navigate, useParams } from 'react-router-dom';
import ListingFormView from './ListingForm';
import { listOwnerListings, getOwnerListing, actOnOwnerListing } from '../../api/ownerListings';
import Inventory from '../Inventory/Inventory';
import { PageHeader, Surface, Feedback } from '../../design-system/primitives';
import { urlConfig } from '../../config';
import './Listings.css';
const statuses = { draft: 'Draft', available: 'Published', unlisted: 'Withdrawn', cleared: 'Cleared', expired: 'Expired' };

function Failure({ error, retry, restart }) {
  const disabled = error?.code === 'OWNER_LISTINGS_DISABLED';
  return <div role="alert"><p>{disabled ? 'My Listings is temporarily unavailable. Existing plan inventory is still available.' : error.message}</p>
    {!disabled && restart && <button className="ui-button" onClick={restart}>Refresh listings</button>}
    {!disabled && !restart && retry && <button className="ui-button" onClick={retry}>Retry</button>}
    <Link to="/app/plans">Existing plan inventory</Link></div>;
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
  useEffect(() => { if (!busy && nextFocus.current) { document.getElementById('owner-listing-' + nextFocus.current)?.focus(); nextFocus.current = null; } }, [items, busy]);
  const badCursor = error && [400,409].includes(error.status);
  return <main className="ui-page owner-listings"><PageHeader title="My Listings" action={error?.code !== 'OWNER_LISTINGS_DISABLED' && <Link className="ui-button" to="/app/listings/new">Create Listing</Link>} />
    <p><Link to="/app/pickups/incoming">Incoming requests</Link></p>
    {busy && <Feedback>Loading listings…</Feedback>}{error && <Failure error={error} retry={() => load(failedMore.current)} restart={badCursor ? () => load(false) : undefined} />}
    {loaded && !items.length && !busy && !error && <Surface><p>No listings yet.</p><p>Save a private draft with just an item name.</p></Surface>}
    <ul className="owner-listing-grid" aria-label="Your listings" aria-busy={busy}>{items.map(item => <Surface as="li" key={item.id}>
      <OwnerPreview key={item.id + ':' + (item.photoPreview?.images?.[0]?.id || '')} item={item} />
      <h2><Link id={'owner-listing-' + item.id} to={'/app/listings/' + item.id}>{item.name}</Link></h2>
      <p>{item.classification?.itemType?.label || 'Type not selected'}{item.classification?.category?.label ? ' · ' + item.classification.category.label : ''}</p>
      {item.classification?.condition?.label && <p>{item.classification.condition.label}</p>}
      <p>{statuses[item.status] || 'Status unavailable'}{item.pickupSummary?.reserved ? ' · Reserved' : ''}</p>
      <p>{[item.location.metroLabel, item.location.stateLabel, item.location.city, item.location.neighborhood].filter(Boolean).join(' · ') || 'Location not selected'}</p>
      <p>{item.pickup.availableUntil ? 'Pickup deadline: ' + item.pickup.availableUntil + (item.pickup.datePolicy === 'utc-calendar' ? ' (UTC)' : item.pickup.timeZone ? ' (' + item.pickup.timeZone + ')' : ' (timezone not selected)') : 'No pickup deadline'}</p>
      {(item.capabilities.editDraft || item.capabilities.legacyEditor) && <Link className="ui-button ui-button--secondary" aria-label={'Edit ' + item.name} to={'/app/items/' + item.id + '/edit'}>Edit listing</Link>}</Surface>)}</ul>
    {cursor && !error && <button className="ui-button" disabled={busy} onClick={() => load(true)}>Load More</button>}
    {!error && <p><Link to="/app/plans">Existing plan inventory</Link></p>}</main>;
}
export function ListingDetail() {
  const { itemId } = useParams(); const [state, setState] = useState({}); const [attempt, setAttempt] = useState(0);
  const [actionError, setActionError] = useState(null), [acting, setActing] = useState(false), [confirmation, setConfirmation] = useState(null);
  const active = useRef(true), actionPending = useRef(false);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  const act = async (action, confirmed = false) => {
    if (actionPending.current || !state.item) return; actionPending.current = true; setActing(true); setActionError(null);
    try { const result = await actOnOwnerListing(itemId, { action, version: state.item.version, ...(confirmed ? { confirmCancelRequests: true } : {}) }); if (active.current) { setState(result); setConfirmation(null); } }
    catch (error) { if (active.current) { if (error.code === 'PICKUP_CONFIRMATION_REQUIRED') setConfirmation(error); else { setActionError(error); setConfirmation(null); } } }
    finally { actionPending.current = false; if (active.current) setActing(false); }
  };
  useEffect(() => { let active = true; setState({}); getOwnerListing(itemId).then(result => active && setState(result)).catch(error => active && setState({ error })); return () => { active = false; }; }, [itemId, attempt]);
  const item = state.item;
  return <main className="ui-page"><Link to="/app/listings">My Listings</Link>{state.error ? <Failure error={state.error} retry={() => setAttempt(n => n + 1)} /> : !item ? <p role="status">Loading listing…</p> : <>
    <PageHeader title={item.name} /><p>{statuses[item.status] || 'Status unavailable'}</p><p>{item.description || 'No description yet.'}</p>
    <p>{item.classification?.itemType?.label || 'Type not selected'}{item.classification?.category?.label ? ' · ' + item.classification.category.label : ''}</p>
    {item.classification?.condition?.label && <p>{item.classification.condition.label}</p>}
    <p>{[item.location.stateLabel, item.location.metroLabel, item.location.city, item.location.neighborhood].filter(Boolean).join(' · ') || 'Location not selected'}</p>
    {item.pickup.availableFrom && <p>Available from: {item.pickup.availableFrom}</p>}
    <p>Pickup deadline: {item.pickup.availableUntil || 'Not selected'}{item.pickup.datePolicy === 'utc-calendar' ? ' (UTC)' : ''}</p>
    <p>Pickup timezone: {item.pickup.timeZone || 'Not selected'}{item.pickup.datePolicy !== 'utc-calendar' && item.pickup.timeZone ? item.pickup.timeZoneConfirmed ? ' · Confirmed' : ' · Confirmation needed' : ''}</p>
    {(item.capabilities.editDraft || item.capabilities.legacyEditor) && <Link className="ui-button" to={'/app/items/' + item.id + '/edit'}>Edit listing</Link>}
    {!item.capabilities.legacyEditor && <>
      {actionError && <Feedback error>{actionError.message}{actionError.fields?.map(field => <p key={field.field}>{field.message}</p>)} <button className="ui-button ui-button--secondary" onClick={() => setAttempt(n => n + 1)}>Refresh listing</button></Feedback>}
      {item.capabilities.publish && <button className="ui-button" disabled={acting} onClick={() => act('publish')}>Publish listing</button>}
      {item.status === 'draft' && !item.capabilities.publish && <p>Private draft. Public publishing is not available yet.</p>}
      {item.status === 'available' && <p><Link to={'/app/items/' + item.id}>View public listing</Link> · <Link to="/app/pickups/incoming">Incoming requests</Link></p>}
      {item.capabilities.withdraw && <button className="ui-button ui-button--secondary" disabled={acting} onClick={() => act('withdraw')}>Withdraw listing</button>}
      {confirmation && <Surface role="alert" aria-label="Confirm withdrawal"><p>{confirmation.message}</p>
        <button className="ui-button" disabled={acting} onClick={() => act('withdraw', true)}>Withdraw and cancel requests</button>
        <button className="ui-button ui-button--secondary" disabled={acting} onClick={() => setConfirmation(null)}>Keep listing</button></Surface>}
      <h2>Photos</h2><ListingPhotos item={item} />
    </>}

  </>}</main>;
}
export function ListingEditor() {
  const { itemId } = useParams(); const [state, setState] = useState({});
  useEffect(() => { let active = true; setState({}); getOwnerListing(itemId).then(result => active && setState(result)).catch(error => active && setState({ error })); return () => { active = false; }; }, [itemId]);
  if (state.item?.capabilities.legacyEditor || state.error?.code === 'OWNER_LISTINGS_DISABLED') return <Inventory />;
  if (state.error) return <main className="ui-page"><Failure error={state.error} /></main>;
  if (!state.item) return <p role="status">Loading listing…</p>;
  if (!state.item.capabilities.editDraft) return <Navigate replace to={'/app/listings/' + itemId} />;
  return <ListingFormView key={itemId} item={state.item} photoCapabilities={state.photoCapabilities || null} publicationEnabled={state.publicationEnabled === true} />;
}
// Owner-only private thumbnails of an independent draft (UX-2C1); no public URL.
function ListingPhotos({ item }) {
  const [failed, setFailed] = useState({});
  const preview = item.photoPreview || {};
  if (preview.availability === 'ready') return <ul className="owner-listing-photos" aria-label="Saved photos">{preview.images.filter(image => /^[a-f0-9]{24}$/.test(image.id)).map((image, index) =>
    <li key={image.id}>{failed[image.id] ? <span>Photo unavailable</span> : <img width="120" height="90" alt={'Saved photo ' + (index + 1) + (index === 0 ? ', cover' : '')} crossOrigin="use-credentials" loading="lazy" decoding="async"
      src={`${urlConfig.backendUrl}/api/item-images/${image.id}/thumbnail`} onError={() => setFailed(old => ({ ...old, [image.id]: true }))} />}</li>)}</ul>;
  if (preview.availability === 'unavailable') return <p>Photos are temporarily unavailable.</p>;
  if (item.capabilities.photos) return <p>No photos yet. Edit the listing to add up to 5 photos.</p>;
  return <p>Photos are not available for independent drafts yet.</p>;
}
// Create Listing learns the server's independent-photo capability; the form
// renders immediately and photos appear only if the server allows them.
export function ListingForm() {
  const [photoCapabilities, setPhotoCapabilities] = useState(null), [publicationEnabled, setPublicationEnabled] = useState(false);
  useEffect(() => { let active = true; listOwnerListings({ limit: 1 }).then(result => { if (active) { setPhotoCapabilities(result.photoCapabilities || null); setPublicationEnabled(result.publicationEnabled === true); } }).catch(() => {}); return () => { active = false; }; }, []);
  return <ListingFormView photoCapabilities={photoCapabilities} publicationEnabled={publicationEnabled} />;
}
