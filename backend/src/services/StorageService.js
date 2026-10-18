const db = require('../db');

class StorageService {
  set(fileId, record) {
    const stmtFile = db.prepare(`
      INSERT OR REPLACE INTO files (
        id, name, sourcePath, linesCount, levelCounts, facetCounts, healthScore,
        detectedFormat, inferredType, inferredFields, multiLineEDR, patterns, anomalies, entities, chronology, timestamp, dedupSummary, userId
      ) VALUES (
        @id, @name, @sourcePath, @linesCount, @levelCounts, @facetCounts, @healthScore,
        @detectedFormat, @inferredType, @inferredFields, @multiLineEDR, @patterns, @anomalies, @entities, @chronology, @timestamp, @dedupSummary, @userId
      )
    `);

    const stmtLog = db.prepare(`
      INSERT INTO logs (
        fileId, logIndex, logTimestamp, level, message, raw, service, host, category, environment, metadata, ids, tags
      ) VALUES (
        @fileId, @logIndex, @logTimestamp, @level, @message, @raw, @service, @host, @category, @environment, @metadata, @ids, @tags
      )
    `);

    const stmtRule = db.prepare(`
      INSERT INTO alert_rules (id, fileId, name, type, threshold, severity, description, active)
      VALUES (@id, @fileId, @name, @type, @threshold, @severity, @description, @active)
    `);

    const stmtAlert = db.prepare(`
      INSERT INTO alerts (id, fileId, ruleId, type, message, severity, timestamp)
      VALUES (@id, @fileId, @ruleId, @type, @message, @severity, @timestamp)
    `);

    const insertTx = db.transaction(() => {
      stmtFile.run({
        id: record.id,
        name: record.name,
        sourcePath: record.sourcePath,
        linesCount: record.linesCount,
        levelCounts: JSON.stringify(record.levelCounts || {}),
        facetCounts: JSON.stringify(record.facetCounts || {}),
        healthScore: record.healthScore,
        detectedFormat: record.detectedFormat,
        inferredType: record.inferredType,
        inferredFields: JSON.stringify(record.inferredFields || []),
        multiLineEDR: record.multiLineEDR ? 1 : 0,
        patterns: JSON.stringify(record.patterns || []),
        anomalies: JSON.stringify(record.anomalies || []),
        entities: JSON.stringify(record.entities || {}),
        chronology: JSON.stringify(record.chronology || {}),
        timestamp: record.timestamp,
        dedupSummary: JSON.stringify(record.dedupSummary || null),
        // Ownership: preserve existing owner on re-ingest unless explicitly provided
        userId: record.userId !== undefined && record.userId !== null
          ? record.userId
          : (db.prepare('SELECT userId FROM files WHERE id = ?').get(record.id)?.userId ?? null)
      });

      db.prepare('DELETE FROM logs WHERE fileId = ?').run(record.id);

      const logParams = record.parsedLogs.map(log => ({
        fileId: record.id,
        logIndex: log.index,
        logTimestamp: log.timestamp,
        level: log.level,
        message: log.message,
        raw: log.raw,
        service: log.service || '',
        host: log.host || '',
        category: log.category || '',
        environment: log.environment || '',
        metadata: JSON.stringify(log.metadata || {}),
        ids: JSON.stringify(log.ids || {}),
        tags: JSON.stringify(log.tags || [])
      }));

      const insertLogs = db.transaction((logs) => {
        for (const params of logs) {
          stmtLog.run(params);
        }
      });
      insertLogs(logParams);

      db.prepare('DELETE FROM alerts WHERE fileId = ?').run(record.id);
      db.prepare('DELETE FROM alert_rules WHERE fileId = ?').run(record.id);

      if (record.rules) {
        for (const rule of record.rules) {
          stmtRule.run({
            id: rule.id, fileId: record.id, name: rule.name, type: rule.type,
            threshold: rule.threshold, severity: rule.severity, description: rule.description,
            active: rule.active ? 1 : 0
          });
        }
      }

      if (record.alerts) {
        for (const alert of record.alerts) {
          stmtAlert.run({
            id: alert.id || `alert_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
            fileId: record.id, ruleId: alert.ruleId, type: alert.type,
            message: alert.message, severity: alert.severity, timestamp: alert.timestamp
          });
        }
      }
    });

    insertTx();
  }

  updateEntities(fileId, entities) {
    db.prepare('UPDATE files SET entities = ? WHERE id = ?').run(JSON.stringify(entities || {}), fileId);
  }

  get(fileId) {
    const fileRow = db.prepare('SELECT * FROM files WHERE id = ?').get(fileId);
    if (!fileRow) return undefined;

    const record = {
      id: fileRow.id,
      name: fileRow.name,
      sourcePath: fileRow.sourcePath,
      linesCount: fileRow.linesCount,
      levelCounts: JSON.parse(fileRow.levelCounts || '{}'),
      facetCounts: JSON.parse(fileRow.facetCounts || '{}'),
      healthScore: fileRow.healthScore,
      detectedFormat: fileRow.detectedFormat,
      inferredType: fileRow.inferredType,
      inferredFields: JSON.parse(fileRow.inferredFields || '[]'),
      patterns: JSON.parse(fileRow.patterns || '[]'),
      anomalies: JSON.parse(fileRow.anomalies || '[]'),
      entities: (() => {
        try {
          const parsed = JSON.parse(fileRow.entities || '{}');
          return Array.isArray(parsed) ? {} : parsed;
        } catch { return {}; }
      })(),
      chronology: JSON.parse(fileRow.chronology || '{}'),
      multiLineEDR: Boolean(fileRow.multiLineEDR),
      timestamp: fileRow.timestamp,
      dedupSummary: (() => {
        try { return JSON.parse(fileRow.dedupSummary || 'null'); } catch { return null; }
      })(),
      userId: fileRow.userId || null,
      parsedLogs: [],
      alerts: [],
      rules: []
    };

    const logRows = db.prepare('SELECT * FROM logs WHERE fileId = ? ORDER BY logIndex ASC').all(fileId);
    record.parsedLogs = logRows.map(row => ({
      index: row.logIndex,
      timestamp: row.logTimestamp,
      level: row.level,
      message: row.message,
      raw: row.raw,
      service: row.service,
      host: row.host,
      category: row.category,
      environment: row.environment,
      metadata: JSON.parse(row.metadata || '{}'),
      ids: JSON.parse(row.ids || '{}'),
      tags: JSON.parse(row.tags || '[]')
    }));

    record.alerts = db.prepare('SELECT * FROM alerts WHERE fileId = ?').all(fileId);
    record.rules = db.prepare('SELECT * FROM alert_rules WHERE fileId = ?').all(fileId).map(r => ({ ...r, active: r.active === 1 }));

    return record;
  }

  /**
   * Get file metadata only — does NOT load parsedLogs, alerts, or rules.
   * Much faster than get() for metadata-only endpoints.
   */
  getMetadata(fileId) {
    const fileRow = db.prepare('SELECT * FROM files WHERE id = ?').get(fileId);
    if (!fileRow) return undefined;

    return {
      id: fileRow.id,
      name: fileRow.name,
      sourcePath: fileRow.sourcePath,
      linesCount: fileRow.linesCount,
      levelCounts: JSON.parse(fileRow.levelCounts || '{}'),
      facetCounts: JSON.parse(fileRow.facetCounts || '{}'),
      healthScore: fileRow.healthScore,
      detectedFormat: fileRow.detectedFormat,
      inferredType: fileRow.inferredType,
      inferredFields: JSON.parse(fileRow.inferredFields || '[]'),
      patterns: JSON.parse(fileRow.patterns || '[]'),
      anomalies: JSON.parse(fileRow.anomalies || '[]'),
      entities: (() => {
        try {
          const parsed = JSON.parse(fileRow.entities || '{}');
          return Array.isArray(parsed) ? {} : parsed;
        } catch { return {}; }
      })(),
      chronology: JSON.parse(fileRow.chronology || '{}'),
      multiLineEDR: Boolean(fileRow.multiLineEDR),
      timestamp: fileRow.timestamp,
      dedupSummary: (() => {
        try { return JSON.parse(fileRow.dedupSummary || 'null'); } catch { return null; }
      })(),
      userId: fileRow.userId || null
    };
  }

  /**
   * SQL-based aggregation — no need to load all logs into memory.
   */
  getAggregations(fileId, field, top = 20) {
    const allowedFields = ['level', 'service', 'host', 'environment', 'category'];
    if (!allowedFields.includes(field)) return [];

    const rows = db.prepare(`
      SELECT ${field} as value, COUNT(*) as count
      FROM logs WHERE fileId = ?
      GROUP BY ${field}
      ORDER BY count DESC
      LIMIT ?
    `).all(fileId, top);

    return rows.map(r => ({ value: r.value || 'unknown', count: r.count }));
  }

  has(fileId) {
    const count = db.prepare('SELECT COUNT(*) as count FROM files WHERE id = ?').get(fileId);
    return count.count > 0;
  }

  delete(fileId) {
    const deleteTx = db.transaction(() => {
      db.prepare('DELETE FROM alerts WHERE fileId = ?').run(fileId);
      db.prepare('DELETE FROM alert_rules WHERE fileId = ?').run(fileId);
      db.prepare('DELETE FROM saved_queries WHERE fileId = ?').run(fileId);
      db.prepare('DELETE FROM logs WHERE fileId = ?').run(fileId);
      db.prepare('DELETE FROM files WHERE id = ?').run(fileId);
    });
    deleteTx();
  }

  getMetadataList() {
    const fileRows = db.prepare(`
      SELECT f.*, COALESCE(ac.alertCount, 0) as alertCount
      FROM files f
      LEFT JOIN (SELECT fileId, COUNT(*) as alertCount FROM alerts GROUP BY fileId) ac ON f.id = ac.fileId
    `).all();

    return fileRows.map(fileRow => ({
      id: fileRow.id,
      name: fileRow.name,
      sourcePath: fileRow.sourcePath,
      linesCount: fileRow.linesCount,
      levelCounts: JSON.parse(fileRow.levelCounts || '{}'),
      facetCounts: JSON.parse(fileRow.facetCounts || '{}'),
      healthScore: fileRow.healthScore,
      inferredType: fileRow.inferredType,
      inferredFields: JSON.parse(fileRow.inferredFields || '[]'),
      multiLineEDR: Boolean(fileRow.multiLineEDR),
      timestamp: fileRow.timestamp,
      userId: fileRow.userId || null,
      alertCount: fileRow.alertCount
    }));
  }

  emitLogEvent(fileId, logEntry) {
    if (this._emitLiveLog) {
      this._emitLiveLog(fileId, logEntry);
    }
  }

  setEmitter(emitter) {
    this._emitLiveLog = emitter;
  }
}

module.exports = new StorageService();
