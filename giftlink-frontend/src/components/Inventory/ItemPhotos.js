import React, { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { useAppContext } from '../../context/AuthContext';
import { useUnsavedForm } from '../../forms/UnsavedChanges';
import { Feedback, Surface } from '../../design-system/primitives';
import { fileDigest, photoError, photoUrl, readPhotos, readUpload, reservePhoto, securePhotoBrowser, selectionError, uploadId, uploadPhoto } from '../../api/itemImages';
import './ItemPhotos.css';

export function operationLabel(operation) {
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
  return failed ? <p className="item-photo-missing">Preview unavailable</p> :
    <img src={url} alt={'Local preview of selected photo ' + position} onError={() => setFailed(true)} />;
}

function ReadyPhoto({ image, position }) {
  const [failed, setFailed] = useState(false);
  return <li className="item-photo-ready">
    {failed ? <p className="item-photo-problem">Photo unavailable. Refresh to check again.</p> :
      <img src={photoUrl(image.id)} crossOrigin="use-credentials" alt={'Uploaded photo ' + (position + 1)} width={image.thumbnail.width} height={image.thumbnail.height}
        onError={() => setFailed(true)} loading="lazy" />}
    <span className="visually-hidden">Photo {position + 1} uploaded.</span>
  </li>;
}

const PhotoSession = forwardRef(function PhotoSession({ planId, item, onClose }, ref) {
  const [data, setData] = useState(null), [loading, setLoading] = useState(true), [error, setError] = useState(null);
  const [entries, setEntries] = useState([]), [busy, setBusy] = useState(false), [message, setMessage] = useState(''), [announcement, setAnnouncement] = useState(''), [refresh, setRefresh] = useState(0);
  const alive = useRef(true), inFlight = useRef(false), urls = useRef(new Set()), activeUpload = useRef(), fileInput = useRef(), addButton = useRef(), heading = useRef(), feedback = useRef(), focusSelection = useRef(false);
  const guard = useUnsavedForm({ photos: entries.map(entry => entry.clientUploadId).join(',') }, { photos: '' });
  useImperativeHandle(ref, () => ({ confirmDiscard: guard.confirmDiscard }));
  useEffect(() => {
    if (!busy && !loading && focusSelection.current) {
      focusSelection.current = false;
      (addButton.current?.disabled ? heading : addButton).current?.focus();
    }
  }, [busy, loading, entries.length]);
  const releaseUrl = url => { if (urls.current.delete(url)) URL.revokeObjectURL(url); };
  useEffect(() => {
    alive.current = true; heading.current?.focus();
    const ownedUrls = urls.current;
    return () => { alive.current = false; activeUpload.current?.abort(); ownedUrls.forEach(url => URL.revokeObjectURL(url)); ownedUrls.clear(); };
  }, []);
  const current = () => alive.current;
  const failed = failure => {
    if (!current()) return;
    setError(failure);
    if (failure.status === 401) window.dispatchEvent(new Event('giftlink:unauthorized'));
    else setTimeout(() => { if (current()) (failure.field === 'file' ? addButton : feedback).current?.focus(); }, 0);
  };
  const load = async () => {
    try {
      const result = await readPhotos(planId, item.id);
      if (current()) { setData(result); setError(null); }
      return result;
    } catch (failure) { if (current()) setData(null); throw failure; }
  };
  useEffect(() => {
    let active = true; setLoading(true);
    readPhotos(planId, item.id).then(value => { if (active && current()) { setData(value); setError(null); } }).catch(failure => {
      if (active && current()) { setData(null); failed({ ...failure, message: failure.message, blockUploads: true }); }
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
  const add = event => {
    const files = Array.from(event.target.files || []); event.target.value = '';
    if (inFlight.current || !data?.capabilities.binaryUpload || !data.allowance.newUploadsAllowed) return;
    const unreserved = entries.filter(entry => !entry.operation).length;
    if (files.length + entries.length > 5 || files.length + unreserved > data.allowance.itemSlots) {
      failed({ ...photoError({ code: 'IMAGE_ITEM_LIMIT', status: 409 }), message: 'Choose up to 5 photos in total.', field: 'file' }); return;
    }
    const problem = files.map(selectionError).find(Boolean);
    if (problem) { failed({ message: problem, field: 'file' }); return; }
    const next = [];
    try {
      for (const file of files) {
        const clientUploadId = uploadId(), url = URL.createObjectURL(file); urls.current.add(url);
        next.push({ clientUploadId, file, url, phase: 'selected', operation: null, reservationAttempted: false, putAttempted: false });
      }
      setEntries(list => list.concat(next)); setError(null); setMessage(''); setAnnouncement('Photos selected. Choose Upload to confirm.');
    } catch (failure) { next.forEach(entry => releaseUrl(entry.url)); failed(photoError(failure)); }
  };
  const upload = async entry => {
    if (inFlight.current || !data || loading || error?.blockUploads || entry.putAttempted || entry.phase === 'uncertain' || (entry.operation && (entry.operation.state !== 'reserved' || entry.operation.reservationExpired))) return;
    if (item.status === 'available' && !window.confirm('Add this photo to the posted item? Ready photos follow its public visibility.')) return;
    inFlight.current = true; setBusy(true); setError(null); setMessage('');
    let operation = entry.operation, attempted = entry.reservationAttempted;
    try {
      // Use the last authoritative read, then let the versioned reservation
      // enforce races. Avoid redundant GETs that consume the control budget.
      const latest = data; if (!current()) return;
      if (!latest.capabilities.binaryUpload || !latest.allowance.newUploadsAllowed) { setMessage('Photo uploads are unavailable for this item.'); return; }
      if (!operation) {
        patch(entry.clientUploadId, { phase: 'hashing' });
        const sha256 = await fileDigest(entry.file); if (!current()) return;
        patch(entry.clientUploadId, { phase: 'reserving', reservationAttempted: true }); attempted = true;
        const result = await reservePhoto(planId, item.id, { imageRevision: latest.imageRevision, clientUploadId: entry.clientUploadId, byteLength: entry.file.size, sha256 });
        if (!current()) return; operation = result.upload;
        patch(entry.clientUploadId, { operation });
      }
      if (operation.state === 'ready') { complete(entry); await load(); return; }
      if (operation.state !== 'reserved' || operation.reservationExpired) {
        patch(entry.clientUploadId, { operation, phase: operation.state === 'processing' ? 'processing' : 'failed' }); return;
      }
      const controller = new AbortController(); activeUpload.current = controller;
      patch(entry.clientUploadId, { operation, phase: 'uploading', putAttempted: true, percent: 0 });
      const response = await uploadPhoto(planId, item.id, operation.id, entry.file, { signal: controller.signal, onProgress: (percent, processing) =>
        patch(entry.clientUploadId, { percent, phase: processing ? 'processing' : 'uploading' }) });
      if (!current()) return;
      patch(entry.clientUploadId, { operation: response.upload, phase: response.upload.state === 'ready' ? 'ready' : 'processing' });
      if (response.upload.state === 'ready') complete(entry);
      await load();
    } catch (failure) {
      if (!current()) return;
      const safe = photoError(failure, attempted); if (attempted) setData(null);
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
    try {
      const result = await readUpload(planId, item.id, entry.operation?.id, entry.clientUploadId);
      if (!current()) return;
      patch(entry.clientUploadId, { operation: result.upload, phase: result.upload.state === 'reserved' ? (entry.putAttempted ? 'uncertain' : 'reserved') : result.upload.state === 'processing' ? 'processing' : 'failed', error: '', recoveryCheckedMissing: false });
      if (result.upload.state === 'ready') complete(entry);
      await load();
      if (current() && result.upload.state !== 'ready') setAnnouncement(operationLabel(result.upload) + '. No file was resent.');
    } catch (failure) {
      if (!current()) return;
      if (failure.status === 404 && !entry.operation && !entry.putAttempted) {
        patch(entry.clientUploadId, { recoveryCheckedMissing: true, error: "Upload wasn't found. You can retry." });
        try { await load(); } catch (problem) { failed(problem); return; }
      }
      else failed({ ...failure, message: failure.message, clientUploadId: entry.clientUploadId });
    } finally { if (current()) { inFlight.current = false; setBusy(false); } }
  };
  const disabled = !data || !data.capabilities.binaryUpload || !data.allowance.newUploadsAllowed || Boolean(error?.blockUploads) || !securePhotoBrowser();
  const selectionSlots = data ? data.allowance.itemSlots - entries.filter(entry => !entry.operation).length : 0;
  const pendingHistory = data?.uploads.filter(operation => !entries.some(entry => entry.operation?.id === operation.id)) || [];
  const needsRefresh = Boolean(error) || pendingHistory.length > 0 || entries.some(entry => entry.reservationAttempted);
  const selectionDisabled = disabled || busy || loading || entries.length >= 5 || selectionSlots <= 0;
  const count = data ? data.images.length + entries.filter(entry => !data.images.some(image => image.id === entry.operation?.id)).length : null;
  const refreshButton = <button type="button" className="item-photos-link" aria-label="Refresh photos" disabled={busy || loading}
    onClick={() => { setError(null); setRefresh(value => value + 1); }}>Refresh</button>;
  return <Surface id="owner-photo-manager" className="item-photos" aria-labelledby="item-photos-title">
    <div className="item-photos-heading">
      <h2 ref={heading} tabIndex={-1} id="item-photos-title">Photos<span className="visually-hidden"> for {item.name}</span></h2>
      <span className="item-photos-count" aria-label={count === null ? 'Photo count unavailable' : `${count} photos and selections, maximum 5`}>{count ?? '—'} / 5</span>
      <button type="button" className="item-photos-icon" aria-label="Close photos" title="Close photos"
        onClick={() => { if (guard.confirmDiscard()) onClose?.(); }}>×</button>
    </div>
    <p className="item-photos-context">{item.name}</p>
    <div role="status" className="visually-hidden">{announcement}</div>
    {loading && <p role="status">Loading photos…</p>}
    {error && !error.clientUploadId && <p id="photo-error" className="item-photo-problem" role={error.code === 'NOT_FOUND' ? 'status' : 'alert'} ref={feedback} tabIndex={-1}>{error.message}</p>}
    {message && <p role="status" className="item-photo-note">{message}</p>}
    {data && !data.capabilities.binaryUpload && <p role="status">Photo uploads are unavailable.</p>}
    {data && data.capabilities.binaryUpload && !data.allowance.newUploadsAllowed && <p role="status">Update the plan and pickup dates to add photos.</p>}
    {!securePhotoBrowser() && <p role="status">Use a current browser over HTTPS or localhost.</p>}
    {(entries.length > 0 || data?.images.length > 0) && <ul className="item-photos-grid" aria-label="Photos and selections">
      {data?.capabilities.imageRead && data.images.map((image, index) => <ReadyPhoto key={image.id + ':' + refresh} image={image} position={index} />)}
      {entries.map((entry, index) => {
        const problem = error?.clientUploadId === entry.clientUploadId ? error.message : entry.error || entryProblem(entry);
        const preparing = ['hashing', 'reserving'].includes(entry.phase);
        const transferring = ['uploading', 'processing'].includes(entry.phase);
        return <li key={entry.clientUploadId} className="item-photo-selection" aria-label={'Selected photo ' + (index + 1)} aria-describedby={problem ? 'selected-photo-error-' + index : undefined}>
          <div className="item-photo-preview"><LocalPreview url={entry.url} position={index + 1} />
            <button type="button" className="item-photos-icon item-photo-remove" aria-label={'Remove selection ' + (index + 1)} title="Remove selection" disabled={busy} onClick={() => {
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
            {['selected', 'reserved'].includes(entry.phase) && <button type="button" className="ui-button" aria-label={'Upload photo ' + (index + 1)} disabled={busy || loading || disabled || entry.putAttempted ||
              Boolean(entry.operation && (entry.operation.state !== 'reserved' || entry.operation.reservationExpired))} onClick={() => upload(entry)}>Upload</button>}
            {entry.reservationAttempted && !preparing && !transferring && <button type="button" className="ui-button ui-button--secondary" aria-label={'Check upload ' + (index + 1) + ' status'} disabled={busy || loading}
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
        aria-describedby={'photo-format-help photo-privacy' + (error?.field === 'file' ? ' photo-error' : '')} onClick={() => fileInput.current?.click()}>Add photos</button>
      <input ref={fileInput} id="item-photo-files" type="file" aria-label="Choose photos" hidden accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp" multiple disabled={selectionDisabled}
        aria-invalid={error?.field === 'file' || undefined} aria-describedby={'photo-format-help photo-privacy' + (error?.field === 'file' ? ' photo-error' : '')} onChange={add} />
      {needsRefresh && refreshButton}
      <details className="item-photos-help"><summary>Photo tips</summary>
        <p id="photo-format-help">Up to 5 photos. JPEG, PNG or static WebP, up to 3 MiB each. Convert HEIC to JPEG. The server checks every upload.</p>
        <p id="photo-privacy">Remove visible addresses, labels, documents and people. Get permission; removing metadata does not hide these details.</p>
        <p>Maximum 16 megapixels and 10,000 pixels per edge.</p>
        {!needsRefresh && refreshButton}
      </details>
    </div>
    {pendingHistory.length > 0 && <details className="item-photo-history"><summary>Upload history</summary>
      <ul>{pendingHistory.map(operation => <li key={operation.id}>
        {operationLabel(operation)} · <time dateTime={operation.createdAt}>{new Date(operation.createdAt).toLocaleString()}</time>
        {operation.cleanupPending && <p>Space may still be held. Contact support if this continues.</p>}
      </li>)}</ul>
    </details>}
  </Surface>;
});

export default forwardRef(function ItemPhotos(props, ref) {
  const { user, status } = useAppContext();
  if (!user || status !== 'authenticated') return null;
  if (!props.item?.id) return <Feedback>Save this item before adding photos.</Feedback>;
  return <PhotoSession {...props} ref={ref} key={user.id + ':' + props.planId + ':' + props.item.id} />;
});
