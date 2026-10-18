const { store, analysisCache } = require('./shared');

function register(router) {
  /* ----- Server-side analysis cache ----- */

  // Endpoint to clear server-side analysis cache and optionally drop parsed logs for a file
  router.post('/cache/clear', (req, res) => {
    try {
      const { fileId, clearParsed } = req.body || {};
      analysisCache.clear();
      if (fileId && store.has(fileId) && clearParsed) {
        const rec = store.get(fileId);
        rec.parsedLogs = [];
        rec.patterns = [];
        rec.anomalies = [];
        rec.entities = {};
      }
      return res.json({ cleared: true });
    } catch (err) {
      return res.status(500).json({ error: 'Failed to clear cache' });
    }
  });
}

module.exports = { register };
