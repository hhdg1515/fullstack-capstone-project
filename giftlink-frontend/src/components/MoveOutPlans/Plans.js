import React from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { apiRequest } from '../../api/client';
import { useAppContext } from '../../context/AuthContext';
import PlanForm, { statusLabels } from './PlanForm';
import usePlansData from './usePlansData';
import { formatDeadline } from './dates';
import './Plans.css';

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
  return <main className="plans-page">
    <div className="plan-page-header"><h1>My move-out plans</h1><Link className="btn btn-primary" to="/app/plans/new">Create a plan</Link></div>
    <p>Keep your move-out deadline and the items you want to give away organized in one plan.</p>
    <LoadState request={request} />
    {request.data?.plans.length === 0 && <section className="plan-panel">
      <h2>Your next move starts here</h2><p>You have no move-out plans yet. Create a plan now; you can start before adding any items.</p>
      <Link to="/app/plans/new">Create your first plan</Link>
    </section>}
    {request.data?.plans.length > 0 && <ul className="plans-grid">
      {request.data.plans.map(plan => <li className="plan-panel" key={plan.id}>
        <h2><Link to={`/app/plans/${plan.id}`}>{heading(plan)}</Link></h2>
        <p>{plan.neighborhood}, {plan.city}</p>
        <p>Move out by <time dateTime={plan.moveOutDeadline}>{formatDeadline(plan.moveOutDeadline)}</time></p>
        <span className="plan-status">{statusLabels[plan.status]}</span>
      </li>)}
    </ul>}
  </main>;
}

export function CreatePlan() {
  const navigate = useNavigate();
  const { user } = useAppContext();
  const save = async details => {
    const data = await apiRequest(base, { method: 'POST', body: details });
    navigate(`/app/plans/${data.plan.id}`, { replace: true, state: { message: 'Plan created.' } });
  };
  return <main className="plans-page"><Link to="/app/plans">My plans</Link>
    <h1>Create move-out plan</h1><p>One plan for your move and the household items you’ll give away.</p>
    <PlanForm key={user.id} onSave={save} />
  </main>;
}

export function PlanDetail() {
  const { planId } = useParams();
  const request = usePlansData(`${base}/${encodeURIComponent(planId)}`);
  const { state } = useLocation();
  const plan = request.data?.plan;
  return <main className="plans-page"><Link to="/app/plans">My plans</Link>
    <LoadState request={request} />
    {plan && <>
      <div className="plan-page-header"><h1>{heading(plan)}</h1><Link className="btn btn-outline-primary" to={`/app/plans/${plan.id}/edit`}>Edit plan</Link></div>
      <p><Link className="btn btn-primary" to={`/app/plans/${plan.id}/items`}>Manage items</Link></p>
      {['Plan created.', 'Plan updated.'].includes(state?.message) && <p role="status">{state.message}</p>}
      <section className="plan-panel" aria-label="Plan details">
        <dl className="plan-details">
          <dt>Move-out deadline</dt><dd><time dateTime={plan.moveOutDeadline}>{formatDeadline(plan.moveOutDeadline)}</time></dd>
          <dt>City</dt><dd>{plan.city}</dd><dt>Neighborhood</dt><dd>{plan.neighborhood}</dd>
          <dt>Status</dt><dd>{statusLabels[plan.status]}</dd>
        </dl>
        <p>Only you can see this plan. It brings your move and the items you want to give away together.</p>
      </section>
    </>}
  </main>;
}

export function EditPlan() {
  const { planId } = useParams();
  const navigate = useNavigate();
  const request = usePlansData(`${base}/${encodeURIComponent(planId)}`);
  const plan = request.data?.plan;
  const save = async details => {
    const data = await apiRequest(`${base}/${encodeURIComponent(planId)}`, { method: 'PATCH', body: details });
    navigate(`/app/plans/${data.plan.id}`, { replace: true, state: { message: 'Plan updated.' } });
  };
  return <main className="plans-page"><Link to="/app/plans">My plans</Link><h1>Edit move-out plan</h1>
    <LoadState request={request} />
    {plan && <PlanForm key={plan.id} initialPlan={plan} onSave={save} />}
  </main>;
}
