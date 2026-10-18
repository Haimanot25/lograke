import { useState, useEffect, useMemo } from 'react';
import { API_BASE } from '../config';

/**
 * Fetch one or more JSON endpoints for the active file, in parallel.
 *
 * `buildPaths(fileId)` returns an array of API paths relative to API_BASE.
 * It may be an inline arrow — the hook re-fetches only when the fileId or
 * the serialized paths actually change.
 *
 * Returns { results, loading, error }: `results` is the array of parsed
 * responses in path order, `null` while loading or on error.
 */
export function useChartData(fileId, buildPaths) {
  const key = useMemo(
    () => JSON.stringify(fileId ? buildPaths(fileId) : []),
    [fileId, buildPaths]
  );
  const [state, setState] = useState({ results: null, loading: true, error: null });

  useEffect(() => {
    if (!fileId) return undefined;
    const controller = new AbortController();
    const requestPaths = JSON.parse(key);

    setState((s) => ({ ...s, loading: true, error: null })); // eslint-disable-line react-hooks/set-state-in-effect -- intentional fetch-on-change; loading flag mirrors request lifecycle

    Promise.all(
      requestPaths.map((p) =>
        fetch(`${API_BASE}${p}`, { credentials: 'include', signal: controller.signal }).then((r) => {
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          return r.json();
        })
      )
    )
      .then((results) => setState({ results, loading: false, error: null }))
      .catch((err) => {
        if (err.name === 'AbortError') return; // superseded or unmounted
        console.warn('Chart data fetch failed', err);
        setState({ results: null, loading: false, error: err.message });
      });

    return () => controller.abort();
  }, [fileId, key]);

  return state;
}
