const QUEUE_KEY = 'lograke-error-queue';
const FLUSH_INTERVAL = 30000;
const MAX_QUEUE = 50;

function getQueue() {
  try { return JSON.parse(sessionStorage.getItem(QUEUE_KEY) || '[]'); } catch { return []; }
}

function setQueue(q) {
  try { sessionStorage.setItem(QUEUE_KEY, JSON.stringify(q.slice(-MAX_QUEUE))); } catch { /* ignore storage quota errors */ }
}

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

export async function flushErrorQueue() {
  const queue = getQueue();
  if (!queue.length) return;
  try {
    await fetch('/api/logs/client-error', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ errors: queue }),
    });
    setQueue([]);
  } catch { /* best-effort flush; queue will retry later */ }
}

let flushTimer = null;
export function startErrorReporting() {
  if (flushTimer) return;
  flushTimer = setInterval(flushErrorQueue, FLUSH_INTERVAL);
  window.addEventListener('beforeunload', flushErrorQueue);
}

export function stopErrorReporting() {
  if (flushTimer) { clearInterval(flushTimer); flushTimer = null; }
  window.removeEventListener('beforeunload', flushErrorQueue);
}

export function installGlobalHandlers() {
  window.onerror = (message, source, lineno, colno, error) => {
    captureError(error || new Error(String(message)), { source, lineno, colno, type: 'onerror' });
  };
  window.addEventListener('unhandledrejection', (event) => {
    captureError(event.reason || new Error('Unhandled Promise Rejection'), { type: 'unhandledrejection' });
  });
}