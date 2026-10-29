import React, { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useReducer, useRef } from 'react';
import { useBlocker } from 'react-router-dom';
import { useAppContext } from '../context/AuthContext';

const DraftContext = createContext(null);
const warning = 'Discard unsaved changes?';
const normalize = values => Object.fromEntries(Object.entries(values).map(([key, value]) =>
  [key, typeof value === 'string' && key !== 'password' ? value.trim() : value ?? '']));
export const meaningfulChanges = (values, initial) => {
  const current = normalize(values), baseline = normalize(initial);
  return [...new Set([...Object.keys(current), ...Object.keys(baseline)])].some(key => (current[key] ?? '') !== (baseline[key] ?? ''));
};

export function UnsavedChangesProvider({ children }) {
  const { user, status } = useAppContext();
  const scope = user?.id || 'anonymous';
  const identity = useRef(); identity.current = { scope, enabled: ['anonymous', 'authenticated'].includes(status) };
  const drafts = useRef(new Map());
  const [version, changed] = useReducer(value => value + 1, 0);
  const hasChanges = useCallback(() => identity.current.enabled && [...drafts.current.values()].some(value => value === identity.current.scope), []);
  const update = useCallback((id, dirty, owner) => {
    const previous = drafts.current.get(id);
    if (dirty) drafts.current.set(id, owner); else drafts.current.delete(id);
    if (previous !== drafts.current.get(id)) changed();
  }, []);
  const discard = useCallback(() => {
    if (drafts.current.size) { drafts.current.clear(); changed(); }
  }, []);
  const confirmDiscard = useCallback(({ release = true } = {}) => {
    if (hasChanges() && !window.confirm(warning)) return false;
    if (release) discard();
    return true;
  }, [hasChanges, discard]);
  const blocker = useBlocker(({ currentLocation, nextLocation }) => hasChanges() &&
    (currentLocation.pathname !== nextLocation.pathname || currentLocation.search !== nextLocation.search));
  useEffect(() => {
    if (blocker.state === 'blocked') {
      if (confirmDiscard()) blocker.proceed(); else blocker.reset();
    }
  }, [blocker, confirmDiscard]);
  useEffect(() => {
    if (!hasChanges()) return;
    const unload = event => { if (hasChanges()) { event.preventDefault(); event.returnValue = ''; } };
    window.addEventListener('beforeunload', unload);
    return () => window.removeEventListener('beforeunload', unload);
  }, [version, scope, status, hasChanges]);
  const value = useMemo(() => ({ scope, update, confirmDiscard, discard }), [scope, update, confirmDiscard, discard]);
  // New identities must not inherit either another user's draft or its guard.
  return <DraftContext.Provider value={value}><React.Fragment key={scope}>{children}</React.Fragment></DraftContext.Provider>;
}

export function useDiscardChanges() { return useContext(DraftContext); }
export function useUnsavedForm(values, initial) {
  const protection = useContext(DraftContext);
  const id = useRef(Symbol('form'));
  const signature = JSON.stringify(normalize(values));
  const dirty = meaningfulChanges(values, initial);
  useLayoutEffect(() => {
    protection?.update(id.current, dirty, protection.scope);
    const formId = id.current;
    return () => protection?.update(formId, false);
  }, [protection, dirty, signature]);
  return {
    dirty,
    markSaved: () => protection?.update(id.current, false),
    confirmDiscard: ({ release = true } = {}) => {
      if (dirty && !window.confirm(warning)) return false;
      // Discarding one form must not release another form's draft guard.
      if (release) protection?.update(id.current, false);
      return true;
    },
  };
}
