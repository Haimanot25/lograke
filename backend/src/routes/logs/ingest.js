const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const { extractLogFiles } = require('../../parser/ArchiveHandler');
const { parseLogLine } = require('../../parser/AdaptiveParser');
const { canonicalize, resetEpochContext } = require('../../ai/Canonicalizer');
const { detectFormat } = require('../../parser/EnhancedParser');
const { inferSchema, generateFewShotRegex } = require('../../parser/SchemaInferrer');
const { anonymize } = require('../../parser/Anonymizer');
const { detectPatterns } = require('../../analyzer/PatternDetector');
const { detectAnomalies } = require('../../analyzer/AnomalyDetector');
const { detectDuplicates } = require('../../analyzer/DedupDetector');
const { groupLines } = require('../../parser/MultiLineGrouper');
const { scanTraceableEntities } = require('../../analyzer/CorrelationEngine');
const { enrichLogEntry } = require('../../analyzer/LogEnricher');
const { validateBody } = require('../../middleware/validate');
const { evaluateAlerts } = require('../../analyzer/AlertEngine');
const { analyzeChronology } = require('../../analyzer/ChronologicalAnalyzer');
const { uploadLimiter } = require('../../middleware/rateLimiter');
const { logger } = require('../../middleware/logger');
const { applyParser, getParsers, getParser } = require('../../services/CustomParserService');
const { store, fileIngestor, sseEmitter, uploadsDir, upload } = require('./shared');

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

function register(router) {
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
}

module.exports = { register, processLogFile };
