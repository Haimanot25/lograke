const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const config = require('../config');
const db = require('../db');
const FileIngestor = require('../ingestion/FileIngestor');
const { extractLogFiles } = require('../parser/ArchiveHandler');
const { parseLogLine } = require('../parser/AdaptiveParser');
const { canonicalize, resetEpochContext } = require('../ai/Canonicalizer');
const { detectFormat } = require('../parser/EnhancedParser');
const { inferSchema, generateFewShotRegex } = require('../parser/SchemaInferrer');
const { anonymize } = require('../parser/Anonymizer');
const { detectPatterns } = require('../analyzer/PatternDetector');
const { detectAnomalies } = require('../analyzer/AnomalyDetector');
const { detectDuplicates } = require('../analyzer/DedupDetector');
const { groupLines } = require('../parser/MultiLineGrouper');
const { scanTraceableEntities, traceEntity } = require('../analyzer/CorrelationEngine');
const { enrichLogEntry } = require('../analyzer/LogEnricher');
const { filterLogs } = require('../analyzer/QueryEngine');
const { validateBody } = require('../middleware/validate');
const { createRule, deleteRule, getRules, evaluateAlerts } = require('../analyzer/AlertEngine');
const { explainLog, queryLogs, isEnabled, generateCompletionStream, pipeStreamToResponse, sanitizeErrorMessage } = require('../ai/AiService');
const { buildLogContextForAI } = require('../ai/LogChunker');
const { addTag, getTagsForFile } = require('../services/TagService');
const { analyzeChronology, analyzeLogDrift } = require('../analyzer/ChronologicalAnalyzer');
const { uploadLimiter, aiLimiter, checkProviderRateLimit } = require('../middleware/rateLimiter');
const { logger } = require('../middleware/logger');
const { applyParser, getParsers, getParser } = require('../services/CustomParserService');
const { requireAuth } = require('../middleware/auth');
const { toEpochMs } = require('../utils/time');

const router = express.Router();
// Webhook ingest validates its own X-API-Key; everything else requires auth
router.use((req, res, next) => {
  if (req.path.startsWith('/ingest/webhook/')) return next();
  return requireAuth(req, res, next);
});
// Apply file access authorization to all /:fileId routes
router.use('/:fileId', authorizeFileAccess);
const fileIngestor = new FileIngestor();
const store = require('../services/StorageService');

// Wire up SSE emitter to StorageService and global for processLogFile
const sseEmitter = (fileId, logEntry) => {
  liveClients.forEach(client => {
    if (!client.fileId || client.fileId === fileId) {
      client.res.write(`data: ${JSON.stringify(logEntry)}\n\n`);
    }
  });
};
store.setEmitter(sseEmitter);

const analysisCache = new Map();
const CACHE_TTL = 5 * 60 * 1000;

function wrapRoute(fn) {
  return (req, res, next) => {
    try {
      const result = fn(req, res, next);
      if (result && typeof result.catch === 'function') {
        result.catch(err => next(err));
      }
    } catch (err) {
      next(err);
    }
  };
}

// Authorization middleware — checks file ownership when auth is enabled
function authorizeFileAccess(req, res, next) {
  if (!config.auth.enabled) return next();
  const { fileId } = req.params;
  if (!fileId) return next();
  const record = store.get(fileId);
  if (record && record.userId && record.userId !== req.user?.id && req.user?.role !== 'admin') {
    return res.status(403).json({ error: 'Access denied' });
  }
  next();
}

function cacheSet(key, value) {
  if (analysisCache.size >= 50) {
    const oldestKey = analysisCache.keys().next().value;
    analysisCache.delete(oldestKey);
  }
  analysisCache.set(key, { value, timestamp: Date.now() });
}

function cacheGet(key) {
  const entry = analysisCache.get(key);
  if (!entry) return undefined;
  if (Date.now() - entry.timestamp > CACHE_TTL) {
    analysisCache.delete(key);
    return undefined;
  }
  return entry.value;
}

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

// Module-level SSE emitter registry
const liveClients = [];

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

  if (liveClients.length >= 100) liveClients.shift();
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

/* ----- Cache functions defined above (lines 28-46) ----- */

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

/* ----- Visualisation Graph Endpoint ----- */
router.get('/visualisation/graph', wrapRoute((req, res) => {
  const { fileId } = req.query;
  const record = store.get(fileId);
  if (!record) {
    return res.status(404).json({ error: 'File not found' });
  }

  const entityMap = (record.entities && typeof record.entities === 'object' && !Array.isArray(record.entities))
    ? record.entities
    : {};
  const hasStoredEntities = Object.values(entityMap).some(bucket => bucket && typeof bucket === 'object' && Object.keys(bucket).length > 0);
  const effectiveEntityMap = hasStoredEntities ? entityMap : scanTraceableEntities(record.parsedLogs || []);

  // Build node set from structured entity sources only (no raw regex)
  const nodeWeights = {};
  Object.values(effectiveEntityMap).forEach(bucket => {
    if (!bucket || typeof bucket !== 'object') return;
    Object.entries(bucket).forEach(([value, count]) => {
      const id = String(value);
      nodeWeights[id] = (nodeWeights[id] || 0) + count;
    });
  });

  record.parsedLogs.forEach(log => {
    if (log.ids) {
      Object.values(log.ids).forEach(v => {
        if (v) { const id = String(v); nodeWeights[id] = (nodeWeights[id] || 0) + 1; }
      });
    }
    if (log.metadata) {
      Object.entries(log.metadata).forEach(([key, v]) => {
        if (v && String(v).trim()) {
          const id = String(v).trim();
          nodeWeights[id] = (nodeWeights[id] || 0) + 1;
        }
      });
    }
  });

  // Cap at 500 highest-weight nodes to prevent huge payloads
  const MAX_NODES = 500;
  const sortedNodes = Object.entries(nodeWeights)
    .sort((a, b) => b[1] - a[1])
    .slice(0, MAX_NODES);
  const allowedNodeIds = new Set(sortedNodes.map(([id]) => id));
  const nodes = sortedNodes.map(([id, weight]) => ({ id, weight }));

  // Build edges with deduplication and weights (only for allowed nodes)
  const edgeMap = {};
  record.parsedLogs.forEach(log => {
    const ids = log.ids ? Object.values(log.ids) : [];
    const normalized = ids.map(v => String(v)).filter(Boolean);
    if (normalized.length >= 2) {
      for (let i = 0; i < normalized.length - 1; i++) {
        const source = normalized[i];
        const target = normalized[i + 1];
        if (source === target) continue;
        if (!allowedNodeIds.has(source) || !allowedNodeIds.has(target)) continue;
        const key = source < target ? `${source}|||${target}` : `${target}|||${source}`;
        if (!edgeMap[key]) edgeMap[key] = { source, target, weight: 0 };
        edgeMap[key].weight++;
      }
    }
  });

  const edges = Object.values(edgeMap).sort((a, b) => b.weight - a.weight);

  return res.json({ nodes, edges });
}));

