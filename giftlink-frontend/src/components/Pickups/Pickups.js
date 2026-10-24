import React, { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { apiRequest } from '../../api/client';
import usePlansData from '../MoveOutPlans/usePlansData';
import '../MoveOutPlans/Plans.css';
import './Pickups.css';

export const pickupLabels = { pending: 'Awaiting giver decision', accepted: 'Accepted appointment', declined: 'Declined', cancelled: 'Cancelled', completed: 'Handed over', no_show: 'Receiver did not arrive' };
const actionLabels = { accept: 'Accept pickup', decline: 'Decline request', cancel: 'Cancel request', complete: 'Confirm handoff', no_show: 'Record no-show' };
function Appointment({ request }) {
  const display = new Intl.DateTimeFormat('en', { dateStyle: 'full', timeStyle: 'short', timeZone: request.timeZone }).format(new Date(request.proposedAt));
  return <p><time dateTime={request.proposedAt}>{display}</time><br /><strong>{request.timeZone}</strong></p>;
}
function LoadState({ data }) {
  if (data.loading) return <p role="status">Loading pickup requests…</p>;
  if (data.error) return <div role="alert"><p>{data.error.status === 404 ? 'This pickup request is unavailable.' : data.error.message}</p><button onClick={data.retry}>Retry requests</button></div>;
  return null;
}
export function RequestPickup() {
  const { itemId } = useParams(); const navigate = useNavigate();
  const data = usePlansData(`/api/items/${encodeURIComponent(itemId)}`);
  const item = data.data?.item;
  const [localDateTime, setTime] = useState(''); const [note, setNote] = useState('');
  const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  const submit = async event => {
    event.preventDefault(); if (busy) return; setBusy(true); setError('');
    try {
      const result = await apiRequest('/api/pickup-requests', { method: 'POST', body: { itemId, localDateTime, timeZone: item.pickupTimeZone, note: note.trim() } });
      navigate(`/app/pickups/${result.request.id}`, { replace: true });
    } catch (failure) { setError(failure.fields?.map(field => `${field.field}: ${field.message}`).join('. ') || failure.message); }
    finally { setBusy(false); }
  };
  return <main className="plans-page pickup-page"><Link to={`/app/items/${itemId}`}>Back to listing</Link><h1>Request pickup</h1><LoadState data={data} />
    {item && <><h2>{item.name}</h2><p>{item.neighborhood}, {item.city}</p>
      {!item.pickupTimeZone ? <p role="alert">The giver must set a pickup timezone before requests can be submitted.</p> : <form className="plan-form" onSubmit={submit} aria-busy={busy}>
        <p>A request does not reserve the item. Wait for the giver to accept. Each listing is one pickup unit, including groups of items.</p>
        <p>Choose a local date from {item.availableFrom || 'today'} through {item.effectiveAvailableUntil}. Listings still expire at the end of that UTC date; late local appointments beyond that cutoff cannot be booked.</p>
        <fieldset disabled={busy}><legend className="visually-hidden">Appointment details</legend>
          <div className="plan-field"><label htmlFor="pickup-time">Pickup date and time</label>
            <input id="pickup-time" type="datetime-local" step="60" required value={localDateTime} onChange={event => setTime(event.target.value)} aria-describedby="pickup-zone-help" />
            <small id="pickup-zone-help">Local time in <strong>{item.pickupTimeZone}</strong>, selected by the giver. Your browser timezone is not used. Times skipped or repeated by daylight saving must be avoided.</small></div>
          <div className="plan-field"><label htmlFor="pickup-note">Coordination note (optional, private)</label><textarea id="pickup-note" maxLength={500} value={note} onChange={event => setNote(event.target.value)} /></div>
          <p>Only you and the giver see this note. Suggest a general public meeting point or brief handoff instructions. Keep phone numbers, email and residential addresses out of it. Messaging is not available yet.</p>
          <button className="btn btn-primary">{busy ? 'Sending…' : 'Send pickup request'}</button>
        </fieldset>
      </form>}
      {error && <div role="alert"><p>{error}</p><button onClick={data.retry}>Reload listing</button></div>}
    </>}
  </main>;
}
export function PickupDashboard({ incoming = false }) {
  const [cursor, setCursor] = useState(''); const [status, setStatus] = useState('');
  const query = new URLSearchParams(); if (cursor) query.set('cursor', cursor); if (status) query.set('status', status);
  const data = usePlansData(`/api/pickup-requests/${incoming ? 'received' : 'sent'}?${query}`);
  return <main className="plans-page pickup-page"><h1>{incoming ? 'Incoming pickup requests' : 'My pickup requests'}</h1>
    <p><Link to={incoming ? '/app/pickups' : '/app/pickups/incoming'}>{incoming ? 'My requests as receiver' : 'Incoming requests as giver'}</Link></p>
    <p>Pending requests do not reserve items. Accepted appointments are arrangements; only a recorded handoff means the item was collected.</p>
    <div className="plan-field"><label htmlFor="pickup-filter">Request status</label><select id="pickup-filter" value={status} onChange={event => { setStatus(event.target.value); setCursor(''); }}>
      <option value="">All requests</option>{Object.entries(pickupLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}
    </select></div>
    <button className="btn btn-outline-secondary" onClick={data.retry}>Refresh requests</button><LoadState data={data} />
    {data.data && <>
      {!data.data.requests.length && <p>No pickup requests here yet.</p>}
      <ul className="plans-grid">{data.data.requests.map(request => <li className="plan-panel" key={request.id}>
        <h2><Link to={`/app/pickups/${request.id}`}>{request.item?.name || 'Former listing'}</Link></h2><p className="plan-status">{pickupLabels[request.status]}</p>
        <p>{incoming ? 'Receiver' : 'Giver'}: {request.counterpart.firstName}</p><Appointment request={request} />
        {incoming && request.plan && <p><Link to={`/app/plans/${request.plan.id}`}>{request.plan.title || 'Move-out plan'}</Link></p>}
      </li>)}</ul>
      <div className="plan-actions">{cursor && <button onClick={() => setCursor('')}>First page</button>}
        {data.data.nextCursor && <button className="btn btn-primary" onClick={() => setCursor(data.data.nextCursor)}>Next requests</button>}</div>
    </>}
  </main>;
}
export function PickupDetail() {
  const { requestId } = useParams(); const data = usePlansData(`/api/pickup-requests/${encodeURIComponent(requestId)}`);
  const request = data.data?.request; const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
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
  return <main className="plans-page pickup-page"><Link to={request?.role === 'giver' ? '/app/pickups/incoming' : '/app/pickups'}>Back to requests</Link>
    <h1>Pickup request</h1><LoadState data={data} />{error && <p role="alert">{error}</p>}
    <button className="btn btn-outline-secondary" disabled={busy} onClick={data.retry}>Reload request</button>
    {request && <article className="plan-panel"><h2>{request.item?.name || 'Former listing'}</h2><p className="plan-status">{pickupLabels[request.status]}</p>
      <p>{request.role === 'giver' ? 'Receiver' : 'Giver'}: {request.counterpart.firstName}</p><Appointment request={request} />
      {request.status === 'pending' && <p>The item is not reserved. The giver must accept a future appointment.</p>}
      {request.status === 'accepted' && <p>This appointment reserves one whole listing. It does not mean a handoff has occurred. No address is disclosed automatically.</p>}
      {request.cancellationReason && <p>Cancellation reason: {request.cancellationReason.replace(/_/g, ' ')}.</p>}
      {request.item && <><p>{request.item.neighborhood}, {request.item.city}</p><p className="pickup-note">{request.item.description}</p><Link to={`/app/items/${request.item.id}`}>Public listing (if still available)</Link></>}
      {request.plan && <p><Link to={`/app/plans/${request.plan.id}`}>{request.plan.title || 'Move-out plan'}</Link></p>}
      <h3>Private coordination note</h3><p className="pickup-note">{request.note || 'No note provided.'}</p>
      <div className="plan-actions">{actions.map(name => <button key={name} className="btn btn-outline-primary" disabled={busy || (['complete', 'no_show'].includes(name) && Date.parse(request.proposedAt) > Date.now())} onClick={() => action(name)}>{actionLabels[name]}</button>)}</div>
      {request.role === 'giver' && request.status === 'accepted' && <p>Record completion or no-show after the appointment time. Reload the request to update these controls.</p>}
      <h3>Request history</h3><ul>{request.history.map((entry, index) => <li key={index}>{pickupLabels[entry.action]} — {entry.actor}, <time dateTime={entry.at}>{new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'short', timeZone: request.timeZone }).format(new Date(entry.at))}</time> ({request.timeZone})</li>)}</ul>
    </article>}
  </main>;
}
