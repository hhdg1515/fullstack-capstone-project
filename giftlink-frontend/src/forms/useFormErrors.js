import { useLayoutEffect, useRef, useState } from 'react';

// Keep validation beside its field; focus only after submission, never while typing.
export default function useFormErrors(busy = false) {
  const formRef = useRef(); const summaryRef = useRef(); const pending = useRef(false);
  const [errors, setErrors] = useState({}); const [error, setError] = useState('');
  useLayoutEffect(() => {
    if (!pending.current || busy) return;
    pending.current = false;
    const field = formRef.current?.querySelector('[aria-invalid="true"]');
    if (field) {
      const details = field.closest('details'); if (details) details.open = true;
      field.focus();
    } else summaryRef.current?.focus();
  });
  const show = (issues = {}, message = 'Check the highlighted fields.') => {
    pending.current = true; setErrors(issues); setError(message);
  };
  const failure = (problem, allowed, aliases = {}) => {
    const issues = {};
    for (const entry of problem.fields || []) {
      const field = aliases[entry.field] || entry.field;
      if (allowed.includes(field)) issues[field] = entry.message;
    }
    show(issues, problem.message || 'Could not save. Please try again.');
  };
  const clear = field => { setErrors(current => ({ ...current, [field]: '' })); };
  const reset = () => { setErrors({}); setError(''); };
  const fieldProps = (field, help) => ({ 'aria-invalid': Boolean(errors[field]),
    'aria-describedby': [help, errors[field] ? `${field}-error` : ''].filter(Boolean).join(' ') || undefined });
  return { formRef, summaryRef, errors, error, show, failure, clear, reset, fieldProps };
}

export function nameErrors(details) {
  return Object.fromEntries(['firstName', 'lastName'].filter(field => !details[field].trim() || Array.from(details[field].trim()).length > 80)
    .map(field => [field, `Enter a ${field === 'firstName' ? 'first' : 'last'} name of 1 to 80 characters.`]));
}
export function emailError(value, control) {
  return !value.trim() || control?.validity.typeMismatch || value.trim().length > 254 ? 'Enter a valid email address.' : '';
}