/* ----- Cache usage example (optional) ----- */
// Example: cache analysis results for a file to avoid recomputation
router.get('/:fileId/analysis', wrapRoute((req, res) => {
  const { fileId } = req.params;
  const cached = cacheGet(fileId);
  if (cached) {
    return res.json({ cached: true, analysis: cached });
  }
  const record = store.get(fileId);
  if (!record) {
    return res.status(404).json({ error: 'File not found' });
  }
  const analysis = {
    patterns: record.patterns,
    anomalies: record.anomalies,
    entities: record.entities
  };
  cacheSet(fileId, analysis);
  res.json({ cached: false, analysis });
}));

// Multer configuration for file uploads inside the workspace upload dir
const uploadsDir = path.join(__dirname, '../../uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadsDir),
  filename: (req, file, cb) => {
    const safe = (path.basename(file.originalname || '').replace(/[^\w.\-]+/g, '_')).slice(0, 120) || 'upload.log';
    cb(null, `${Date.now()}-${safe}`);
  }
});
const upload = multer({
  storage: storage,
  limits: { fileSize: config.upload.maxFileSize }
});

/**
 * Helper to process and index raw log file contents.
 */
function processLogFile(fileName, rawText, options = {}) {
  const logType = options.logType || 'default';
  const multiLineEDR = options.multiLineEDR === 'true' || options.multiLineEDR === true;
  const parserId = options.parserId || null;
  
  logger.info(`[processLogFile] Starting processing for: ${fileName} (Type: ${logType}, MultiLine: ${multiLineEDR}, Size: ${(rawText.length / 1024).toFixed(2)} KB)`);
  
  const rawLines = rawText.split(/\r?\n/);
  let lines = [];

  if (multiLineEDR && logType === 'cdr') {
    let currentRecord = "";
    const recordPattern = /^record\d+:/;
    for (const line of rawLines) {
      if (recordPattern.test(line)) {
        if (currentRecord) lines.push(currentRecord);
        currentRecord = line;
      } else if (currentRecord) {
        currentRecord += "\n" + line;
      } else if (line.trim()) {
        lines.push(line);
      }
    }
    if (currentRecord) lines.push(currentRecord);
  } else {
    const nonEmpty = rawLines.filter(l => l.trim() !== '');
    const grouped = groupLines(nonEmpty);
    lines = grouped.map(g => g.raw);
  }
  
  // Infer basic schema from a sample
  const sample = lines.slice(0, 100);
  const inferred = inferSchema(sample);
  const detectedFormat = detectFormat(rawText, fileName);
  const anonymizeOptions = options.anonymize || {};

  const parsedLogs = [];
  let indexCounter = 0;
  
  // Consolidated Facets for Enterprise Sidebar
  const levelCounts = { info: 0, warn: 0, error: 0, debug: 0 };
  const facetCounts = {
    service: {},
    host: {},
    category: {},
    environment: {}
  };

  // Check for custom parser matching the logType name
  let customParser = null;
  if (parserId) {
    try { customParser = getParser(parserId); } catch { /* no custom parser */ }
  }
  if (!customParser && logType !== 'default') {
    const allParsers = getParsers(logType);
    customParser = allParsers.find(p => p.name.toLowerCase() === logType.toLowerCase()) || null;
  }

  for (let line of lines) {
    line = anonymize(line, anonymizeOptions);
    let parsed;
    if (customParser) {
      const result = applyParser(customParser, [line]);
      const match = result.records?.[0];
      if (match?.parsed) {
        parsed = {
          timestamp: match.fields.timestamp || new Date().toISOString(),
          level: (match.fields.level || 'INFO').toUpperCase(),
          message: match.fields.message || match.fields.field_1 || line,
          raw: line,
          index: indexCounter,
          ...match.fields
        };
      }
    }
    if (!parsed) {
      parsed = parseLogLine(line, indexCounter, logType);
    }
    if (!parsed) {
      parsed = { raw: line, message: line, level: 'INFO', timestamp: Date.now(), index: indexCounter };
    }

    if (parsed) {
      let enriched;
      try {
        enriched = enrichLogEntry(parsed, { source: options.source || fileName });
      } catch (err) {
        logger.warn(`[processLogFile] Enrich error on line ${indexCounter}: ${err.message}`);
        enriched = { ...parsed, service: 'unknown', host: 'unknown', environment: 'unknown', category: 'general', categories: ['general'], enrichedAt: new Date().toISOString() };
      }
      enriched.tags = [];
      
      // Single-pass Aggregation
      const lvl = enriched.level.toLowerCase();
      if (levelCounts[lvl] !== undefined) levelCounts[lvl]++;
      else levelCounts.info++;

      facetCounts.service[enriched.service] = (facetCounts.service[enriched.service] || 0) + 1;
      facetCounts.host[enriched.host] = (facetCounts.host[enriched.host] || 0) + 1;
      facetCounts.category[enriched.category] = (facetCounts.category[enriched.category] || 0) + 1;
      facetCounts.environment[enriched.environment] = (facetCounts.environment[enriched.environment] || 0) + 1;

      parsedLogs.push(enriched);
      
      // Emit to live tail clients
      if (sseEmitter) {
        sseEmitter(options.source || fileName, enriched);
      }

      indexCounter++;
    }
  }

  logger.info(`[processLogFile] Parsed ${parsedLogs.length} log entries from ${fileName}`);

  // Canonicalize all parsed logs (adds timestampIso, timestampEpochMs, effectiveLevel, etc.)
  resetEpochContext();
  parsedLogs.forEach((log, i) => Object.assign(log, canonicalize(log, i)));

  // Analyze Patterns
  const patterns = detectPatterns(parsedLogs);

  // Analyze Anomalies
  const anomalies = detectAnomalies(parsedLogs, patterns);

  // Detect Duplicates
  const dedupSummary = detectDuplicates(parsedLogs);
  if (dedupSummary.duplicates > 0) {
    logger.info(`[processLogFile] Dedup: ${dedupSummary.duplicates} duplicates found (${dedupSummary.nearUniqueGroups} unique message patterns)`);
  }

  // Scan Traceable Entities
  const entities = scanTraceableEntities(parsedLogs);
  
  // Analyze Chronology / Temporal Analysis
  const chronology = analyzeChronology(parsedLogs, {
    bucketIntervalMinutes: 5,
    anomalyThreshold: 2.0
  });
  
  const sourcePath = options.sourcePath || null;

  const fileId = `file_${crypto.randomUUID().slice(0, 8)}`;
  const fileRecord = {
    id: fileId,
    name: fileName,
    userId: options.userId || null,
    sourcePath,
    linesCount: parsedLogs.length,
    multiLineEDR,
    levelCounts,
    facetCounts,
    healthScore: chronology.healthScore || 100,
    detectedFormat,
    inferredType: inferred.type,
    inferredFields: inferred.fields || [],
    parsedLogs,
    patterns,
    anomalies,
    entities,
    chronology,
    dedupSummary,
    alerts: [],
    timestamp: new Date().toISOString()
  };

  fileRecord.alerts = evaluateAlerts(fileRecord);
  store.set(fileId, fileRecord);
  return fileRecord;
}

