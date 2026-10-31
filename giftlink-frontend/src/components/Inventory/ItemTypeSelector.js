import React, { useEffect, useId, useRef, useState } from 'react';

const normalize = value => value.normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();
export function rankedItemTypes(entries, query) {
  const search = normalize(query || '');
  if (!search) return entries;
  const rank = type => {
    const label = normalize(type.label), terms = (type.searchTerms || []).map(normalize);
    if (label === search) return 0;
    if (terms.includes(search)) return 1;
    if (label.startsWith(search)) return 2;
    if (terms.some(term => term.startsWith(search))) return 3;
    if ([label, normalize(type.category.label), ...terms].some(term => term.includes(search))) return 4;
    return 5;
  };
  return entries.map((type, index) => ({ type, index, rank: rank(type) })).filter(row => row.rank < 5)
    .sort((a, b) => a.rank - b.rank || a.index - b.index).map(row => row.type);
}

// Editable listbox: only choosing a catalog entry assigns canonical IDs.
export default function ItemTypeSelector({ categories = [], categoryId, itemTypeId, onChange, onSearch, disabled, fieldProps }) {
  const listId = useId(); const input = useRef(), root = useRef(), pointerActive = useRef(false);
  const entries = categories.flatMap(category => category.itemTypes.map(type => ({ ...type, category })));
  const selected = entries.find(type => type.id === itemTypeId && type.category.id === categoryId);
  const [query, setQuery] = useState(null), [open, setOpen] = useState(false), [active, setActive] = useState(-1);
  // Closing this in-flow list on pointer-induced blur moves a Save button
  // between pointerdown and click. Defer dismissal until that gesture completes;
  // keyboard focus changes still dismiss immediately.
  useEffect(() => {
    let closeTimer;
    const dismiss = () => {
      pointerActive.current = false;
      if (root.current && !root.current.contains(document.activeElement)) { setOpen(false); setActive(-1); }
    };
    const start = () => { clearTimeout(closeTimer); pointerActive.current = true; };
    const finish = () => { closeTimer = setTimeout(dismiss, 0); };
    document.addEventListener('pointerdown', start, true);
    document.addEventListener('pointerup', finish, true);
    document.addEventListener('click', dismiss);
    document.addEventListener('pointercancel', dismiss, true);
    window.addEventListener('blur', dismiss);
    return () => {
      clearTimeout(closeTimer);
      document.removeEventListener('pointerdown', start, true);
      document.removeEventListener('pointerup', finish, true);
      document.removeEventListener('click', dismiss);
      document.removeEventListener('pointercancel', dismiss, true);
      window.removeEventListener('blur', dismiss);
    };
  }, []);
  const search = normalize(query || '');
  const matches = rankedItemTypes(entries, search);
  // Keep the global fallback easy to find, even when a search has no matches.
  const fallback = entries.find(type => type.id === 'other');
  const options = search && fallback && !matches.includes(fallback) ? [...matches, fallback] : matches;
  useEffect(() => { if (open && active >= 0) document.getElementById(`${listId}-${active}`)?.scrollIntoView?.({ block: 'nearest' }); }, [active, open, listId]);
  const choose = type => {
    if (disabled) return;
    onChange(type.category.id, type.id); onSearch(''); input.current?.focus(); setQuery(null); setOpen(false); setActive(-1);
  };
  const category = categories.find(row => row.id === categoryId);
  return <div ref={root} className="ui-field item-type-selector" onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget) && !pointerActive.current) { setOpen(false); setActive(-1); } }}>
    <label htmlFor="item-type">Item type</label>
    <div className="item-type-input">
      <input id="item-type" ref={input} role="combobox" aria-autocomplete="list" aria-expanded={open && !disabled}
        aria-controls={open && !disabled ? listId : undefined} aria-activedescendant={open && active >= 0 && options[active] ? `${listId}-${active}` : undefined}
        autoComplete="off" maxLength={100} disabled={disabled} placeholder="Search item types" value={query === null ? selected?.label || '' : query}
        {...fieldProps} onFocus={() => { setOpen(true); setActive(-1); }}
        onChange={event => { setQuery(event.target.value); onSearch(event.target.value); setOpen(true); setActive(-1); if (categoryId || itemTypeId) onChange('', ''); }}
        onKeyDown={event => {
          if (['ArrowDown', 'ArrowUp'].includes(event.key)) {
            event.preventDefault(); setOpen(true);
            setActive(index => event.key === 'ArrowDown' ? Math.min(index + 1, options.length - 1) : index < 0 ? options.length - 1 : Math.max(index - 1, 0));
          } else if (open && ['Home', 'End'].includes(event.key)) { event.preventDefault(); setActive(event.key === 'Home' ? 0 : options.length - 1); }
          else if (event.key === 'Enter' && open) { event.preventDefault(); if (options[active]) choose(options[active]); }
          else if (event.key === 'Escape' && open) { event.preventDefault(); event.stopPropagation(); setOpen(false); setActive(-1); }
        }} />
      {(selected || query || categoryId) && <button type="button" className="ui-button ui-button--secondary" disabled={disabled} aria-label="Clear item type" onClick={() => { onChange('', ''); onSearch(''); setQuery(''); setActive(-1); input.current?.focus(); setOpen(true); }}>Clear</button>}
    </div>
    {category && <small className="item-type-category">{category.label}</small>}
    {open && !disabled && <>
      {search && matches.length === 0 && <p role="status" className="item-type-empty">No matching types. Choose Other.</p>}
      <ul id={listId} role="listbox" aria-label="Item types" className="item-type-options">
        {options.map((type, index) => <li key={type.id} id={`${listId}-${index}`} role="option" aria-selected={type.id === itemTypeId}
          className={active === index ? 'is-active' : ''} onMouseDown={event => event.preventDefault()} onClick={() => choose(type)}>
          <span>{type.label}</span><small>{type.category.label}</small>
        </li>)}
      </ul>
    </>}
  </div>;
}
