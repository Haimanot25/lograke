const db = require('../db');
const { inferSchema, generateFewShotRegex } = require('../parser/SchemaInferrer');
const { logger } = require('../middleware/logger');
const { compileSafe } = require('../utils/safeRegex');

function userError(message, statusCode = 400) {
  const e = new Error(message);
  e.isOperational = true;
  e.statusCode = statusCode;
  return e;
}

function generateId() {
  return `parser_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function rowToParser(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    description: row.description || '',
    version: row.version || 1,
    regexPattern: row.regexPattern || '',
    fieldMappings: row.fieldMappings ? JSON.parse(row.fieldMappings) : [],
    sampleLines: row.sampleLines || '',
    testResults: row.testResults ? JSON.parse(row.testResults) : null,
    tags: (row.tags || '').split(',').filter(Boolean),
    isBuiltin: row.isBuiltin === 1,
    multiLine: row.multiLine === 1,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    metadata: row.metadata ? JSON.parse(row.metadata) : {}
  };
}

function suggestFields(sampleLines) {
  const lines = Array.isArray(sampleLines) ? sampleLines : (sampleLines || '').split('\n');
  return inferSchema(lines);
}

function generateRegexFromFields(fields) {
  const parts = [];
  for (const f of fields) {
    if (f.type === 'date') {
      parts.push('(?<' + f.regexGroup + '>\\d{4}[-/]\\d{2}[-/]\\d{2}[T ]\\d{2}:\\d{2}:\\d{2}(?:\\.\\d+)?(?:Z|[+-]\\d{2}:?\\d{2})?)');
    } else if (f.type === 'number') {
      parts.push('(?<' + f.regexGroup + '>\\w+=(?:-?\\d+(?:\\.\\d+)?)|-?\\d+(?:\\.\\d+)?)');
    } else if (f.type === 'ip') {
      parts.push('(?<' + f.regexGroup + '>\\S+)');
    } else if (f.type === 'email') {
      parts.push('(?<' + f.regexGroup + '>\\S+@\\S+\\.\\S+)');
    } else if (f.type === 'json') {
      parts.push('(?<' + f.regexGroup + '>\\{.*\\})');
    } else if (f.type === 'level') {
      parts.push('(?<' + f.regexGroup + '>\\S+)');
    } else if (f.name === 'message') {
      parts.push('(?<' + f.regexGroup + '>.+)');
    } else {
      parts.push('(?<' + f.regexGroup + '>\\S+)');
    }
  }
  return '^' + parts.join('\\s+') + '$';
}

function createParser(name, description, sampleLines, fields, tags, options = {}) {
  if (!name || !fields?.length) throw userError('Parser name and at least one field required');

  const id = generateId();
  const now = new Date().toISOString();

  const regexPattern = options.regexPattern || generateRegexFromFields(fields);

  const sampleStr = Array.isArray(sampleLines) ? sampleLines.join('\n') : sampleLines;

  db.prepare(`
    INSERT INTO custom_parsers (id, name, description, version, regexPattern, fieldMappings, sampleLines, tags, multiLine, createdAt, updatedAt)
    VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, name, description, regexPattern, JSON.stringify(fields), sampleStr, (tags || []).join(','), options.multiLine ? 1 : 0, now, now);

  return getParser(id);
}

function updateParser(id, updates) {
  const existing = db.prepare('SELECT * FROM custom_parsers WHERE id = ?').get(id);
  if (!existing) throw userError('Parser not found');

  const newVersion = (existing.version || 0) + 1;
  const now = new Date().toISOString();

  const fields = updates.fieldMappings !== undefined ? JSON.stringify(updates.fieldMappings) : existing.fieldMappings;
  const tags = updates.tags !== undefined ? (Array.isArray(updates.tags) ? updates.tags.join(',') : updates.tags) : existing.tags;
  const multiLine = updates.multiLine !== undefined ? (updates.multiLine ? 1 : 0) : existing.multiLine;
  const metadata = updates.metadata !== undefined ? JSON.stringify(updates.metadata) : existing.metadata;

  db.prepare(`
    UPDATE custom_parsers SET
      name = ?, description = ?, version = ?, regexPattern = ?, fieldMappings = ?,
      sampleLines = ?, tags = ?, multiLine = ?, updatedAt = ?, metadata = ?
    WHERE id = ?
  `).run(
    updates.name || existing.name,
    updates.description !== undefined ? updates.description : existing.description,
    newVersion,
    updates.regexPattern || existing.regexPattern,
    fields,
    updates.sampleLines || existing.sampleLines,
    tags,
    multiLine,
    now,
    metadata,
    id
  );
  return getParser(id);
}

function getParsers(search, tag) {
  let query = 'SELECT * FROM custom_parsers WHERE 1=1';
  const params = [];

  if (search) {
    query += ' AND (name LIKE ? OR description LIKE ?)';
    params.push(`%${search}%`, `%${search}%`);
  }
  if (tag) {
    query += ' AND tags LIKE ?';
    params.push(`%${tag}%`);
  }

  query += ' ORDER BY updatedAt DESC';
  const rows = db.prepare(query).all(...params);
  return rows.map(rowToParser);
}

function getParser(id) {
  const row = db.prepare('SELECT * FROM custom_parsers WHERE id = ?').get(id);
  return rowToParser(row);
}

function deleteParser(id) {
  db.prepare('DELETE FROM custom_parsers WHERE id = ?').run(id);
}