// 1. Upload API
router.post('/upload', uploadLimiter, upload.array('file', 20), (req, res) => {
  if (!req.files || req.files.length === 0) {
    return res.status(400).json({ error: 'No files uploaded' });
  }

  try {
    const logType = req.body.logType || 'default';
    const multiLineEDR = req.body.multiLineEDR === 'true';
    const parserId = req.body.parserId || null;
    let anonymizeConfig = {};
    if (req.body.anonymize) {
      try {
        anonymizeConfig = JSON.parse(req.body.anonymize);
      } catch (err) {
        anonymizeConfig = {};
      }
    }

    const results = [];
    for (const file of req.files) {
      const originalName = (path.basename(file.originalname || '').replace(/[^\w.\-]+/g, '_')) || 'upload.log';
      const buffer = fs.readFileSync(file.path);
      const sourcePath = fileIngestor.ingest(buffer, originalName);
      const extractedFiles = extractLogFiles(buffer, originalName, uploadsDir);

      for (const extractedFile of extractedFiles) {
        const record = processLogFile(extractedFile.name, extractedFile.content, {
          anonymize: anonymizeConfig,
          userId: req.user?.id,
          sourcePath,
          logType,
          multiLineEDR,
          parserId
        });
        results.push({
          id: record.id,
          name: record.name,
          linesCount: record.linesCount,
          levelCounts: record.levelCounts,
          inferredType: record.inferredType,
          inferredFields: record.inferredFields,
          timestamp: record.timestamp
        });
      }
    }

    res.json({
      success: true,
      files: results
    });
  } catch (err) {
    logger.error('Upload process failed:', err);
    res.status(500).json({ error: 'File processing failed' });
  }
});

// 2. Raw ingestion API for batch or streaming sources
router.post('/ingest/raw', (req, res) => {
  const { sourceName, lines, rawText, anonymize, logType = 'default', multiLineEDR = false, parserId } = req.body;
  const rawLines = Array.isArray(lines)
    ? lines
    : (typeof rawText === 'string' && rawText.trim() !== '' ? rawText.split(/\r?\n/).filter(line => line.trim()) : []);

  if (rawLines.length === 0) {
    return res.status(400).json({ error: 'lines array or rawText is required and must contain at least one log line' });
  }

  let anonymizeConfig = {};
  if (typeof anonymize === 'string') {
    try {
      anonymizeConfig = JSON.parse(anonymize);
    } catch (err) {
      anonymizeConfig = {};
    }
  } else if (typeof anonymize === 'object' && anonymize !== null) {
    anonymizeConfig = anonymize;
  }

  const source = sourceName || `pasted_log_${Date.now()}.log`;
  try {
    const record = processLogFile(source, rawLines.join('\n'), {
      anonymize: anonymizeConfig,
      userId: req.user?.id,
      sourcePath: null,
      logType,
      multiLineEDR: multiLineEDR === 'true' || multiLineEDR === true,
      parserId
    });
    res.json({
      success: true,
      file: {
        id: record.id,
        name: record.name,
        linesCount: record.linesCount,
        levelCounts: record.levelCounts,
        healthScore: record.healthScore,
        inferredType: record.inferredType,
        inferredFields: record.inferredFields,
        timestamp: record.timestamp
      }
    });
  } catch (err) {
    logger.error('Raw ingest failed:', err);
    res.status(500).json({ error: 'Raw ingestion failed' });
  }
});

// 3. Few-shot parser configuration
router.post('/few-shot-configure', validateBody({
  sampleLine: { required: true, type: 'string', minLength: 1 },
  selections: { required: true, type: 'object' }
}), (req, res) => {
  const { sampleLine, selections } = req.body;
  if (!sampleLine || !selections) {
    return res.status(400).json({ error: 'Missing sampleLine or selections' });
  }

  try {
    const regexPattern = generateFewShotRegex(sampleLine, selections);
    res.json({
      success: true,
      regexPattern
    });
  } catch (err) {
    res.status(500).json({ error: 'Regex inference failed' });
  }
});

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
    res.json({ success: true, deleted: fileId });
  } catch (err) {
    logger.error(`Failed to delete file ${fileId}:`, err);
    res.status(500).json({ error: 'Failed to delete file' });
  }
});

// 4. Get full file details (excludes parsedLogs to prevent large payloads)
// METRICS ENDPOINTS — must be above /:fileId to avoid route swallowing
router.get('/metrics', (req, res) => {
  const db = require('../db');
  const summary = { totalFiles: 0, totalLogs: 0, levelCounts: { info: 0, warn: 0, error: 0, debug: 0 }, tagCounts: {} };
  
  const fileStats = db.prepare('SELECT SUM(linesCount) as totalLogs, COUNT(*) as totalFiles FROM files').get();
  summary.totalFiles = fileStats.totalFiles || 0;
  summary.totalLogs = fileStats.totalLogs || 0;
  
  const levels = db.prepare('SELECT level, COUNT(*) as count FROM logs GROUP BY level').all();
  levels.forEach(row => {
    const lvl = (row.level || 'info').toLowerCase();
    if (summary.levelCounts[lvl] !== undefined) summary.levelCounts[lvl] += row.count;
  });
  
  const allTags = db.prepare('SELECT tags FROM logs WHERE tags IS NOT NULL AND tags != "[]"').all();
  allTags.forEach(row => {
    try {
      JSON.parse(row.tags).forEach(tag => {
        const t = tag.toLowerCase();
        summary.tagCounts[t] = (summary.tagCounts[t] || 0) + 1;
      });
    } catch { /* tag parsing is best-effort */ }
  });
  
  res.json({ success: true, metrics: summary });
});

