import React, { forwardRef } from 'react';
import './tokens.css';
import './primitives.css';

export function PageHeader({ title, description, action }) {
  return <header className="ui-page-header">
    <div><h1>{title}</h1>{description && <p>{description}</p>}</div>
    {action && <div className="ui-header-action">{action}</div>}
  </header>;
}

// Keep native forms, list items and sections, including their refs and ARIA.
export const Surface = forwardRef(function Surface({ as: Element = 'section', className = '', children, ...props }, ref) {
  return <Element {...props} ref={ref} className={`ui-surface ${className}`.trim()}>{children}</Element>;
});

export const Feedback = forwardRef(function Feedback({ error = false, children, ...props }, ref) {
  return <div {...props} ref={ref} className={`ui-feedback${error ? ' ui-feedback--error' : ''}`} role={error ? 'alert' : 'status'}>{children}</div>;
});
