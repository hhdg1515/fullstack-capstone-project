import React, { useEffect, useRef, useState } from 'react';
import { isCalendarDate, utcToday } from '../MoveOutPlans/dates';
import { useUnsavedForm } from '../../forms/UnsavedChanges';

export function availabilityError(values, plan, publishing = false) {
  for (const field of ['availableFrom', 'availableUntil']) {
    if (values[field] && !isCalendarDate(values[field])) return 'Use real calendar dates (YYYY-MM-DD).';
  }
  const end = values.availableUntil || plan.moveOutDeadline;
  if (end > plan.moveOutDeadline || (values.availableFrom && values.availableFrom > end)) return 'Pickup dates must be in order and end by the plan deadline.';
  if (publishing && end < utcToday()) return 'Choose an end date of today or later (UTC) before publishing or reopening.';
  return '';
}
export default function ItemForm({ plan, item, onSave, onCancel, disabled, focusName }) {
  const nameInput = useRef();
  useEffect(() => { if (!disabled && (item || focusName)) nameInput.current?.focus(); }, [item, focusName, disabled]);
  const [values, setValues] = useState({ name: item?.name || '', description: item?.description || '', category: item?.category || '',
    availableFrom: item?.availableFrom || '', availableUntil: item?.availableUntil || '' });
  const [busy, setBusy] = useState(false);
  const guard = useUnsavedForm(values, { name: item?.name || '', description: item?.description || '', category: item?.category || '',
    availableFrom: item?.availableFrom || '', availableUntil: item?.availableUntil || '' });
  const [error, setError] = useState('');
  const change = event => setValues(current => ({ ...current, [event.target.name]: event.target.value }));
  const submit = async publishing => {
    if (busy || disabled) return;
    const details = { ...values, name: values.name.trim(), description: values.description.trim(), category: values.category.trim() };
    if (!details.name || Array.from(details.name).length > 160) { setError('Give this item or group a name of 1–160 characters.'); return; }
    const dateError = availabilityError(details, plan, publishing);
    if (dateError) { setError(dateError); return; }
    if (item?.status === 'available' && !window.confirm('Save changes to this public listing?')) return;
    setBusy(true); setError('');
    try { await onSave({ ...details, availableFrom: details.availableFrom || null, availableUntil: details.availableUntil || null }, publishing, guard.markSaved); guard.markSaved(); }
    catch (failure) { setError(failure.fields?.map(field => `${field.field}: ${field.message}`).join('. ') || failure.message); }
    finally { setBusy(false); }
  };
  return <form className="plan-form inventory-form" onSubmit={event => { event.preventDefault(); submit(false); }} noValidate aria-busy={busy}>
    <h2>{item ? `Edit ${item.name}` : 'Add an item or group'}</h2>
    <fieldset disabled={busy || disabled}>
      <legend className="visually-hidden">Item details</legend>
      <div className="plan-field"><label htmlFor="item-name">Item name</label>
        <input id="item-name" ref={nameInput} name="name" required maxLength={160} value={values.name} onChange={change} />
        <small>A single item, several identical items, or a group such as “Box of kitchen supplies”.</small>
      </div>
      <details open={Boolean(item)}><summary>Optional description, category and pickup dates</summary>
        <div className="plan-field"><label htmlFor="item-description">Description (optional)</label>
          <textarea id="item-description" name="description" maxLength={2000} value={values.description} onChange={change} /></div>
        <div className="plan-field"><label htmlFor="item-category">Category or tag (optional)</label>
          <input id="item-category" name="category" maxLength={80} value={values.category} onChange={change} /></div>
        <div className="inventory-dates">{[['availableFrom', 'Available from (optional)'], ['availableUntil', 'Available until (optional)']].map(([name, label]) =>
          <div className="plan-field" key={name}><label htmlFor={`item-${name}`}>{label}</label>
            <input id={`item-${name}`} type="date" name={name} max={plan.moveOutDeadline} value={values[name]} onChange={change} /></div>)}</div>
        <p>Leave dates empty for immediate availability through {plan.moveOutDeadline}, the plan deadline. Calendar dates use UTC comparisons.</p>
        <button type="button" className="btn btn-outline-secondary" onClick={() => setValues(current => ({ ...current, availableFrom: '', availableUntil: '' }))}>Use plan availability</button>
      </details>
      <p>All items are free. Offer safe, lawful household goods. Keep contact details and street addresses out of public text.</p>
      {item?.status === 'available' && <p>Changes to this published item become public immediately.</p>}
      {error && <p role="alert" className="plan-field-error">{error}</p>}
      <div className="plan-actions">
        <button type="submit" className="btn btn-primary" value="draft">{busy ? 'Saving…' : item ? 'Save changes' : 'Save draft & add another'}</button>
        {!item && <button type="button" className="btn btn-outline-primary" onClick={() => submit(true)} disabled={plan.status !== 'active'}>Publish & add another</button>}
        {item && <button type="button" className="btn btn-outline-secondary" onClick={() => { if (guard.confirmDiscard()) onCancel(); }}>Cancel edit</button>}
      </div>
    </fieldset>
  </form>;
}
