import React, { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { createOwnerListing, updateOwnerListing } from '../../api/ownerListings';
import usePublicCatalog from '../../api/usePublicCatalog';
import { photoDraftWarning, useUnsavedForm } from '../../forms/UnsavedChanges';
import useFormErrors from '../../forms/useFormErrors';
import { validPickupTimeZone } from '../../forms/pickupTime';
import { isCalendarDate } from '../MoveOutPlans/dates';
import RegionFields from '../MoveOutPlans/RegionFields';
import ItemTypeSelector from '../Inventory/ItemTypeSelector';
import ItemPhotos, { isQueuedPhoto, isUnsentPhoto } from '../Inventory/ItemPhotos';
import { PageHeader, Surface, Feedback } from '../../design-system/primitives';
import './ListingForm.css';
const nullable = ['categoryId','itemTypeId','customItemType','condition','stateId','metroId','availableFrom','availableUntil'];
// Pickup dates follow the metro's timezone, else this browser's; owners never pick one.
const localZone = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone; } catch { return null; } };
export default function ListingForm({ item, photoCapabilities = null, publicationEnabled = false, withdraw = null }) {
  const navigate = useNavigate(), catalog = usePublicCatalog('/api/item-taxonomy'), directory = usePublicCatalog('/api/regions');
  const initial = { name: item?.name || '', description: item?.description || '', categoryId: item?.classification?.category?.id || '', itemTypeId: item?.classification?.itemType?.id || '',
    customItemType: item?.classification?.customItemType || '', condition: item?.classification?.condition?.id || '', stateId: item?.location.stateId || '', metroId: item?.location.metroId || '',
    city: item?.location.city || '', neighborhood: item?.location.neighborhood || '', availableFrom: item?.pickup.availableFrom || '', availableUntil: item?.pickup.availableUntil || '' };
  const [values, setValues] = useState(initial), [busy, setBusy] = useState(false), [uncertain, setUncertain] = useState(false), [stale, setStale] = useState(false), [disabled, setDisabled] = useState(false);
  const validation = useFormErrors(busy), guard = useUnsavedForm(values, initial), pending = useRef(false), alive = useRef(true);
  // UX-2C1: staged photos live only in this tab until one explicit save authorizes
  // a bounded sequential upload to the saved item ID. Server capabilities decide.
  const [photoEntries, setPhotoEntries] = useState([]), [photoBusy, setPhotoBusy] = useState(false), [photoItem, setPhotoItem] = useState(null);
  const urls = useRef(new Set()), intent = useRef(null), intentSequence = useRef(0), [uploadIntent, setUploadIntent] = useState(null);
  const photoGuard = useUnsavedForm({ photos: photoEntries.filter(isUnsentPhoto).map(entry => entry.clientUploadId).join(',') }, { photos: '' }, photoDraftWarning);
  const photosEnabled = photoCapabilities?.metadata === true && (!item || item.capabilities?.photos === true);
  const queued = photoEntries.filter(isQueuedPhoto).length;
  const suggestion = directory.data?.metros.find(metro => metro.id === values.metroId)?.suggestedTimeZone;
  useEffect(() => { const owned = urls.current; alive.current = true; return () => { alive.current = false; owned.forEach(url => URL.revokeObjectURL(url)); owned.clear(); }; }, []);
  const claimUploadIntent = (id, itemId) => {
    if (!alive.current || intent.current?.id !== id || intent.current.itemId !== itemId) return null;
    const authorized = intent.current; intent.current = null; setUploadIntent(null); return authorized;
  };
  // After the last authorized photo settles, return to My Listings.
  useEffect(() => {
    if (!photoItem || photoBusy || uploadIntent || photoEntries.length) return;
    navigate('/app/listings');
  }, [photoItem, photoBusy, uploadIntent, photoEntries.length, navigate]);
  const locked = busy || uncertain || stale || disabled || Boolean(photoItem);
  const change = fields => {
    Object.keys(fields).forEach(validation.clear);
    if (Object.values(validation.errors).some(Boolean) && !Object.entries(validation.errors).some(([key, text]) => text && !Object.hasOwn(fields, key))) validation.reset();
    setValues(old => ({ ...old, ...fields }));
  };
  const save = async event => {
    const publishing = publicationEnabled;
    event.preventDefault(); if (pending.current || locked) return;
    if (photoBusy || intent.current || photoEntries.some(entry => entry.phase === 'preparing')) { validation.show({}, 'Wait for the current photo work to finish before saving.'); return; }
    validation.reset(); const issues = {};
    if (!values.name.trim() || Array.from(values.name.trim()).length > 160) issues.name = 'Enter an item name of 1 to 160 characters.';
    for (const field of ['availableFrom','availableUntil']) if (values[field] && !isCalendarDate(values[field])) issues[field] = 'Choose a real calendar date.';
    if (values.availableFrom && values.availableUntil && values.availableFrom > values.availableUntil) issues.availableUntil = 'End pickup on or after the start date.';
    if (publishing) {
      if (!values.description.trim()) issues.description = 'Describe the item before publishing.';
      if (!values.itemTypeId) issues.itemTypeId = 'Choose an item type before publishing.';
      if (!values.stateId) issues.stateId = 'Choose a state before publishing.';
      if (!values.metroId) issues.metroId = 'Choose a metro before publishing.';
      if (!values.availableUntil) issues.availableUntil = 'Choose a pickup deadline before publishing.';
    }
    // Photo intake needs the item's own confirmed deadline; keep files staged otherwise.
    if (queued && !issues.availableUntil && !values.availableUntil) issues.availableUntil = 'Add a pickup deadline to save photos.';
    if (Object.keys(issues).length) { validation.show(issues); return; }
    pending.current = true; setBusy(true);
    const clientIds = photoEntries.filter(isQueuedPhoto).map(entry => entry.clientUploadId);
    const zone = [item?.pickup.timeZone, suggestion, localZone()].find(validPickupTimeZone) || null;
    const body = { ...values, pickupTimeZone: zone, pickupTimeZoneConfirmed: Boolean(zone), ...(publishing ? { publish: true } : {}) }; nullable.forEach(key => { body[key] = body[key] || null; });
    try {
      const result = item ? await updateOwnerListing(item.id, { ...body, version: item.version }) : await createOwnerListing(body);
      if (!alive.current) return; guard.markSaved();
      if (!clientIds.length) { navigate('/app/listings'); return; }
      // The saved item ID, not the form, now owns the upload authorization.
      setPhotoItem(result.item);
      intent.current = { id: ++intentSequence.current, itemId: result.item.id, clientIds }; setUploadIntent(intent.current);
    } catch (failure) {
      if (!alive.current) return;
      if (failure.status === 409 && (!failure.code || ['LISTING_CHANGED', 'LISTING_CONTEXT_INVALID', 'V2_LIFECYCLE_DISABLED'].includes(failure.code))) { setStale(true); validation.show({}, 'This draft changed or is unavailable. Review the latest saved version before editing again.'); }
      else if (failure.code === 'OWNER_LISTINGS_DISABLED') { setDisabled(true); validation.show({}, 'Listing tools are temporarily unavailable. Your unsaved details remain here.'); }
      else {
        validation.failure(failure, Object.keys(initial), { categoryId: 'itemTypeId' });
        if (!item && (failure.status === 0 || failure.status >= 500)) setUncertain(true);
      }
    } finally { pending.current = false; if (alive.current) setBusy(false); }
  };
  const message = name => validation.errors[name] && <p id={name + '-error'} className="ui-field-error">{validation.errors[name]}</p>;
  const field = (name, label, type = 'text', maxLength) => <div className="ui-field"><label htmlFor={'listing-' + name}>{label}</label>
    {name === 'description' ? <textarea id={'listing-' + name} name={name} value={values[name]} maxLength={2000} disabled={locked} onChange={e => change({ [name]: e.target.value })} {...validation.fieldProps(name)} /> :
      <input id={'listing-' + name} name={name} type={type} value={values[name]} disabled={locked} maxLength={maxLength} onChange={e => change({ [name]: e.target.value })} required={name === 'name'} autoFocus={name === 'name'} {...validation.fieldProps(name)} />}{message(name)}</div>;
  const chosenType = catalog.data?.categories.find(c => c.id === values.categoryId)?.itemTypes.find(t => t.id === values.itemTypeId);
  const submit = <button className="ui-button" type="submit" disabled={locked || photoBusy}>{busy ? 'Saving…' : publicationEnabled ? 'Publish' : 'Save draft'}</button>;
  const photos = photosEnabled && <ItemPhotos embedded allowStaging planId={null} item={photoItem || (item ? { id: item.id, name: item.name, status: item.status } : {})}
    entries={photoEntries} onEntriesChange={setPhotoEntries} previewUrls={urls.current} capabilities={photoCapabilities}
    disabled={busy || uncertain || stale || disabled} onBusyChange={setPhotoBusy} uploadIntent={uploadIntent} claimUploadIntent={claimUploadIntent} recovery={Boolean(photoItem)} />;
  return <main className="ui-page ui-page--form listing-editor"><PageHeader title={item ? 'Edit Listing' : 'Create Listing'} />
    {photoItem && <Feedback><p role="status">{photoBusy || uploadIntent ? (photoItem.status === 'available' ? 'Listing published. Saving photos…' : 'Draft saved. Saving photos…') : (photoItem.status === 'available' ? 'Listing published. Some photos still need attention.' : 'Draft saved. Some photos still need attention.')}</p>
      {!photoBusy && !uploadIntent && <Link to="/app/listings">Back to My Listings</Link>}</Feedback>}
    <Surface as="form" aria-label={item ? 'Edit Listing' : 'Create Listing'} ref={validation.formRef} onSubmit={save} noValidate aria-busy={busy}>
      <div hidden={Boolean(photoItem)}>{field('name','Item name','text',160)}</div>
      {validation.error && <Feedback error ref={validation.summaryRef} tabIndex={-1}><p>{validation.error}</p><ul>{Object.entries(validation.errors).filter(([, text]) => text).map(([key, text]) => <li key={key}><a href={'#' + (key === 'itemTypeId' ? 'item-type' : ['stateId','metroId'].includes(key) ? 'listing-region-' + (key === 'stateId' ? 'state' : 'metro') : 'listing-' + key)} onClick={e => { e.preventDefault(); document.getElementById(e.currentTarget.hash.slice(1))?.focus(); }}>{text}</a></li>)}</ul></Feedback>}
      {uncertain && <p>The save result is uncertain. Do not submit again. <Link to="/app/listings" target="_blank" rel="noopener noreferrer">Inspect My Listings in a new tab</Link>. Your form stays here.</p>}
      {stale && item && <p><Link to={'/app/items/' + item?.id + '/edit'} target="_blank" rel="noopener noreferrer">Review saved listing in a new tab</Link>. Cancel to discard these edits and reopen the saved version.</p>}
      <div hidden={Boolean(photoItem)}>
      <fieldset disabled={locked}><legend>Item details</legend>
        {catalog.loading && <p role="status">Loading item types…</p>}{catalog.error && <Feedback error>Item types are unavailable. <button type="button" onClick={catalog.retry}>Retry item types</button></Feedback>}
        <ItemTypeSelector categories={catalog.data?.categories || []} categoryId={values.categoryId} itemTypeId={values.itemTypeId} disabled={locked || catalog.loading || Boolean(catalog.error)} fieldProps={validation.fieldProps('itemTypeId')} onChange={(categoryId,itemTypeId) => { change({ categoryId,itemTypeId,customItemType:'' }); validation.clear('customItemType'); }} onSearch={() => {}} />{message('itemTypeId')}
        {chosenType?.custom && field('customItemType','Custom item type (optional)','text',60)}
        {field('description','Description')}<div className="ui-field"><label htmlFor="listing-condition">Condition (optional)</label><select id="listing-condition" name="condition" value={values.condition} onChange={e => change({ condition: e.target.value })} {...validation.fieldProps('condition')}><option value="">Not selected</option>{catalog.data?.conditions.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}</select>{message('condition')}</div>
      </fieldset><fieldset disabled={locked}><legend>Pickup location</legend><RegionFields directory={directory} values={values} onChange={change} validation={validation} prefix="listing-region" showHelp={false} fieldClassName="ui-field" />{field('city','City (optional)','text',100)}{field('neighborhood','Neighborhood (optional)','text',100)}</fieldset>
      <fieldset disabled={locked}><legend>Pickup availability</legend>{field('availableFrom','Available from (optional)','date')}{field('availableUntil','Pickup deadline','date')}</fieldset>
      </div>
      {photos}
      <div className="listing-form-actions" hidden={Boolean(photoItem)}>{submit}<button type="button" className="ui-button ui-button--secondary" disabled={busy || photoBusy} onClick={async () => {
        if (photoGuard.dirty ? await photoGuard.requestDiscard({ release: false, alsoText: guard.dirty }) : guard.confirmDiscard()) {
          // The photo dialog's approval also covers unsaved text; release both guards.
          photoGuard.markSaved(); guard.markSaved(); navigate('/app/listings');
        }
      }}>Cancel</button></div>
      {withdraw && !photoItem && <p className="listing-withdraw"><button type="button" className="item-photos-link" disabled={busy || photoBusy || locked} onClick={async () => {
        if (!window.confirm('Withdraw this listing? It will no longer be shown to others.')) return;
        try { await withdraw(false); }
        catch (failure) {
          if (failure.code !== 'PICKUP_CONFIRMATION_REQUIRED') { validation.show({}, failure.message); return; }
          if (!window.confirm(failure.message)) return;
          try { await withdraw(true); } catch (again) { validation.show({}, again.message); return; }
        }
        guard.markSaved(); photoGuard.markSaved(); navigate('/app/listings');
      }}>Withdraw listing</button></p>}
    </Surface></main>;
}
