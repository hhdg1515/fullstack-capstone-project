import React, { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { apiRequest } from '../../api/client';
import usePlansData from '../MoveOutPlans/usePlansData';
import '../MoveOutPlans/Plans.css';
import './Pickups.css';
import JourneyNav from '../Journeys/JourneyNav';
import { useUnsavedForm } from '../../forms/UnsavedChanges';
import useFormErrors from '../../forms/useFormErrors';
import PickupConversation from './PickupConversation';
import PickupItemPhoto from './PickupItemPhoto';
import PickupScheduling, { PickupTime, SchedulingEvent } from './PickupScheduling';
import { useAppContext } from '../../context/AuthContext';
import { PageHeader, Surface, Feedback } from '../../design-system/primitives';
import { pickupMinimum, pastPickupSelection } from '../../forms/pickupTime';
import { placeLabel } from './placeLabel';

export const pickupLabels = { pending: 'Pending', accepted: 'Accepted', declined: 'Declined', cancelled: 'Cancelled', completed: 'Completed', no_show: 'No-show' };
const actionLabels = { accept: 'Accept pickup', decline: 'Decline request', cancel: 'Cancel request', complete: 'Confirm handoff', no_show: 'Record no-show' };
const participant = request => ['giver', 'receiver'].includes(request.role);
const conversationAvailable = request => participant(request) && request.item && Boolean(pickupLabels[request.status]);
function Appointment({ request, compact = false }) {
  return <p className="pickup-appointment"><b>{request.status === 'pending' ? 'Proposed pickup' : request.status === 'accepted' ? 'Confirmed pickup' : 'Pickup time'}:</b><br />
    <PickupTime value={request} compact={compact} /></p>;
}
function LoadState({ data }) {
  if (data.loading) return <Feedback>Loading pickup requests…</Feedback>;
  if (data.error) return <Feedback error><p>{data.error.status === 404 ? 'This pickup request is unavailable.' : data.error.message}</p>
    <button className="ui-button ui-button--secondary" onClick={data.retry}>Retry requests</button></Feedback>;
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
    else if (pastPickupSelection(localDateTime, item.pickupTimeZone)) issues.localDateTime = 'Choose a future pickup time in the giver’s timezone.';
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
  return <main className="ui-page pickup-page"><JourneyNav journey="find" discoverySearch={discoverySearch} /><Link to={`/app/items/${itemId}`} state={{ discoverySearch }}>Back to listing</Link><PageHeader title="Request pickup" /><LoadState data={data} />
    {item && <><div className="pickup-item-context"><PickupItemPhoto key={item.images?.[0]?.id || item.id} item={item} detail /><div className="pickup-item-identity"><h2>{item.name}</h2><p>{placeLabel(item)}</p></div></div>
      {item.isOwner === true ? <p role="status">Your listing. You cannot request your own item. Manage it from {item.listingModel === 2 ? 'My Listings' : 'My plans'}.</p> : item.isReserved === true ? <div role="status"><p>This item has an accepted pickup. Check back if it becomes available.</p>
        <button className="ui-button ui-button--secondary" onClick={data.retry}>Check availability</button></div> : !item.pickupTimeZone ? <p role="alert">The giver must set a pickup timezone before requests can be submitted.</p> : <Surface as="form" ref={validation.formRef} noValidate className="pickup-request-form" onSubmit={submit} aria-busy={busy}>
        <p>A request does not reserve the item. Wait for the giver to accept. Each listing is one pickup unit, including groups of items.</p>
        {typeof item.isReserved !== 'boolean' && <p>Current pickup availability will be checked when you send a request.</p>}
        {item.datePolicy === 'pickup-local' ? <p>Choose a local date from {item.availableFrom || 'today'} through {item.effectiveAvailableUntil} in {item.pickupTimeZone}. The listing ends at the end of that local date.</p> :
          <p>Choose a local date from {item.availableFrom || 'today'} through {item.effectiveAvailableUntil}. Listings still expire at the end of that UTC date; late local appointments beyond that cutoff cannot be booked.</p>}
        <fieldset disabled={busy}><legend className="visually-hidden">Appointment details</legend>
          <div className="ui-field"><label htmlFor="pickup-time">Pickup date and time</label>
            <input id="pickup-time" name="localDateTime" type="datetime-local" step="60" min={pickupMinimum(item.pickupTimeZone)} required value={localDateTime} onChange={event => { setTime(event.target.value); validation.clear('localDateTime'); }} {...validation.fieldProps('localDateTime', 'pickup-zone-help')} />
            {errors.localDateTime && <p id="localDateTime-error" className="ui-field-error">{errors.localDateTime}</p>}
            <small id="pickup-zone-help">Local time in <strong>{item.pickupTimeZone}</strong>, selected by the giver. Your browser timezone is not used. Times skipped or repeated by daylight saving must be avoided.</small></div>
          <div className="ui-field"><label htmlFor="pickup-note">Coordination note (optional, private)</label><textarea id="pickup-note" name="note" {...validation.fieldProps('note')} maxLength={500} value={note} onChange={event => { setNote(event.target.value); validation.clear('note'); }} />
            {errors.note && <p id="note-error" className="ui-field-error">{errors.note}</p>}</div>
          <p>Only you and the giver see this note. Suggest a general public meeting point or brief handoff instructions. Keep phone numbers, email and residential addresses out of it. After sending your request, use its pickup conversation to coordinate.</p>
          <button className="ui-button">{busy ? 'Sending…' : 'Send pickup request'}</button>
        </fieldset>
      </Surface>}
      {error && <div ref={validation.summaryRef} tabIndex={-1} role="alert"><p>{error}</p><button onClick={data.retry}>Reload listing</button></div>}
    </>}
  </main>;
}
export function PickupDashboard({ incoming = false }) {
  const [params, setParams] = useSearchParams();
  const status = params.get('status') || '', cursor = params.get('cursor') || '';
  const query = new URLSearchParams(); if (cursor) query.set('cursor', cursor); if (status) query.set('status', status);
  const data = usePlansData(`/api/pickup-requests/${incoming ? 'received' : 'sent'}?${query}`);
  const setStatus = value => { const next = new URLSearchParams(); if (value) next.set('status', value); setParams(next); };
  const setCursor = value => { const next = new URLSearchParams(query); if (value) next.set('cursor', value); else next.delete('cursor'); setParams(next); };
  const state = { journey: incoming ? 'give' : 'find', returnSearch: query.toString() };
  return <main className="ui-page pickup-page"><JourneyNav journey={incoming ? 'give' : 'find'} />
    <PageHeader title={incoming ? 'Incoming pickup requests' : 'My pickup requests'} description={incoming ? 'Review requests and arrange pickup.' : 'Check your requests and pickup arrangements.'}
      action={<button className="ui-button ui-button--secondary" disabled={data.loading} onClick={data.retry}>Refresh requests</button>} />
    <div className="ui-field pickup-filter"><label htmlFor="pickup-filter">Request status</label><select id="pickup-filter" value={status} onChange={event => setStatus(event.target.value)}>
      <option value="">All requests</option>{Object.entries(pickupLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}
    </select></div>
    <LoadState data={data} />
    {data.data && <>
      {!data.data.requests.length && <Surface className="ui-empty">{status ? <><h2>No requests match this status.</h2>
        <button className="ui-button ui-button--secondary" onClick={() => setStatus('')}>Clear status filter</button></> : <><h2>No pickup requests here yet.</h2>
          {!incoming && <Link className="ui-button" to="/app/items">Find free items</Link>}</>}</Surface>}
      <ul className="pickup-cards" aria-label="Pickup requests">{data.data.requests.map(request => <Surface as="li" className="pickup-request-card" key={request.id}>
        <div className="pickup-card-heading"><h2>{request.item ? <Link to={`/app/items/${request.item.id}`}>{request.item.name}</Link> : 'Former listing'}</h2>
          <span className="ui-status">{pickupLabels[request.status] || 'Status unavailable'}</span></div>
        <p>Applicant: {incoming ? request.counterpart.firstName : 'You'}</p>
        {!incoming && <p>Giver: {request.counterpart.firstName}</p>}<Appointment request={request} compact />
        {Number.isFinite(Date.parse(request.createdAt)) && <p className="pickup-help">Requested <time dateTime={request.createdAt}>{new Date(request.createdAt).toLocaleString()}</time></p>}
        <div className="pickup-actions"><Link className="ui-button" to={`/app/pickups/${request.id}`} state={state}
          aria-label={`View request ${incoming ? 'from' : 'to'} ${request.counterpart.firstName} for ${request.item?.name || 'former listing'}`}>View request</Link>
          {conversationAvailable(request) && <Link className="ui-button ui-button--secondary" to={`/app/pickups/${request.id}#conversation`} state={state}
            aria-label={`Open conversation with ${request.counterpart.firstName} for ${request.item.name}`}>Open conversation</Link>}</div>
        {request.note && <details className="pickup-request-details"><summary>Pickup note</summary><p className="pickup-note">{request.note}</p></details>}
        {!request.item && <p>The listing is no longer available. You can still review the request.</p>}
      </Surface>)}</ul>
      <div className="pickup-actions">{cursor && <button className="ui-button ui-button--secondary" onClick={() => setCursor('')}>First page</button>}
        {data.data.nextCursor && <button className="ui-button" onClick={() => setCursor(data.data.nextCursor)}>Next requests</button>}</div>
    </>}
  </main>;
}
export function PickupDetail() {
  const { requestId } = useParams(); const { user } = useAppContext();
  return <RequestDetail key={`${user.id}:${requestId}`} requestId={requestId} />;
}
function RequestDetail({ requestId }) {
  const data = usePlansData(`/api/pickup-requests/${encodeURIComponent(requestId)}`, true);
  const request = [403, 404].includes(data.error?.status) ? undefined : data.data?.request;
  const [error, setError] = useState(''); const [busy, setBusy] = useState(false); const [blocked, setBlocked] = useState(false);
  const flight = useRef(false), alive = useRef(false); const location = useLocation();
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => { if (request) { setBlocked(false); setError(''); } }, [request]);
  const loaded = Boolean(request);
  useEffect(() => {
    if (loaded && ['#conversation', '#pickup-arrangement-heading'].includes(location.hash)) {
      const target = document.getElementById(location.hash === '#conversation' ? 'conversation-heading' : 'pickup-arrangement-heading'); target?.focus({ preventScroll: true }); target?.scrollIntoView?.({ block: 'start' });
    }
  }, [loaded, location.hash, location.key]);
  const actions = request ? [
    ...(request.role === 'giver' && request.status === 'pending' ? ['accept', 'decline'] : []),
    ...(request.role === 'giver' && request.status === 'accepted' ? ['complete', 'no_show'] : []),
    ...(participant(request) && ['pending', 'accepted'].includes(request.status) ? ['cancel'] : [])
  ] : [];
  const action = async name => {
    if (flight.current || blocked || data.loading || data.error || !actions.includes(name)) return;
    const warning = name === 'complete' ? 'Confirm the entire item or group was actually handed over? This clears the item and cancels competing requests.' :
      name === 'no_show' ? 'Confirm the receiver did not arrive? This releases the reservation without clearing the item.' :
      name === 'accept' ? 'Accept this appointment? Other requests will remain pending, and new requests will be blocked until it is released.' : `${actionLabels[name]}?`;
    if (!window.confirm(warning)) return;
    flight.current = true; setBusy(true); setError('');
    try {
      await apiRequest(`/api/pickup-requests/${requestId}/actions`, { method: 'POST', notifyUnauthorized: false, body: { action: name, version: request.version },
        validate: value => value?.request?.id === requestId && Number.isInteger(value.request.version) && value.request.version > request.version });
      if (!alive.current) return;
      setBlocked(true); data.retry();
    } catch (failure) {
      if (!alive.current) return;
      setError(failure.message); setBlocked(true);
      if (failure.status === 401) window.dispatchEvent(new Event('giftlink:unauthorized'));
    } finally { if (alive.current) { flight.current = false; setBusy(false); } }
  };
  const outcomeReady = Number.isFinite(Date.parse(request?.proposedAt)) && Date.parse(request.proposedAt) <= Date.now();
  const conversationPrimary = !actions.includes('accept') && !(actions.includes('complete') && outcomeReady);
  const conversationLink = request && conversationAvailable(request) ? <Link className={`ui-button${conversationPrimary ? '' : ' ui-button--secondary'}`} to={{ hash: '#conversation', search: location.search }} state={location.state}>Open conversation</Link> : null;
  const returnQuery = new URLSearchParams(typeof location.state?.returnSearch === 'string' ? location.state.returnSearch : '');
  const backQuery = new URLSearchParams(); for (const name of ['status', 'cursor']) if (returnQuery.get(name)) backQuery.set(name, returnQuery.get(name));
  const back = ((request ? request.role === 'giver' : location.state?.journey === 'give') ? '/app/pickups/incoming' : '/app/pickups') + (backQuery.toString() ? `?${backQuery}` : '');
  return <main className="ui-page pickup-page">{request && <JourneyNav journey={request.role === 'giver' ? 'give' : 'find'} planId={request.plan?.id} />}
    <Link className="pickup-back" to={back}>Back to requests</Link>
    <PageHeader title="Pickup request" action={<button className="ui-button ui-button--secondary" disabled={busy || data.loading} onClick={data.retry}>Reload request</button>} />
    <LoadState data={data} />{error && <Feedback error><p>{error}</p><p>Reload the request and review its current state before trying again.</p></Feedback>}
    {request && <>
      {(data.loading || data.error) && <Feedback>Showing last loaded details. Reload to confirm current status and pickup time.</Feedback>}
      <Surface as="article" className="pickup-summary" aria-label="Request summary">
        <div className="pickup-item-context">
          {request.item && participant(request) && pickupLabels[request.status] && request.id === requestId && !data.loading && !data.error && <PickupItemPhoto key={request.item.coverImage?.id || request.item.id} item={request.item} />}
          <div className="pickup-item-identity pickup-card-heading"><h2>{request.item?.name || 'Former listing'}</h2><span className="ui-status">{pickupLabels[request.status] || 'Status unavailable'}</span></div>
        </div>
        <p>Applicant: {request.role === 'giver' ? request.counterpart.firstName : 'You'}</p>
        {request.role === 'receiver' && <p>Giver: {request.counterpart.firstName}</p>}
        {request.item && <p>{placeLabel(request.item)}</p>}
        {request.status === 'pending' && <p>Not reserved. Waiting for the giver to accept a pickup time.</p>}
        {request.status === 'accepted' && <p>Pickup arranged. The item is reserved; handoff has not been recorded.</p>}
        {request.cancellationReason && <p>Cancellation reason: {request.cancellationReason.replace(/_/g, ' ')}.</p>}
        <div className="pickup-actions">{conversationPrimary && conversationLink}{actions.map(name => <button key={name} className={`ui-button${(name === 'accept' || (name === 'complete' && outcomeReady)) ? '' : ' ui-button--secondary'}`}
          disabled={busy || blocked || data.loading || Boolean(data.error) || (['complete', 'no_show'].includes(name) && !outcomeReady)} onClick={() => action(name)}>{actionLabels[name]}</button>)}
          {!conversationPrimary && conversationLink}</div>
        {request.role === 'giver' && request.status === 'accepted' && <p className="pickup-help">Record completion or no-show after the appointment time. Reload the request to update these controls.</p>}
      </Surface>
      <Surface aria-label="Pickup arrangement" className="pickup-arrangement" aria-busy={data.loading || false}>
        <h2 id="pickup-arrangement-heading" tabIndex={-1}>Pickup arrangement</h2><Appointment request={request} />
        {request.item && <p className="pickup-help">Pickup window: {request.item.availableFrom || 'Now'} through {request.item.effectiveAvailableUntil} {request.item.datePolicy === 'pickup-local' ? '(local dates in ' + request.timeZone + ')' : '(UTC dates)'}. No address is disclosed automatically.</p>}
        <PickupScheduling request={request} onRefresh={data.retry} disabled={busy || data.loading || Boolean(data.error) || blocked} />
      </Surface>
      <PickupConversation requestId={request.id} requestStatus={request.status} itemName={request.item?.name} hasTimeProposal={request.status === 'accepted' && Boolean(request.rescheduling?.proposal)} />
      <Surface className="pickup-secondary" aria-label="Request details and history">
        {request.note && <details className="pickup-request-details"><summary>Pickup note</summary><p className="pickup-note">{request.note}</p></details>}
        {request.item && <p><Link to={request.role === 'giver' && request.item.listingModel === 2 ? `/app/listings/${request.item.id}` : `/app/items/${request.item.id}`}>View item</Link></p>}
        <details className="pickup-request-details"><summary>Request history</summary><ul>{request.history.map((entry, index) => <li key={index}>
          {entry.action.startsWith('reschedule_') ? <SchedulingEvent entry={entry} /> : entry.action === 'pending' ? 'Request submitted' : pickupLabels[entry.action] || 'Request updated'}
          {' — '}{entry.actor === 'receiver' ? 'requester' : entry.actor}, <PickupTime compact value={{ proposedAt: entry.at, timeZone: request.timeZone }} />
        </li>)}</ul></details>
      </Surface>
    </>}
  </main>;
}
