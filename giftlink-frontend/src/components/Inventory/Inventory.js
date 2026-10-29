import React, { useEffect, useRef, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { useAppContext } from '../../context/AuthContext';
import { confirmPickupChanges } from '../../api/confirmPickupChanges';
import usePlansData from '../MoveOutPlans/usePlansData';
import ItemForm, { availabilityError } from './ItemForm';
import ItemLabels from './ItemLabels';
import ItemPhotos, { ReadyPhoto } from './ItemPhotos';
import { useUnsavedForm } from '../../forms/UnsavedChanges';
import '../MoveOutPlans/Plans.css';
import './Inventory.css';
import JourneyNav from '../Journeys/JourneyNav';
import { Feedback, PageHeader, Surface } from '../../design-system/primitives';
import { inventoryFilters, ownerStatus, publicationComplete } from './inventoryStatus';
import { validPickupTimeZone } from '../../forms/pickupTime';

export const itemStates = ['draft', 'available', 'unlisted', 'cleared', 'expired'];
const actionLabels = { publish: 'Publish', unlist: 'Hide listing', clear: 'Mark cleared', reopen: 'Reopen as draft' };
const confirmations = { publish: 'Publish this item for everyone to see? Future pickup dates do not delay publication.',
  unlist: 'Remove this item from public discovery now? It will not count as cleared.',
  clear: 'Mark this item as dealt with and remove it from public discovery? It will count toward your move-out progress.',
  reopen: 'Reopen this cleared item as a private draft? It will no longer count as cleared. Publish it separately when ready.' };
export default function Inventory() {
  const { planId } = useParams(); const { user } = useAppContext();
  return <InventorySession key={user.id + ':' + planId} planId={planId} user={user} />;
}
function InventorySession({ planId, user }) {
  const textForm = useRef(), urls = useRef(new Set()), alive = useRef(true), initialLoad = useRef(false), pendingRefresh = useRef(false);
  const [photoEntries, setPhotoEntries] = useState([]), [photoBusy, setPhotoBusy] = useState(false), [photoOnly, setPhotoOnly] = useState(false);
  const [previews, setPreviews] = useState({}), [uncertainCreate, setUncertainCreate] = useState(false);
  const photoGuard = useUnsavedForm({ photos: photoEntries.map(entry => entry.clientUploadId).join(',') }, { photos: '' },
    'Discard unsent photos? They are kept only in this tab and cannot be restored after reloading.');
  useEffect(() => { const owned = urls.current; alive.current = true; return () => { alive.current = false; owned.forEach(url => URL.revokeObjectURL(url)); owned.clear(); }; }, []);
  const [params] = useSearchParams();
  const request = usePlansData(`/api/move-out-plans/${encodeURIComponent(planId)}/items`, true);
  const [editor, setEditor] = useState(params.get('edit'));
  const [editSnapshot, setEditSnapshot] = useState(null);
  const itemsHeading = useRef();
  const [sequence, setSequence] = useState(0);
  const [filter, setFilter] = useState('all');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const data = [403, 404].includes(request.error?.status) ? undefined : request.data;
  const locked = busy || photoBusy || request.loading || Boolean(request.error);
  const writing = useRef(false);
  const item = editSnapshot || data?.items.find(value => value.id === editor);
  useEffect(() => {
    if (!data || request.loading) return;
    if (!initialLoad.current) { initialLoad.current = true; if (!data.items.length && !editor) setEditor('new'); else if (editor) setEditSnapshot(data.items.find(value => value.id === editor) || null); }
    if (pendingRefresh.current) { pendingRefresh.current = false; setEditSnapshot(data.items.find(value => value.id === editor) || null); setSequence(value => value + 1); }
  }, [data, request.loading, editor]);
  const clearPhotos = () => { urls.current.forEach(url => URL.revokeObjectURL(url)); urls.current.clear(); setPhotoEntries([]); };
  const confirmEdits = () => (!textForm.current || textForm.current.confirmDiscard({ release: false })) && photoGuard.confirmDiscard({ release: false });
  const closeEditor = () => { clearPhotos(); setEditSnapshot(null); setEditor(null); setPhotoOnly(false); setUncertainCreate(false); itemsHeading.current?.focus(); };
  const openNew = () => {
    if (editor && !confirmEdits()) return;
    if (uncertainCreate && !window.confirm('The previous save is unconfirmed. Check inventory for an existing item before starting a separate draft. Continue?')) return;
    clearPhotos(); setEditSnapshot(null); setEditor('new'); setPhotoOnly(false); setUncertainCreate(false); setSequence(value => value + 1); setError('');
  };
  const refreshInventory = () => {
    if (textForm.current && !textForm.current.confirmDiscard({ release: false })) return;
    pendingRefresh.current = true; request.retry();
  };
  useEffect(() => {
    if (photoOnly && photoEntries.length === 0 && !photoBusy) { const id = editor; setTimeout(() => { if (alive.current) document.getElementById('inventory-item-' + id)?.focus(); }, 0); setEditSnapshot(null); setEditor(null); setPhotoOnly(false); request.retry(); }
    // Only completed/removed selections close the saved-item confirmation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [photoOnly, photoEntries.length, photoBusy]);
  const root = `/api/move-out-plans/${encodeURIComponent(planId)}/items`;
  const save = async (details, publish, committed) => {
    if (photoBusy || photoEntries.some(entry => entry.phase === 'preparing')) throw new Error('Wait for photo preparation to finish before saving.');
    if (uncertainCreate && !item) throw Object.assign(new Error('Check inventory before creating another item.'), { handledByInventory: true });
    if (writing.current) throw new Error('Another inventory change is saving. Wait for it to finish, then try again.');
    writing.current = true; setBusy(true);
    try {
      const result = await confirmPickupChanges(item ? `${root}/${item.id}` : root, { method: item ? 'PATCH' : 'POST', notifyUnauthorized: false,
        body: item ? { ...details, version: item.version, publish } : { ...details, publish } });
      if (!alive.current) return;
      if (!result?.item || !/^[a-f0-9]{24}$/i.test(result.item.id) || !Number.isSafeInteger(result.item.version) || result.item.version < 1 || result.item.planId !== planId || !itemStates.includes(result.item.status) || (item && result.item.id !== item.id)) throw Object.assign(new Error('Save not confirmed. Check inventory before continuing.'), { status: 0 });
      committed?.();
      const saved = result.item; setEditSnapshot(saved);
      request.update(previous => {
        const items = previous.items.some(value => value.id === saved.id) ? previous.items.map(value => value.id === saved.id ? { ...value, ...saved } : value) : previous.items.concat(saved);
        return { ...previous, items, progress: { total: items.length, cleared: items.filter(value => value.status === 'cleared').length } };
      });
      setMessage(photoEntries.length ? '' : publish ? 'Item published.' : 'Item saved.');
      if (!photoEntries.length) setTimeout(() => { if (alive.current) document.getElementById('inventory-item-' + saved.id)?.focus(); }, 0);
      setEditor(photoEntries.length ? saved.id : null); setPhotoOnly(photoEntries.length > 0); setUncertainCreate(false); request.retry();
    } catch (failure) {
      if (alive.current && failure.status === 401) window.dispatchEvent(new Event('giftlink:unauthorized'));
      if (alive.current && !item && (!failure.status || failure.status >= 500)) {
        setUncertainCreate(true); setError('Save not confirmed. Check inventory before creating another item. Unsent photos are still in this tab.'); failure.handledByInventory = true;
      }
      throw failure;
    } finally { writing.current = false; setBusy(false); }
  };
  const edit = entry => {
    if (editor === entry.id) { setPhotoOnly(false); return; }
    if (editor !== entry.id) {
      if (uncertainCreate && photoEntries.length) {
        if (!window.confirm('Use this saved item and keep the selected photos? Unsaved item text will be replaced.')) return;
      } else { if (!confirmEdits()) return; clearPhotos(); }
    }
    setEditSnapshot(entry); setEditor(entry.id); setPhotoOnly(false); setUncertainCreate(false); setError(''); setSequence(value => value + 1);
  };
  const action = async (entry, name) => {
    if (writing.current || locked) return;
    if (['publish', 'reopen'].includes(name)) {
      const invalid = availabilityError(entry, data.plan, true);
      if (invalid) { setError(invalid); return; }
    }
    // Retain the current edit (and its guard) if the later action confirmation
    // is cancelled. Photo drafts are independent of this text editor.
    if (editor === entry.id && !confirmEdits()) return;
    if (!window.confirm(confirmations[name])) return;
    writing.current = true; setBusy(true); setError(''); setMessage('');
    try {
      await confirmPickupChanges(`${root}/${entry.id}/actions`, { method: 'POST', body: { action: name, version: entry.version } });
      if (editor === entry.id) closeEditor();
      setMessage(`${actionLabels[name]} confirmed.`); request.retry();
    } catch (failure) { setError(failure.message); }
    finally { writing.current = false; setBusy(false); }
  };
  const renderEditor = entry => <>
    {photoOnly && <p role="status">Item saved. Photos have not all been uploaded.</p>}
    <ItemForm ref={textForm} key={user.id + ':' + planId + ':' + (entry?.id || 'new') + ':' + sequence} plan={data.plan} item={entry ? item : null}
      onSave={save} onCancel={closeEditor} onBeforeClose={confirmEdits} focusName={!photoOnly} textHidden={photoOnly}
      disabled={locked || uncertainCreate} photos={<ItemPhotos embedded allowStaging planId={planId} item={entry ? item : {}}
        entries={photoEntries} onEntriesChange={setPhotoEntries} previewUrls={urls.current} capabilities={data.photoCapabilities}
        disabled={busy || uncertainCreate} onBusyChange={setPhotoBusy}
        onMetadata={(id, metadata) => { if (alive.current) setPreviews(previous => ({ ...previous, [id]: { availability: metadata.capabilities.imageRead ? 'ready' : 'disabled', images: metadata.capabilities.imageRead ? metadata.images : [], imageRevision: metadata.imageRevision } })); }} />} />
    {photoOnly && <button className="item-photos-link" disabled={busy || photoBusy} onClick={() => { if (confirmEdits()) closeEditor(); }}>Done</button>}
  </>;
  return <main className="ui-page inventory-page">
    <JourneyNav journey="give" planId={planId} />
    <Link to={'/app/plans/' + planId}>Back to plan</Link>
    <PageHeader title="Plan inventory" description={data ? data.plan.neighborhood + ', ' + data.plan.city + ' · Move out by ' + data.plan.moveOutDeadline : undefined}
      action={<button className="item-photos-link" disabled={locked} onClick={refreshInventory}>Refresh inventory</button>} />
    {request.loading && <Feedback>{data ? 'Refreshing inventory…' : 'Loading inventory…'}</Feedback>}
    {(error || request.error) && <Feedback error><p>{error || (request.error.status === 404 ? 'This inventory is unavailable.' : request.error.message)}</p>
      <button className="ui-button ui-button--secondary" onClick={() => { setError(''); refreshInventory(); }}>Reload inventory</button></Feedback>}
    {message && <Feedback>{message}</Feedback>}
    {data && <>
      <p className="inventory-progress"><strong>{data.progress.cleared} of {data.progress.total} items cleared</strong></p>
      {validPickupTimeZone(data.plan.pickupTimeZone) ? <p>Pickup timezone: <strong>{data.plan.pickupTimeZone}</strong> · One setting for this plan.</p> :
        <Feedback><p>Set a pickup timezone so people can request your posted items. You can still save drafts and publish; metro discovery also needs a metro.</p>
          <Link to={'/app/plans/' + planId + '/edit'} state={{ focusPickupTimeZone: true }}>{data.plan.pickupTimeZone === null ? 'Set pickup timezone' : 'Check pickup setup'}</Link></Feedback>}
      {data.plan.metroId === null && <p>Choose a metro for regional discovery. <Link to={'/app/plans/' + planId + '/edit'}>Choose a metro</Link></p>}
      {data.plan.moveOutDeadline < new Date().toISOString().slice(0, 10) && <Feedback><p>The plan deadline has passed. Extend it before publishing or reopening items.</p><Link to={'/app/plans/' + planId + '/edit'}>Edit plan deadline</Link></Feedback>}
      {data.plan.status !== 'active' && <p>This plan is inactive. <Link to={'/app/plans/' + planId + '/edit'}>Activate it</Link> before publishing.</p>}
      <section aria-label="Inventory items">
        {<div className="plan-page-header"><h2 ref={itemsHeading} tabIndex={-1}>Your items</h2>
          <button className="ui-button" disabled={locked} onClick={openNew}>Add item</button></div>}
        {data.items.length > 0 && <div className="ui-field inventory-filter"><label htmlFor="inventory-filter">Show items</label>
          <select id="inventory-filter" value={filter} onChange={event => setFilter(event.target.value)}>
            <option value="all">All items</option>{inventoryFilters.map(state => <option key={state} value={state}>{state}</option>)}
          </select></div>}
        {!data.items.length && <p>No items yet. Add your first item.</p>}
        {data.items.length > 0 && !data.items.some(entry => filter === 'all' || ownerStatus(entry) === filter) && <p>No items match this status. <button className="ui-button ui-button--secondary" onClick={() => setFilter('all')}>Show all items</button></p>}
        <ul className="inventory-list">{data.items.filter(entry => filter === 'all' || ownerStatus(entry) === filter || editor === entry.id).map(entry => <Surface as="li" className="inventory-card" key={entry.id}>
          <div className="inventory-card-heading"><h2 id={'inventory-item-' + entry.id} tabIndex={-1}>{entry.name}</h2><span className="ui-status">{ownerStatus(entry)}</span></div>
          <OwnerPhotos item={entry} preview={previews[entry.id]} capabilities={data.photoCapabilities} refreshKey={sequence} />
          <ItemLabels item={entry} />
          <p>Pickup: {entry.availableFrom || 'Immediately'} through {entry.effectiveAvailableUntil}</p>
          {entry.status === 'available' && !entry.isPublic && <p>Not publicly visible. Review the plan’s status.</p>}
          {entry.isReserved === true && <p>Pickup arranged. <Link to="/app/pickups/incoming">View pickup requests</Link> to review or confirm the handoff.</p>}
          {entry.status === 'cleared' && entry.isPickedUp !== true && <p>Marked as dealt with. Check pickup requests for any handoff history.</p>}
          {entry.isPickedUp === true && entry.status === 'cleared' && <p>Handoff confirmed in the pickup request.</p>}
          {entry.status === 'expired' && <p>Edit pickup dates or the plan deadline, then publish again.</p>}
          <div className="inventory-actions">
            <button aria-label={'Edit ' + entry.name} disabled={locked} className="ui-button ui-button--secondary" onClick={() => edit(entry)}>Edit</button>
            {['draft', 'unlisted', 'expired'].includes(entry.status) && publicationComplete(entry) && <button aria-label={'Publish ' + entry.name} disabled={locked || data.plan.status !== 'active'} className="ui-button" onClick={() => action(entry, 'publish')}>Publish</button>}
            {['available', 'expired'].includes(entry.status) && <button aria-label={'Hide ' + entry.name} disabled={locked} className="ui-button ui-button--secondary" onClick={() => action(entry, 'unlist')}>Hide listing</button>}
            {entry.isPublic && <Link to={'/app/items/' + entry.id}>Public listing</Link>}
          </div>
          {editor === entry.id && renderEditor(entry)}
          <details className="inventory-more"><summary>More actions<span className="visually-hidden"> for {entry.name}</span></summary>
            {entry.status !== 'cleared' ? <><p>Mark as dealt with outside a confirmed pickup. This counts toward clearance and cancels outstanding requests after confirmation.</p>
              <button aria-label={'Mark ' + entry.name + ' cleared'} disabled={locked} className="ui-button ui-button--secondary" onClick={() => action(entry, 'clear')}>Mark as cleared</button></> :
              <button aria-label={'Reopen ' + entry.name + ' as draft'} disabled={locked} className="ui-button ui-button--secondary" onClick={() => action(entry, 'reopen')}>Reopen as draft</button>}
          </details>
        </Surface>)}</ul>
      </section>
      {editor === 'new' && renderEditor(null)}
    </>}
  </main>;
}

function OwnerPhotos({ item, preview, capabilities, refreshKey }) {
  const remote = item.photoPreview;
  const value = remote && ['unavailable', 'disabled'].includes(remote.availability) ? remote : preview && (!remote || preview.imageRevision > remote.imageRevision) ? preview : remote || preview;
  if (capabilities?.imageRead !== true || !value || value.availability === 'disabled') return null;
  if (value.availability === 'unavailable') return <p>Photos unavailable. Refresh inventory to check again.</p>;
  if (!Array.isArray(value.images) || value.images.length > 5) return <p>Photos unavailable.</p>;
  const safe = value.images.every(image => /^[a-f0-9]{24}$/i.test(image.id) && Number.isSafeInteger(image.thumbnail?.width) && image.thumbnail.width > 0 && image.thumbnail.width <= 400 && Number.isSafeInteger(image.thumbnail?.height) && image.thumbnail.height > 0 && image.thumbnail.height <= 400);
  if (!safe) return <p>Photos unavailable.</p>;
  return value.images.length > 0 ? <ul className="item-photos-grid inventory-card-photos" aria-label={'Photos of ' + item.name}>
    {value.images.map((image, index) => <ReadyPhoto key={image.id + ":" + refreshKey} image={image} position={index} />)}</ul> : null;
}
