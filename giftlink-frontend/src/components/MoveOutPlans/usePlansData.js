import { useEffect, useState } from 'react';
import { apiRequest } from '../../api/client';
import { useAppContext } from '../../context/AuthContext';

export default function usePlansData(path) {
  const { user } = useAppContext();
  const key = `${user.id}:${path}`;
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState({});
  useEffect(() => {
    let active = true;
    setState({ key, loading: true });
    apiRequest(path).then(data => {
      if (active) setState({ key, data, loading: false });
    }).catch(error => {
      if (active) setState({ key, error, loading: false });
    });
    return () => { active = false; };
  }, [key, path, attempt]);
  // Do not display the previous account's data during a session/account switch.
  return { ...(state.key === key ? state : { loading: true }), retry: () => setAttempt(value => value + 1) };
}
