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

export const itemStates = ['draft', 'available', 'unlisted', 'cleared', 'expired'];
const labels = { draft: 'Draft', available: 'Published', unlisted: 'Unlisted', cleared: 'Cleared', expired: 'Expired' };
const actionLabels = { publish: 'Publish', unlist: 'Unlist', clear: 'Mark cleared', reopen: 'Reopen as draft' };
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
  const data = request.data;
  const item = data?.items.find(value => value.id === editor);
  const formVisible = !data?.items.length || Boolean(item) || adding;
  const root = `/api/move-out-plans/${encodeURIComponent(planId)}/items`;
  const save = async (details, publish, committed) => {
    setBusy(true);
    try {
      await confirmPickupChanges(item ? `${root}/${item.id}` : root, { method: item ? 'PATCH' : 'POST',
        body: item ? { ...details, version: item.version } : { ...details, publish } });
      committed?.();
      setMessage(item ? 'Item saved.' : publish ? 'Item published. Add another below.' : 'Draft saved. Add another below.');
      setAdding(!item); setEditor(null); setSequence(value => value + 1); request.retry();
    } finally { setBusy(false); }
  };
  const action = async (entry, name) => {
    if (['publish', 'reopen'].includes(name)) {
      const invalid = availabilityError(entry, data.plan, true);
      if (invalid) { setError(invalid); return; }
    }
    if (!window.confirm(confirmations[name])) return;
    setBusy(true); setError(''); setMessage('');
    try {
      await confirmPickupChanges(`${root}/${entry.id}/actions`, { method: 'POST', body: { action: name, version: entry.version } });
      setMessage(`${actionLabels[name]} confirmed.`); request.retry();
    } catch (failure) { setError(failure.message); }
    finally { setBusy(false); }
  };
  return <main className="plans-page inventory-page">
    <JourneyNav journey="give" planId={planId} />
    <Link to={`/app/plans/${planId}`}>Back to plan</Link><h1>Plan inventory</h1>
    <button className="btn btn-outline-secondary" disabled={busy || request.loading} onClick={() => {
      if (item) {
        if (drafts ? !drafts.confirmDiscard() : !window.confirm('Refresh and review the latest saved item details? An outdated edit draft may be replaced.')) return;
        setSequence(value => value + 1);
      }
      request.retry();
    }}>Refresh inventory</button>
    {request.loading && <p role="status">{data ? 'Refreshing inventory…' : 'Loading inventory…'}</p>}
    {(error || request.error) && <div role="alert"><p>{error || (request.error.status === 404 ? 'This inventory is unavailable.' : request.error.message)}</p>
      <button className="btn btn-outline-secondary" onClick={() => { setError(''); request.retry(); }}>Reload inventory</button></div>}
    {message && <p role="status">{message}</p>}
    {data && <>
      <p>{data.plan.neighborhood}, {data.plan.city} · Move out by {data.plan.moveOutDeadline}</p>
      <p className="inventory-progress"><strong>{data.progress.cleared} of {data.progress.total} items cleared</strong></p>
      {data.plan.pickupTimeZone === null && <section aria-label="Pickup setup" role="status">
        <p>Set a pickup timezone so people can request your published items. You can still save drafts and publish without it. Metro discovery needs both a metro and a pickup timezone.</p>
        <Link to={`/app/plans/${planId}/edit`} state={{ focusPickupTimeZone: true }}>Set pickup timezone</Link>
      </section>}
      {data.plan.pickupTimeZone === undefined && <p>Check your plan’s pickup timezone before receiving requests. <Link to={`/app/plans/${planId}/edit`} state={{ focusPickupTimeZone: true }}>Check pickup setup</Link></p>}
      {data.plan.metroId === null && <p>Assign a metro so people can find these items in regional discovery. <Link to={`/app/plans/${planId}/edit`}>Choose a metro</Link></p>}
      {data.plan.status !== 'active' && <p>This plan is inactive. <Link to={`/app/plans/${planId}/edit`}>Activate it</Link> before publishing.</p>}
      <section aria-label="Inventory items">
        {data.items.length > 0 && <div className="plan-page-header"><h2 ref={itemsHeading} tabIndex={-1}>Your items</h2>
          <button className="btn btn-primary" disabled={busy || request.loading} onClick={() => { if (item && drafts && !drafts.confirmDiscard()) return; setEditor(null); setAdding(true); }}>Add item</button></div>}
        {data.items.length > 0 && <div className="plan-field"><label htmlFor="inventory-filter">Show items</label>
          <select id="inventory-filter" value={filter} onChange={event => setFilter(event.target.value)}>
            <option value="all">All items</option>{itemStates.map(state => <option key={state} value={state}>{labels[state]}</option>)}
          </select></div>}
        {!data.items.length && <p>No items yet. Add your first item below; the plan supplies its location and deadline.</p>}
        {data.items.length > 0 && !data.items.some(entry => filter === 'all' || entry.status === filter) && <p>No items match this status.</p>}
        <ul className="inventory-list">{data.items.filter(entry => filter === 'all' || entry.status === filter).map(entry => <li className="plan-panel" key={entry.id}>
          <h2>{entry.name}</h2><ItemLabels item={entry} /><p><span className="plan-status">{labels[entry.status]}</span>
            {entry.isReserved === true && <> · <span className="plan-status">Pickup arranged</span></>}</p>
          <p>Pickup: {entry.availableFrom || 'Immediately'} through {entry.effectiveAvailableUntil}</p>
          {entry.status === 'available' && !entry.isPublic && <p>Hidden while the plan is inactive.</p>}
          {entry.status === 'expired' && <p>Edit the pickup dates or extend the plan deadline, then explicitly publish again.</p>}
          <div className="inventory-actions">
            <button aria-label={`Edit ${entry.name}`} disabled={busy || request.loading} className="btn btn-outline-primary" onClick={() => {
              if (editor !== entry.id && drafts && !drafts.confirmDiscard()) return;
              setEditor(entry.id); setAdding(false); setError('');
            }}>Edit</button>
            {['draft', 'unlisted', 'expired'].includes(entry.status) && <button aria-label={`${entry.status === 'unlisted' ? 'Relist' : 'Publish'} ${entry.name}`} disabled={busy || request.loading || data.plan.status !== 'active'} className="btn btn-primary" onClick={() => action(entry, 'publish')}>{entry.status === 'unlisted' ? 'Relist' : 'Publish'}</button>}
            {['available', 'expired'].includes(entry.status) && <button aria-label={`Unlist ${entry.name}`} disabled={busy || request.loading} className="btn btn-outline-secondary" onClick={() => action(entry, 'unlist')}>Unlist</button>}
            {entry.status !== 'cleared' ? <button aria-label={`Mark ${entry.name} cleared`} disabled={busy || request.loading} className="btn btn-outline-secondary" onClick={() => action(entry, 'clear')}>Mark cleared</button> :
              <button aria-label={`Reopen ${entry.name} as draft`} disabled={busy || request.loading} className="btn btn-outline-secondary" onClick={() => action(entry, 'reopen')}>Reopen as draft</button>}
            {entry.isPublic && <Link to={`/app/items/${entry.id}`}>Public listing</Link>}
          </div>
        </li>)}</ul>
      </section>
      <div hidden={!formVisible}>
        {data.items.length > 0 && !item && <button className="btn btn-outline-secondary" onClick={() => { setAdding(false); itemsHeading.current?.focus(); }}>Back to items</button>}
        <ItemForm key={`${user.id}:${planId}:${item?.id || 'new'}:${item?.version || 0}:${sequence}`} plan={data.plan} item={item}
          onSave={save} onCancel={() => { setEditor(null); setAdding(false); itemsHeading.current?.focus(); }}
          focusName={formVisible && !item && (adding || sequence > 0)} disabled={busy || request.loading} />
      </div>
    </>}
  </main>;
}
