import { useEffect, useRef, useState } from 'react';
import { apiRequest } from '../../api/client';
import { useAppContext } from '../../context/AuthContext';

export default function usePlansData(path, keepData = false) {
  const { user } = useAppContext();
  const key = `${user.id}:${path}`;
  const currentKey = useRef(key); currentKey.current = key;
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState({});
  useEffect(() => {
    let active = true;
    setState(previous => ({ key, loading: true, data: keepData && previous.key === key ? previous.data : undefined }));
    apiRequest(path, { notifyUnauthorized: false }).then(data => {
      if (active && currentKey.current === key) setState({ key, data, loading: false });
    }).catch(error => {
      if (active && currentKey.current === key) {
        setState(previous => ({ key, error, loading: false, data: keepData && previous.key === key ? previous.data : undefined }));
        if (error.status === 401) window.dispatchEvent(new Event('giftlink:unauthorized'));
      }
    });
    return () => { active = false; };
  }, [key, path, attempt, keepData]);
  // Do not display the previous account's data during a session/account switch.
  return { ...(state.key === key ? state : { loading: true }), retry: () => setAttempt(value => value + 1),
    update: change => setState(previous => previous.key === key ? { ...previous, data: change(previous.data) } : previous) };
}
