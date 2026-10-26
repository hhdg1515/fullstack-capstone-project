import React, { useRef, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { useAppContext } from '../../context/AuthContext';
import { confirmPickupChanges } from '../../api/confirmPickupChanges';
import usePlansData from '../MoveOutPlans/usePlansData';
import ItemForm, { availabilityError } from './ItemForm';
import ItemLabels from './ItemLabels';
import '../MoveOutPlans/Plans.css';
import './Inventory.css';
import JourneyNav from '../Journeys/JourneyNav';
import { useDiscardChanges } from '../../forms/UnsavedChanges';
import { Feedback, PageHeader, Surface } from '../../design-system/primitives';
import { inventoryFilters, ownerStatus, publicationComplete } from './inventoryStatus';
import { validPickupTimeZone } from '../../forms/pickupTime';

export const itemStates = ['draft', 'available', 'unlisted', 'cleared', 'expired'];
const actionLabels = { publish: 'Publish', unlist: 'Hide listing', clear: 'Mark cleared', reopen: 'Reopen as draft' };
const confirmations = { publish: 'Publish this item for everyone to see? Future pickup dates do not delay publication.',
  unlist: 'Remove this item from public discovery now? It will not count as cleared.',
  clear: 'Mark this item as dealt with and remove it from public discovery? It will count toward your move-out progress.',
  reopen: 'Reopen this cleared item as a private draft? It will no longer count as cleared. Publish it separately when ready.' };
export default function Inventory() {
  const { planId } = useParams();
  const { user } = useAppContext();
  const drafts = useDiscardChanges();
  const [params] = useSearchParams();
  const request = usePlansData(`/api/move-out-plans/${encodeURIComponent(planId)}/items`, true);
  const [editor, setEditor] = useState(params.get('edit'));
  const [adding, setAdding] = useState(false);
  const itemsHeading = useRef();
  const [sequence, setSequence] = useState(0);
  const [filter, setFilter] = useState('all');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const data = [403, 404].includes(request.error?.status) ? undefined : request.data;
  const locked = busy || request.loading || Boolean(request.error);
  const writing = useRef(false);
  const item = data?.items.find(value => value.id === editor);
  const formVisible = !data?.items.length || Boolean(item) || adding;
  const root = `/api/move-out-plans/${encodeURIComponent(planId)}/items`;
  const save = async (details, publish, committed) => {
    if (writing.current) throw new Error('Another inventory change is saving. Wait for it to finish, then try again.');
    writing.current = true; setBusy(true);
    try {
      await confirmPickupChanges(item ? `${root}/${item.id}` : root, { method: item ? 'PATCH' : 'POST',
        body: item ? { ...details, version: item.version, publish } : { ...details, publish } });
      committed?.();
      setMessage(item ? (publish ? 'Item published.' : 'Item saved.') : publish ? 'Item published. Add another below.' : 'Draft saved. Add another below.');
      setAdding(!item); setEditor(null); setSequence(value => value + 1); request.retry();
    } finally { writing.current = false; setBusy(false); }
  };
  const edit = entry => {
    if (editor !== entry.id && drafts && !drafts.confirmDiscard()) return;
    setEditor(entry.id); setAdding(false); setError('');
  };
  const action = async (entry, name) => {
    if (writing.current || locked) return;
    if (['publish', 'reopen'].includes(name)) {
      const invalid = availabilityError(entry, data.plan, true);
      if (invalid) { setError(invalid); return; }
    }
    if (editor === entry.id && drafts && !drafts.confirmDiscard({ release: false })) return;
    if (!window.confirm(confirmations[name])) return;
    writing.current = true; setBusy(true); setError(''); setMessage('');
    try {
      await confirmPickupChanges(`${root}/${entry.id}/actions`, { method: 'POST', body: { action: name, version: entry.version } });
      if (editor === entry.id) { setEditor(null); setAdding(false); }
      setMessage(`${actionLabels[name]} confirmed.`); request.retry();
    } catch (failure) { setError(failure.message); }
    finally { writing.current = false; setBusy(false); }
  };
  return <main className="ui-page inventory-page">
    <JourneyNav journey="give" planId={planId} />
    <Link to={'/app/plans/' + planId}>Back to plan</Link>
    <PageHeader title="Plan inventory" description={data ? data.plan.neighborhood + ', ' + data.plan.city + ' · Move out by ' + data.plan.moveOutDeadline : undefined}
      action={<button className="ui-button ui-button--secondary" disabled={busy || request.loading} onClick={() => {
        if (item) {
          if (drafts ? !drafts.confirmDiscard() : !window.confirm('Refresh and review the latest saved item details? An outdated edit draft may be replaced.')) return;
          setSequence(value => value + 1);
        }
        request.retry();
      }}>Refresh inventory</button>} />
    {request.loading && <Feedback>{data ? 'Refreshing inventory…' : 'Loading inventory…'}</Feedback>}
    {(error || request.error) && <Feedback error><p>{error || (request.error.status === 404 ? 'This inventory is unavailable.' : request.error.message)}</p>
      <button className="ui-button ui-button--secondary" onClick={() => { setError(''); request.retry(); }}>Reload inventory</button></Feedback>}
    {message && <Feedback>{message}</Feedback>}
    {data && <>
      <p className="inventory-progress"><strong>{data.progress.cleared} of {data.progress.total} items cleared</strong></p>
      {validPickupTimeZone(data.plan.pickupTimeZone) ? <p>Pickup timezone: <strong>{data.plan.pickupTimeZone}</strong> · One setting for this plan.</p> :
        <Feedback><p>Set a pickup timezone so people can request your posted items. You can still save drafts and publish; metro discovery also needs a metro.</p>
          <Link to={'/app/plans/' + planId + '/edit'} state={{ focusPickupTimeZone: true }}>{data.plan.pickupTimeZone === null ? 'Set pickup timezone' : 'Check pickup setup'}</Link></Feedback>}
      {data.plan.metroId === null && <p>Choose a metro for regional discovery. <Link to={'/app/plans/' + planId + '/edit'}>Choose a metro</Link></p>}
      {data.plan.moveOutDeadline < new Date().toISOString().slice(0, 10) && <Feedback><p>The plan deadline has passed. Extend it before publishing or reopening items.</p><Link to={'/app/plans/' + planId + '/edit'}>Edit plan deadline</Link></Feedback>}
      {data.plan.status !== 'active' && <p>This plan is inactive. <Link to={'/app/plans/' + planId + '/edit'}>Activate it</Link> before publishing.</p>}
      <section aria-label="Inventory items">
        {data.items.length > 0 && <div className="plan-page-header"><h2 ref={itemsHeading} tabIndex={-1}>Your items</h2>
          <button className="ui-button" disabled={locked} onClick={() => { if (item && drafts && !drafts.confirmDiscard()) return; setEditor(null); setAdding(true); }}>Add item</button></div>}
        {data.items.length > 0 && <div className="ui-field inventory-filter"><label htmlFor="inventory-filter">Show items</label>
          <select id="inventory-filter" value={filter} onChange={event => setFilter(event.target.value)}>
            <option value="all">All items</option>{inventoryFilters.map(state => <option key={state} value={state}>{state}</option>)}
          </select></div>}
        {!data.items.length && <p>No items yet. Add your first item below; the plan supplies its location and deadline.</p>}
        {data.items.length > 0 && !data.items.some(entry => filter === 'all' || ownerStatus(entry) === filter) && <p>No items match this status. <button className="ui-button ui-button--secondary" onClick={() => setFilter('all')}>Show all items</button></p>}
        <ul className="inventory-list">{data.items.filter(entry => filter === 'all' || ownerStatus(entry) === filter).map(entry => <Surface as="li" className="inventory-card" key={entry.id}>
          <div className="inventory-card-heading"><h2>{entry.name}</h2><span className="ui-status">{ownerStatus(entry)}</span></div>
          <ItemLabels item={entry} />
          <p>Pickup: {entry.availableFrom || 'Immediately'} through {entry.effectiveAvailableUntil}</p>
          {entry.status === 'available' && !entry.isPublic && <p>Not publicly visible. Review the plan’s status.</p>}
          {entry.isReserved === true && <p>Pickup arranged. <Link to="/app/pickups/incoming">View pickup requests</Link> to review or confirm the handoff.</p>}
          {entry.status === 'cleared' && entry.isPickedUp !== true && <p>Marked as dealt with. Check pickup requests for any handoff history.</p>}
          {entry.isPickedUp === true && entry.status === 'cleared' && <p>Handoff confirmed in the pickup request.</p>}
          {entry.status === 'expired' && <p>Edit pickup dates or the plan deadline, then publish again.</p>}
          <div className="inventory-actions">
            <button aria-label={'Edit ' + entry.name} disabled={locked} className="ui-button ui-button--secondary" onClick={() => edit(entry)}>Edit</button>
            {['draft', 'unlisted', 'expired'].includes(entry.status) && <button aria-label={(publicationComplete(entry) ? 'Publish ' : 'Complete ') + entry.name + (publicationComplete(entry) ? '' : ' for publication')} disabled={locked || data.plan.status !== 'active'} className="ui-button" onClick={() => publicationComplete(entry) ? action(entry, 'publish') : edit(entry)}>{publicationComplete(entry) ? 'Publish' : 'Complete listing'}</button>}
            {['available', 'expired'].includes(entry.status) && <button aria-label={'Hide ' + entry.name} disabled={locked} className="ui-button ui-button--secondary" onClick={() => action(entry, 'unlist')}>Hide listing</button>}
            {entry.isPublic && <Link to={'/app/items/' + entry.id}>Public listing</Link>}
          </div>
          <details className="inventory-more"><summary>More actions<span className="visually-hidden"> for {entry.name}</span></summary>
            {entry.status !== 'cleared' ? <><p>Mark as dealt with outside a confirmed pickup. This counts toward clearance and cancels outstanding requests after confirmation.</p>
              <button aria-label={'Mark ' + entry.name + ' cleared'} disabled={locked} className="ui-button ui-button--secondary" onClick={() => action(entry, 'clear')}>Mark as cleared</button></> :
              <button aria-label={'Reopen ' + entry.name + ' as draft'} disabled={locked} className="ui-button ui-button--secondary" onClick={() => action(entry, 'reopen')}>Reopen as draft</button>}
          </details>
        </Surface>)}</ul>
      </section>
      <div hidden={!formVisible}>
        {data.items.length > 0 && !item && <button className="ui-button ui-button--secondary" onClick={() => { setAdding(false); itemsHeading.current?.focus(); }}>Back to items</button>}
        <ItemForm key={user.id + ':' + planId + ':' + (item?.id || 'new') + ':' + (item?.version || 0) + ':' + sequence} plan={data.plan} item={item}
          onSave={save} onCancel={() => { setEditor(null); setAdding(false); itemsHeading.current?.focus(); }}
          focusName={formVisible && !item && (adding || sequence > 0)} disabled={locked} />
      </div>
    </>}
  </main>;
}
