const db = require('../../db');
const { scanTraceableEntities, traceEntity } = require('../../analyzer/CorrelationEngine');
const { analyzeChronology, analyzeLogDrift } = require('../../analyzer/ChronologicalAnalyzer');
const { logger } = require('../../middleware/logger');
const { toEpochMs } = require('../../utils/time');
const { store, wrapRoute, cacheSet, cacheGet } = require('./shared');

function register(router) {
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

  // METRICS ENDPOINTS — must be above /:fileId to avoid route swallowing
  router.get('/metrics', (req, res) => {
    const db = require('../../db');
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
        
        const db = require('../../db');
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
      
      const { generateTimeline } = require('../../analyzer/ChronologicalAnalyzer');
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
      
      const { detectTemporalPatterns } = require('../../analyzer/ChronologicalAnalyzer');
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
      
      const { analyzeMetricsTimeSeries } = require('../../analyzer/ChronologicalAnalyzer');
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
      const { generateTimeline, detectTemporalPatterns, detectTemporalAnomalies } = require('../../analyzer/ChronologicalAnalyzer');
      const timeline = generateTimeline(record.parsedLogs, 5);
      const temporalPatterns = detectTemporalPatterns(record.parsedLogs);
      const anomalies = detectTemporalAnomalies(record.parsedLogs, 1.5);

      // Heatmap data
      const db = require('../../db');
      const { toEpochMs } = require('../../utils/time');
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
}

module.exports = { register };
