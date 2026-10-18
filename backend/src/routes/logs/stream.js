const { liveClients, store } = require('./shared');

function register(router) {
  // ─── SSE /stream endpoint ──────────────────────────────────────────────────
  router.get('/stream', (req, res) => {
    const { fileId } = req.query;

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    const heartbeat = setInterval(() => {
      res.write(': heartbeat\n\n');
    }, 25000);

    if (liveClients.length >= 100) {
      // Evict the oldest client — close its response so its heartbeat
      // interval and socket are cleaned up instead of leaking.
      const evicted = liveClients.shift();
      try { evicted.res.end(); } catch { /* already closed */ }
    }
    const client = { res, fileId: fileId || null };
    liveClients.push(client);

    if (fileId) {
      const record = store.get ? store.get(fileId) : null;
      if (record && record.parsedLogs && record.parsedLogs.length > 0) {
        const recent = record.parsedLogs.slice(-50);
        recent.forEach(log => {
          res.write(`data: ${JSON.stringify(log)}\n\n`);
        });
      }
    }

    req.on('close', () => {
      clearInterval(heartbeat);
      const idx = liveClients.indexOf(client);
      if (idx !== -1) liveClients.splice(idx, 1);
    });
  });
}

module.exports = { register };
