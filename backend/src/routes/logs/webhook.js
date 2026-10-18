const config = require('../../config');
const { logger } = require('../../middleware/logger');

function register(router) {
  // Webhook ingestion for log sources (text/plain, JSON array, NDJSON)
  router.post('/ingest/webhook/:sourceId', async (req, res) => {
    const { sourceId } = req.params;
    const apiKey = req.headers['x-api-key'] || req.query.apiKey || '';
    try {
      const sourceManager = require('../../services/SourceManager');
      if (!sourceManager.validateWebhookKey(sourceId, apiKey)) {
        return res.status(401).json({ error: 'Invalid API key' });
      }

      // Read raw body manually (express.json doesn't parse text/plain), capped at maxFileSize
      const ct = (req.headers['content-type'] || '').toLowerCase();
      let body = req.body;
      const maxBytes = config.upload.maxFileSize;
      const declaredLen = parseInt(req.headers['content-length'], 10);
      if (Number.isFinite(declaredLen) && declaredLen > maxBytes) {
        return res.status(413).json({ error: 'Payload too large' });
      }
      const shouldReadRaw = ct.includes('text') || ct.includes('octet-stream') || !ct ||
        (typeof req.body === 'object' && !Array.isArray(req.body) && Object.keys(req.body).length === 0);
      if (shouldReadRaw) {
        body = await new Promise((resolve, reject) => {
          let data = '';
          let size = 0;
          req.on('data', chunk => {
            size += chunk.length;
            if (size > maxBytes) {
              const e = new Error('Payload too large');
              e.statusCode = 413;
              e.isOperational = true;
              req.destroy();
              reject(e);
              return;
            }
            data += chunk;
          });
          req.on('end', () => resolve(data || req.body || ''));
          req.on('error', reject);
        });
      }

      const result = await sourceManager.handleWebhookPayload(sourceId, body, req.ip);
      res.json({ success: true, ...result });
    } catch (err) {
      if (res.writableEnded || res.destroyed) return;
      if (err.statusCode === 413 || err.status === 413) {
        return res.status(413).json({ error: 'Payload too large' });
      }
      logger.error(`Webhook ingest failed for source ${sourceId}:`, err.message);
      if (err.isOperational) {
        return res.status(err.statusCode || 400).json({ error: err.message });
      }
      res.status(500).json({ error: 'Webhook ingestion failed' });
    }
  });
}

module.exports = { register };
