const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { authorizeFileAccess } = require('./logs/shared');
const { processLogFile } = require('./logs/ingest');

const stream = require('./logs/stream');
const cache = require('./logs/cache');
const graph = require('./logs/graph');
const ingest = require('./logs/ingest');
const query = require('./logs/query');
const analysis = require('./logs/analysis');
const alerts = require('./logs/alerts');
const ai = require('./logs/ai');
const tags = require('./logs/tags');
const exportRoutes = require('./logs/export');
const webhook = require('./logs/webhook');
const files = require('./logs/files');

const router = express.Router();

// Webhook ingest validates its own X-API-Key; everything else requires auth
router.use((req, res, next) => {
  if (req.path.startsWith('/ingest/webhook/')) return next();
  return requireAuth(req, res, next);
});
// Apply file access authorization to all /:fileId routes
router.use('/:fileId', authorizeFileAccess);

// Mount order matters: concrete paths before parameterized ones.
stream.register(router);
cache.register(router);
graph.register(router);
ingest.register(router);
query.register(router);
analysis.register(router);
alerts.register(router);
ai.register(router);
tags.register(router);
exportRoutes.register(router);
webhook.register(router);
files.register(router); // GET /:fileId must be last — it would swallow /metrics, /files, /ai/health otherwise

// Back-compat for logSources.js which calls router.processLogFile(...)
router.processLogFile = processLogFile;

module.exports = router;