function previewRegex(regexPattern, testLines) {
  const lines = Array.isArray(testLines) ? testLines : (testLines || '').split('\n');
  const results = [];

  try {
    const regex = compileSafe(regexPattern);
    for (const line of lines) {
      if (!line.trim()) continue;
      const match = line.match(regex);
      if (match) {
        const groups = {};
        for (const [key, value] of Object.entries(match.groups || {})) {
          groups[key] = value;
        }
        results.push({ line, matched: true, groups, length: line.length });
      } else {
        results.push({ line, matched: false, groups: {}, length: line.length });
      }
    }
  } catch (err) {
    return { success: false, error: err.message, results: [] };
  }

  const matched = results.filter(r => r.matched).length;
  return {
    success: true,
    totalLines: results.length,
    matchedLines: matched,
    matchRate: results.length > 0 ? Math.round((matched / results.length) * 100) : 0,
    results
  };
}

/* Apply custom parser regex to log lines and return structured records */
function applyParser(parserOrId, rawLines) {
  const parser = typeof parserOrId === 'string' ? getParser(parserOrId) : parserOrId;
  if (!parser) throw userError('Parser not found');

  const lines = Array.isArray(rawLines) ? rawLines : (rawLines || '').split('\n');
  const records = [];

  try {
    const regex = compileSafe(parser.regexPattern);
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!line.trim()) continue;
      const match = line.match(regex);
      if (match) {
        const groups = {};
        for (const [key, value] of Object.entries(match.groups || {})) {
          groups[key] = value;
        }
        records.push({ index: i, raw: line, parsed: true, fields: groups });
      } else {
        records.push({ index: i, raw: line, parsed: false, fields: {} });
      }
    }
  } catch (err) {
    return { success: false, error: err.message, records: [], totalLines: lines.length, parsedLines: 0 };
  }

  const parsedLines = records.filter(r => r.parsed).length;
  return {
    success: true,
    totalLines: lines.length,
    parsedLines,
    matchRate: lines.length > 0 ? Math.round((parsedLines / lines.length) * 100) : 0,
    records
  };
}

function testParser(parserId, testLogLines) {
  const parser = getParser(parserId);
  if (!parser) throw userError('Parser not found');

  const result = applyParser(parser, testLogLines);
  if (!result.success) return result;

  // Per-field analysis
  const fieldStats = {};
  const fieldMappings = parser.fieldMappings || [];

  for (const field of fieldMappings) {
    const groupName = field.regexGroup;
    const extractedValues = result.records.filter(r => r.parsed && r.fields[groupName]).map(r => r.fields[groupName]);
    const emptyCount = result.records.filter(r => r.parsed && !r.fields[groupName]).length;
    const nullCount = result.records.filter(r => r.parsed && r.fields[groupName] === '').length;

    fieldStats[groupName] = {
      name: field.name || groupName,
      type: field.type,
      extractedCount: extractedValues.length,
      emptyCount,
      nullCount,
      successRate: result.parsedLines > 0 ? Math.round((extractedValues.length / result.parsedLines) * 100) : 0,
      sampleValues: [...new Set(extractedValues)].slice(0, 5)
    };
  }

  const testResult = {
    testedAt: new Date().toISOString(),
    totalLines: result.totalLines,
    parsedLines: result.parsedLines,
    matchRate: result.matchRate,
    fieldStats,
    lineResults: result.records.map(r => ({
      index: r.index,
      matched: r.parsed,
      fields: r.fields,
      raw: r.raw.length > 200 ? r.raw.slice(0, 200) + '...' : r.raw
    }))
  };

  // Save test results to DB
  db.prepare('UPDATE custom_parsers SET testResults = ?, updatedAt = ? WHERE id = ?')
    .run(JSON.stringify(testResult), new Date().toISOString(), parserId);

  return { success: true, ...testResult };
}

function exportParser(id) {
  const parser = getParser(id);
  if (!parser) throw userError('Parser not found');
  return {
    exportVersion: 1,
    exportedAt: new Date().toISOString(),
    parser: {
      name: parser.name,
      description: parser.description,
      regexPattern: parser.regexPattern,
      fieldMappings: parser.fieldMappings,
      sampleLines: parser.sampleLines,
      tags: parser.tags,
      multiLine: parser.multiLine
    }
  };
}

function importParser(json) {
  if (!json || !json.parser) throw userError('Invalid parser JSON');
  const p = json.parser;
  if (!p.name || !p.regexPattern) throw userError('Parser must have name and regexPattern');

  const id = generateId();
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO custom_parsers (id, name, description, version, regexPattern, fieldMappings, sampleLines, tags, multiLine, createdAt, updatedAt)
    VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, p.name, p.description || '', p.regexPattern,
    JSON.stringify(p.fieldMappings || []), p.sampleLines || '',
    (p.tags || []).join(','), p.multiLine ? 1 : 0, now, now
  );

  return getParser(id);
}

function verifyRegex(regexPattern) {
  try {
    compileSafe(regexPattern);
    return { valid: true };
  } catch (err) {
    return { valid: false, error: err.message };
  }
}

module.exports = {
  suggestFields,
  createParser,
  updateParser,
  getParsers,
  getParser,
  deleteParser,
  previewRegex,
  applyParser,
  testParser,
  exportParser,
  importParser,
  verifyRegex
};
