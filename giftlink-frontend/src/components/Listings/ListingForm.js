import React, { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { createOwnerListing, updateOwnerListing } from '../../api/ownerListings';
import usePublicCatalog from '../../api/usePublicCatalog';
import { useUnsavedForm } from '../../forms/UnsavedChanges';
import useFormErrors from '../../forms/useFormErrors';
import { validPickupTimeZone } from '../../forms/pickupTime';
import { isCalendarDate } from '../MoveOutPlans/dates';
import RegionFields from '../MoveOutPlans/RegionFields';
import ItemTypeSelector from '../Inventory/ItemTypeSelector';
import { PageHeader, Surface, Feedback } from '../../design-system/primitives';
import './ListingForm.css';
const nullable = ['categoryId','itemTypeId','customItemType','condition','stateId','metroId','availableFrom','availableUntil','pickupTimeZone'];
const contextFields = ['stateId','metroId','city','neighborhood','pickupTimeZone'];
export default function ListingForm({ item }) {
  const navigate = useNavigate(), catalog = usePublicCatalog('/api/item-taxonomy'), directory = usePublicCatalog('/api/regions');
  const initial = { name: item?.name || '', description: item?.description || '', categoryId: item?.classification?.category?.id || '', itemTypeId: item?.classification?.itemType?.id || '',
    customItemType: item?.classification?.customItemType || '', condition: item?.classification?.condition?.id || '', stateId: item?.location.stateId || '', metroId: item?.location.metroId || '',
    city: item?.location.city || '', neighborhood: item?.location.neighborhood || '', availableFrom: item?.pickup.availableFrom || '', availableUntil: item?.pickup.availableUntil || '', pickupTimeZone: item?.pickup.timeZone || '', pickupTimeZoneConfirmed: Boolean(item?.pickup.timeZoneConfirmed) };
  const [values, setValues] = useState(initial), [busy, setBusy] = useState(false), [uncertain, setUncertain] = useState(false), [stale, setStale] = useState(false), [disabled, setDisabled] = useState(false);
  const validation = useFormErrors(busy), guard = useUnsavedForm(values, initial), pending = useRef(false), alive = useRef(true), confirmationTouched = useRef(false);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const locked = busy || uncertain || stale || disabled;
  const change = fields => {
    Object.keys(fields).forEach(validation.clear);
    if (Object.values(validation.errors).some(Boolean) && !Object.entries(validation.errors).some(([key, text]) => text && !Object.hasOwn(fields, key))) validation.reset();
    if (Object.hasOwn(fields, 'pickupTimeZoneConfirmed')) confirmationTouched.current = true;
    setValues(old => {
      const changed = contextFields.some(key => Object.hasOwn(fields, key) && fields[key].trim() !== old[key].trim());
      if (changed) confirmationTouched.current = true;
      return { ...old, ...fields, ...(changed ? { pickupTimeZoneConfirmed: false } : {}) };
    });
  };
  const save = async event => {
    event.preventDefault(); if (pending.current || locked) return;
    validation.reset(); const issues = {};
    if (!values.name.trim() || Array.from(values.name.trim()).length > 160) issues.name = 'Enter an item name of 1 to 160 characters.';
    if (values.pickupTimeZone && !validPickupTimeZone(values.pickupTimeZone)) issues.pickupTimeZone = 'Choose a valid IANA timezone, such as America/Los_Angeles.';
    if (values.pickupTimeZoneConfirmed && !values.pickupTimeZone) issues.pickupTimeZone = 'Select a timezone before confirming it.';
    for (const field of ['availableFrom','availableUntil']) if (values[field] && !isCalendarDate(values[field])) issues[field] = 'Choose a real calendar date.';
    if (values.availableFrom && values.availableUntil && values.availableFrom > values.availableUntil) issues.availableUntil = 'End pickup on or after the start date.';
    if (Object.keys(issues).length) { validation.show(issues); return; }
    pending.current = true; setBusy(true);
    const body = { ...values }; nullable.forEach(key => { body[key] = body[key] || null; });
    if (!confirmationTouched.current) delete body.pickupTimeZoneConfirmed;
    try {
      const result = item ? await updateOwnerListing(item.id, { ...body, version: item.version }) : await createOwnerListing(body);
      if (!alive.current) return; guard.markSaved(); navigate('/app/listings/' + result.item.id);
    } catch (failure) {
      if (!alive.current) return;
      if (failure.status === 409) { setStale(true); validation.show({}, 'This draft changed or is unavailable. Review the latest saved version before editing again.'); }
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
      <input id={'listing-' + name} name={name} type={type} value={values[name]} disabled={locked} maxLength={maxLength} onChange={e => change({ [name]: e.target.value })} required={name === 'name'} autoFocus={name === 'name'} {...validation.fieldProps(name, name === 'pickupTimeZone' ? 'listing-zone-help' : undefined)} />}{message(name)}</div>;
  const suggestion = directory.data?.metros.find(metro => metro.id === values.metroId)?.suggestedTimeZone;
  const chosenType = catalog.data?.categories.find(c => c.id === values.categoryId)?.itemTypes.find(t => t.id === values.itemTypeId);
  const submit = <button className="ui-button" type="submit" disabled={locked}>{busy ? 'Saving…' : 'Save Draft'}</button>;
  return <main className="ui-page ui-page--form listing-editor"><PageHeader title={item ? 'Edit Listing' : 'Create Listing'} />
    <Surface as="form" aria-label={item ? 'Edit Listing' : 'Create Listing'} ref={validation.formRef} onSubmit={save} noValidate aria-busy={busy}>
      {field('name','Item name','text',160)}<div className="listing-form-actions">{submit}</div>
      {validation.error && <Feedback error ref={validation.summaryRef} tabIndex={-1}><p>{validation.error}</p><ul>{Object.entries(validation.errors).filter(([, text]) => text).map(([key, text]) => <li key={key}><a href={'#' + (key === 'itemTypeId' ? 'item-type' : ['stateId','metroId'].includes(key) ? 'listing-region-' + (key === 'stateId' ? 'state' : 'metro') : 'listing-' + key)} onClick={e => { e.preventDefault(); document.getElementById(e.currentTarget.hash.slice(1))?.focus(); }}>{text}</a></li>)}</ul></Feedback>}
      {uncertain && <p>The save result is uncertain. Do not submit again. <Link to="/app/listings" target="_blank" rel="noopener noreferrer">Inspect My Listings in a new tab</Link>. Your form stays here.</p>}
      {stale && item && <p><Link to={'/app/listings/' + item?.id} target="_blank" rel="noopener noreferrer">Review saved listing in a new tab</Link>. Cancel to discard these edits and reopen the saved version.</p>}
      <fieldset disabled={locked}><legend>Item details</legend>
        {catalog.loading && <p role="status">Loading item types…</p>}{catalog.error && <Feedback error>Item types are unavailable. <button type="button" onClick={catalog.retry}>Retry item types</button></Feedback>}
        <ItemTypeSelector categories={catalog.data?.categories || []} categoryId={values.categoryId} itemTypeId={values.itemTypeId} disabled={locked || catalog.loading || Boolean(catalog.error)} fieldProps={validation.fieldProps('itemTypeId')} onChange={(categoryId,itemTypeId) => { change({ categoryId,itemTypeId,customItemType:'' }); validation.clear('customItemType'); }} onSearch={() => {}} />{message('itemTypeId')}
        {chosenType?.custom && field('customItemType','Custom item type (optional)','text',60)}
        {field('description','Description')}<div className="ui-field"><label htmlFor="listing-condition">Condition (optional)</label><select id="listing-condition" name="condition" value={values.condition} onChange={e => change({ condition: e.target.value })} {...validation.fieldProps('condition')}><option value="">Not selected</option>{catalog.data?.conditions.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}</select>{message('condition')}</div>
      </fieldset><fieldset disabled={locked}><legend>Pickup location</legend><RegionFields directory={directory} values={values} onChange={change} validation={validation} prefix="listing-region" showHelp={false} fieldClassName="ui-field" />{field('city','City (optional)','text',100)}{field('neighborhood','Neighborhood (optional)','text',100)}</fieldset>
      <fieldset disabled={locked}><legend>Pickup availability</legend>{field('availableFrom','Available from (optional)','date')}{field('availableUntil','Pickup deadline','date')}{field('pickupTimeZone','Pickup timezone','text',100)}
        {suggestion && <p>Suggested timezone: {suggestion}. <button type="button" className="ui-button ui-button--secondary" onClick={() => change({ pickupTimeZone: suggestion })}>Use suggested timezone</button></p>}
        <label htmlFor="listing-pickupTimeZoneConfirmed"><input id="listing-pickupTimeZoneConfirmed" name="pickupTimeZoneConfirmed" type="checkbox" checked={values.pickupTimeZoneConfirmed} onChange={e => change({ pickupTimeZoneConfirmed: e.target.checked })} {...validation.fieldProps('pickupTimeZoneConfirmed', 'listing-zone-help')} />Confirm this pickup timezone</label>{message('pickupTimeZoneConfirmed')}
        <p id="listing-zone-help">Pickup deadlines use the local date in your confirmed pickup timezone. You can leave this blank for a private draft.</p>
      </fieldset><p>Private drafts need only an item name. Publishing and photos are not available yet.</p>
      <div className="listing-form-actions">{submit}<button type="button" className="ui-button ui-button--secondary" disabled={busy} onClick={() => { if (guard.confirmDiscard()) navigate('/app/listings'); }}>Cancel</button></div>
    </Surface></main>;
}
