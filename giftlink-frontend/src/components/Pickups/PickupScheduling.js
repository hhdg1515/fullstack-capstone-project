import React, { useEffect, useRef, useState } from 'react';
import { apiRequest } from '../../api/client';
import { useAppContext } from '../../context/AuthContext';
import { useUnsavedForm } from '../../forms/UnsavedChanges';
import useFormErrors from '../../forms/useFormErrors';
import { pickupMinimum, pastPickupSelection } from '../../forms/pickupTime';

export function PickupTime({ value, compact = false }) {
  let display;
  try { display = new Intl.DateTimeFormat('en', { dateStyle: compact ? 'medium' : 'full', timeStyle: 'short', timeZone: value.timeZone }).format(new Date(value.proposedAt)); }
  catch { return <span>Time unavailable. Reload the request.</span>; }
  if (compact) return <><time dateTime={value.proposedAt}>{display}</time> ({value.timeZone})</>;
  return <><time dateTime={value.proposedAt}>{display}</time>{' '}<strong>{value.timeZone}</strong></>;
}
const reasonText = {
  appointment_passed: 'The confirmed pickup time has passed. Use the existing outcome or cancellation actions; it cannot be changed retrospectively.',
  listing_unavailable: 'Pickup availability changed. Reload the request before changing its time.',
  proposal_unavailable: 'The proposed time is no longer valid. The other participant can decline it; the confirmed time still applies.',
  unavailable: 'Time changes are unavailable. Reload the request to check its current state.',
};
const eventLabels = { reschedule_proposed: 'Time change proposed', reschedule_accepted: 'New pickup time confirmed',
  reschedule_declined: 'Time change declined; confirmed time kept', reschedule_invalidated: 'Time change no longer applies' };
const reasonLabels = { proposal_window_changed: 'The proposed time no longer fits the pickup window.', timezone_changed: 'The pickup timezone changed.',
  location_changed: 'The pickup location changed.', plan_inactive: 'The plan closed.', availability_changed: 'Pickup availability changed.',
  item_unlisted: 'The item was withdrawn.', external_clearance: 'The item was cleared.', request_cancelled: 'The request was cancelled.',
  request_completed: 'The item was handed over.', request_no_show: 'The pickup was marked as no-show.' };
export function SchedulingEvent({ entry }) {
  return <><strong>{eventLabels[entry.action] || 'Request updated'}</strong>
    {entry.reschedule && <p className="pickup-note">Previous confirmed time: <PickupTime compact value={entry.reschedule.previousAppointment} /><br />
      {entry.action === 'reschedule_accepted' ? 'New confirmed time' : 'Unconfirmed proposed time'}: <PickupTime compact value={entry.reschedule.proposal} /></p>}
    {entry.reason && <p>{reasonLabels[entry.reason] || 'The request or pickup availability changed.'}</p>}</>;
}

