import React, { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { isCalendarDate, utcToday } from './dates';
import { useUnsavedForm } from '../../forms/UnsavedChanges';
import useFormErrors from '../../forms/useFormErrors';
import usePublicCatalog from '../../api/usePublicCatalog';
import RegionFields from './RegionFields';

export const statusLabels = { active: 'Active', completed: 'Completed', cancelled: 'Cancelled' };
const hasControlCharacters = value => Array.from(value).some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127);

export default function PlanForm({ initialPlan, onSave, focusPickupTimeZone = false }) {
  const timezoneInput = useRef();
  useEffect(() => { if (focusPickupTimeZone) timezoneInput.current?.focus(); }, [focusPickupTimeZone]);
  const editing = Boolean(initialPlan);
  const directory = usePublicCatalog('/api/regions');
  const [values, setValues] = useState(() => initialPlan ? {
    moveOutDeadline: initialPlan.moveOutDeadline, city: initialPlan.city, neighborhood: initialPlan.neighborhood,
    title: initialPlan.title, status: initialPlan.status, pickupTimeZone: initialPlan.pickupTimeZone || '', stateId: initialPlan.stateId || '', metroId: initialPlan.metroId || '',
  } : { moveOutDeadline: '', city: '', neighborhood: '', title: '', pickupTimeZone: '', stateId: '', metroId: '' });
  const guard = useUnsavedForm(values, initialPlan ? { moveOutDeadline: initialPlan.moveOutDeadline, city: initialPlan.city,
    neighborhood: initialPlan.neighborhood, title: initialPlan.title, status: initialPlan.status, pickupTimeZone: initialPlan.pickupTimeZone || '', stateId: initialPlan.stateId || '', metroId: initialPlan.metroId || '' } :
    { moveOutDeadline: '', city: '', neighborhood: '', title: '', pickupTimeZone: '', stateId: '', metroId: '' });
  const [busy, setBusy] = useState(false);
  const validation = useFormErrors(busy);
  const { errors, error } = validation;
  const [conflicts, setConflicts] = useState([]);
  const changeRegion = change => {
    setValues(previous => {
      const suggestion = directory.data?.metros.find(metro => metro.id === change.metroId)?.suggestedTimeZone;
      return { ...previous, ...change, ...(!previous.pickupTimeZone && suggestion ? { pickupTimeZone: suggestion } : {}) };
    });
    validation.clear('stateId'); validation.clear('metroId');
  };
  const change = event => {
    const { name, value } = event.target;
    setValues(current => ({ ...current, [name]: value }));
    validation.clear(name);
  };
  const submit = async event => {
    event.preventDefault();
    if (busy) return;
    validation.reset();
    setConflicts([]);
    const details = { ...values, title: values.title.trim(), city: values.city.trim(), neighborhood: values.neighborhood.trim() };
    if (values.stateId || initialPlan?.stateId || initialPlan?.metroId) {
      details.stateId = values.stateId || null; details.metroId = values.metroId || null;
    } else { delete details.stateId; delete details.metroId; }
    details.pickupTimeZone = values.pickupTimeZone.trim() || null;
    if (!details.pickupTimeZone && !initialPlan?.pickupTimeZone) delete details.pickupTimeZone;
    const issues = {};
    if (!isCalendarDate(details.moveOutDeadline)) issues.moveOutDeadline = 'Choose a valid move-out date.';
    else if (details.moveOutDeadline < utcToday() && details.moveOutDeadline !== initialPlan?.moveOutDeadline) {
      issues.moveOutDeadline = 'Choose today or a later date (UTC).';
    }
    for (const [field, maximum] of [['city', 100], ['neighborhood', 100], ['title', 120]]) {
      if ((field !== 'title' && !details[field]) || Array.from(details[field]).length > maximum || hasControlCharacters(details[field])) {
        issues[field] = field === 'title' ? 'Use a single line of at most 120 characters.' : 'Use a single line of 1 to 100 characters.';
      }
    }
    if (Object.keys(issues).length) { validation.show(issues); return; }
    setBusy(true);
    try { await onSave(details, guard.markSaved); guard.markSaved(); }
    catch (failure) {
      validation.failure(failure, ['moveOutDeadline', 'city', 'neighborhood', 'title', 'status', 'pickupTimeZone', 'stateId', 'metroId']);
      setConflicts(failure.conflicts || []);
    } finally { setBusy(false); }
  };
  const fields = [
    { name: 'moveOutDeadline', label: 'Move-out deadline', type: 'date', required: true },
    { name: 'city', label: 'City', maximum: 100, required: true },
    { name: 'neighborhood', label: 'Neighborhood', maximum: 100, required: true },
    { name: 'title', label: 'Plan title (optional)', maximum: 120 },
  ];
  return <form ref={validation.formRef} onSubmit={submit} noValidate className="plan-form" aria-busy={busy}>
    <p id="plan-privacy">Only you can see this plan. Use city and neighborhood names; keep street addresses private.</p>
    <fieldset disabled={busy} aria-describedby="plan-privacy">
      <legend className="visually-hidden">Plan details</legend>
      <RegionFields directory={directory} values={values} onChange={changeRegion} validation={validation} prefix="plan-region" />
      {!values.metroId && <p>This plan's items will not appear in metro discovery until you assign a listed metro. You can still save a plan and share its public item links.</p>}
      {fields.map(field => <div className="plan-field" key={field.name}>
        <label htmlFor={`plan-${field.name}`}>{field.label}</label>
        <input id={`plan-${field.name}`} name={field.name} type={field.type || 'text'} required={field.required}
          maxLength={field.maximum} value={values[field.name]} onChange={change}
          min={field.type === 'date' && !(initialPlan?.moveOutDeadline < utcToday()) ? utcToday() : undefined}
          aria-invalid={Boolean(errors[field.name])}
          aria-describedby={[field.type === 'date' ? 'plan-date-help' : '', errors[field.name] ? `plan-${field.name}-error` : ''].filter(Boolean).join(' ') || undefined} />
        {field.type === 'date' && <small id="plan-date-help">A calendar date, with no pickup time. New dates must be today or later, checked in UTC.</small>}
        {errors[field.name] && <p className="plan-field-error" id={`plan-${field.name}-error`}>{errors[field.name]}</p>}
      </div>)}
      {editing && <div className="plan-field">
        <label htmlFor="plan-status">Plan status</label>
        <select id="plan-status" name="status" value={values.status} onChange={change} aria-invalid={Boolean(errors.status)}
          aria-describedby={errors.status ? 'plan-status-error' : undefined}>
          {Object.entries(statusLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}
        </select>
        {errors.status && <p className="plan-field-error" id="plan-status-error">{errors.status}</p>}
      </div>}
      <div className="plan-field"><label htmlFor="plan-timezone">Pickup timezone (needed to receive requests)</label>
        <input id="plan-timezone" ref={timezoneInput} name="pickupTimeZone" list="pickup-timezones" maxLength={100} value={values.pickupTimeZone} onChange={change} {...validation.fieldProps('pickupTimeZone', 'plan-timezone-help')} placeholder="America/Los_Angeles" />
        <datalist id="pickup-timezones">{['UTC', ...(Intl.supportedValuesOf ? Intl.supportedValuesOf('timeZone') : ['America/Los_Angeles', 'America/New_York', 'Europe/London', 'Asia/Kolkata'])].map(zone => <option value={zone} key={zone} />)}</datalist>
        <small id="plan-timezone-help">Choose the timezone at the pickup location. A curated metro suggestion fills only an empty field; explicit timezones are preserved. We never use your browser or guess from a multi-timezone state. Review this field after changing region. Changing timezone or location cancels outstanding requests after confirmation.</small>
        {errors.pickupTimeZone && <p className="plan-field-error" id="pickupTimeZone-error">{errors.pickupTimeZone}</p>}
      </div>
    </fieldset>
    {error && <p ref={validation.summaryRef} tabIndex={-1} role="alert" className="plan-field-error">{error}</p>}
    {conflicts.length > 0 && <section aria-label="Items needing date changes" className="plan-panel">
      <h2>Resolve item dates first</h2>
      <p>Your plan and item dates have not changed. Open the affected items in a new tab, edit or clear their pickup date overrides, then retry this form. Your draft stays here.</p>
      <ul>{conflicts.map(item => <li key={item.id}>
        <a href={`/app/plans/${initialPlan.id}/items?edit=${item.id}`} target="_blank" rel="noopener noreferrer">{item.name} (opens new tab)</a>
        {' — '}{item.availableFrom || 'Immediately'} to {item.availableUntil || 'Plan deadline'}
      </li>)}</ul>
    </section>}
    <div className="plan-actions">
      <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? 'Saving…' : editing ? 'Save changes' : 'Create plan'}</button>
      <Link to={editing ? `/app/plans/${initialPlan.id}` : '/app/plans'}>Cancel</Link>
    </div>
  </form>;
}
