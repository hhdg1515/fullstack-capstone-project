import React, { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { useAppContext } from '../../context/AuthContext';
import { photoDraftWarning, useUnsavedForm } from '../../forms/UnsavedChanges';
import { Feedback, Surface } from '../../design-system/primitives';
import { deletePhoto, reorderPhotos, fileDigest, photoError, photoUrl, readPhotos, readUpload, reservePhoto, securePhotoBrowser, uploadId, uploadPhoto, validReady } from '../../api/itemImages';
import { preparePhoto, sourcePhotoError } from '../../api/photoPreparation';
import PhotoDeleteDialog from './PhotoDeleteDialog';
import './ItemPhotos.css';

export const isQueuedPhoto = entry => ['selected', 'reserved'].includes(entry.phase) && !entry.putAttempted && !entry.recoveryCheckedMissing &&
  (!entry.operation || (entry.operation.state === 'reserved' && !entry.operation.reservationExpired));
export const isUnsentPhoto = entry => entry.phase !== 'ready' && entry.operation?.state !== 'ready';

export function operationLabel(operation) {
  if (operation.state === 'delete_pending') return 'Cleanup pending';
  if (operation.cleanupPending) return 'Upload needs review';
  if (operation.reservationExpired) return 'Upload expired';
  return { reserved: 'Waiting for photo', processing: 'Processing', ready: 'Uploaded', failed: 'Upload failed', deleted: 'Removed' }[operation.state] || 'Check status';
}
function entryProblem(entry) {
  if (entry.operation?.cleanupPending) return "Couldn't upload. Space is still held; contact support.";
  if (entry.operation?.reservationExpired) return 'Upload expired. Choose the photo again.';
  if (entry.phase === 'failed') return "Couldn't upload. Choose another photo.";
  if (entry.phase === 'uncertain') return 'Upload not confirmed. Check status.';
  return '';
}
function LocalPreview({ url, position }) {
  const [failed, setFailed] = useState(false);
  return failed || !url ? <p className="item-photo-missing">Preview unavailable</p> :
    <img src={url} alt={'Local preview of selected photo ' + position} onError={() => setFailed(true)} />;
}

export function ReadyPhoto({ image, position, cover = false, managing = false, children }) {
  const [failed, setFailed] = useState(false);
  return <li className="item-photo-ready" {...(managing ? { id: `manage-photo-${image.id}`, tabIndex: -1, 'aria-label': `Saved photo ${position + 1}${cover ? ", Cover" : ""}` } : {})}>
    {failed ? <p className="item-photo-problem">Photo unavailable. Refresh to check again.</p> :
      <img src={photoUrl(image.id)} crossOrigin="use-credentials" alt={(managing ? 'Saved photo ' : 'Uploaded photo ') + (position + 1)} width={image.thumbnail.width} height={image.thumbnail.height}
        onError={() => setFailed(true)} loading="lazy" />}
    <span className="visually-hidden">Photo {position + 1} uploaded.</span>
    {cover && <span className={'item-photo-cover' + (failed ? ' item-photo-cover--unavailable' : '')}>Cover</span>}
    {children}
  </li>;
}

const PhotoSession = forwardRef(function PhotoSession({ planId, item = {}, onClose, entries: ownedEntries, onEntriesChange, previewUrls, capabilities, embedded = false, onMetadata, onBusyChange, uploadIntent, claimUploadIntent, recovery = false, changeIntent, onChangeIntent, disabled: saving = false }, ref) {
  const [data, setData] = useState(null), [loading, setLoading] = useState(true), [error, setError] = useState(null);
  const [localChange, setLocalChange] = useState(null), [deleting, setDeleting] = useState(null);
  const pendingChange = changeIntent === undefined ? localChange : changeIntent;
  const changeRef = useRef(pendingChange), managementFocus = useRef(), deletionNotice = useRef(); changeRef.current = pendingChange;
  const setChange = value => { changeRef.current = value; if (onChangeIntent) onChangeIntent(value); else setLocalChange(value); };
  const [localEntries, setLocalEntries] = useState([]), [busy, setBusy] = useState(false), [message, setMessage] = useState(''), [announcement, setAnnouncement] = useState(''), [refresh, setRefresh] = useState(0);
  const entries = ownedEntries ?? localEntries, setEntries = onEntriesChange || setLocalEntries;
  const draft = !item.id, dataRef = useRef(data), batch = useRef(false); dataRef.current = data;
  const [batchBusy, setBatchBusy] = useState(false), [metadataStale, setMetadataStale] = useState(false);
  useEffect(() => { onBusyChange?.(busy || batchBusy); }, [busy, batchBusy, onBusyChange]);
  const alive = useRef(true), inFlight = useRef(false), urls = useRef(previewUrls || new Set()), activeUpload = useRef(), fileInput = useRef(), addButton = useRef(), heading = useRef(), feedback = useRef(), focusSelection = useRef(false);
  const guard = useUnsavedForm({ photos: ownedEntries ? '' : entries.filter(isUnsentPhoto).map(entry => entry.clientUploadId).join(',') }, { photos: '' }, photoDraftWarning);
  useImperativeHandle(ref, () => ({ confirmDiscard: guard.confirmDiscard }));
  useEffect(() => {
    if (!busy && !loading && focusSelection.current) {
      focusSelection.current = false;
      (addButton.current?.disabled ? heading : addButton).current?.focus();
    }
  }, [busy, loading, entries.length]);
  const releaseUrl = url => { if (urls.current.delete(url)) URL.revokeObjectURL(url); };
  const mountOptions = useRef({ autofocus: !embedded || Boolean(item.id && entries.length), ownsPreviews: !previewUrls });
  useEffect(() => {
    const options = mountOptions.current; alive.current = true; if (options.autofocus) heading.current?.focus();
    const ownedUrls = urls.current;
    return () => { alive.current = false; activeUpload.current?.abort(); if (options.ownsPreviews) { ownedUrls.forEach(url => URL.revokeObjectURL(url)); ownedUrls.clear(); } };
  }, []);
  const current = () => alive.current;
  const failed = failure => {
    if (!current()) return;
    setError(failure);
    if (failure.status === 401) window.dispatchEvent(new Event('giftlink:unauthorized'));
    else setTimeout(() => { if (current()) (failure.field === 'file' ? addButton : feedback).current?.focus(); }, 0);
  };
  const updateDeletionNotice = result => {
    if (result.uploads.some(operation => operation.id === deletionNotice.current && operation.state === 'deleted')) {
      setMessage(previous => previous === 'Photo deleted. Cleanup pending.' ? 'Photo deleted.' : previous);
    }
  };
  const load = async () => {
    try {
      const result = await readPhotos(planId, item.id);
      if (current()) { dataRef.current = result; setData(result); setMetadataStale(false); setError(null); onMetadata?.(item.id, result); updateDeletionNotice(result); }
      return result;
    } catch (failure) { if (current()) setMetadataStale(true); throw failure; }
  };
  useEffect(() => {
    let active = true; if (draft || (embedded && capabilities?.metadata !== true)) { setLoading(false); return; } setLoading(true);
    readPhotos(planId, item.id).then(value => { if (active && current()) { dataRef.current = value; setData(value); setMetadataStale(false); setError(null); onMetadata?.(item.id, value); updateDeletionNotice(value); } }).catch(failure => {
      if (active && current()) { setMetadataStale(true); failed({ ...failure, message: failure.message, blockUploads: true }); }
    }).finally(() => { if (active && current()) setLoading(false); });
    return () => { active = false; };
    // This instance is keyed to the account/plan/item; refresh is deliberately manual.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refresh, planId, item.id]);
  const patch = (clientId, values) => { if (current()) setEntries(list => list.map(entry => entry.clientUploadId === clientId ? { ...entry, ...values } : entry)); };
  const complete = entry => {
    if (!current()) return;
    releaseUrl(entry.url); setEntries(list => list.filter(value => value.clientUploadId !== entry.clientUploadId));
    setMessage(''); setAnnouncement('Photo uploaded.');
    focusSelection.current = true;
  };
  const acknowledgeReady = (entry, result) => {
    const latest = dataRef.current;
    // A confirmed operation can preserve its safe thumbnail even if the next
    // collection read fails. Admission still requires a fresh metadata read.
    if (!latest || !validReady(result.upload)) return false;
    const images = latest.images.filter(image => image.id !== result.upload.id).concat(result.upload).sort((a, b) => a.sortPosition - b.sortPosition);
    if (images.length > 5) return false;
    const snapshot = { ...latest, imageRevision: Math.max(latest.imageRevision, result.imageRevision), images };
    dataRef.current = snapshot; setData(snapshot); setMetadataStale(true); onMetadata?.(item.id, snapshot); complete(entry);
    return true;
  };
  const add = async event => {
    const files = Array.from(event.target.files || []); event.target.value = '';
    if (!files.length || changeRef.current || inFlight.current || batch.current || saving || !(draft ? capabilities?.binaryUpload === true : data?.capabilities.binaryUpload && data.allowance.newUploadsAllowed)) return;
    const unreserved = entries.filter(entry => !entry.operation).length;
    if (files.length + entries.length > 5 || files.length + unreserved > (draft ? 5 : data.allowance.itemSlots)) {
      failed({ ...photoError({ code: 'IMAGE_ITEM_LIMIT', status: 409 }), message: 'Choose up to 5 photos in total.', field: 'file' }); return;
    }
    // One bounded decode at a time. Only the resulting canvas derivative becomes
    // entry.file; the original never reaches hashing/reservation/multipart code.
    inFlight.current = true; setBusy(true); onBusyChange?.(true); setError(null);
    let preparedCount = 0;
    try {
      for (const source of files) {
        if (!current()) return;
        const clientUploadId = uploadId();
        setEntries(list => list.concat({ clientUploadId, file: null, url: null, phase: 'preparing', operation: null, reservationAttempted: false, putAttempted: false }));
        try {
          const problem = sourcePhotoError(source); if (problem) throw Error(problem);
          const file = await preparePhoto(source); if (!current()) return;
          const url = URL.createObjectURL(file); urls.current.add(url);
          patch(clientUploadId, { file, url, phase: 'selected', error: '' }); preparedCount++;
        } catch (failure) {
          if (current()) {
            const message = failure.code === 'PHOTO_PREPARATION_FAILED' || sourcePhotoError(source) ? failure.message : 'Could not prepare this photo. Try a smaller JPEG.';
            patch(clientUploadId, { phase: 'failed', error: message }); failed({ message, clientUploadId, field: 'file' });
          }
        }
      }
      if (current()) { setMessage(''); setAnnouncement(preparedCount ? `${preparedCount} photos prepared. Save or publish to include them.` : 'No photos prepared. Check the photo errors.'); }
    } catch (failure) { failed(photoError(failure)); }
    finally { if (current()) { inFlight.current = false; setBusy(false); } }
  };
  const upload = async (entry, publicConfirmed = false) => {
    const data = dataRef.current;
    if (changeRef.current || inFlight.current || !data || loading || error?.blockUploads || entry.putAttempted || entry.phase === 'uncertain' || (entry.operation && (entry.operation.state !== 'reserved' || entry.operation.reservationExpired))) return;
    if (!embedded && !publicConfirmed && item.status === 'available' && !window.confirm('Add this photo to the posted item? Ready photos follow its public visibility.')) return;
    inFlight.current = true; setBusy(true); setError(null); setMessage('');
    let operation = entry.operation, attempted = entry.reservationAttempted, confirmedReady = false;
    try {
      // Use the last authoritative read, then let the versioned reservation
      // enforce races. Avoid redundant GETs that consume the control budget.
      const latest = data; let revision = latest.imageRevision; if (!current()) return;
      if (!latest.capabilities.binaryUpload || !latest.allowance.newUploadsAllowed) { setMessage('Photo uploads are unavailable for this item.'); return; }
      if (!operation) {
        patch(entry.clientUploadId, { phase: 'hashing' });
        const sha256 = await fileDigest(entry.file); if (!current()) return;
        patch(entry.clientUploadId, { phase: 'reserving', reservationAttempted: true }); attempted = true;
        const result = await reservePhoto(planId, item.id, { imageRevision: latest.imageRevision, clientUploadId: entry.clientUploadId, byteLength: entry.file.size, sha256 });
        if (!current()) return; operation = result.upload; revision = result.imageRevision;
        patch(entry.clientUploadId, { operation });
      }
      if (operation.state === 'ready') { confirmedReady = true; const removed = acknowledgeReady(entry, { imageRevision: revision, upload: operation }); await load(); if (!removed) complete(entry); return true; }
      if (operation.state !== 'reserved' || operation.reservationExpired) {
        patch(entry.clientUploadId, { operation, phase: operation.state === 'processing' ? 'processing' : 'failed' }); return;
      }
      const controller = new AbortController(); activeUpload.current = controller;
      patch(entry.clientUploadId, { operation, phase: 'uploading', putAttempted: true, percent: 0 });
      const response = await uploadPhoto(planId, item.id, operation.id, entry.file, { signal: controller.signal, onProgress: (percent, processing) =>
        patch(entry.clientUploadId, { percent, phase: processing ? 'processing' : 'uploading' }) });
      if (!current()) return;
      patch(entry.clientUploadId, { operation: response.upload, phase: response.upload.state === 'ready' ? 'ready' : 'processing' });
      confirmedReady = response.upload.state === 'ready';
      const removed = confirmedReady && acknowledgeReady(entry, response);
      await load();
      if (confirmedReady && !removed) complete(entry);
      return response.upload.state === 'ready';
    } catch (failure) {
      if (!current()) return;
      if (confirmedReady) { failed({ ...photoError(failure), message: 'Photo uploaded. Refresh photos to update status.', blockUploads: true }); return; }
      const safe = photoError(failure, attempted); if (attempted) setMetadataStale(true);
      const message = safe.uncertain ? 'Upload not confirmed. Check status.' : safe.message;
      patch(entry.clientUploadId, { operation, reservationAttempted: attempted,
        ...((operation && safe.status === 429 && ['IMAGE_PROCESSOR_BUSY', 'IMAGE_CONTROL_LIMIT'].includes(safe.code)) ? { putAttempted: false } : {}),
        phase: safe.uncertain || operation ? 'uncertain' : 'selected', error: message });
      failed({ ...safe, message, clientUploadId: entry.clientUploadId, blockUploads: safe.code === 'IMAGE_CHANGED' || (!operation && !attempted) });
    } finally { if (current()) { inFlight.current = false; setBusy(false); activeUpload.current = null; } }
  };
  const check = async entry => {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true); setError(null); setMessage('');
    let confirmedReady = false;
    try {
      const result = await readUpload(planId, item.id, entry.operation?.id, entry.clientUploadId);
      if (!current()) return;
      patch(entry.clientUploadId, { operation: result.upload, phase: result.upload.state === 'reserved' ? (entry.putAttempted ? 'uncertain' : 'reserved') : result.upload.state === 'processing' ? 'processing' : 'failed', error: '', recoveryCheckedMissing: false });
      confirmedReady = result.upload.state === 'ready';
      const removed = confirmedReady && acknowledgeReady(entry, result);
      await load();
      if (result.upload.state === 'ready' && !removed) complete(entry);
      if (current() && result.upload.state !== 'ready') setAnnouncement(operationLabel(result.upload) + '. No file was resent.');
    } catch (failure) {
      if (!current()) return;
      if (confirmedReady) { failed({ ...photoError(failure), message: 'Photo uploaded. Refresh photos to update status.', blockUploads: true }); return; }
      if (failure.status === 404 && !entry.operation && !entry.putAttempted) {
        patch(entry.clientUploadId, { recoveryCheckedMissing: true, error: "Upload wasn't found. You can retry." });
        try { await load(); } catch (problem) { failed(problem); return; }
      }
      else failed({ ...failure, message: failure.message, clientUploadId: entry.clientUploadId });
    } finally { if (current()) { inFlight.current = false; setBusy(false); } }
  };
  const uploadable = entries.filter(isQueuedPhoto);
  const uploadSelected = async (authorization = null) => {
    if (draft || changeRef.current || inFlight.current || batch.current || saving || metadataStale || !uploadable.length) return;
    const selected = authorization ? uploadable.filter(entry => authorization.clientIds.includes(entry.clientUploadId)) : uploadable;
    if (!selected.length) return;
    if (!embedded && item.status === 'available' && !window.confirm('Upload these photos to the public listing?')) return;
    batch.current = true; setBatchBusy(true); onBusyChange?.(true);
    try { for (const entry of selected) { if (!current() || !await upload(entry, true)) break; } }
    finally { if (current()) { batch.current = false; setBatchBusy(false); } }
  };
  useEffect(() => {
    if (!uploadIntent || uploadIntent.itemId !== item.id || draft || saving || loading || inFlight.current || batch.current) return;
    const authorization = claimUploadIntent?.(uploadIntent.id, item.id);
    if (authorization && data && !metadataStale && !error?.blockUploads) uploadSelected(authorization);
    // The parent consumes an explicit submit intent before any async work. A
    // status refresh, rerender or remount cannot authorize the same batch again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uploadIntent, item.id, draft, saving, loading, data, metadataStale, claimUploadIntent]);
  const reviewChange = async intent => {
    // Status + a full canonical list are reads, never an automatic mutation retry.
    let status;
    if (intent.kind === 'delete') {
      status = await readUpload(planId, item.id, intent.imageId);
      if (status.upload.id !== intent.imageId) throw photoError({ status: 503 });
    }
    const latest = await load(); if (!current()) return;
    if (intent.kind === 'delete') {
      const removed = ['delete_pending', 'deleted'].includes(status.upload.state);
      const present = latest.images.some(image => image.id === intent.imageId);
      if ((!removed && status.upload.state !== 'ready') || removed === present) throw photoError({ status: 503 });
      if (removed) deletionNotice.current = intent.imageId;
      setMessage(removed ? (status.upload.state === 'deleted' ? 'Photo deleted.' : 'Photo deleted. Cleanup pending.') : 'Photo is still present. Review it before deleting again.');
      managementFocus.current = latest.images[Math.min(intent.position, latest.images.length - 1)]?.id || 'heading';
    } else {
      setMessage(latest.images.map(image => image.id).join(',') === intent.imageIds.join(',') ? 'Photo order saved.' : 'Photos changed. Review the current order.');
      managementFocus.current = intent.imageId;
    }
    setChange(null);
  };
  const manage = async (kind, imageId, direction) => {
    const latest = dataRef.current;
    if (!latest?.capabilities.imageRead || inFlight.current || batch.current || saving || loading || metadataStale || changeRef.current || uploadIntent) return;
    const position = latest.images.findIndex(image => image.id === imageId); if (position < 0) return;
    const imageIds = latest.images.map(image => image.id);
    if (kind === 'order') {
      if (direction === 'cover') imageIds.unshift(...imageIds.splice(position, 1));
      else { const target = position + direction; if (target < 0 || target >= imageIds.length) return; [imageIds[position], imageIds[target]] = [imageIds[target], imageIds[position]]; }
    }
    const intent = { kind, imageId, imageIds, position, imageRevision: latest.imageRevision };
    inFlight.current = true; setBusy(true); onBusyChange?.(true); setChange(intent); setError(null); setMessage(''); setMetadataStale(true);
    try {
      if (kind === 'delete') await deletePhoto(planId, item.id, imageId, intent.imageRevision);
      else await reorderPhotos(planId, item.id, intent.imageRevision, imageIds);
      if (current()) await reviewChange(intent);
    } catch (failure) {
      if (current()) failed({ ...failure, message: failure.status === 401 ? failure.message : failure.status === 429 ? failure.message : 'Photo change not confirmed. Check changes before continuing.' });
    } finally { if (current()) { inFlight.current = false; setBusy(false); } }
  };
  const checkChange = async () => {
    if (!changeRef.current || inFlight.current || batch.current || saving || loading) return;
    const intent = changeRef.current; inFlight.current = true; setBusy(true); onBusyChange?.(true); setError(null);
    try { await reviewChange(intent); }
    catch (failure) { failed({ ...failure, message: [401, 429].includes(failure.status) || failure.code === 'IMAGE_METADATA_INVALID' ? failure.message : 'Could not check photo changes. Try again.' }); }
    finally { if (current()) { inFlight.current = false; setBusy(false); } }
  };
  useEffect(() => {
    if (busy || loading || !managementFocus.current) return;
    const id = managementFocus.current; managementFocus.current = null;
    (document.getElementById('manage-photo-' + id) || heading.current)?.focus();
  }, [busy, loading, data]);
  const managementDisabled = saving || busy || batchBusy || loading || metadataStale || Boolean(pendingChange) || Boolean(uploadIntent);
  const disabled = saving || Boolean(pendingChange) || metadataStale || (draft ? capabilities?.binaryUpload !== true : !data || !data.capabilities.binaryUpload || !data.allowance.newUploadsAllowed) || Boolean(error?.blockUploads) || !securePhotoBrowser();
  const selectionSlots = draft ? 5 - entries.length : data ? data.allowance.itemSlots - entries.filter(entry => !entry.operation).length : 0;
  const pendingHistory = data?.uploads.filter(operation => !entries.some(entry => entry.operation?.id === operation.id)) || [];
  const needsRefresh = Boolean(error) || pendingHistory.length > 0 || entries.some(entry => entry.reservationAttempted);
  const selectionDisabled = disabled || busy || batchBusy || loading || entries.length >= 5 || selectionSlots <= 0;
  const count = draft ? entries.length : data ? data.images.length + entries.filter(entry => !data.images.some(image => image.id === entry.operation?.id)).length : null;
  const refreshButton = <button type="button" className="item-photos-link" aria-label="Refresh photos" disabled={busy || batchBusy || saving || loading}
    onClick={() => { setError(null); setRefresh(value => value + 1); }}>Refresh</button>;
  const fileErrorId = error?.clientUploadId ? 'selected-photo-error-' + entries.findIndex(entry => entry.clientUploadId === error.clientUploadId) : 'photo-error';
  const Wrapper = embedded ? 'section' : Surface;
  return <Wrapper id="owner-photo-manager" className="item-photos" aria-labelledby="item-photos-title">
    <div className="item-photos-heading">
      <h2 ref={heading} tabIndex={-1} id="item-photos-title">Photos{item.name && <span className="visually-hidden"> for {item.name}</span>}</h2>
      <span className="item-photos-count" aria-label={count === null ? 'Photo count unavailable' : `${count} photos and selections, maximum 5`}>{count ?? '—'} / 5</span>
      {!embedded && <button type="button" className="item-photos-icon" aria-label="Close photos" title="Close photos"
        onClick={async () => { if (await guard.requestDiscard()) onClose?.(); }}>×</button>}
    </div>
    {!embedded && <p className="item-photos-context">{item.name}</p>}
    <div role="status" className="visually-hidden">{announcement}</div>
    {entries.some(isUnsentPhoto) && <p className="item-photo-note">Unsent photos stay in this tab. Reloading will lose them.</p>}
    {!draft && uploadable.length > 0 && (!embedded || recovery) && !uploadIntent && !busy && !batchBusy && <button type="button" className="ui-button" disabled={disabled || loading} onClick={() => uploadSelected()}>{embedded ? 'Upload remaining ' : 'Upload '}{uploadable.length} {uploadable.length === 1 ? 'photo' : 'photos'}</button>}
    {pendingChange && <div className="item-photo-change-status">{(busy || !error) && <p role="status">{busy ? 'Updating photos…' : 'Review the last photo change.'}</p>}
      <button type="button" className="ui-button ui-button--secondary" disabled={busy || batchBusy || saving || loading} onClick={checkChange}>Check photo changes</button></div>}
    {deleting && <PhotoDeleteDialog position={deleting.position} cover={deleting.position === 0 && data.images.length > 1}
      onDecision={approved => { const id = deleting.id; setDeleting(null); if (approved) manage('delete', id); }} />}
    {loading && <p role="status">Loading photos…</p>}
    {error && !error.clientUploadId && <p id="photo-error" className="item-photo-problem" role={error.code === 'NOT_FOUND' ? 'status' : 'alert'} ref={feedback} tabIndex={-1}>{error.message}</p>}
    {message && <p role="status" className="item-photo-note">{message}</p>}
    {embedded && !draft && capabilities?.metadata !== true && <p role="status">Photo uploads are unavailable.</p>}
    {(draft ? capabilities && !capabilities.binaryUpload : data && !data.capabilities.binaryUpload) && <p role="status">Photo uploads are unavailable.</p>}
    {data && data.capabilities.binaryUpload && !data.allowance.newUploadsAllowed && <p role="status">Update the plan and pickup dates to add photos.</p>}
    {!securePhotoBrowser() && <p role="status">Use a current browser over HTTPS or localhost.</p>}
    {(entries.length > 0 || data?.images.length > 0) && <ul className="item-photos-grid" aria-label="Photos and selections">
      {(!embedded || !recovery) && data?.capabilities.imageRead && data.images.map((image, index) => <ReadyPhoto key={image.id + ':' + refresh} image={image} position={index} cover={index === 0} managing={embedded}>
        {embedded && <div className="item-photo-controls">
          <button type="button" className="ui-button ui-button--secondary" aria-label={`Move photo ${index + 1} up`} disabled={managementDisabled || index === 0} onClick={() => manage('order', image.id, -1)}>Up</button>
          <button type="button" className="ui-button ui-button--secondary" aria-label={`Move photo ${index + 1} down`} disabled={managementDisabled || index === data.images.length - 1} onClick={() => manage('order', image.id, 1)}>Down</button>
          {index > 0 && <button type="button" className="ui-button ui-button--secondary" aria-label={`Make photo ${index + 1} cover`} disabled={managementDisabled} onClick={() => manage('order', image.id, 'cover')}>Make cover</button>}
          <button type="button" className="ui-button ui-button--secondary item-photo-delete" aria-label={`Delete photo ${index + 1}`} disabled={managementDisabled} onClick={() => setDeleting({ id: image.id, position: index })}>Delete</button>
        </div>}
      </ReadyPhoto>)}
      {entries.map((entry, index) => {
        const problem = error?.clientUploadId === entry.clientUploadId ? error.message : entry.error || entryProblem(entry);
        const preparing = ['preparing', 'hashing', 'reserving'].includes(entry.phase);
        const transferring = ['uploading', 'processing'].includes(entry.phase);
        return <li key={entry.clientUploadId} className="item-photo-selection" aria-label={'Selected photo ' + (index + 1)} aria-describedby={problem ? 'selected-photo-error-' + index : undefined}>
          <div className="item-photo-preview"><LocalPreview url={entry.url} position={index + 1} />
            <button type="button" className="item-photos-icon item-photo-remove" aria-label={'Remove selection ' + (index + 1)} title="Remove selection" disabled={busy || batchBusy || saving} onClick={() => {
              releaseUrl(entry.url); setEntries(list => list.filter(value => value.clientUploadId !== entry.clientUploadId)); setError(null);
              setMessage(entry.reservationAttempted ? 'Selection removed. Its upload may still use space.' : ''); setAnnouncement('Selection removed.'); focusSelection.current = true;
            }}>×</button>
          </div>
          {(preparing || transferring) && <p role="status" className="item-photo-progress">{preparing ? 'Preparing…' : entry.phase === 'uploading' ? `Uploading ${entry.percent || 0}%` : 'Processing…'}
            {entry.phase === 'processing' && <span className="visually-hidden">{entry.percent === 100 ? 'Bytes transferred; not ready yet.' : 'Waiting for server confirmation.'}</span>}</p>}
          {transferring && <progress {...(entry.phase === 'uploading' ? { max: 100, value: entry.percent || 0 } : {})}
            aria-label={(entry.phase === 'uploading' ? 'Bytes transferred for selected photo ' : 'Processing photo ') + (index + 1)} />}
          {problem && <p id={'selected-photo-error-' + index} className="item-photo-problem" role="alert" ref={error?.clientUploadId === entry.clientUploadId ? feedback : undefined} tabIndex={-1}>{problem}</p>}
          <div className="item-photos-actions">
            {entry.reservationAttempted && !preparing && !transferring && <button type="button" className="ui-button ui-button--secondary" aria-label={'Check upload ' + (index + 1) + ' status'} disabled={busy || batchBusy || saving || loading}
              onClick={() => check(entry)}>Check status</button>}
            {entry.phase === 'processing' && !busy && <button type="button" className="ui-button ui-button--secondary" aria-label={'Check upload ' + (index + 1) + ' status'} disabled={loading}
              onClick={() => check(entry)}>Check status</button>}
            {entry.recoveryCheckedMissing && !entry.putAttempted && <button type="button" className="ui-button" aria-label={'Retry upload ' + (index + 1)} disabled={busy || loading || disabled}
              onClick={() => upload({ ...entry, phase: 'selected' })}>Retry upload</button>}
          </div>
        </li>;
      })}
    </ul>}
    {data && data.images.length > 0 && !data.capabilities.imageRead && <p role="status">Saved photos are temporarily unavailable.</p>}
    <div className="item-photos-footer">
      <button ref={addButton} type="button" className={'ui-button' + (entries.length ? ' ui-button--secondary' : '')} disabled={selectionDisabled}
        aria-describedby={'photo-format-help photo-privacy' + (error?.field === 'file' ? ' ' + fileErrorId : '')} onClick={() => fileInput.current?.click()}>Add photos</button>
      <input ref={fileInput} id="item-photo-files" type="file" aria-label="Choose photos" hidden accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp" multiple disabled={selectionDisabled}
        aria-invalid={error?.field === 'file' || undefined} aria-describedby={'photo-format-help photo-privacy' + (error?.field === 'file' ? ' ' + fileErrorId : '')} onChange={add} />
      {needsRefresh && refreshButton}
      <details className="item-photos-help"><summary>Photo tips</summary>
        <p id="photo-format-help">Up to 5 photos. JPEG, PNG or static WebP, up to 20 MiB each. Photos are resized before upload; the server checks them again. Convert HEIC to JPEG.</p>
        <p id="photo-privacy">Remove visible addresses, labels, documents and people. Get permission; removing metadata does not hide these details.</p>
        <p>Source photos: at most 48 megapixels and 10,000 pixels per edge. Upload copies: at most 1280 pixels and 3 MiB.</p>
        {!needsRefresh && refreshButton}
      </details>
    </div>
    {pendingHistory.length > 0 && <details className="item-photo-history"><summary>Upload history</summary>
      <ul>{pendingHistory.map(operation => <li key={operation.id}>
        {operationLabel(operation)} · <time dateTime={operation.createdAt}>{new Date(operation.createdAt).toLocaleString()}</time>
        {operation.cleanupPending && <p>Space may still be held. Contact support if this continues.</p>}
      </li>)}</ul>
    </details>}
  </Wrapper>;
});

export default forwardRef(function ItemPhotos(props, ref) {
  const { user, status } = useAppContext();
  if (!user || status !== 'authenticated') return null;
  if (!props.item?.id && !props.allowStaging) return <Feedback>Save this item before adding photos.</Feedback>;
  return <PhotoSession {...props} ref={ref} key={user.id + ':' + props.planId + ':' + (props.item?.id || 'new')} />;
});
