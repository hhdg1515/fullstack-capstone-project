import React, { useEffect, useRef, useState } from 'react';
import { isCalendarDate, utcToday } from '../MoveOutPlans/dates';
import { useUnsavedForm } from '../../forms/UnsavedChanges';
import useFormErrors from '../../forms/useFormErrors';
import usePublicCatalog from '../../api/usePublicCatalog';

export function availabilityIssues(values, plan, publishing = false) {
  const issues = {};
  for (const field of ['availableFrom', 'availableUntil']) {
    if (values[field] && !isCalendarDate(values[field])) issues[field] = 'Choose a real calendar date.';
  }
  if (Object.keys(issues).length) return issues;
  const end = values.availableUntil || plan.moveOutDeadline;
  if (end > plan.moveOutDeadline) issues.availableUntil = 'Choose an end date on or before the plan deadline.';
  if (values.availableFrom && values.availableFrom > end) issues.availableFrom = 'Choose a start date on or before the end date.';
  if (publishing && end < utcToday()) issues.availableUntil = 'Choose an end date of today or later (UTC) before publishing or reopening.';
  return issues;
}
export function availabilityError(values, plan, publishing = false) {
  return Object.values(availabilityIssues(values, plan, publishing))[0] || '';
}
export default function ItemForm({ plan, item, onSave, onCancel, disabled, focusName }) {
  const nameInput = useRef();
  useEffect(() => { if (!disabled && (item || focusName)) nameInput.current?.focus(); }, [item, focusName, disabled]);
  const catalog = usePublicCatalog('/api/item-taxonomy');
  const initial = { name: item?.name || '', description: item?.description || '', categoryId: item?.classification?.category?.id || '',
    itemTypeId: item?.classification?.itemType?.id || '', condition: item?.classification?.condition?.id || '',
    availableFrom: item?.availableFrom || '', availableUntil: item?.availableUntil || '' };
  const [values, setValues] = useState(initial);
  const [busy, setBusy] = useState(false);
  const guard = useUnsavedForm(values, initial);
  const validation = useFormErrors(busy);
  const { errors, error } = validation;
  const change = event => { setValues(current => ({ ...current, [event.target.name]: event.target.value,
    ...(event.target.name === 'categoryId' ? { itemTypeId: '' } : {}) })); validation.clear(event.target.name);
    if (event.target.name === 'categoryId') validation.clear('itemTypeId'); };
  const submit = async publishing => {
    if (busy || disabled) return;
    const details = { ...values, name: values.name.trim(), description: values.description.trim(),
      categoryId: values.categoryId || null, itemTypeId: values.itemTypeId || null, condition: values.condition || null };
    const issues = availabilityIssues(details, plan, publishing);
    for (const [field, maximum] of [['name', 160], ['description', 2000]]) {
      if ((field === 'name' && !details.name) || Array.from(details[field]).length > maximum) issues[field] = field === 'name' ? 'Give this item or group a name of 1–160 characters.' : `Use at most ${maximum} characters.`;
    }
    if (Object.keys(issues).length) { validation.show(issues); return; }
    if (item?.status === 'available' && !window.confirm('Save changes to this public listing?')) return;
    setBusy(true); validation.reset();
    try { await onSave({ ...details, availableFrom: details.availableFrom || null, availableUntil: details.availableUntil || null }, publishing, guard.markSaved); guard.markSaved(); }
    catch (failure) { validation.failure(failure, ['name', 'description', 'categoryId', 'itemTypeId', 'condition', 'availableFrom', 'availableUntil']); }
    finally { setBusy(false); }
  };
  return <form ref={validation.formRef} className="plan-form inventory-form" onSubmit={event => { event.preventDefault(); submit(false); }} noValidate aria-busy={busy}>
    <h2>{item ? `Edit ${item.name}` : 'Add an item or group'}</h2>
    <fieldset disabled={busy || disabled}>
      <legend className="visually-hidden">Item details</legend>
      <div className="plan-field"><label htmlFor="item-name">Item name</label>
        <input id="item-name" ref={nameInput} name="name" required maxLength={160} value={values.name} onChange={change} {...validation.fieldProps('name')} />
        {errors.name && <p id="name-error" className="plan-field-error">{errors.name}</p>}
        <small>A single item, several identical items, or a group such as “Box of kitchen supplies”.</small>
      </div>
      {catalog.loading && <p role="status">Loading item types…</p>}
      {catalog.error && <p role="alert">Item types are unavailable. <button type="button" onClick={catalog.retry}>Retry item types</button></p>}
      {item?.category && <p>Existing category: {item.category}. It will be preserved.</p>}
      <div className="plan-field"><label htmlFor="item-category">Category (optional)</label>
        <select id="item-category" name="categoryId" value={values.categoryId} onChange={change} disabled={catalog.loading || Boolean(catalog.error)} {...validation.fieldProps('categoryId')}>
          <option value="">Uncategorized</option>{catalog.data?.categories?.map(entry => <option key={entry.id} value={entry.id}>{entry.label}</option>)}
        </select>{errors.categoryId && <p id="categoryId-error" className="plan-field-error">{errors.categoryId}</p>}</div>
      <div className="plan-field"><label htmlFor="item-type">Item type (optional)</label>
        <select id="item-type" name="itemTypeId" value={values.itemTypeId} onChange={change} disabled={!values.categoryId || catalog.loading || Boolean(catalog.error)} {...validation.fieldProps('itemTypeId')}>
          <option value="">Not specified</option>{catalog.data?.categories?.find(entry => entry.id === values.categoryId)?.itemTypes.map(entry => <option key={entry.id} value={entry.id}>{entry.label}</option>)}
        </select>{errors.itemTypeId && <p id="itemTypeId-error" className="plan-field-error">{errors.itemTypeId}</p>}</div>
      <details open={Boolean(item)}><summary>Optional description, condition and pickup dates</summary>
        <div className="plan-field"><label htmlFor="item-description">Description (optional)</label>
          <textarea id="item-description" name="description" maxLength={2000} value={values.description} onChange={change} {...validation.fieldProps('description')} />
          {errors.description && <p id="description-error" className="plan-field-error">{errors.description}</p>}</div>
        <div className="plan-field"><label htmlFor="item-condition">Condition (optional)</label>
          <select id="item-condition" name="condition" value={values.condition} onChange={change} disabled={catalog.loading || Boolean(catalog.error)} {...validation.fieldProps('condition')}>
            <option value="">Not specified</option>{catalog.data?.conditions?.map(entry => <option key={entry.id} value={entry.id}>{entry.label}</option>)}
          </select>{errors.condition && <p id="condition-error" className="plan-field-error">{errors.condition}</p>}</div>
        <div className="inventory-dates">{[['availableFrom', 'Available from (optional)'], ['availableUntil', 'Available until (optional)']].map(([name, label]) =>
          <div className="plan-field" key={name}><label htmlFor={`item-${name}`}>{label}</label>
            <input id={`item-${name}`} type="date" name={name} max={plan.moveOutDeadline} value={values[name]} onChange={change} {...validation.fieldProps(name)} />
            {errors[name] && <p id={`${name}-error`} className="plan-field-error">{errors[name]}</p>}</div>)}</div>
        <p>Leave dates empty for immediate availability through {plan.moveOutDeadline}, the plan deadline. Calendar dates use UTC comparisons.</p>
        <button type="button" className="btn btn-outline-secondary" onClick={() => setValues(current => ({ ...current, availableFrom: '', availableUntil: '' }))}>Use plan availability</button>
      </details>
      <p>All items are free. Offer safe, lawful household goods. Keep contact details and street addresses out of public text.</p>
      {item?.status === 'available' && <p>Changes to this published item become public immediately.</p>}
      {error && <p ref={validation.summaryRef} tabIndex={-1} role="alert" className="plan-field-error">{error}</p>}
      <div className="plan-actions">
        <button type="submit" className="btn btn-primary" value="draft">{busy ? 'Saving…' : item ? 'Save changes' : 'Save draft & add another'}</button>
        {!item && <button type="button" className="btn btn-outline-primary" onClick={() => submit(true)} disabled={plan.status !== 'active'}>Publish & add another</button>}
        {item && <button type="button" className="btn btn-outline-secondary" onClick={() => { if (guard.confirmDiscard()) onCancel(); }}>Cancel edit</button>}
      </div>
    </fieldset>
  </form>;
}