export default function PickupScheduling(props) {
  const { user } = useAppContext();
  return <TimeChange key={`${user.id}:${props.request.id}`} {...props} />;
}
function TimeChange({ request, onRefresh, disabled = false }) {
  const scheduling = request.rescheduling;
  const proposal = scheduling?.proposal;
  const [editing, setEditing] = useState(false); const [localDateTime, setTime] = useState('');
  const [busy, setBusy] = useState(false); const inFlight = useRef(false); const alive = useRef(false);
  const [blocked, setBlocked] = useState(false); const [notice, setNotice] = useState('');
  const validation = useFormErrors(busy); const reset = useRef(validation.reset); reset.current = validation.reset;
  const guard = useUnsavedForm({ localDateTime }, { localDateTime: '' });
  const input = useRef();
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => { setBlocked(false); reset.current(); }, [request]);
  useEffect(() => { if (editing) input.current?.focus(); }, [editing]);
  const accepted = request.status === 'accepted';
  const canPropose = accepted && !proposal && scheduling?.canPropose === true;
  const canAccept = accepted && proposal && proposal.proposedBy !== request.role && scheduling?.canAccept === true;
  const canDecline = accepted && proposal && proposal.proposedBy !== request.role && scheduling?.canDecline === true;
  const locked = busy || blocked || disabled;
  const mutate = async action => {
    if (inFlight.current || locked || !(action === 'propose' ? canPropose : action === 'accept' ? canAccept : canDecline)) return;
    validation.reset(); setNotice('');
    if (action === 'propose' && !localDateTime) { validation.show({ localDateTime: 'Choose a new pickup date and time.' }); return; }
    if (action === 'propose' && pastPickupSelection(localDateTime, request.timeZone)) { validation.show({ localDateTime: 'Choose a future pickup time in the giver’s timezone.' }); return; }
    if (action === 'accept' && !window.confirm('Confirm this proposed pickup time? It will replace the current confirmed appointment.')) return;
    inFlight.current = true; setBusy(true);
    const root = `/api/pickup-requests/${encodeURIComponent(request.id)}/reschedule-proposals`;
    try {
      await apiRequest(action === 'propose' ? root : `${root}/${encodeURIComponent(proposal.id)}/actions`, {
        method: 'POST', notifyUnauthorized: false,
        body: action === 'propose' ? { version: request.version, localDateTime, timeZone: request.timeZone } : { version: request.version, action },
        validate: result => result?.request?.id === request.id && Number.isInteger(result.request.version) && result.request.version > request.version,
      });
      if (!alive.current) return;
      setBlocked(true);
      if (action === 'propose') { guard.markSaved(); setTime(''); setEditing(false); }
      setNotice(action === 'propose' ? 'Time change proposed. The confirmed time has not changed.' :
        action === 'accept' ? 'New pickup time confirmed.' : 'Time change declined. The confirmed time is unchanged.');
      onRefresh();
    } catch (failure) {
      if (!alive.current) return;
      if (failure.status === 401) window.dispatchEvent(new Event('giftlink:unauthorized'));
      if ([0, 403, 404, 409].includes(failure.status) || !failure.status || failure.status >= 500) setBlocked(true);
      if (action === 'propose' && ['INVALID_APPOINTMENT', 'APPOINTMENT_PAST', 'OUTSIDE_PICKUP_WINDOW', 'UNCHANGED_APPOINTMENT'].includes(failure.code)) {
        validation.show({ localDateTime: failure.message });
      } else if (failure.status === 400) validation.failure(failure, ['localDateTime']);
      else validation.show({}, failure.status === 429 ? 'Too many requests. Wait a minute and retry.' :
        failure.status === 409 ? 'This request or proposal changed. Reload the request and review its current times before trying again.' :
        failure.status === 403 || failure.status === 404 ? 'Time changes are unavailable. Reload the request to check your access.' :
        'The time change could not be confirmed. Your draft is kept. Reload and check the current appointment and proposal before trying again.');
    } finally { if (alive.current) { inFlight.current = false; setBusy(false); } }
  };
  if (!accepted && !editing && !localDateTime) return null;
  return <section className="pickup-scheduling" aria-labelledby="scheduling-heading">
    <h3 id="scheduling-heading">Pickup time change</h3>
    {proposal && <div className="plan-panel" role="group" aria-label="Pending time change">
      <p><b>Proposed time — waiting for approval</b><br /><PickupTime value={proposal} /></p>
      <p>Proposed by {proposal.proposedBy === request.role ? 'you' : request.counterpart.firstName} ({proposal.proposedBy === 'giver' ? 'giver' : 'requester'}).</p>
      <p>The confirmed time above still applies until the other participant accepts this change.</p>
      {proposal.proposedBy === request.role && <p>Waiting for the other participant to respond. You cannot approve your own proposal.</p>}
      <div className="plan-actions">
        {canAccept && <button type="button" className="btn btn-primary" disabled={locked} onClick={() => mutate('accept')}>Accept proposed time</button>}
        {canDecline && <button type="button" className="btn btn-outline-secondary" disabled={locked} onClick={() => mutate('decline')}>Decline time change</button>}
      </div>
    </div>}
    {accepted && !scheduling && <p>Reload the request to check whether time changes are available.</p>}
    {accepted && scheduling?.reason && reasonText[scheduling.reason] && <p>{reasonText[scheduling.reason]}</p>}
    {!accepted && <p>This request is closed. Your unsent time has not been applied; no time changes can be submitted.</p>}
    {canPropose && !editing && <button type="button" className="btn btn-outline-primary" disabled={locked} onClick={() => setEditing(true)}>Propose new time</button>}
    {editing && <form ref={validation.formRef} className="plan-form" noValidate aria-busy={busy} onSubmit={event => { event.preventDefault(); mutate('propose'); }}>
      <div className="plan-field"><label htmlFor="reschedule-time">New pickup date and time</label>
        <input ref={input} id="reschedule-time" name="localDateTime" type="datetime-local" step="60" min={pickupMinimum(request.timeZone)} required value={localDateTime}
          readOnly={!canPropose || locked} {...validation.fieldProps('localDateTime', 'reschedule-zone-help')}
          onChange={event => { setTime(event.target.value); validation.clear('localDateTime'); }} />
        {validation.errors.localDateTime && <p id="localDateTime-error" className="plan-field-error">{validation.errors.localDateTime}</p>}
        <small id="reschedule-zone-help">Local time in {request.timeZone}, the giver's pickup timezone. Your browser timezone is not used.
          {' '}Choose a future time within the existing listing window, before its UTC expiration. Skipped or repeated daylight-saving times are not allowed.</small>
      </div>
      {!canPropose && localDateTime && <p>Your draft is kept, but cannot be submitted in the current request state.</p>}
      <div className="plan-actions"><button type="submit" className="btn btn-primary" disabled={locked || !canPropose}>Propose time change</button>
        <button type="button" className="btn btn-outline-secondary" disabled={busy} onClick={() => {
          if (guard.confirmDiscard()) { setTime(''); setEditing(false); validation.reset(); }
        }}>{canPropose ? 'Cancel time edit' : 'Discard time draft'}</button></div>
    </form>}
    <p role="status">{busy ? 'Saving time change…' : notice}</p>
    {validation.error && <div><p ref={validation.summaryRef} tabIndex={-1} role="alert" className="plan-field-error">{validation.error}</p>
      {blocked && <button type="button" className="btn btn-outline-secondary" disabled={busy || disabled} onClick={() => { validation.reset(); onRefresh(); }}>Reload current times</button>}</div>}
  </section>;
}
