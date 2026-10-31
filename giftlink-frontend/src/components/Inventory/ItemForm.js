import React, { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { isCalendarDate, utcToday } from '../MoveOutPlans/dates';
import { useUnsavedForm } from '../../forms/UnsavedChanges';
import useFormErrors from '../../forms/useFormErrors';
import usePublicCatalog from '../../api/usePublicCatalog';
import { Feedback, Surface } from '../../design-system/primitives';
import ItemTypeSelector from './ItemTypeSelector';
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
  if (!values.itemTypeId) issues.itemTypeId = 'Choose an item type before publishing.';
  if (!values.description.trim()) issues.description = 'Describe the item before publishing.';
  return issues;
}
export default forwardRef(function ItemForm({ plan, item, onSave, onCancel, disabled, focusName, photos, photoCount = 0, textHidden = false, onBeforeClose }, ref) {
  const nameInput = useRef(), inFlight = useRef(false), alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => { if (!textHidden && (item?.id || focusName)) nameInput.current?.focus({ preventScroll: true }); }, [item?.id, focusName, textHidden]);
  const catalog = usePublicCatalog('/api/item-taxonomy');
  const initial = { name: item?.name || '', description: item?.description || '', categoryId: item?.classification?.category?.id || '',
    itemTypeId: item?.classification?.itemType?.id || '', customItemType: item?.classification?.customItemType || '', condition: item?.classification?.condition?.id || '',
    availableFrom: item?.availableFrom || '', availableUntil: item?.availableUntil || '' };
  const [values, setValues] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [typeSearch, setTypeSearch] = useState('');
  const guard = useUnsavedForm({ ...values, typeSearch }, { ...initial, typeSearch: '' });
  useImperativeHandle(ref, () => ({ confirmDiscard: guard.confirmDiscard, dirty: guard.dirty }));
  const validation = useFormErrors(busy);
  const { errors, error } = validation;
  const editablePublication = !item || ['draft', 'unlisted', 'expired'].includes(item.status);
  const change = event => {
    const { name, value } = event.target;
    setValues(current => ({ ...current, [name]: value, ...(name === 'categoryId' ? { itemTypeId: '' } : {}) }));
    validation.clear(name); if (name === 'categoryId') validation.clear('itemTypeId');
  };
  const chooseType = (categoryId, itemTypeId) => {
    setValues(current => ({ ...current, categoryId, itemTypeId, customItemType: '' }));
    validation.clear('categoryId'); validation.clear('itemTypeId'); validation.clear('customItemType');
  };
  const submit = async publishing => {
    if (inFlight.current || busy || disabled) return;
    const details = { ...values, name: values.name.trim(), description: values.description.trim(),
      categoryId: values.categoryId || null, itemTypeId: values.itemTypeId || null, condition: values.condition || null };
    const issues = availabilityIssues(details, plan, publishing, item);
    for (const [field, maximum] of [['name', 160], ['description', 2000]]) {
      if ((field === 'name' && !details.name) || Array.from(details[field]).length > maximum) issues[field] = field === 'name' ? 'Give this item or group a name of 1–160 characters.' : 'Use at most 2,000 characters.';
    }
    if (typeSearch.trim() && !details.itemTypeId) issues.itemTypeId = 'Choose a listed type or Other, or clear the search to save without a type.';
    // eslint-disable-next-line no-control-regex -- Reject controls rather than allowing hidden classification text.
    if (details.customItemType && (Array.from(details.customItemType.trim()).length > 60 || /[<>\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/.test(details.customItemType) || /[^\s@]+@[^\s@]+\.[^\s@]+/.test(details.customItemType))) issues.customItemType = 'Use up to 60 plain-text characters without contact details.';
    details.customItemType = details.customItemType.trim().replace(/\s+/g, ' ') || null;
    if (publishing || (item?.status === 'available' && item.requiresPublicationDetails)) Object.assign(issues, publicationIssues(details));
    if (Object.keys(issues).length) { validation.show(issues); return; }
    if (item?.status === 'available' && !photoCount && !window.confirm('Save changes to this public listing?')) return;
    inFlight.current = true; setBusy(true); validation.reset();
    try {
      await onSave({ ...details, availableFrom: details.availableFrom || null, availableUntil: details.availableUntil || null }, publishing, guard.markSaved);
      guard.markSaved();
    } catch (failure) { if (alive.current && !failure.handledByInventory) validation.failure(failure, ['name', 'description', 'categoryId', 'itemTypeId', 'customItemType', 'condition', 'availableFrom', 'availableUntil'], { categoryId: 'itemTypeId' }); }
    finally { inFlight.current = false; if (alive.current) setBusy(false); }
  };
  return <Surface as="form" ref={validation.formRef} className="inventory-form" onSubmit={event => { event.preventDefault(); submit(false); }} noValidate aria-busy={busy}>
    <div hidden={textHidden}>
      <div className="inventory-card-heading"><h2>{item ? 'Edit ' + item.name : 'Add item'}</h2>{item && <span className="ui-status">{ownerStatus(item)}</span>}</div>
      <fieldset disabled={busy || disabled}>
        <legend className="visually-hidden">Item name</legend>
        <div className="ui-field"><label htmlFor="item-name">Item name</label>
          <input id="item-name" ref={nameInput} name="name" required maxLength={160} value={values.name} onChange={change} {...validation.fieldProps('name')} />
          {errors.name && <p id="name-error" className="ui-field-error">{errors.name}</p>}</div>
      </fieldset>
    </div>
    {photos}
    <div hidden={textHidden}>
      <fieldset disabled={busy || disabled}>
        <legend className="visually-hidden">Description and pickup</legend>
        {catalog.loading && <Feedback>Loading item types…</Feedback>}
        {catalog.error && <Feedback error>Item types are unavailable. <button type="button" className="ui-button ui-button--secondary" onClick={catalog.retry}>Retry item types</button></Feedback>}
        <ItemTypeSelector categories={catalog.data?.categories} categoryId={values.categoryId} itemTypeId={values.itemTypeId} onChange={chooseType} onSearch={setTypeSearch}
          disabled={busy || disabled || catalog.loading || Boolean(catalog.error)} fieldProps={validation.fieldProps('itemTypeId')} />
        {errors.itemTypeId && <p id="itemTypeId-error" className="ui-field-error">{errors.itemTypeId}</p>}
        {catalog.data?.categories?.find(entry => entry.id === values.categoryId)?.itemTypes.find(entry => entry.id === values.itemTypeId)?.custom &&
          <div className="ui-field"><label htmlFor="item-custom-type">Custom type (optional)</label>
            <input id="item-custom-type" name="customItemType" maxLength={60} value={values.customItemType} onChange={change} placeholder="e.g. Sewing machine" {...validation.fieldProps('customItemType')} />
            {errors.customItemType && <p id="customItemType-error" className="ui-field-error">{errors.customItemType}</p>}</div>}
        <div className="ui-field"><label htmlFor="item-description">Description</label>
          <textarea id="item-description" name="description" rows={3} maxLength={2000} value={values.description} onChange={change} {...validation.fieldProps('description', 'item-description-help')} />
          {errors.description && <p id="description-error" className="ui-field-error">{errors.description}</p>}
          <small id="item-description-help">Keep contact details and street addresses private.</small></div>
        <div className="ui-field"><label htmlFor="item-availableFrom">Available from (optional)</label>
          <input id="item-availableFrom" type="date" name="availableFrom" min={item?.availableFrom && item.availableFrom < utcToday() ? undefined : utcToday()} max={values.availableUntil || plan.moveOutDeadline} value={values.availableFrom} onChange={change} {...validation.fieldProps('availableFrom')} />
          {errors.availableFrom && <p id="availableFrom-error" className="ui-field-error">{errors.availableFrom}</p>}
          <small>Pickup ends {values.availableUntil || plan.moveOutDeadline} (UTC).</small></div>
        {item && <details className="inventory-end-override"><summary>Change pickup end</summary>
          <div className="ui-field"><label htmlFor="item-availableUntil">Available until (optional)</label>
            <input id="item-availableUntil" type="date" name="availableUntil" max={plan.moveOutDeadline} value={values.availableUntil} onChange={change} {...validation.fieldProps('availableUntil')} />
            <small>Leave blank to use the plan deadline.</small>
            {errors.availableUntil && <p id="availableUntil-error" className="ui-field-error">{errors.availableUntil}</p>}</div></details>}
        <details className="inventory-secondary-fields"><summary>More details{values.condition ? ': ' + (catalog.data?.conditions?.find(row => row.id === values.condition)?.label || '') : ''}</summary>
          {item?.category && <p>Existing category: {item.category}. It will be preserved.</p>}
          <div className="ui-field"><label htmlFor="item-condition">Condition (optional)</label>
            <select id="item-condition" name="condition" value={values.condition} onChange={change} disabled={catalog.loading || Boolean(catalog.error)} {...validation.fieldProps('condition')}>
              <option value="">Not specified</option>{catalog.data?.conditions?.map(entry => <option key={entry.id} value={entry.id}>{entry.label}</option>)}</select>
            {errors.condition && <p id="condition-error" className="ui-field-error">{errors.condition}</p>}</div>
        </details>
      </fieldset>
    </div>
    <fieldset className="inventory-save-area" disabled={busy || disabled} hidden={textHidden}>
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
