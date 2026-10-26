import { useEffect, useState } from 'react';
import { apiRequest } from './client';

export default function usePublicCatalog(path) {
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState({});
  useEffect(() => {
    let active = true;
    setState({ key: path, loading: true });
    apiRequest(path, { validate: data => path === '/api/regions' ? Array.isArray(data.states) && Array.isArray(data.metros) : Array.isArray(data.categories) })
      .then(data => { if (active) setState({ key: path, data }); })
      .catch(error => { if (active) setState({ key: path, error }); });
    return () => { active = false; };
  }, [path, attempt]);
  return { ...(state.key === path ? state : { loading: true }), retry: () => setAttempt(value => value + 1) };
}
