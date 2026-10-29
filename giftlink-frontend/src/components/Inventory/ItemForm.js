import React, { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { isCalendarDate, utcToday } from '../MoveOutPlans/dates';
import { useUnsavedForm } from '../../forms/UnsavedChanges';
import useFormErrors from '../../forms/useFormErrors';
import usePublicCatalog from '../../api/usePublicCatalog';
import { Feedback, Surface } from '../../design-system/primitives';
import { ownerStatus } from './inventoryStatus';

export function availabilityIssues(values, plan, publishing = false, previous) {
  const issues = {};
  for (const field of ['availableFrom', 'availableUntil']) {
    if (values[field] && !isCalendarDate(values[field])) issues[field] = 'Choose a real calendar date.';
  }
  if (Object.keys(issues).length) return issues;
  if (values.availableFrom && values.availableFrom < utcToday() && values.availableFrom !== previous?.availableFrom) {
    issues.availableFrom = 'Choose today or a later date (UTC), or keep the existing start date.';
  }
  const end = values.availableUntil || plan.moveOutDeadline;
  if (end > plan.moveOutDeadline) issues.availableUntil = 'Choose an end date on or before the plan deadline.';
  if (values.availableFrom && values.availableFrom > end) issues.availableFrom = 'Choose a start date on or before the end date.';
  if (publishing && end < utcToday()) issues.availableUntil = 'Choose an end date of today or later (UTC) before publishing or reopening.';
  return issues;
}
export function availabilityError(values, plan, publishing = false) {
  return Object.values(availabilityIssues(values, plan, publishing, values))[0] || '';
}
export function publicationIssues(values) {
  const issues = {};
  if (!values.categoryId) issues.categoryId = 'Choose a category before publishing.';
  if (!values.itemTypeId) issues.itemTypeId = 'Choose an item type in this category before publishing.';
  if (!values.description.trim()) issues.description = 'Describe the item before publishing.';
  return issues;
}
export default forwardRef(function ItemForm({ plan, item, onSave, onCancel, disabled, focusName, photos, photoCount = 0, textHidden = false, onBeforeClose }, ref) {
  const nameInput = useRef(), inFlight = useRef(false), alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => { if (!textHidden && (item?.id || focusName)) nameInput.current?.focus(); }, [item?.id, focusName, textHidden]);
  const catalog = usePublicCatalog('/api/item-taxonomy');
  const initial = { name: item?.name || '', description: item?.description || '', categoryId: item?.classification?.category?.id || '',
    itemTypeId: item?.classification?.itemType?.id || '', condition: item?.classification?.condition?.id || '',
    availableFrom: item?.availableFrom || '', availableUntil: item?.availableUntil || '' };
  const [values, setValues] = useState(initial);
  const [busy, setBusy] = useState(false);
  const guard = useUnsavedForm(values, initial);
  useImperativeHandle(ref, () => ({ confirmDiscard: guard.confirmDiscard, dirty: guard.dirty }));
  const validation = useFormErrors(busy);
  const { errors, error } = validation;
  const editablePublication = !item || ['draft', 'unlisted', 'expired'].includes(item.status);
  const change = event => {
    const { name, value } = event.target;
    setValues(current => ({ ...current, [name]: value, ...(name === 'categoryId' ? { itemTypeId: '' } : {}) }));
    validation.clear(name); if (name === 'categoryId') validation.clear('itemTypeId');
  };
  const submit = async publishing => {
    if (inFlight.current || busy || disabled) return;
    const details = { ...values, name: values.name.trim(), description: values.description.trim(),
      categoryId: values.categoryId || null, itemTypeId: values.itemTypeId || null, condition: values.condition || null };
    const issues = availabilityIssues(details, plan, publishing, item);
    for (const [field, maximum] of [['name', 160], ['description', 2000]]) {
      if ((field === 'name' && !details.name) || Array.from(details[field]).length > maximum) issues[field] = field === 'name' ? 'Give this item or group a name of 1–160 characters.' : 'Use at most 2,000 characters.';
    }
    if (publishing || (item?.status === 'available' && item.requiresPublicationDetails)) Object.assign(issues, publicationIssues(details));
    if (Object.keys(issues).length) { validation.show(issues); return; }
    if (item?.status === 'available' && !photoCount && !window.confirm('Save changes to this public listing?')) return;
    inFlight.current = true; setBusy(true); validation.reset();
    try {
      await onSave({ ...details, availableFrom: details.availableFrom || null, availableUntil: details.availableUntil || null }, publishing, guard.markSaved);
      guard.markSaved();
    } catch (failure) { if (alive.current && !failure.handledByInventory) validation.failure(failure, ['name', 'description', 'categoryId', 'itemTypeId', 'condition', 'availableFrom', 'availableUntil']); }
    finally { inFlight.current = false; if (alive.current) setBusy(false); }
  };
  return <Surface as="form" ref={validation.formRef} className="inventory-form" onSubmit={event => { event.preventDefault(); submit(false); }} noValidate aria-busy={busy}>
    <div hidden={textHidden}><div className="inventory-card-heading"><h2>{item ? 'Edit ' + item.name : 'Add an item or group'}</h2>{item && <span className="ui-status">{ownerStatus(item)}</span>}</div>
    <p className="inventory-form-help">To publish, add a name, category, item type and description. Save a draft with just a name.</p>
    <fieldset disabled={busy || disabled}>
      <legend className="visually-hidden">Item details</legend>
      <div className="ui-field"><label htmlFor="item-name">Item name</label>
        <input id="item-name" ref={nameInput} name="name" required maxLength={160} value={values.name} onChange={change} {...validation.fieldProps('name')} />
        {errors.name && <p id="name-error" className="ui-field-error">{errors.name}</p>}
      </div>
      {catalog.loading && <Feedback>Loading item types…</Feedback>}
      {catalog.error && <Feedback error>Item types are unavailable. <button type="button" className="ui-button ui-button--secondary" onClick={catalog.retry}>Retry item types</button></Feedback>}
      {item?.category && <p>Existing category: {item.category}. It will be preserved.</p>}
      <div className="inventory-classification">
      <div className="ui-field"><label htmlFor="item-category">Category</label>
        <select id="item-category" name="categoryId" value={values.categoryId} onChange={change} disabled={catalog.loading || Boolean(catalog.error)} {...validation.fieldProps('categoryId')}>
          <option value="">Choose a category</option>{catalog.data?.categories?.map(entry => <option key={entry.id} value={entry.id}>{entry.label}</option>)}
        </select>{errors.categoryId && <p id="categoryId-error" className="ui-field-error">{errors.categoryId}</p>}</div>
      <div className="ui-field"><label htmlFor="item-type">Item type</label>
        <select id="item-type" name="itemTypeId" value={values.itemTypeId} onChange={change} disabled={!values.categoryId || catalog.loading || Boolean(catalog.error)} {...validation.fieldProps('itemTypeId')}>
          <option value="">Choose an item type</option>{catalog.data?.categories?.find(entry => entry.id === values.categoryId)?.itemTypes.map(entry => <option key={entry.id} value={entry.id}>{entry.label}</option>)}
        </select>{errors.itemTypeId && <p id="itemTypeId-error" className="ui-field-error">{errors.itemTypeId}</p>}</div>
      <div className="ui-field"><label htmlFor="item-condition">Condition (optional)</label>
        <select id="item-condition" name="condition" value={values.condition} onChange={change} disabled={catalog.loading || Boolean(catalog.error)} {...validation.fieldProps('condition')}>
          <option value="">Not specified</option>{catalog.data?.conditions?.map(entry => <option key={entry.id} value={entry.id}>{entry.label}</option>)}
        </select>{errors.condition && <p id="condition-error" className="ui-field-error">{errors.condition}</p>}</div>
      </div>
      <div className="ui-field"><label htmlFor="item-description">Description</label>
        <textarea id="item-description" name="description" rows={3} maxLength={2000} value={values.description} onChange={change} {...validation.fieldProps('description')} />
        {errors.description && <p id="description-error" className="ui-field-error">{errors.description}</p>}</div>
      <div className="ui-field"><label htmlFor="item-availableFrom">Available from (optional)</label>
        <input id="item-availableFrom" type="date" name="availableFrom" min={item?.availableFrom && item.availableFrom < utcToday() ? undefined : utcToday()} max={values.availableUntil || plan.moveOutDeadline} value={values.availableFrom} onChange={change} {...validation.fieldProps('availableFrom')} />
        {errors.availableFrom && <p id="availableFrom-error" className="ui-field-error">{errors.availableFrom}</p>}</div>
      <p>Pickup ends {values.availableUntil || plan.moveOutDeadline}{values.availableUntil ? ' (existing item override)' : ' (plan deadline)'}. Dates use UTC calendar days; leave the start empty for immediate availability.</p>
      {item && <details className="inventory-end-override"><summary>Pickup end override</summary>
        <div className="ui-field"><label htmlFor="item-availableUntil">Available until (optional)</label>
          <input id="item-availableUntil" type="date" name="availableUntil" max={plan.moveOutDeadline} value={values.availableUntil} onChange={change} {...validation.fieldProps('availableUntil')} />
          <small>Leave empty to inherit the plan deadline. Shortening availability may cancel requests after confirmation.</small>
          {errors.availableUntil && <p id="availableUntil-error" className="ui-field-error">{errors.availableUntil}</p>}</div>
      </details>}
      <p className="inventory-form-help">Free household goods only. Keep contact details and street addresses out of public text.</p>
      {item?.status === 'available' && <p>Changes to this posted item become public immediately.</p>}
    </fieldset></div>
    {photos}
    <fieldset disabled={busy || disabled} hidden={textHidden}>
      <legend className="visually-hidden">Save item</legend>
      {error && <Feedback ref={validation.summaryRef} tabIndex={-1} error>{error}</Feedback>}
      <div className="plan-actions">
        {editablePublication && <button type="button" className="ui-button" onClick={() => submit(true)} disabled={plan.status !== 'active' || catalog.loading || Boolean(catalog.error)}>{busy ? 'Saving…' : photoCount ? `Publish with ${photoCount} ${photoCount === 1 ? 'photo' : 'photos'}` : 'Publish'}</button>}
        <button type="submit" className={'ui-button' + (editablePublication ? ' ui-button--secondary' : '')} disabled={busy}>{busy && !editablePublication ? 'Saving…' : photoCount ? `${item && item.status !== 'draft' ? 'Save changes' : 'Save draft'} with ${photoCount} ${photoCount === 1 ? 'photo' : 'photos'}` : item && item.status !== 'draft' ? 'Save Changes' : 'Save Draft'}</button>
        {onCancel && <button type="button" className="ui-button ui-button--secondary" onClick={async () => { if (await (onBeforeClose || guard.confirmDiscard)()) onCancel(); }}>{item ? 'Cancel edit' : 'Cancel'}</button>}
      </div>
    </fieldset>
  </Surface>;
});