router.get('/metrics/:type', (req, res) => {
  const { type } = req.params;
  switch (type) {
    case 'files':
      return res.json({ files: store.getMetadataList().map(r => ({ id: r.id, name: r.name, linesCount: r.linesCount })) });
    case 'levels':
    case 'tags': {
      const summary = { totalFiles: 0, totalLogs: 0, levelCounts: { info: 0, warn: 0, error: 0, debug: 0 }, tagCounts: {} };
      const files = store.getMetadataList();
      files.forEach(record => {
        summary.totalFiles++;
        summary.totalLogs += record.linesCount || 0;
        Object.entries(record.levelCounts || {}).forEach(([lvl, cnt]) => {
          if (summary.levelCounts[lvl] !== undefined) summary.levelCounts[lvl] += cnt;
        });
      });
      if (type === 'levels') return res.json({ levelCounts: summary.levelCounts });
      
      const db = require('../db');
      const allTags = db.prepare('SELECT tags FROM logs WHERE tags IS NOT NULL AND tags != "[]"').all();
      allTags.forEach(row => {
        try {
          JSON.parse(row.tags).forEach(tag => {
            const t = tag.toLowerCase();
            summary.tagCounts[t] = (summary.tagCounts[t] || 0) + 1;
          });
        } catch { /* tag parsing is best-effort */ }
      });
      return res.json({ tagCounts: summary.tagCounts });
    }
    default:
      return res.status(400).json({ error: 'Invalid metric type' });
  }
});

router.get('/:fileId', (req, res) => {
  const { fileId } = req.params;
  const record = store.get(fileId);
  if (!record) {
    return res.status(404).json({ error: 'File not found' });
  }
  const { parsedLogs, alerts, rules, ...summary } = record;
  res.json({ success: true, file: summary });
});

// 5. Query specific file log lines (with filters & search) — SQL-backed
router.get('/:fileId/query', (req, res) => {
  const { fileId } = req.params;
  if (!store.has(fileId)) {
    return res.status(404).json({ error: 'File not found' });
  }

  const { search = '', level = 'all', page = '1', limit = '100' } = req.query;
  const pageNum = Math.max(1, parseInt(page) || 1);
  const limitNum = Math.max(1, Math.min(parseInt(limit) || 100, 1000));
  const offset = (pageNum - 1) * limitNum;

  const conditions = ['fileId = ?'];
  const params = [fileId];

  if (level !== 'all') {
    conditions.push('level = ?');
    params.push(level.toUpperCase());
  }

  if (search.trim() !== '') {
    const like = `%${search}%`;
    conditions.push('(message LIKE ? OR raw LIKE ? OR metadata LIKE ? OR ids LIKE ?)');
    params.push(like, like, like, like);
  }

  const whereSQL = conditions.join(' AND ');

  const countRow = db.prepare(`SELECT COUNT(*) as total FROM logs WHERE ${whereSQL}`).get(...params);
  const total = countRow ? countRow.total : 0;

  const rows = db.prepare(`SELECT * FROM logs WHERE ${whereSQL} ORDER BY logIndex ASC LIMIT ? OFFSET ?`).all(...params, limitNum, offset);

  const logs = rows.map(row => ({
    index:          row.logIndex,
    timestamp:      row.logTimestamp,
    level:          row.level,
    message:        row.message,
    raw:            row.raw,
    service:        row.service || '',
    host:           row.host || '',
    category:       row.category || '',
    environment:    row.environment || '',
    metadata:       JSON.parse(row.metadata || '{}'),
    ids:            JSON.parse(row.ids || '{}'),
    tags:           JSON.parse(row.tags || '[]')
  }));

  res.json({ total, page: pageNum, limit: limitNum, logs });
});

// 5. Search using DSL / advanced query syntax — SQL pre-filtered then in-memory DSL
router.post('/:fileId/query-dsl', (req, res) => {
  const { fileId } = req.params;
  const { query = '', page = 1, limit = 100, level = 'all' } = req.body;
  const record = store.get(fileId);
  if (!record) {
    return res.status(404).json({ error: 'File not found' });
  }

  // Pre-filter by level using SQL to reduce memory pressure
  let filtered;
  if (level !== 'all') {
    const rows = db.prepare('SELECT logIndex FROM logs WHERE fileId = ? AND level = ?').all(fileId, level.toUpperCase());
    const allowedIndexes = new Set(rows.map(r => r.logIndex));
    filtered = record.parsedLogs.filter(log => allowedIndexes.has(log.index));
  } else {
    filtered = record.parsedLogs;
  }

  // Apply DSL predicates in memory on the (potentially reduced) set
  filtered = filterLogs(filtered, query);
  const total = filtered.length;
  const startIndex = (Number(page) - 1) * Number(limit);
  const paginated = filtered.slice(startIndex, startIndex + Number(limit));

  res.json({
    total,
    page: Number(page),
    limit: Number(limit),
    logs: paginated
  });
});

// 6. Get structural patterns (with server-side pagination, search, level filter, sort)
router.get('/:fileId/patterns', (req, res) => {
  const { fileId } = req.params;
  const record = store.get(fileId);
  if (!record) {
    return res.status(404).json({ error: 'File not found' });
  }

  let patterns = record.patterns || [];

  // Level filter
  const level = req.query.level;
  if (level) {
    patterns = patterns.filter(p => p.level === level);
  }

  // Text search (template, examples, level)
  const search = (req.query.search || '').trim().toLowerCase();
  if (search) {
    patterns = patterns.filter(p =>
      p.template.toLowerCase().includes(search) ||
      p.level.toLowerCase().includes(search) ||
      (p.examples || []).some(ex => ex.toLowerCase().includes(search))
    );
  }

  // Sort
  const sortBy = req.query.sortBy || 'count';
  const sortDir = req.query.sortDir === 'asc' ? 1 : -1;
  const LEVEL_ORDER = { FATAL: 0, ERROR: 1, WARN: 2, INFO: 3, DEBUG: 4, TRACE: 5 };
  patterns.sort((a, b) => {
    let cmp = 0;
    if (sortBy === 'count') cmp = a.count - b.count;
    else if (sortBy === 'percentage') cmp = a.percentage - b.percentage;
    else if (sortBy === 'level') cmp = (LEVEL_ORDER[a.level] ?? 99) - (LEVEL_ORDER[b.level] ?? 99);
    else if (sortBy === 'template') cmp = a.template.localeCompare(b.template);
    return cmp * sortDir;
  });

  const total = patterns.length;

  // Pagination
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = Math.min(200, Math.max(1, parseInt(req.query.limit, 10) || 50));
  const start = (page - 1) * limit;
  const paginated = patterns.slice(start, start + limit);

  res.json({ patterns: paginated, total, page, limit });
});

