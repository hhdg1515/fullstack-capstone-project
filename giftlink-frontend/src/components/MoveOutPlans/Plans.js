import React from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { apiRequest } from '../../api/client';
import { confirmPickupChanges } from '../../api/confirmPickupChanges';
import { useAppContext } from '../../context/AuthContext';
import PlanForm, { statusLabels } from './PlanForm';
import usePlansData from './usePlansData';
import { formatDeadline } from './dates';
import './Plans.css';
import JourneyNav from '../Journeys/JourneyNav';
import { Feedback, PageHeader, Surface } from '../../design-system/primitives';
import './MyPlans.css';

const base = '/api/move-out-plans';
const heading = plan => plan.title || `Move-out in ${plan.neighborhood}`;
function LoadState({ request }) {
  if (request.loading) return <p role="status">Loading your plans…</p>;
  if (request.error) return <div role="alert">
    <p>{request.error.status === 404 ? 'This plan is unavailable.' : request.error.message}</p>
    {request.error.status !== 404 && <button className="btn btn-outline-secondary" onClick={request.retry}>Retry</button>}
  </div>;
  return null;
}

export function MyPlans() {
  const request = usePlansData(base);
  return <main className="ui-page my-plans-page">
    <JourneyNav journey="give" />
    <PageHeader title="My move-out plans" description="Choose a plan to manage items and pickups."
      action={request.data?.plans.length > 0 && <Link className="ui-button" to="/app/plans/new">Create a plan</Link>} />
    {request.loading && <Feedback>Loading your plans…</Feedback>}
    {request.error && <Feedback error><p>{request.error.message}</p><button className="ui-button ui-button--secondary" onClick={request.retry}>Retry</button></Feedback>}
    {request.data?.plans.length === 0 && <Surface className="ui-empty" aria-labelledby="plans-empty-title">
      <h2 id="plans-empty-title">No plans yet</h2><p>You have no move-out plans yet. Set a deadline and location. Add items when you’re ready.</p>
      <Link className="ui-button" to="/app/plans/new">Create your first plan</Link>
    </Surface>}
    {request.data?.plans.length > 0 && <ul className="ui-plan-list" aria-label="Move-out plans">
      {request.data.plans.map(plan => <Surface as="li" className="ui-plan-card" key={plan.id}>
        <div className="ui-plan-card-header"><h2><Link to={`/app/plans/${plan.id}`}>{heading(plan)}</Link></h2>
          <span className="ui-status">{statusLabels[plan.status]}</span></div>
        <p className="ui-plan-location">{plan.neighborhood}, {plan.city}</p>
        <p className="ui-plan-deadline">Move out by <time dateTime={plan.moveOutDeadline}>{formatDeadline(plan.moveOutDeadline)}</time></p>
        <Link className="ui-button ui-button--secondary" to={`/app/plans/${plan.id}/items`}>Manage items &amp; clearance progress</Link>
      </Surface>)}
    </ul>}
  </main>;
}

export function CreatePlan() {
  const navigate = useNavigate();
  const { user } = useAppContext();
  const save = async (details, committed) => {
    const data = await apiRequest(base, { method: 'POST', body: details });
    committed?.();
    navigate(`/app/plans/${data.plan.id}`, { replace: true, state: { message: 'Plan created.' } });
  };
  return <main className="ui-page"><JourneyNav journey="give" />
    <PageHeader title="Create move-out plan" description="One plan for your move and the items you’ll give away." />
    <PlanForm key={user.id} onSave={save} />
  </main>;
}

export function PlanDetail() {
  const { planId } = useParams();
  const request = usePlansData(`${base}/${encodeURIComponent(planId)}`);
  const { state } = useLocation();
  const plan = request.data?.plan;
  return <main className="plans-page"><JourneyNav journey="give" planId={plan?.id} />
    <LoadState request={request} />
    {plan && <>
      <div className="plan-page-header"><h1>{heading(plan)}</h1><Link className="btn btn-outline-primary" to={`/app/plans/${plan.id}/edit`}>Edit plan</Link></div>
      <p><Link className="btn btn-primary" to={`/app/plans/${plan.id}/items`}>Manage items</Link></p>
      {['Plan created.', 'Plan updated.'].includes(state?.message) && <p role="status">{state.message}</p>}
      <section className="plan-panel" aria-label="Plan details">
        <dl className="plan-details">
          <dt>Move-out deadline</dt><dd><time dateTime={plan.moveOutDeadline}>{formatDeadline(plan.moveOutDeadline)}</time></dd>
          <dt>City</dt><dd>{plan.city}</dd><dt>Neighborhood</dt><dd>{plan.neighborhood}</dd>
          <dt>Metro region</dt><dd>{plan.metroLabel || 'Not assigned. Edit the plan to include its items in metro discovery.'}</dd>
          <dt>Status</dt><dd>{statusLabels[plan.status]}</dd>
          <dt>Pickup timezone</dt><dd>{plan.pickupTimeZone || 'Set a timezone in Edit plan to receive pickup requests.'}</dd>
        </dl>
        <p>Only you can see this plan. It brings your move and the items you want to give away together.</p>
      </section>
    </>}
  </main>;
}

export function EditPlan() {
  const { planId } = useParams();
  const { state } = useLocation();
  const navigate = useNavigate();
  const request = usePlansData(`${base}/${encodeURIComponent(planId)}`);
  const plan = request.data?.plan;
  const save = async (details, committed) => {
    const data = await confirmPickupChanges(`${base}/${encodeURIComponent(planId)}`, { method: 'PATCH', body: details });
    committed?.();
    navigate(`/app/plans/${data.plan.id}`, { replace: true, state: { message: 'Plan updated.' } });
  };
  return <main className="ui-page"><JourneyNav journey="give" planId={plan?.id} /><PageHeader title="Edit move-out plan" />
    <LoadState request={request} />
    {plan && <PlanForm key={plan.id} initialPlan={plan} onSave={save} focusPickupTimeZone={state?.focusPickupTimeZone === true} />}
  </main>;
}
