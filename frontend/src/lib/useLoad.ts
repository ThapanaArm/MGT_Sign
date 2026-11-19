import { useCallback, useEffect, useRef, useState, type DependencyList } from 'react';
import { errMsg } from './format';

/** Run an async loader on mount / when deps change. Keeps the last data while reloading. */
export function useLoad<T>(fn: () => Promise<T>, deps: DependencyList) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);
  const fnRef = useRef(fn);
  fnRef.current = fn;
  useEffect(() => {
    let off = false;
    setLoading(true); setError('');
    fnRef.current().then(d => { if (!off) setData(d); }).catch(e => { if (!off) setError(errMsg(e)); }).finally(() => { if (!off) setLoading(false); });
    return () => { off = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);
  const reload = useCallback(() => setTick(t => t + 1), []);
  return { data, setData, error, loading, reload };
}