// 6. Get detected anomalies
router.get('/:fileId/anomalies', (req, res) => {
  const { fileId } = req.params;
  const record = store.get(fileId);
  if (!record) {
    return res.status(404).json({ error: 'File not found' });
  }
  res.json({ anomalies: record.anomalies });
});

// 6.5 Get chronological analysis (NEW)
router.get('/:fileId/chronology', (req, res) => {
  try {
    const { fileId } = req.params;
    const { bucketMinutes = 5, anomalyThreshold = 2.0 } = req.query;
    
    const record = store.get(fileId);
    if (!record) {
      return res.status(404).json({ error: 'File not found' });
    }
    
    // Check cache first
    const cacheKey = `chrono_${fileId}_${bucketMinutes}_${anomalyThreshold}`;
    const cached = cacheGet(cacheKey);
    if (cached) {
      return res.json({ cached: true, ...cached });
    }
    
    const chronology = analyzeChronology(record.parsedLogs, {
      bucketIntervalMinutes: parseInt(bucketMinutes),
      anomalyThreshold: parseFloat(anomalyThreshold)
    });
    
    cacheSet(cacheKey, chronology);
    res.json({ cached: false, ...chronology });
  } catch (err) {
    res.status(500).json({ error: 'Failed to analyze chronology' });
  }
});

// 6.6 Get timeline visualization data (NEW)
router.get('/:fileId/timeline', (req, res) => {
  try {
    const { fileId } = req.params;
    const { bucketMinutes = 5 } = req.query;
    
    const record = store.get(fileId);
    if (!record) {
      return res.status(404).json({ error: 'File not found' });
    }
    
    const cacheKey = `timeline_${fileId}_${bucketMinutes}`;
    const cached = cacheGet(cacheKey);
    if (cached) {
      return res.json({ cached: true, ...cached });
    }
    
    const { generateTimeline } = require('../analyzer/ChronologicalAnalyzer');
    const timeline = generateTimeline(record.parsedLogs, parseInt(bucketMinutes));
    
    cacheSet(cacheKey, timeline);
    res.json({ cached: false, ...timeline });
  } catch (err) {
    res.status(500).json({ error: 'Failed to generate timeline' });
  }
});

// 6.7 Get temporal patterns (NEW)
router.get('/:fileId/temporal-patterns', (req, res) => {
  try {
    const { fileId } = req.params;
    
    const record = store.get(fileId);
    if (!record) {
      return res.status(404).json({ error: 'File not found' });
    }
    
    const cacheKey = `temporal_${fileId}`;
    const cached = cacheGet(cacheKey);
    if (cached) {
      return res.json({ cached: true, ...cached });
    }
    
    const { detectTemporalPatterns } = require('../analyzer/ChronologicalAnalyzer');
    const patterns = detectTemporalPatterns(record.parsedLogs);
    
    cacheSet(cacheKey, patterns);
    res.json({ cached: false, ...patterns });
  } catch (err) {
    res.status(500).json({ error: 'Failed to detect temporal patterns' });
  }
});

// 6.8 Get metrics time series (NEW)
router.get('/:fileId/metrics-series', (req, res) => {
  try {
    const { fileId } = req.params;
    const { metric = 'durationMs' } = req.query;
    
    const record = store.get(fileId);
    if (!record) {
      return res.status(404).json({ error: 'File not found' });
    }
    
    const cacheKey = `metrics_${fileId}_${metric}`;
    const cached = cacheGet(cacheKey);
    if (cached) {
      return res.json({ cached: true, ...cached });
    }
    
    const { analyzeMetricsTimeSeries } = require('../analyzer/ChronologicalAnalyzer');
    const series = analyzeMetricsTimeSeries(record.parsedLogs, metric);
    
    cacheSet(cacheKey, series);
    res.json({ cached: false, ...series });
  } catch (err) {
    res.status(500).json({ error: 'Failed to analyze metrics series' });
  }
});

// 7. Get traceable entities list
router.get('/:fileId/entities', wrapRoute((req, res) => {
  const { fileId } = req.params;
  const record = store.get(fileId);
  if (!record) {
    return res.status(404).json({ error: 'File not found' });
  }

  const storedEntities = record.entities && typeof record.entities === 'object' && !Array.isArray(record.entities) ? record.entities : {};
  const hasStoredEntities = Object.values(storedEntities).some(bucket => bucket && typeof bucket === 'object' && Object.keys(bucket).length > 0);
  const entities = hasStoredEntities ? storedEntities : scanTraceableEntities(record.parsedLogs || []);

  if (!hasStoredEntities && record.parsedLogs && record.parsedLogs.length > 0) {
    try {
      store.updateEntities(fileId, entities);
    } catch (err) {
      logger.error(`Failed to persist recomputed entities for ${fileId}:`, err);
    }
  }

  res.json({ entities, source: hasStoredEntities ? 'stored' : 'computed' });
}));

// 8. Trace specific entity (entity correlation)
router.get('/:fileId/trace', wrapRoute((req, res) => {
  const { fileId } = req.params;
  const { val } = req.query;
  const record = store.get(fileId);
  
  if (!record) {
    return res.status(404).json({ error: 'File not found' });
  }
  if (!val) {
    return res.status(400).json({ error: 'Trace value parameter (val) required' });
  }

  const timeline = traceEntity(record.parsedLogs, val);
  res.json({ timeline });
}));

// 9. Aggregations by field for dashboard and fast analytics
router.get('/:fileId/aggregations', wrapRoute((req, res) => {
  const { fileId } = req.params;
  const { field = 'level', top = 20 } = req.query;

  if (!store.has(fileId)) {
    return res.status(404).json({ error: 'File not found' });
  }

  const values = store.getAggregations(fileId, field, Number(top));
  res.json({ field, values });
}));

// 9b. Heatmap data (day-of-week × hour-of-day)
router.get('/:fileId/heatmap', wrapRoute((req, res) => {
  const { fileId } = req.params;
  if (!store.has(fileId)) {
    return res.status(404).json({ error: 'File not found' });
  }

  const rows = db.prepare('SELECT logTimestamp FROM logs WHERE fileId = ? AND logTimestamp IS NOT NULL').all(fileId);

  const matrix = {};
  for (const row of rows) {
    const ms = toEpochMs(row.logTimestamp);
    if (isNaN(ms)) continue;
    const d = new Date(ms);
    const day = (d.getDay() + 6) % 7;
    const hour = d.getHours();
    const key = `${day}:${hour}`;
    matrix[key] = (matrix[key] || 0) + 1;
  }

  const cells = Object.entries(matrix).map(([key, count]) => {
    const [day, hour] = key.split(':').map(Number);
    return { day, hour, count };
  });

  res.json({ cells });
}));

