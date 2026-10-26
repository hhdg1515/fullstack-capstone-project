import { useEffect, useState } from 'react';
import { apiRequest } from './client';
const named = entry => entry && typeof entry.id === 'string' && typeof entry.label === 'string';
const validCatalog = (path, data) => path === '/api/regions' ?
  Array.isArray(data.states) && data.states.every(named) && Array.isArray(data.metros) && data.metros.every(entry => named(entry) &&
    Array.isArray(entry.stateIds) && entry.stateIds.every(id => typeof id === 'string') && (entry.suggestedTimeZone == null || typeof entry.suggestedTimeZone === 'string')) :
  Array.isArray(data.categories) && data.categories.every(entry => named(entry) && Array.isArray(entry.itemTypes) && entry.itemTypes.every(named)) &&
  Array.isArray(data.conditions) && data.conditions.every(named);

export default function usePublicCatalog(path) {
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState({});
  useEffect(() => {
    let active = true;
    setState({ key: path, loading: true });
    apiRequest(path, { validate: data => validCatalog(path, data) })
      .then(data => { if (active) setState({ key: path, data }); })
      .catch(error => { if (active) setState({ key: path, error }); });
    return () => { active = false; };
  }, [path, attempt]);
  return { ...(state.key === path ? state : { loading: true }), retry: () => setAttempt(value => value + 1) };
}
