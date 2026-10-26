import React, { useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { apiRequest } from '../../api/client';
import usePlansData from '../MoveOutPlans/usePlansData';
import '../MoveOutPlans/Plans.css';
import './Pickups.css';
import JourneyNav from '../Journeys/JourneyNav';
import { useUnsavedForm } from '../../forms/UnsavedChanges';
import useFormErrors from '../../forms/useFormErrors';
import PickupConversation from './PickupConversation';
import PickupScheduling, { PickupTime, SchedulingEvent } from './PickupScheduling';

export const pickupLabels = { pending: 'Awaiting giver decision', accepted: 'Accepted appointment', declined: 'Declined', cancelled: 'Cancelled', completed: 'Handed over', no_show: 'Receiver did not arrive' };
const actionLabels = { accept: 'Accept pickup', decline: 'Decline request', cancel: 'Cancel request', complete: 'Confirm handoff', no_show: 'Record no-show' };
function Appointment({ request }) {
  const display = new Intl.DateTimeFormat('en', { dateStyle: 'full', timeStyle: 'short', timeZone: request.timeZone }).format(new Date(request.proposedAt));
  return <p><b>{request.status === 'pending' ? 'Proposed pickup' : request.status === 'accepted' ? 'Confirmed pickup' : 'Pickup time'}:</b><br /><time dateTime={request.proposedAt}>{display}</time><br /><strong>{request.timeZone}</strong></p>;
}
function LoadState({ data }) {
  if (data.loading) return <p role="status">Loading pickup requests…</p>;
  if (data.error) return <div role="alert"><p>{data.error.status === 404 ? 'This pickup request is unavailable.' : data.error.message}</p><button onClick={data.retry}>Retry requests</button></div>;
  return null;
}
export function RequestPickup() {
  const { itemId } = useParams(); const navigate = useNavigate();
  const discoverySearch = useLocation().state?.discoverySearch || '';
  const data = usePlansData(`/api/items/${encodeURIComponent(itemId)}`);
  const item = data.data?.item;
  const [localDateTime, setTime] = useState(''); const [note, setNote] = useState('');
  const guard = useUnsavedForm({ localDateTime, note }, { localDateTime: '', note: '' });
  const [busy, setBusy] = useState(false);
  const validation = useFormErrors(busy); const { errors, error } = validation;
  const submit = async event => {
    event.preventDefault(); if (busy) return; validation.reset();
    const issues = {};
    if (!localDateTime) issues.localDateTime = 'Choose a pickup date and time in the giver’s timezone.';
    if (Array.from(note.trim()).length > 500) issues.note = 'Use at most 500 characters.';
    if (Object.keys(issues).length) { validation.show(issues); return; }
    setBusy(true);
    try {
      const result = await apiRequest('/api/pickup-requests', { method: 'POST', body: { itemId, localDateTime, timeZone: item.pickupTimeZone, note: note.trim() } });
      guard.markSaved();
      navigate(`/app/pickups/${result.request.id}`, { replace: true, state: { journey: 'find' } });
    } catch (failure) { if (['INVALID_APPOINTMENT', 'APPOINTMENT_PAST', 'OUTSIDE_PICKUP_WINDOW'].includes(failure.code)) validation.show({ localDateTime: failure.message }, failure.message);
      else validation.failure(failure, ['localDateTime', 'note'], { proposedAt: 'localDateTime' }); }
    finally { setBusy(false); }
  };
  return <main className="plans-page pickup-page"><JourneyNav journey="find" discoverySearch={discoverySearch} /><Link to={`/app/items/${itemId}`} state={{ discoverySearch }}>Back to listing</Link><h1>Request pickup</h1><LoadState data={data} />
    {item && <><h2>{item.name}</h2><p>{item.neighborhood}, {item.city}</p>
      {item.isOwner === true ? <p role="status">Your listing. You cannot request your own item. Manage it from My plans.</p> : item.isReserved === true ? <div role="status"><p>This item has an accepted pickup. Check back if it becomes available.</p>
        <button className="btn btn-outline-secondary" onClick={data.retry}>Check availability</button></div> : !item.pickupTimeZone ? <p role="alert">The giver must set a pickup timezone before requests can be submitted.</p> : <form ref={validation.formRef} noValidate className="plan-form" onSubmit={submit} aria-busy={busy}>
        <p>A request does not reserve the item. Wait for the giver to accept. Each listing is one pickup unit, including groups of items.</p>
        {typeof item.isReserved !== 'boolean' && <p>Current pickup availability will be checked when you send a request.</p>}
        <p>Choose a local date from {item.availableFrom || 'today'} through {item.effectiveAvailableUntil}. Listings still expire at the end of that UTC date; late local appointments beyond that cutoff cannot be booked.</p>
        <fieldset disabled={busy}><legend className="visually-hidden">Appointment details</legend>
          <div className="plan-field"><label htmlFor="pickup-time">Pickup date and time</label>
            <input id="pickup-time" name="localDateTime" type="datetime-local" step="60" required value={localDateTime} onChange={event => { setTime(event.target.value); validation.clear('localDateTime'); }} {...validation.fieldProps('localDateTime', 'pickup-zone-help')} />
            {errors.localDateTime && <p id="localDateTime-error" className="plan-field-error">{errors.localDateTime}</p>}
            <small id="pickup-zone-help">Local time in <strong>{item.pickupTimeZone}</strong>, selected by the giver. Your browser timezone is not used. Times skipped or repeated by daylight saving must be avoided.</small></div>
          <div className="plan-field"><label htmlFor="pickup-note">Coordination note (optional, private)</label><textarea id="pickup-note" name="note" {...validation.fieldProps('note')} maxLength={500} value={note} onChange={event => { setNote(event.target.value); validation.clear('note'); }} />
            {errors.note && <p id="note-error" className="plan-field-error">{errors.note}</p>}</div>
          <p>Only you and the giver see this note. Suggest a general public meeting point or brief handoff instructions. Keep phone numbers, email and residential addresses out of it. After sending your request, use its pickup conversation to coordinate.</p>
          <button className="btn btn-primary">{busy ? 'Sending…' : 'Send pickup request'}</button>
        </fieldset>
      </form>}
      {error && <div ref={validation.summaryRef} tabIndex={-1} role="alert"><p>{error}</p><button onClick={data.retry}>Reload listing</button></div>}
    </>}
  </main>;
}
export function PickupDashboard({ incoming = false }) {
  const [cursor, setCursor] = useState(''); const [status, setStatus] = useState('');
  const query = new URLSearchParams(); if (cursor) query.set('cursor', cursor); if (status) query.set('status', status);
  const data = usePlansData(`/api/pickup-requests/${incoming ? 'received' : 'sent'}?${query}`);
  return <main className="plans-page pickup-page"><JourneyNav journey={incoming ? 'give' : 'find'} /><h1>{incoming ? 'Incoming pickup requests' : 'My pickup requests'}</h1>
    <p>Pending requests do not reserve items. Accepted appointments are arrangements; only a recorded handoff means the item was collected.</p>
    <div className="plan-field"><label htmlFor="pickup-filter">Request status</label><select id="pickup-filter" value={status} onChange={event => { setStatus(event.target.value); setCursor(''); }}>
      <option value="">All requests</option>{Object.entries(pickupLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}
    </select></div>
    <button className="btn btn-outline-secondary" onClick={data.retry}>Refresh requests</button><LoadState data={data} />
    {data.data && <>
      {!data.data.requests.length && (status ? <div role="status"><p>No requests match this status.</p>
        <button className="btn btn-outline-secondary" onClick={() => { setStatus(''); setCursor(''); }}>Clear status filter</button></div> : <p>No pickup requests here yet.</p>)}
      <ul className="plans-grid">{data.data.requests.map(request => <li className="plan-panel" key={request.id}>
        <h2>{request.item ? <Link to={`/app/items/${request.item.id}`}>{request.item.name}</Link> : 'Former listing'}</h2><p className="plan-status">{pickupLabels[request.status]}</p>
        <p>Applicant: {incoming ? request.counterpart.firstName : 'You'}</p>
        {!incoming && <p>Giver: {request.counterpart.firstName}</p>}<Appointment request={request} />
        <Link className="btn btn-outline-primary" to={`/app/pickups/${request.id}`} state={{ journey: incoming ? 'give' : 'find' }}
          aria-label={`Review request ${incoming ? 'from' : 'to'} ${request.counterpart.firstName} for ${request.item?.name || 'former listing'}`}>Review request</Link>
        <details className="pickup-request-details"><summary>Note and request reference</summary>
          <p className="pickup-note">{request.note || 'No note provided.'}</p><p>Request reference: <code>{request.id}</code></p>
        </details>
        {!request.item && <p>The listing is no longer available. You can still review the request.</p>}
        {incoming && request.plan && <p><Link to={`/app/plans/${request.plan.id}`}>{request.plan.title || 'Move-out plan'}</Link></p>}
      </li>)}</ul>
      <div className="plan-actions">{cursor && <button onClick={() => setCursor('')}>First page</button>}
        {data.data.nextCursor && <button className="btn btn-primary" onClick={() => setCursor(data.data.nextCursor)}>Next requests</button>}</div>
    </>}
  </main>;
}
export function PickupDetail() {
  const { requestId } = useParams(); const data = usePlansData(`/api/pickup-requests/${encodeURIComponent(requestId)}`, true);
  const request = [403, 404].includes(data.error?.status) ? undefined : data.data?.request; const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  const action = async name => {
    const warning = name === 'complete' ? 'Confirm the entire item or group was actually handed over? This clears the item and cancels competing requests.' :
      name === 'no_show' ? 'Confirm the receiver did not arrive? This releases the reservation without clearing the item.' :
      name === 'accept' ? 'Accept this appointment? Other requests will remain pending, and new requests will be blocked until it is released.' : `${actionLabels[name]}?`;
    if (!window.confirm(warning)) return;
    setBusy(true); setError('');
    try { await apiRequest(`/api/pickup-requests/${requestId}/actions`, { method: 'POST', body: { action: name, version: request.version } }); data.retry(); }
    catch (failure) { setError(failure.message); }
    finally { setBusy(false); }
  };
  const actions = request ? [
    ...(request.role === 'giver' && request.status === 'pending' ? ['accept', 'decline'] : []),
    ...(['pending', 'accepted'].includes(request.status) ? ['cancel'] : []),
    ...(request.role === 'giver' && request.status === 'accepted' ? ['complete', 'no_show'] : [])
  ] : [];
  return <main className="plans-page pickup-page">{request && <JourneyNav journey={request.role === 'giver' ? 'give' : 'find'} planId={request.plan?.id} />}<Link to={request?.role === 'giver' ? '/app/pickups/incoming' : '/app/pickups'}>Back to requests</Link>
    <h1>Pickup request</h1><LoadState data={data} />{error && <p role="alert">{error}</p>}
    <button className="btn btn-outline-secondary" disabled={busy || data.loading} onClick={data.retry}>Reload request</button>
    {request && <article className="plan-panel"><h2>{request.item?.name || 'Former listing'}</h2><p className="plan-status">{pickupLabels[request.status]}</p>
      <p>Applicant: {request.role === 'giver' ? request.counterpart.firstName : 'You'}</p>
      {request.role === 'receiver' && <p>Giver: {request.counterpart.firstName}</p>}<Appointment request={request} />
      {request.status === 'pending' && <p>The item is not reserved. The giver must accept a future appointment.</p>}
      {request.status === 'accepted' && <p>This appointment reserves one whole listing. It does not mean a handoff has occurred. No address is disclosed automatically.</p>}
      {request.cancellationReason && <p>Cancellation reason: {request.cancellationReason.replace(/_/g, ' ')}.</p>}
      {request.item && <><p>{request.item.neighborhood}, {request.item.city}</p><p className="pickup-note">{request.item.description}</p><Link to={`/app/items/${request.item.id}`}>Public listing (if still available)</Link></>}
      {request.plan && <p><Link to={`/app/plans/${request.plan.id}`}>{request.plan.title || 'Move-out plan'}</Link></p>}
      <h3>Private coordination note</h3><p className="pickup-note">{request.note || 'No note provided.'}</p>
      <details className="pickup-request-details"><summary>Request reference</summary><code>{request.id}</code></details>
      <div className="plan-actions">{actions.map(name => <button key={name} className="btn btn-outline-primary" disabled={busy || data.loading || (['complete', 'no_show'].includes(name) && Date.parse(request.proposedAt) > Date.now())} onClick={() => action(name)}>{actionLabels[name]}</button>)}</div>
      {request.role === 'giver' && request.status === 'accepted' && <p>Record completion or no-show after the appointment time. Reload the request to update these controls.</p>}
      <PickupScheduling request={request} onRefresh={data.retry} disabled={busy || data.loading || Boolean(data.error)} />
      <PickupConversation requestId={request.id} requestStatus={request.status} />
      <h3>Request history</h3><ul>{request.history.map((entry, index) => <li key={index}>
        {entry.action.startsWith('reschedule_') ? <SchedulingEvent entry={entry} /> : pickupLabels[entry.action] || 'Request updated'}
        {' — '}{entry.actor}, <PickupTime compact value={{ proposedAt: entry.at, timeZone: request.timeZone }} />
      </li>)}</ul>
    </article>}
  </main>;
}