// 10. Saved Queries API
router.get('/queries/saved', (req, res) => {
  try {
    const queries = db.prepare('SELECT * FROM saved_queries ORDER BY timestamp DESC').all();
    res.json({ success: true, queries });
  } catch (err) {
    res.status(500).json({ error: 'Failed to load saved queries' });
  }
});

router.post('/queries/saved', (req, res) => {
  const { name, query } = req.body;
  try {
    const stmt = db.prepare('INSERT INTO saved_queries (id, name, query, timestamp) VALUES (@id, @name, @query, @timestamp)');
    const q = { id: `sq_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`, name, query, timestamp: new Date().toISOString() };
    stmt.run(q);
    res.json({ success: true, query: q });
  } catch (err) {
    res.status(500).json({ error: 'Failed to save query' });
  }
});

// 11. Alert rule management and evaluation
router.post('/:fileId/alerts', (req, res) => {
  const { fileId } = req.params;
  const record = store.get(fileId);
  if (!record) {
    return res.status(404).json({ error: 'File not found' });
  }

  try {
    const rule = createRule(fileId, req.body);
    const currentAlerts = evaluateAlerts(record);
    record.alerts = currentAlerts;
    res.json({ success: true, rule, activeAlerts: currentAlerts });
  } catch (err) {
    res.status(400).json({ error: 'Invalid alert rule' });
  }
});

router.get('/:fileId/alerts', (req, res) => {
  const { fileId } = req.params;
  const record = store.get(fileId);
  if (!record) {
    return res.status(404).json({ error: 'File not found' });
  }
  res.json({ rules: getRules(fileId), alerts: record.alerts || [] });
});

router.get('/:fileId/alerts/evaluate', (req, res) => {
  const { fileId } = req.params;
  const record = store.get(fileId);
  if (!record) {
    return res.status(404).json({ error: 'File not found' });
  }
  const currentAlerts = evaluateAlerts(record);
  record.alerts = currentAlerts;
  res.json({ success: true, alerts: currentAlerts });
});

router.delete('/:fileId/alerts/:ruleId', (req, res) => {
  const { fileId, ruleId } = req.params;
  try {
    deleteRule(fileId, ruleId);
    res.json({ success: true });
  } catch (err) {
    res.status(400).json({ error: 'Failed to delete rule' });
  }
});

// In-flight dedup set for explain requests
const explainInFlight = new Set();

// Build explain prompt (mirrors AiService.explainLog logic for streaming)
function buildExplainPrompt(logText, level, fileRecord) {
  const contextLines = [];
  if (fileRecord?.parsedLogs) {
    const idx = fileRecord.parsedLogs.findIndex(l => l.raw === logText);
    if (idx >= 0) {
      let start = idx;
      let end = idx + 1;
      const tsGap = 60000;
      const baseTs = new Date(fileRecord.parsedLogs[idx].timestamp).getTime();
      while (start > 0) {
        const prev = fileRecord.parsedLogs[start - 1];
        if (!prev.raw.trim()) break;
        const prevTs = new Date(prev.timestamp).getTime();
        if (!isNaN(baseTs) && !isNaN(prevTs) && (baseTs - prevTs) > tsGap) break;
        if ((idx - start + 1) >= 10) break;
        start--;
      }
      while (end < fileRecord.parsedLogs.length) {
        const next = fileRecord.parsedLogs[end];
        if (!next.raw.trim()) break;
        const nextTs = new Date(next.timestamp).getTime();
        if (!isNaN(baseTs) && !isNaN(nextTs) && (nextTs - baseTs) > tsGap) break;
        if ((end - idx + 1) >= 10) break;
        end++;
      }
      for (let i = start; i < end; i++) {
        const l = fileRecord.parsedLogs[i];
        if (i === idx) contextLines.push(`→ [${l.level}] ${l.message}`);
        else contextLines.push(`  [${l.level}] ${l.message}`);
      }
    }
  }
  return `Explain this log entry with root cause analysis and remediation steps. Be concise.

Level: ${level}
${contextLines.length ? `Context (${contextLines.length - 1} surrounding lines):\n${contextLines.join('\n')}\n` : ''}
Log Content: ${logText}

Format your response as markdown with sections: Root Cause, Impact, Remediation.`;
}

// 11. Explain single log via AI or heuristic fallback
router.get('/:fileId/explain/:logIndex', aiLimiter, async (req, res) => {
  const { fileId, logIndex } = req.params;
  const stream = req.query.stream === 'true';
  const record = store.get(fileId);

  if (!record) {
    return res.status(404).json({ error: 'File not found' });
  }

  const logIdx = parseInt(logIndex);
  const log = record.parsedLogs.find(l => l.index === logIdx);
  if (!log) {
    return res.status(404).json({ error: 'Log entry not found' });
  }

  // Deduplicate in-flight requests for same (fileId, logIndex)
  const dedupKey = `${fileId}:${logIdx}`;
  if (explainInFlight.has(dedupKey)) {
    return res.status(429).json({ error: 'Explanation already in progress for this log entry.' });
  }
  explainInFlight.add(dedupKey);
  const cleanup = () => explainInFlight.delete(dedupKey);

  try {
    if (stream) {
      // Streaming mode
      const prompt = buildExplainPrompt(log.raw, log.level, record);
      pipeStreamToResponse(prompt, res);
      cleanup();
      return;
    }

    const explanation = await explainLog(log.raw, log.level, record);
    res.json({
      aiEnabled: isEnabled(),
      explanation
    });
  } catch (err) {
    res.status(500).json({ error: sanitizeErrorMessage(err) });
  } finally {
    cleanup();
  }
});

// 10. Query all logs using AI
router.post('/:fileId/query-ai', aiLimiter, async (req, res) => {
  const { fileId } = req.params;
  let { prompt } = req.body;
  const record = store.get(fileId);

  if (!record) {
    return res.status(404).json({ error: 'File not found' });
  }
  if (!prompt) {
    return res.status(400).json({ error: 'Prompt is required' });
  }

  const AiService = require('../ai/AiService');
  const provider = AiService.getActiveProvider ? AiService.getActiveProvider() : 'unknown';
  if (!checkProviderRateLimit(provider, 15)) {
    return res.status(429).json({ error: `Provider "${provider}" rate limit reached. Please wait or switch providers.` });
  }

  const MAX_PROMPT_CHARS = 3000;
  if (prompt.length > MAX_PROMPT_CHARS) {
    prompt = prompt.slice(0, MAX_PROMPT_CHARS) + '\n...[truncated for context limit]';
  }

  try {
    const aiResponse = await queryLogs(record.parsedLogs, prompt);
    res.json({
      aiEnabled: isEnabled(),
      response: aiResponse
    });
  } catch (err) {
    res.status(500).json({ error: sanitizeErrorMessage(err) });
  }
});

