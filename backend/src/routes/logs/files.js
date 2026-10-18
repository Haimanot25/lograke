const db = require('../../db');
const { logger } = require('../../middleware/logger');
const { toEpochMs } = require('../../utils/time');
const { store, analysisCache } = require('./shared');

/**
 * SQL-based timeBuckets — no need to load all logs into memory.
 */
function buildTimeBucketsFromDB(fileId, bucketCount = 24) {
  const logRows = db.prepare(`
    SELECT logTimestamp, level FROM logs WHERE fileId = ?
  `).all(fileId);

  if (!logRows.length) return [];

  let min = Infinity, max = -Infinity;
  for (const log of logRows) {
    const t = toEpochMs(log.logTimestamp);
    if (isNaN(t)) continue;
    if (t < min) min = t;
    if (t > max) max = t;
  }
  if (min === Infinity || max === -Infinity) return [];

  const span = Math.max(max - min, 1);

  const buckets = Array.from({ length: bucketCount }, (_, idx) => ({
    index: idx,
    label: new Date(min + ((idx / bucketCount) * span)).toISOString().slice(0, 16).replace('T', ' '),
    info: 0,
    warn: 0,
    error: 0,
    total: 0
  }));

  for (const log of logRows) {
    const ts = toEpochMs(log.logTimestamp);
    if (isNaN(ts)) continue;
    let bucketIndex = Math.floor(((ts - min) / span) * bucketCount);
    if (bucketIndex >= bucketCount) bucketIndex = bucketCount - 1;
    const bucket = buckets[bucketIndex];
    bucket.total++;
    const level = String(log.level || 'info').toLowerCase();
    if (level === 'error' || level === 'fatal') bucket.error++;
    else if (level === 'warn' || level === 'warning') bucket.warn++;
    else bucket.info++;
  }

  return buckets;
}

function register(router) {
  // 3. Get list of files
  router.get('/files', (req, res) => {
    res.json({ files: store.getMetadataList() });
  });

  // 3.5 Get file metadata summary without full parsed logs
  router.get('/:fileId/metadata', (req, res) => {
    const { fileId } = req.params;
    const metadata = store.getMetadata(fileId);
    if (!metadata) {
      return res.status(404).json({ error: 'File not found' });
    }

    const timeBuckets = buildTimeBucketsFromDB(fileId);

    res.json({
      success: true,
      metadata: {
        ...metadata,
        timeBuckets
      }
    });
  });

  // Delete a file and its historical analysis data
  router.delete('/:fileId', (req, res) => {
    const { fileId } = req.params;
    if (!store.has(fileId)) {
      return res.status(404).json({ error: 'File not found' });
    }

    try {
      store.delete(fileId);
      analysisCache.delete(fileId); // don't leave a phantom entry behind
      res.json({ success: true, deleted: fileId });
    } catch (err) {
      logger.error(`Failed to delete file ${fileId}:`, err);
      res.status(500).json({ error: 'Failed to delete file' });
    }
  });

  // 4. Get full file details (excludes parsedLogs to prevent large payloads)
  router.get('/:fileId', (req, res) => {
    const { fileId } = req.params;
    const record = store.get(fileId);
    if (!record) {
      return res.status(404).json({ error: 'File not found' });
    }
    const { parsedLogs, alerts, rules, ...summary } = record;
    res.json({ success: true, file: summary });
  });
}

module.exports = { register };
