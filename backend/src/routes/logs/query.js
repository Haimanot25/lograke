const db = require('../../db');
const { filterLogs } = require('../../analyzer/QueryEngine');
const { store } = require('./shared');

function register(router) {
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
}

module.exports = { register };
