import React from 'react';

export default function RegionFields({ directory, values, onChange, validation, prefix = 'region', browsing = false, fieldClassName = 'plan-field', showHelp = true }) {
  const states = directory.data?.states || [], metros = directory.data?.metros || [];
  const choices = metros.filter(metro => metro.stateIds.includes(values.stateId));
  const changeState = event => onChange({ stateId: event.target.value, metroId: '' });
  return <>
    {directory.loading && <p role="status">Loading region options…</p>}
    {directory.error && <p role="alert">Region options are unavailable. <button type="button" onClick={directory.retry}>Retry region options</button></p>}
    <div className={fieldClassName}><label htmlFor={`${prefix}-state`}>State</label>
      <select id={`${prefix}-state`} name="stateId" value={values.stateId} onChange={changeState} disabled={directory.loading || Boolean(directory.error)} {...validation?.fieldProps('stateId')}>
        <option value="">{browsing ? 'Choose a state' : 'Not assigned'}</option>{states.map(state => <option value={state.id} key={state.id}>{state.label}</option>)}
      </select>{validation?.errors.stateId && <p id="stateId-error" className="plan-field-error">{validation.errors.stateId}</p>}</div>
    <div className={fieldClassName}><label htmlFor={`${prefix}-metro`}>Metro area</label>
      <select id={`${prefix}-metro`} name="metroId" value={values.metroId} onChange={event => onChange({ metroId: event.target.value })}
        disabled={!values.stateId || directory.loading || Boolean(directory.error)} {...validation?.fieldProps('metroId')}>
        <option value="">{browsing ? 'Choose a listed metro' : 'Area not listed / not assigned'}</option>{choices.map(metro => <option value={metro.id} key={metro.id}>{metro.label}</option>)}
      </select>{validation?.errors.metroId && <p id="metroId-error" className="plan-field-error">{validation.errors.metroId}</p>}</div>
    {showHelp && <small>Curated metro coverage uses {directory.data?.vintage?.metros || 'dated'} Census definitions. City and neighborhood labels stay separate; no address or browser location is collected.</small>}
    {values.stateId && !choices.length && directory.data && <p>No metros are listed for this state yet.</p>}
  </>;
}
