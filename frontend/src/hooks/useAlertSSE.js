import { useEffect, useRef, useCallback } from 'react';
import { API_BASE } from '../config';

export function useAlertSSE(onAlert) {
  const eventSourceRef = useRef(null);
  const onAlertRef = useRef(onAlert);
  useEffect(() => {
    onAlertRef.current = onAlert;
  });

  const connect = useCallback(function connectImpl() {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
    }

    const url = `${API_BASE}/notifications/stream`;
    const es = new EventSource(url, { withCredentials: true });
    eventSourceRef.current = es;

    es.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'alert' && onAlertRef.current) {
          onAlertRef.current(data);
        }
      } catch (err) { console.warn('[SSE] Failed to parse event data:', err); }
    };

    es.onerror = () => {
      es.close();
      setTimeout(connectImpl, 5000);
    };
  }, []);

  useEffect(() => {
    connect();
    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
      }
    };
  }, [connect]);
}