// 10a. Stream AI response (SSE for copilot)
router.post('/:fileId/query-ai/stream', aiLimiter, async (req, res) => {
  const { fileId } = req.params;
  let { prompt, logContext } = req.body;
  const record = store.get(fileId);

  if (!record) {
    return res.status(404).json({ error: 'File not found' });
  }
  if (!prompt) {
    return res.status(400).json({ error: 'Prompt is required' });
  }

  const AiService = require('../ai/AiService');
  const provider = AiService.getActiveProvider ? AiService.getActiveProvider() : 'unknown';
  if (!checkProviderRateLimit(provider, 15)) {
    return res.status(429).json({ error: `Provider "${provider}" rate limit reached. Please wait or switch providers.` });
  }

  const ctx = buildLogContextForAI(record.parsedLogs || []);
  const { stats, timeline, errorTraces, sampleNormalLogs, omittedErrorCount } = ctx;
  const errorPct = stats.totalLogs ? ((stats.countsByLevel.ERROR + stats.countsByLevel.FATAL) / stats.totalLogs * 100).toFixed(1) : '0.0';

  const timelineStr = timeline.length > 0
    ? timeline.map(w => `  ${w.window}: ${w.errors} errors, ${w.total} total`).join('\n')
    : '  (no time data)';
  const errorsStr = errorTraces.length > 0
    ? errorTraces.map(e => `[${e.effectiveLevel || e.level}] ${e.timestampIso || e.timestamp} ${e.message || e.raw}`).join('\n')
    : '  (none)';
  const omittedStr = omittedErrorCount > 0 ? `\n[+ ${omittedErrorCount} similar errors omitted]` : '';
  const samplesStr = sampleNormalLogs.length > 0
    ? sampleNormalLogs.map(s => `[${s.effectiveLevel || s.level}] ${s.timestampIso || s.timestamp} ${s.message || s.raw}`).join('\n')
    : '  (none)';

  const fullPrompt = `Answer the user query based on the structured log context below.

Query: "${prompt}"

### LOG SUMMARY METRICS
- Total Logs: ${stats.totalLogs}
- Level Breakdown: INFO=${stats.countsByLevel.INFO}, WARN=${stats.countsByLevel.WARN}, ERROR=${stats.countsByLevel.ERROR}, FATAL=${stats.countsByLevel.FATAL}
- Error Rate: ${errorPct}%

### PER-MINUTE TIMELINE (errors / total per window)
${timelineStr}

### INCIDENT SANDBOX (Trigger → Critical → Recovery) (${errorTraces.length} shown${omittedErrorCount > 0 ? `, ${omittedErrorCount} omitted` : ''})
${errorsStr}${omittedStr}

### SAMPLE NORMAL LOGS (baseline context, ${sampleNormalLogs.length} entries)
${samplesStr}

### INSTRUCTIONS
1. Provide a chronological timeline of events described in the logs.
2. Identify root causes for any errors, exceptions, or anomalies.
3. Correlate related events across services or trace IDs.
4. Do NOT stop analysis early. Evaluate the full timeline from start to finish.
   CRITICAL: Cover both the INCIDENT phase AND the RECOVERY phase
   (e.g., pod restarts, state transitions back to CLOSED, cleared locks, restored connections).`;

  pipeStreamToResponse(fullPrompt, res);
});

/* ----- Comparative Drift API ----- */
router.get('/compare/:baseId/:targetId', wrapRoute((req, res) => {
  const { baseId, targetId } = req.params;
  const base = store.get(baseId);
  const target = store.get(targetId);

  if (!base || !target) {
    return res.status(404).json({ error: 'One or both files not found' });
  }

  const drift = analyzeLogDrift(base.patterns, target.patterns);
  res.json({ success: true, drift });
}));

// Tagging endpoints
// Add tags to a specific log entry
router.post('/:fileId/tags', (req, res) => {
  const { fileId } = req.params;
  const { logIndex, tags } = req.body;
  if (logIndex === undefined || !Array.isArray(tags)) {
    return res.status(400).json({ error: 'logIndex and tags array required' });
  }
  try {
    const updated = addTag(store, fileId, Number(logIndex), tags);
    res.json({ success: true, tags: updated });
  } catch (err) {
    res.status(500).json({ error: 'Failed to add tag' });
  }
});

// Get all tags for all logs in a file
router.get('/:fileId/tags', (req, res) => {
  const { fileId } = req.params;
  try {
    const tagsMap = getTagsForFile(store, fileId);
    res.json({ success: true, tags: tagsMap });
  } catch (err) {
    res.status(500).json({ error: 'Failed to load tags' });
  }
});

