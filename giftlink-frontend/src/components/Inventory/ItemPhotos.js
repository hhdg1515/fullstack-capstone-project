import React, { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { useAppContext } from '../../context/AuthContext';
import { useUnsavedForm } from '../../forms/UnsavedChanges';
import { Feedback, Surface } from '../../design-system/primitives';
import { fileDigest, photoError, photoUrl, readPhotos, readUpload, reservePhoto, securePhotoBrowser, selectionError, uploadId, uploadPhoto } from '../../api/itemImages';
import './ItemPhotos.css';

export function operationLabel(operation) {
  if (operation.cleanupPending) return operation.state === 'failed' ? 'Failed — cleanup pending' : 'Cleanup pending';
  if (operation.reservationExpired) return 'Reservation expired';
  return { reserved: 'Reserved — waiting for the file', processing: 'Processing', ready: 'Ready', failed: 'Failed', deleted: 'Cleanup complete' }[operation.state] || 'Check status';
}
const phaseLabels = { selected: 'Selected — not uploaded', reserving: 'Reserving capacity', hashing: 'Preparing photo', uploading: 'Uploading bytes',
  processing: 'Processing', uncertain: 'Outcome uncertain', failed: 'Failed', reserved: 'Reserved — waiting for the file' };
function LocalPreview({ url, position }) {
  const [failed, setFailed] = useState(false);
  return failed ? <p>Local preview unavailable.</p> :
    <img src={url} alt={'Local preview of selected photo ' + position} onError={() => setFailed(true)} />;
}

function ReadyPhoto({ image, position }) {
  const [failed, setFailed] = useState(false);
  return <li className="item-photo-ready">
    {failed ? <p>Photo {position + 1} is unavailable. Refresh photos to check again.</p> :
      <img src={photoUrl(image.id)} crossOrigin="use-credentials" alt={'Uploaded photo ' + (position + 1)} width={image.thumbnail.width} height={image.thumbnail.height}
        onError={() => setFailed(true)} loading="lazy" />}
    <p>Photo {position + 1} · Ready</p>
  </li>;
}

const PhotoSession = forwardRef(function PhotoSession({ planId, item, onClose }, ref) {
  const [data, setData] = useState(null), [loading, setLoading] = useState(true), [error, setError] = useState(null);
  const [entries, setEntries] = useState([]), [busy, setBusy] = useState(false), [message, setMessage] = useState(''), [refresh, setRefresh] = useState(0);
  const alive = useRef(true), inFlight = useRef(false), urls = useRef(new Set()), activeUpload = useRef(), fileInput = useRef(), heading = useRef(), feedback = useRef(), focusSelection = useRef(false);
  const guard = useUnsavedForm({ photos: entries.map(entry => entry.clientUploadId).join(',') }, { photos: '' });
  useImperativeHandle(ref, () => ({ confirmDiscard: guard.confirmDiscard }));
  useEffect(() => {
    if (!busy && !loading && focusSelection.current) {
      focusSelection.current = false;
      (fileInput.current?.disabled ? heading : fileInput).current?.focus();
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
    else setTimeout(() => { if (current()) (failure.field === 'file' ? fileInput : feedback).current?.focus(); }, 0);
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
    setMessage('Photo ready.');
    focusSelection.current = true;
  };
  const add = event => {
    const files = Array.from(event.target.files || []); event.target.value = '';
    if (inFlight.current || !data?.capabilities.binaryUpload || !data.allowance.newUploadsAllowed) return;
    const unreserved = entries.filter(entry => !entry.operation).length;
    if (files.length + entries.length > 5 || files.length + unreserved > data.allowance.itemSlots) {
      failed({ ...photoError({ code: 'IMAGE_ITEM_LIMIT', status: 409 }), message: 'Choose at most five photos, including saved photos and pending selections.', field: 'file' }); return;
    }
    const problem = files.map(selectionError).find(Boolean);
    if (problem) { failed({ message: problem, field: 'file' }); return; }
    const next = [];
    try {
      for (const file of files) {
        const clientUploadId = uploadId(), url = URL.createObjectURL(file); urls.current.add(url);
        next.push({ clientUploadId, file, url, phase: 'selected', operation: null, reservationAttempted: false, putAttempted: false });
      }
      setEntries(list => list.concat(next)); setError(null); setMessage('Photos selected. Choose Upload photo when ready.');
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
      patch(entry.clientUploadId, { operation, reservationAttempted: attempted,
        ...((operation && safe.status === 429 && ['IMAGE_PROCESSOR_BUSY', 'IMAGE_CONTROL_LIMIT'].includes(safe.code)) ? { putAttempted: false } : {}),
        phase: safe.uncertain || operation ? 'uncertain' : 'selected', error: safe.message });
      failed({ ...safe, message: safe.message, blockUploads: safe.code === 'IMAGE_CHANGED' || (!operation && !attempted) });
    } finally { if (current()) { inFlight.current = false; setBusy(false); activeUpload.current = null; } }
  };
  const check = async entry => {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true); setError(null);
    try {
      const result = await readUpload(planId, item.id, entry.operation?.id, entry.clientUploadId);
      if (!current()) return;
      patch(entry.clientUploadId, { operation: result.upload, phase: result.upload.state === 'reserved' ? (entry.putAttempted ? 'uncertain' : 'reserved') : result.upload.state === 'processing' ? 'processing' : 'failed', error: '', recoveryCheckedMissing: false });
      if (result.upload.state === 'ready') complete(entry);
      await load();
      if (current() && result.upload.state !== 'ready') setMessage(operationLabel(result.upload) + '. No file was resent.');
    } catch (failure) {
      if (!current()) return;
      if (failure.status === 404 && !entry.operation && !entry.putAttempted) {
        patch(entry.clientUploadId, { recoveryCheckedMissing: true });
        try { await load(); } catch (problem) { failed(problem); return; }
        setMessage('No reservation is visible yet. This browser has not sent the file. You may explicitly retry the same reservation ID; no new upload ID will be created.');
      }
      else failed(failure);
    } finally { if (current()) { inFlight.current = false; setBusy(false); } }
  };
  const disabled = !data || !data.capabilities.binaryUpload || !data.allowance.newUploadsAllowed || Boolean(error?.blockUploads) || !securePhotoBrowser();
  const selectionSlots = data ? data.allowance.itemSlots - entries.filter(entry => !entry.operation).length : 0;
  return <Surface id="owner-photo-manager" className="item-photos" aria-labelledby="item-photos-title">
    <div className="item-photos-heading"><h2 ref={heading} tabIndex={-1} id="item-photos-title">Photos for {item.name}</h2>
      <button type="button" className="ui-button ui-button--secondary" onClick={() => { if (guard.confirmDiscard()) onClose?.(); }}>Close photos</button></div>
    <p>Optional · Maximum 5 photos · JPEG, PNG or static WebP · 3 MiB per file (3,145,728 bytes).</p>
    <p id="photo-privacy">Check for visible addresses, labels, documents and people. Remove identifying details and get permission. Removing metadata does not hide visible details.</p>
    <p id="photo-format-help">Export HEIC or HEIF as JPEG first. The picker and preview are not safety checks; the server validates every upload.</p>
    {loading && <Feedback>Loading photo status…</Feedback>}
    {error && <Feedback id="photo-error" error={error.code !== 'NOT_FOUND'} ref={feedback} tabIndex={-1}><p>{error.message}</p></Feedback>}
    {message && <Feedback>{message}</Feedback>}
    {data && !data.capabilities.binaryUpload && <Feedback>Photo uploads are disabled on this server. Your text-only listing still works.</Feedback>}
    {data && !data.allowance.newUploadsAllowed && <Feedback>New photos need an active plan, an uncleared item and current pickup dates.</Feedback>}
    {!securePhotoBrowser() && <Feedback>Secure photo preparation needs a current browser over HTTPS or localhost.</Feedback>}
    <div className="item-photos-controls">
      <div className="ui-field"><label htmlFor="item-photo-files">Choose photos</label>
        <input ref={fileInput} id="item-photo-files" type="file" accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp" multiple disabled={disabled || busy || loading || entries.length >= 5 || selectionSlots <= 0}
          aria-invalid={error?.field === 'file' || undefined} aria-describedby={'photo-format-help photo-privacy' + (error?.field === 'file' ? ' photo-error' : '')} onChange={add} /></div>
      <button type="button" className="ui-button ui-button--secondary" disabled={busy || loading} onClick={() => { setError(null); setRefresh(value => value + 1); }}>Refresh photos</button>
    </div>
    {data?.allowance.itemSlots === 0 && <Feedback>All five photo slots are used or reserved. Review pending operations.</Feedback>}
    {entries.length > 0 && <section aria-label="Selected photos"><h3>Selected photos</h3><ul className="item-photos-grid">{entries.map((entry, index) =>
      <li key={entry.clientUploadId} className="item-photo-selection">
        <LocalPreview url={entry.url} position={index + 1} />
        <p><strong>Selected photo {index + 1}</strong> · {['hashing', 'reserving', 'uploading', 'processing', 'uncertain'].includes(entry.phase) ? phaseLabels[entry.phase] : entry.operation ? operationLabel(entry.operation) : phaseLabels[entry.phase]}</p>
        {['uploading', 'processing'].includes(entry.phase) && <p role="status">{entry.phase === 'uploading' ? `Uploading bytes: ${entry.percent || 0}%` : entry.percent === 100 ?
          'Bytes transferred. Waiting for server processing; the photo is not ready yet.' : 'The server reports processing. Check status again; recovery may need operator review.'}</p>}
        {entry.phase === 'uploading' && <progress max={100} value={entry.percent || 0} aria-label={'Bytes transferred for selected photo ' + (index + 1)} />}
        {entry.phase === 'uncertain' && <p>Check the existing operation. This file will not be resent automatically.</p>}
        {entry.error && <p className="ui-field-error">{entry.error}</p>}
        <div className="item-photos-actions">
          <button type="button" className="ui-button" disabled={busy || loading || disabled || entry.putAttempted || !['selected', 'reserved'].includes(entry.phase) ||
            Boolean(entry.operation && (entry.operation.state !== 'reserved' || entry.operation.reservationExpired))} onClick={() => upload(entry)}>Upload photo {index + 1}</button>
          {entry.reservationAttempted && <button type="button" className="ui-button ui-button--secondary" disabled={busy || loading} onClick={() => check(entry)}>Check upload {index + 1} status</button>}
          {entry.recoveryCheckedMissing && !entry.putAttempted && <button type="button" className="ui-button ui-button--secondary" disabled={busy || loading || disabled}
            onClick={() => upload({ ...entry, phase: 'selected' })}>Retry same reservation {index + 1} and upload</button>}
          <button type="button" className="ui-button ui-button--secondary" disabled={busy} onClick={() => {
            releaseUrl(entry.url); setEntries(list => list.filter(value => value.clientUploadId !== entry.clientUploadId)); setError(null);
            setMessage(entry.reservationAttempted ? 'Selection removed locally. The server operation and any capacity holds remain; refresh photos to review them.' : 'Local selection removed.'); focusSelection.current = true;
          }}>Remove selection {index + 1}</button>
        </div>
      </li>)}</ul></section>}
    {data && <section aria-label="Saved photos"><h3>Saved photos</h3>
      {data.images.length === 0 ? <p>No ready photos. Photos are optional for publication.</p> : data.capabilities.imageRead ?
        <ul className="item-photos-grid">{data.images.map((image, index) => <ReadyPhoto key={image.id + ':' + refresh} image={image} position={index} />)}</ul> : <p>{data.images.length} ready photos. Image viewing is unavailable on this server.</p>}
    </section>}
    {data && <details className="item-photo-history"><summary>Photo allowance</summary><p className="item-photos-allowance">
      At last refresh: {data.allowance.itemSlots} photo spaces · {data.allowance.attempts} attempts left today · {data.allowance.successes} uploads left today.
      Shared capacity is checked again when reserving.</p></details>}
    {data?.uploads.some(operation => !entries.some(entry => entry.operation?.id === operation.id)) && <details className="item-photo-history"><summary>Other upload operations</summary>
      <ul>{data.uploads.filter(operation => !entries.some(entry => entry.operation?.id === operation.id)).map(operation => <li key={operation.id}>
        {operationLabel(operation)} · <time dateTime={operation.createdAt}>{new Date(operation.createdAt).toLocaleString()}</time>
        {operation.cleanupPending && ' · Capacity may remain held. Cleanup needs operator review.'}
      </li>)}</ul><p>Reloading can lose local files, but server operations remain here. Refresh photos to check their status. Unchanged processing or cleanup may need operator review.</p>
    </details>}
  </Surface>;
});

export default forwardRef(function ItemPhotos(props, ref) {
  const { user, status } = useAppContext();
  if (!user || status !== 'authenticated') return null;
  if (!props.item?.id) return <Feedback>Save this item before adding photos.</Feedback>;
  return <PhotoSession {...props} ref={ref} key={user.id + ':' + props.planId + ':' + props.item.id} />;
});
