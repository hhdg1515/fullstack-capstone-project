import React, { Children, cloneElement, useEffect, useRef, useState } from 'react';

// Keep the native form value, but draw a padded list below the control rather
// than allowing an OS popup to cover the area label.
export default function AreaSelect({ children, onChange, ...props }) {
  const [open, setOpen] = useState(false), [active, setActive] = useState(0);
  const root = useRef(), select = useRef();
  const options = Children.toArray(children).flatMap(child => child.type === 'optgroup' ? Children.toArray(child.props.children).map(option => cloneElement(option, { 'data-group': child.props.label })) : [child]).filter(option => option.type === 'option');
  const menuId = props.id + '-options';
  useEffect(() => {
    const outside = event => { if (!root.current?.contains(event.target)) setOpen(false); };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, []);
  useEffect(() => { if (props.disabled) setOpen(false); }, [props.disabled]);
  useEffect(() => { if (open) document.getElementById(menuId + '-' + active)?.scrollIntoView?.({ block: 'nearest' }); }, [open, active, menuId]);
  const show = () => { setActive(Math.max(0, options.findIndex(option => option.props.value === props.value))); setOpen(true); };
  const choose = index => {
    const option = options[index]; if (!option) return;
    onChange({ target: { name: props.name, value: option.props.value } });
    setOpen(false); select.current?.focus();
  };
  return <div className="discovery-area-select" ref={root}>
    <select {...props} ref={select} aria-expanded={open} aria-controls={open ? menuId : undefined}
      aria-activedescendant={open ? menuId + '-' + active : undefined}
      onPointerDown={event => { if (!props.disabled) { event.preventDefault(); select.current?.focus(); } }}
      onMouseDown={event => event.preventDefault()}
      onClick={event => { event.preventDefault(); if (open) setOpen(false); else show(); }}
      onBlur={event => { if (!root.current?.contains(event.relatedTarget)) setOpen(false); }}
      onChange={event => { onChange(event); setOpen(false); }}
      onKeyDown={event => {
        if (event.key === 'Tab') { setOpen(false); return; }
        if (event.key === 'Escape') { event.preventDefault(); setOpen(false); return; }
        if (['ArrowDown', 'ArrowUp', 'Home', 'End', 'Enter', ' '].includes(event.key)) {
          event.preventDefault();
          if (!open) { show(); return; }
          if (event.key === 'Enter' || event.key === ' ') choose(active);
          else setActive(index => event.key === 'Home' ? 0 : event.key === 'End' ? options.length - 1 : Math.max(0, Math.min(options.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1))));
        }
      }}>{children}</select>
    {open && !props.disabled && <div id={menuId} className="discovery-area-menu" role="listbox" tabIndex={0} onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); setOpen(false); select.current?.focus(); } }} aria-label={(props['aria-label'] || select.current?.labels?.[0]?.textContent || 'Area') + ' options'}>
      {options.map((option, index) => <React.Fragment key={option.props.value}>{option.props['data-group'] && options[index - 1]?.props['data-group'] !== option.props['data-group'] && <div className="discovery-area-group" role="presentation">{option.props['data-group']}</div>}<div id={menuId + '-' + index} role="option"
        aria-selected={option.props.value === props.value} className={index === active ? 'is-active' : ''}
        onPointerDown={event => event.preventDefault()} onMouseEnter={() => setActive(index)} onClick={() => choose(index)}>{option.props.children}</div></React.Fragment>)}
    </div>}
  </div>;
}