// 11. Export matching logs (JSON, CSV, or Markdown) — capped at 10,000 entries
router.get('/:fileId/export', (req, res) => {
  const { fileId } = req.params;
  const { format = 'json', level = 'all', search = '' } = req.query;
  const record = store.get(fileId);
  const EXPORT_CAP = 10000;

  if (!record) {
    return res.status(404).json({ error: 'File not found' });
  }

  let filtered = record.parsedLogs;
  if (level !== 'all') {
    filtered = filtered.filter(log => log.level && log.level.toLowerCase() === level.toLowerCase());
  }
  if (search.trim() !== '') {
    const searchLower = search.toLowerCase();
    filtered = filtered.filter(log => log.raw.toLowerCase().includes(searchLower));
  }

  const capped = filtered.length > EXPORT_CAP;
  const exportLogs = filtered.slice(0, EXPORT_CAP);

  if (format === 'csv') {
    const chunks = ['Index,Timestamp,Level,Message,IDs,Metadata\n'];
    exportLogs.forEach(log => {
      const idx = log.index;
      const ts = log.timestamp;
      const lvl = log.level.toUpperCase();
      const msg = `"${log.message.replace(/"/g, '""')}"`;
      const idsStr = `"${JSON.stringify(log.ids).replace(/"/g, '""')}"`;
      const metaStr = `"${JSON.stringify(log.metadata).replace(/"/g, '""')}"`;
      chunks.push(`${idx},${ts},${lvl},${msg},${idsStr},${metaStr}\n`);
    });

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="lograke_export_${fileId}.csv"`);
    return res.send(chunks.join(''));
  }

  if (format === 'markdown') {
    let md = `# Lograke Export Summary - ${record.name}\n\n`;
    md += `- **Export Date**: ${new Date().toLocaleString()}\n`;
    md += `- **Showing**: ${exportLogs.length} of ${filtered.length} matching lines${capped ? ` (capped at ${EXPORT_CAP})` : ''}\n`;
    md += `- **Filters**: Level: ${level}, Search: "${search}"\n\n`;
    
    md += '## Log Line Details\n\n';
    exportLogs.forEach(log => {
      md += `### [${log.timestamp}] [${log.level.toUpperCase()}] Log Entry #${log.index}\n`;
      md += `**Message**: \`${log.message}\`\n\n`;
      if (Object.keys(log.ids).length > 0) {
        md += `**Identifiers**:\n`;
        for (const [k, v] of Object.entries(log.ids)) {
          md += `- ${k}: \`${v}\`\n`;
        }
        md += '\n';
      }
      if (Object.keys(log.metadata).length > 0) {
        md += `**Metadata**:\n`;
        for (const [k, v] of Object.entries(log.metadata)) {
          md += `- ${k}: \`${v}\`\n`;
        }
        md += '\n';
      }
      md += '---\n\n';
    });

    res.setHeader('Content-Type', 'text/markdown');
    res.setHeader('Content-Disposition', `attachment; filename="lograke_export_${fileId}.md"`);
    return res.send(md);
  }

  // Default to JSON export
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Content-Disposition', `attachment; filename="lograke_export_${fileId}.json"`);
  res.send(JSON.stringify({
    fileName: record.name,
    exportedAt: new Date().toISOString(),
    totalParsed: record.linesCount,
    exportedCount: exportLogs.length,
    capped,
    logs: exportLogs
  }, null, 2));
});

router.processLogFile = processLogFile;

// Webhook ingestion for log sources (text/plain, JSON array, NDJSON)
router.post('/ingest/webhook/:sourceId', async (req, res) => {
  const { sourceId } = req.params;
  const apiKey = req.headers['x-api-key'] || req.query.apiKey || '';
  try {
    const sourceManager = require('../services/SourceManager');
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

// Health check endpoint for AI providers
router.get('/ai/health', aiLimiter, async (req, res) => {
  const AiService = require('../ai/AiService');
  const config = require('../config');
  const provider = AiService.getActiveProvider ? AiService.getActiveProvider() : 'none';
  const enabled = AiService.isEnabled ? AiService.isEnabled() : false;

  const result = {
    enabled,
    activeProvider: provider,
    providerLabel: AiService.getProviderLabel ? AiService.getProviderLabel(provider) : provider,
    hasKey: enabled,
    providers: {
      groq: { configured: Boolean(config.ai?.groqApiKey || process.env.GROQ_API_KEY) },
      gemini: { configured: Boolean(config.ai?.geminiApiKey || process.env.GEMINI_API_KEY) },
      grok: { configured: Boolean(config.ai?.grokApiKey || process.env.GROK_API_KEY) },
      ollama: { configured: true },
    },
  };

  res.json(result);
});

// 12. Global AI Insights
router.get('/:fileId/ai-summary', aiLimiter, async (req, res) => {
  const { fileId } = req.params;
  const record = store.get(fileId);
  if (!record) return res.status(404).json({ error: 'File not found' });
  
  const { AiService } = require('../ai/AiService');
  if (!AiService.isEnabled()) {
    return res.status(400).json({ error: 'AI integration is disabled.' });
  }

  try {
    const summary = await AiService.generateExecutiveSummary(record);
    res.json({ summary });
  } catch (err) {
    res.status(500).json({ error: sanitizeErrorMessage(err) });
  }
});

// 20. Unified Dashboard endpoint (aggregates all dashboard data in one call)
router.get('/:fileId/dashboard', async (req, res) => {
  const { fileId } = req.params;
  const record = store.get(fileId);
  if (!record) return res.status(404).json({ error: 'File not found' });

  try {
    const cacheKey = `dashboard_${fileId}`;
    const cached = cacheGet(cacheKey);
    if (cached) return res.json(cached);

    // Aggregations
    const [serviceAggs, hostAggs, categoryAggs] = await Promise.all([
      Promise.resolve(store.getAggregations(fileId, 'service', 8)),
      Promise.resolve(store.getAggregations(fileId, 'host', 8)),
      Promise.resolve(store.getAggregations(fileId, 'category', 8)),
    ]);

    // Chronology data
    const { generateTimeline, detectTemporalPatterns, detectTemporalAnomalies } = require('../analyzer/ChronologicalAnalyzer');
    const timeline = generateTimeline(record.parsedLogs, 5);
    const temporalPatterns = detectTemporalPatterns(record.parsedLogs);
    const anomalies = detectTemporalAnomalies(record.parsedLogs, 1.5);

    // Heatmap data
    const db = require('../db');
    const { toEpochMs } = require('../utils/time');
    const rows = db.prepare('SELECT logTimestamp FROM logs WHERE fileId = ? AND logTimestamp IS NOT NULL').all(fileId);
    const matrix = {};
    for (const row of rows) {
      const ms = toEpochMs(row.logTimestamp);
      if (isNaN(ms)) continue;
      const d = new Date(ms);
      const day = (d.getDay() + 6) % 7;
      const hour = d.getHours();
      const key = `${day}:${hour}`;
      matrix[key] = (matrix[key] || 0) + 1;
    }
    const heatmapCells = Object.entries(matrix).map(([key, count]) => {
      const [day, hour] = key.split(':').map(Number);
      return { day, hour, count };
    });

    // Time bucket data (from stored chronology)
    const timeBuckets = record.chronology?.timeline?.timeline || [];

    const payload = {
      timeline: timeline.timeline,
      timeBuckets,
      aggregations: { service: serviceAggs, host: hostAggs, category: categoryAggs },
      heatmap: { cells: heatmapCells },
      patterns: (record.patterns || []).slice(0, 5),
      anomalies: (record.anomalies || []).slice(0, 5),
      temporalPatterns,
      errorBursts: anomalies.anomalies || [],
      healthScore: record.healthScore,
      levelCounts: record.levelCounts,
      linesCount: record.linesCount,
      totalPatterns: (record.patterns || []).length,
      totalAnomalies: (record.anomalies || []).length,
      timeSpanMs: timeline.stats?.durationMinutes ? timeline.stats.durationMinutes * 60000 : 0
    };

    cacheSet(cacheKey, payload);
    res.json(payload);
  } catch (err) {
    logger.error('[Dashboard] Error building dashboard:', err.message);
    res.status(500).json({ error: 'Failed to build dashboard data' });
  }
});

module.exports = router;
