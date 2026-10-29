import React, { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState } from 'react';
import { useBlocker } from 'react-router-dom';
import { useAppContext } from '../context/AuthContext';
import PhotoDiscardDialog from './PhotoDiscardDialog';

const DraftContext = createContext(null);
const warning = 'Discard unsaved changes?';
export const photoDraftWarning = Object.freeze({ kind: 'photos' });
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
  const drafts = useRef(new Map()), notices = useRef(new Map());
  const pending = useRef(null), [photoDialog, setPhotoDialog] = useState(null);
  const [version, changed] = useReducer(value => value + 1, 0);
  const hasChanges = useCallback(() => identity.current.enabled && [...drafts.current.values()].some(value => value === identity.current.scope), []);
  const hasPhotos = useCallback(() => identity.current.enabled && [...drafts.current.entries()].some(([id, owner]) => owner === identity.current.scope && notices.current.get(id)?.kind === 'photos'), []);
  const decidePhotos = useCallback(leave => {
    const current = pending.current; pending.current = null; setPhotoDialog(null);
    current?.resolve(Boolean(leave && current.scope === identity.current.scope && identity.current.enabled));
  }, []);
  const requestPhotos = useCallback(alsoText => {
    if (pending.current) return pending.current.promise;
    const current = { scope: identity.current.scope };
    current.promise = new Promise(resolve => { current.resolve = resolve; });
    pending.current = current; setPhotoDialog({ alsoText }); return current.promise;
  }, []);
  useEffect(() => () => { pending.current?.resolve(false); pending.current = null; }, []);
  useEffect(() => { if (pending.current && (!hasPhotos() || pending.current.scope !== scope)) decidePhotos(false); }, [version, scope, status, hasPhotos, decidePhotos]);
  const update = useCallback((id, dirty, owner, notice) => {
    if (dirty && notice) notices.current.set(id, notice); else notices.current.delete(id);
    const previous = drafts.current.get(id);
    if (dirty) drafts.current.set(id, owner); else drafts.current.delete(id);
    if (previous !== drafts.current.get(id)) changed();
  }, []);
  const discard = useCallback(() => {
    if (drafts.current.size) { drafts.current.clear(); notices.current.clear(); changed(); }
  }, []);
  const confirmDiscard = useCallback(({ release = true } = {}) => {
    // Synchronous callers cannot accidentally treat a dialog promise as approval.
    if (hasPhotos()) return false;
    const notice = [...drafts.current.entries()].find(([id, owner]) => owner === identity.current.scope && notices.current.has(id));
    if (hasChanges() && !window.confirm(notice ? notices.current.get(notice[0]) : warning)) return false;
    if (release) discard();
    return true;
  }, [hasChanges, hasPhotos, discard]);
  const requestDiscard = useCallback(async ({ release = true } = {}) => {
    if (!hasPhotos()) return confirmDiscard({ release });
    const alsoText = [...drafts.current.entries()].some(([id, owner]) => owner === identity.current.scope && notices.current.get(id)?.kind !== 'photos');
    if (!await requestPhotos(alsoText)) return false;
    if (release) discard(); return true;
  }, [hasPhotos, confirmDiscard, requestPhotos, discard]);
  const blocker = useBlocker(({ currentLocation, nextLocation }) => hasChanges() &&
    (currentLocation.pathname !== nextLocation.pathname || currentLocation.search !== nextLocation.search));
  const handling = useRef(false), currentBlocker = useRef(blocker); currentBlocker.current = blocker;
  useEffect(() => {
    if (blocker.state === 'blocked' && !handling.current) {
      handling.current = true;
      requestDiscard().then(leave => {
        handling.current = false;
        if (currentBlocker.current.state === 'blocked') { if (leave) currentBlocker.current.proceed(); else currentBlocker.current.reset(); }
      });
    }
  }, [blocker, requestDiscard]);
  useEffect(() => {
    if (!hasChanges()) return;
    const unload = event => { if (hasChanges()) { event.preventDefault(); event.returnValue = ''; } };
    window.addEventListener('beforeunload', unload);
    return () => window.removeEventListener('beforeunload', unload);
  }, [version, scope, status, hasChanges]);
  const value = useMemo(() => ({ scope, update, confirmDiscard, requestDiscard, requestPhotos, discard }), [scope, update, confirmDiscard, requestDiscard, requestPhotos, discard]);
  // New identities must not inherit either another user's draft or its guard.
  return <DraftContext.Provider value={value}><React.Fragment key={scope}>{children}</React.Fragment>{photoDialog && <PhotoDiscardDialog alsoText={photoDialog.alsoText} onDecision={decidePhotos} />}</DraftContext.Provider>;
}

export function useDiscardChanges() { return useContext(DraftContext); }
export function useUnsavedForm(values, initial, discardWarning = warning) {
  const protection = useContext(DraftContext);
  const id = useRef(Symbol('form'));
  const signature = JSON.stringify(normalize(values));
  const dirty = meaningfulChanges(values, initial);
  useLayoutEffect(() => {
    protection?.update(id.current, dirty, protection.scope, discardWarning === warning ? undefined : discardWarning);
    const formId = id.current;
    return () => protection?.update(formId, false);
  }, [protection, dirty, signature, discardWarning]);
  return {
    dirty,
    markSaved: () => protection?.update(id.current, false),
    confirmDiscard: ({ release = true } = {}) => {
      if (dirty && discardWarning?.kind === 'photos') return false;
      if (dirty && !window.confirm(discardWarning)) return false;
      // Discarding one form must not release another form's draft guard.
      if (release) protection?.update(id.current, false);
      return true;
    },
    requestDiscard: async ({ release = true, alsoText = false } = {}) => {
      if (dirty) {
        const approved = discardWarning?.kind === 'photos' ? await protection?.requestPhotos(alsoText) : window.confirm(discardWarning);
        if (!approved) return false;
      }
      if (release) protection?.update(id.current, false);
      return true;
    },
  };
}
