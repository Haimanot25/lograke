const QUEUE_KEY = 'lograke-error-queue';
const MAX_QUEUE = 50;

function getQueue() {
  try { return JSON.parse(sessionStorage.getItem(QUEUE_KEY) || '[]'); } catch { return []; }
}

function setQueue(q) {
  try { sessionStorage.setItem(QUEUE_KEY, JSON.stringify(q.slice(-MAX_QUEUE))); } catch { /* ignore storage quota errors */ }
}

// Captures an error into a capped session queue (inspectable in devtools)
// and logs it in development. There is intentionally no network flush —
// the backend has no client-error ingestion endpoint.
export function captureError(error, context = {}) {
  const entry = {
    ts: new Date().toISOString(),
    message: error?.message || String(error),
    stack: error?.stack || '',
    url: location.href,
    ...context,
  };

  if (import.meta.env.DEV) {
    console.groupCollapsed('[ErrorCapture]', entry.message);
    console.error(error);
    console.log('context:', context);
    console.groupEnd();
  }

  const queue = getQueue();
  queue.push(entry);
  setQueue(queue);
}

export function installGlobalHandlers() {
  window.onerror = (message, source, lineno, colno, error) => {
    captureError(error || new Error(String(message)), { source, lineno, colno, type: 'onerror' });
  };
  window.addEventListener('unhandledrejection', (event) => {
    captureError(event.reason || new Error('Unhandled Promise Rejection'), { type: 'unhandledrejection' });
  });
}