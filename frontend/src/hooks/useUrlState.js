import { useSearchParams } from 'react-router-dom';
import { useCallback, useMemo } from 'react';

export function useUrlState(key, defaultValue = '') {
  const [searchParams, setSearchParams] = useSearchParams();

  const value = useMemo(() => {
    const raw = searchParams.get(key);
    if (raw === null) return defaultValue;
    try { return JSON.parse(raw); } catch { return raw; }
  }, [searchParams, key, defaultValue]);

  const setValue = useCallback((newValue) => {
    setSearchParams(prev => {
      const next = new URLSearchParams(prev);
      const val = typeof newValue === 'function' ? newValue(value) : newValue;
      if (val === defaultValue || val === '' || val === null || val === undefined) {
        next.delete(key);
      } else {
        next.set(key, typeof val === 'string' ? val : JSON.stringify(val));
      }
      return next;
    }, { replace: true });
  }, [key, defaultValue, value, setSearchParams]);

  return [value, setValue];
}