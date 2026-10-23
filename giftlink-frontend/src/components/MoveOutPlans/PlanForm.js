import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { isCalendarDate, utcToday } from './dates';

export const statusLabels = { active: 'Active', completed: 'Completed', cancelled: 'Cancelled' };
const hasControlCharacters = value => Array.from(value).some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127);

export default function PlanForm({ initialPlan, onSave }) {
  const editing = Boolean(initialPlan);
  const [values, setValues] = useState(() => initialPlan ? {
    moveOutDeadline: initialPlan.moveOutDeadline, city: initialPlan.city, neighborhood: initialPlan.neighborhood,
    title: initialPlan.title, status: initialPlan.status,
  } : { moveOutDeadline: '', city: '', neighborhood: '', title: '' });
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState({});
  const [error, setError] = useState('');
  const change = event => {
    const { name, value } = event.target;
    setValues(current => ({ ...current, [name]: value }));
    setErrors(current => ({ ...current, [name]: '' }));
  };
  const submit = async event => {
    event.preventDefault();
    if (busy) return;
    setError('');
    const details = { ...values, title: values.title.trim(), city: values.city.trim(), neighborhood: values.neighborhood.trim() };
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
    setErrors(issues);
    if (Object.keys(issues).length) { setError('Check the highlighted fields.'); return; }
    setBusy(true);
    try { await onSave(details); }
    catch (failure) {
      setError(failure.message || 'Could not save your plan. Please try again.');
      setErrors(Object.fromEntries((failure.fields || []).map(field => [field.field, field.message])));
    } finally { setBusy(false); }
  };
  const fields = [
    { name: 'moveOutDeadline', label: 'Move-out deadline', type: 'date', required: true },
    { name: 'city', label: 'City', maximum: 100, required: true },
    { name: 'neighborhood', label: 'Neighborhood', maximum: 100, required: true },
    { name: 'title', label: 'Plan title (optional)', maximum: 120 },
  ];
  return <form onSubmit={submit} noValidate className="plan-form" aria-busy={busy}>
    <p id="plan-privacy">Only you can see this plan. Use city and neighborhood names; keep street addresses private.</p>
    <fieldset disabled={busy} aria-describedby="plan-privacy">
      <legend className="visually-hidden">Plan details</legend>
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
    </fieldset>
    {error && <p role="alert" className="plan-field-error">{error}</p>}
    <div className="plan-actions">
      <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? 'Saving…' : editing ? 'Save changes' : 'Create plan'}</button>
      <Link to={editing ? `/app/plans/${initialPlan.id}` : '/app/plans'}>Cancel</Link>
    </div>
  </form>;
}
