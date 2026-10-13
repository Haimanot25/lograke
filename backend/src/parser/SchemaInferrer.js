/**
 * SchemaInferrer - Multi-sample statistical log schema inference engine
 * Analyzes up to 20 sample lines to detect structure, variable fields, types, and generates accurate regex.
 */

const LEVEL_KEYWORDS = ['ERROR', 'WARN', 'WARNING', 'INFO', 'DEBUG', 'TRACE', 'FATAL', 'SEVERE', 'CRITICAL', 'NOTICE'];
const { compileSafe } = require('../utils/safeRegex');
const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

const DATE_PATTERNS = [
  { name: 'iso8601', regex: /\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?/ },
  { name: 'bracket', regex: /\[\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?\]/ },
  { name: 'syslog', regex: /[A-Z][a-z]{2}\s+\d{1,2}\s+\d{2}:\d{2}:\d{2}/ },
  { name: 'syslog2', regex: /\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}/ },
  { name: 'hdfs', regex: /\d{8}\s+\d{2}:\d{2}:\d{2}/ },
  { name: 'epoch', regex: /\b\d{10}(?:\.\d+)?\b/ }
];

const FIELD_TYPE_PATTERNS = {
  ip: /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$|^[0-9a-fA-F:]+:[0-9a-fA-F:]+$/,
  uuid: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
  email: /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/,
  number: /^-?\d+(?:\.\d+)?$/,
  hex: /^0x[0-9a-fA-F]+$/,
  path: /^(\/|[a-zA-Z]:\\)/,
  level: new RegExp('^(' + LEVEL_KEYWORDS.join('|') + ')$', 'i'),
  url: /^https?:\/\//,
  json: /^\{.*\}$/,
  mac: /^[0-9a-fA-F]{2}(?::[0-9a-fA-F]{2}){5}$/
};

const DELIMITER_CANDIDATES = ['|', ',', '\t', ';', ' '];

function escapeRegex(str) {
  if (!str) return '';
  return String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function detectDateType(value) {
  for (const p of DATE_PATTERNS) {
    if (p.regex.test(value)) return { type: 'date', subType: p.name, confidence: 95 };
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return { type: 'date', subType: 'dateOnly', confidence: 90 };
  if (/^\d{2}\/\w{3}\/\d{4}/.test(value)) return { type: 'date', subType: 'slashed', confidence: 85 };
  return null;
}

function classifyFieldType(values) {
  if (!values || values.length === 0) return { type: 'string', confidence: 30 };

  const nonEmpty = values.filter(v => v && v !== '');
  if (nonEmpty.length === 0) return { type: 'string', confidence: 30 };

  // Date detection (highest priority)
  const dateMatches = nonEmpty.filter(v => detectDateType(v));
  if (dateMatches.length >= nonEmpty.length * 0.8) {
    const subType = dateMatches[0]?.subType || 'iso8601';
    return { type: 'date', confidence: Math.round(85 + (dateMatches.length / nonEmpty.length) * 15), subType };
  }

  // Level keywords
  const levelSet = new Set(nonEmpty.map(v => v.toUpperCase()));
  const levelMatches = LEVEL_KEYWORDS.filter(l => levelSet.has(l));
  if (levelMatches.length >= nonEmpty.length * 0.7) {
    return { type: 'level', confidence: Math.round(80 + (levelMatches.length / LEVEL_KEYWORDS.length) * 20), values: levelMatches };
  }

  // IP
  const ipMatches = nonEmpty.filter(v => FIELD_TYPE_PATTERNS.ip.test(v));
  if (ipMatches.length >= nonEmpty.length * 0.85) return { type: 'ip', confidence: 95 };

  // UUID
  const uuidMatches = nonEmpty.filter(v => FIELD_TYPE_PATTERNS.uuid.test(v));
  if (uuidMatches.length >= nonEmpty.length * 0.85) return { type: 'uuid', confidence: 98 };

  // Email
  const emailMatches = nonEmpty.filter(v => FIELD_TYPE_PATTERNS.email.test(v));
  if (emailMatches.length >= nonEmpty.length * 0.85) return { type: 'email', confidence: 97 };

  // Number
  const numMatches = nonEmpty.filter(v => FIELD_TYPE_PATTERNS.number.test(v));
  if (numMatches.length >= nonEmpty.length * 0.85) return { type: 'number', confidence: 90 };

  // Hex
  const hexMatches = nonEmpty.filter(v => FIELD_TYPE_PATTERNS.hex.test(v));
  if (hexMatches.length >= nonEmpty.length * 0.85) return { type: 'hexNumber', confidence: 88 };

  // Path
  const pathMatches = nonEmpty.filter(v => FIELD_TYPE_PATTERNS.path.test(v));
  if (pathMatches.length >= nonEmpty.length * 0.8) return { type: 'path', confidence: 80 };

  // URL
  const urlMatches = nonEmpty.filter(v => FIELD_TYPE_PATTERNS.url.test(v));
  if (urlMatches.length >= nonEmpty.length * 0.8) return { type: 'url', confidence: 85 };

  // JSON
  const jsonMatches = nonEmpty.filter(v => FIELD_TYPE_PATTERNS.json.test(v));
  if (jsonMatches.length >= nonEmpty.length * 0.8) {
    try { JSON.parse(nonEmpty[0]); return { type: 'json', confidence: 90 }; } catch { /* not valid JSON */ }
  }

  // MAC
  const macMatches = nonEmpty.filter(v => FIELD_TYPE_PATTERNS.mac.test(v));
  if (macMatches.length >= nonEmpty.length * 0.85) return { type: 'mac', confidence: 95 };

  // Mixed or generic
  const avgLen = nonEmpty.reduce((s, v) => s + v.length, 0) / nonEmpty.length;
  const uniqueRatio = new Set(nonEmpty).size / nonEmpty.length;
  const confidence = Math.min(70, Math.round((1 - uniqueRatio) * 40 + 30));
  return { type: 'string', confidence };
}

function detectDelimiter(lines) {
  const candidateCounts = {};
  for (const delim of DELIMITER_CANDIDATES) {
    let consistent = 0;
    let colCount = 0;
    for (let i = 0; i < Math.min(lines.length, 20); i++) {
      const cols = delim === '\t' ? lines[i].split('\t').length : lines[i].split(delim).length;
      if (i === 0) colCount = cols;
      else if (cols === colCount) consistent++;
    }
    if (consistent >= Math.min(lines.length, 20) * 0.6 && colCount >= 3) {
      candidateCounts[delim] = { count: consistent, columns: colCount };
    }
  }
  // Pick best delimiter
  let best = null;
  let bestScore = 0;
  for (const [delim, info] of Object.entries(candidateCounts)) {
    if (info.count > bestScore) { best = delim; bestScore = info.count; }
  }
  if (best === ' ') {
    // Only use space if other delimiters aren't better
    const spaceScore = candidateCounts[' ']?.count || 0;
    const otherBest = Math.max(...Object.entries(candidateCounts).filter(([k]) => k !== ' ').map(([, v]) => v.count), 0);
    if (otherBest >= spaceScore) best = Object.entries(candidateCounts).filter(([k]) => k !== ' ').sort((a, b) => b[1].count - a[1].count)[0]?.[0] || null;
  }
  return best;
}

function tokenizeByDelimiter(line, delimiter) {
  if (delimiter === ' ') return line.match(/\S+/g) || [];
  return line.split(delimiter).map(t => t.trim());
}

function alignLines(lines, delimiter) {
  const tokenized = lines.map(l => tokenizeByDelimiter(l, delimiter));
  const maxCols = Math.max(...tokenized.map(t => t.length));
  const minCols = Math.min(...tokenized.map(t => t.length));

  // Build columns: each column is an array of the token at that position
  const columns = [];
  for (let col = 0; col < maxCols; col++) {
    const colValues = tokenized.map(t => t[col] || '');
    // Determine if this column is static (all same value)
    const unique = new Set(colValues);
    const isStatic = unique.size === 1 && colValues[0] !== '';
    columns.push({ index: col, values: colValues, isStatic, uniqueCount: unique.size, staticValue: isStatic ? colValues[0] : null });
  }

  return { columns, tokenized, maxCols, minCols, delimiter };
}

function mergeVariableColumns(columns) {
  // Merge adjacent variable columns into field groups
  const fields = [];
  let currentField = null;

  for (const col of columns) {
    if (col.isStatic) {
      if (currentField) { fields.push(currentField); currentField = null; }
      fields.push({ type: 'static', value: col.staticValue, index: col.index });
    } else {
      if (!currentField) {
        currentField = { type: 'variable', indices: [col.index], values: col.values, allValues: [...col.values] };
      } else {
        currentField.indices.push(col.index);
        currentField.allValues = currentField.allValues.map((v, i) => v + ' ' + col.values[i]);
      }
    }
  }
  if (currentField) fields.push(currentField);
  return fields;
}

function detectApacheFormat(lines) {
  // Apache/NCSA combined: IP - - [date] "METHOD path proto" status size "referrer" "user-agent"
  const apacheRegex = /^(\S+)\s+\S+\s+\S+\s+\[([^\]]+)\]\s+"(\S+)\s+(\S+)\s+(\S+)"\s+(\d+)\s+(\S+)/;
  const matches = lines.filter(l => apacheRegex.test(l));
  if (matches.length >= lines.length * 0.8) {
    const fields = [
      { name: 'client_ip', type: 'ip', confidence: 95, sampleValues: lines.map(l => l.match(/^(\S+)/)?.[1] || '').filter(Boolean).slice(0, 5), regexGroup: 'client_ip' },
      { name: 'timestamp', type: 'date', confidence: 95, sampleValues: lines.map(l => l.match(/\[([^\]]+)\]/)?.[1] || '').filter(Boolean).slice(0, 5), regexGroup: 'timestamp' },
      { name: 'method', type: 'string', confidence: 90, sampleValues: lines.map(l => l.match(/"(\S+)/)?.[1] || '').filter(Boolean).slice(0, 5), regexGroup: 'method' },
      { name: 'path', type: 'string', confidence: 90, sampleValues: lines.map(l => l.match(/"\S+\s+(\S+)/)?.[1] || '').filter(Boolean).slice(0, 5), regexGroup: 'path' },
      { name: 'protocol', type: 'string', confidence: 85, sampleValues: lines.map(l => l.match(/"\S+\s+\S+\s+(\S+)"/)?.[1] || '').filter(Boolean).slice(0, 5), regexGroup: 'protocol' },
      { name: 'status', type: 'number', confidence: 95, sampleValues: lines.map(l => l.match(/"\S+\s+\S+\s+\S+"\s+(\d+)/)?.[1] || '').filter(Boolean).slice(0, 5), regexGroup: 'status' },
      { name: 'size', type: 'number', confidence: 85, sampleValues: lines.map(l => l.match(/"\S+\s+\S+\s+\S+"\s+\d+\s+(\S+)/)?.[1] || '').filter(Boolean).slice(0, 5), regexGroup: 'size' }
    ];
    // Check for combined format (with referrer and user-agent)
    const combinedRegex = /^(\S+)\s+\S+\s+\S+\s+\[([^\]]+)\]\s+"(\S+)\s+(\S+)\s+(\S+)"\s+(\d+)\s+(\S+)\s+"([^"]*)"\s+"([^"]*)"/;
    const combinedMatches = lines.filter(l => combinedRegex.test(l));
    if (combinedMatches.length >= lines.length * 0.5) {
      fields.push({ name: 'referrer', type: 'string', confidence: 80, sampleValues: lines.map(l => l.match(/"([^"]*)"\s+"[^"]*"$/)?.[1] || '').filter(Boolean).slice(0, 5), regexGroup: 'referrer' });
      fields.push({ name: 'user_agent', type: 'string', confidence: 80, sampleValues: lines.map(l => {
        const m = l.match(/"([^"]*)"$/); return m ? m[1] : '';
      }).filter(Boolean).slice(0, 5), regexGroup: 'user_agent' });
    }
    const regexPattern = '^(?<client_ip>\\S+)\\s+\\S+\\s+\\S+\\s+\\[(?<timestamp>[^\\]]+)\\]\\s+"(?<method>\\S+)\\s+(?<path>\\S+)\\s+(?<protocol>\\S+)"\\s+(?<status>\\d+)\\s+(?<size>\\S+)' + (fields.length > 7 ? '\\s+"(?<referrer>[^"]*)"\\s+"(?<user_agent>[^"]*)"' : '') + '$';
    return {
      success: true, format: 'apache', delimiter: ' ', fields,
      regexPattern, confidence: 90, coverage: Math.round(matches.length / lines.length * 100), columnCount: fields.length
    };
  }
  return null;
}

function inferSchema(sampleLines, options = {}) {
  const lines = (sampleLines || []).filter(l => l.trim().length > 0).slice(0, 20);
  if (lines.length < 2) {
    return { success: false, error: 'Need at least 2 sample lines for inference', fields: [], regexPattern: null };
  }

  // Check for JSON lines
  const jsonLines = lines.filter(l => l.trim().match(/^\{.*\}$/));
  if (jsonLines.length >= lines.length * 0.8) {
    try {
      const parsed = jsonLines.map(l => JSON.parse(l.trim()));
      const keys = [...new Set(parsed.flatMap(Object.keys))];
      const fields = keys.map(key => {
        const values = parsed.map(p => String(p[key] || ''));
        const classified = classifyFieldType(values);
        return { name: key, type: classified.type, confidence: classified.confidence, sampleValues: [...new Set(values)].slice(0, 5), regexGroup: key };
      });
      const sep = '\\s+';
      const regexPattern = '^' + fields.map(f => '(?<' + f.regexGroup + '>\\S+)').join(sep) + '$';
      return { success: true, format: 'json', delimiter: ' ', fields, regexPattern, confidence: 85, coverage: 100 };
    } catch { /* non-critical, field inference continues */ }
  }

  // Check for Apache/Nginx combined log format
  const apacheResult = detectApacheFormat(lines);
  if (apacheResult) return apacheResult;

  // Log-aware structural analysis
  // Step 1: Detect timestamp position and pattern in each line
  const timestampInfo = detectCommonTimestamp(lines);
  // Step 2: Detect level keywords and their positions
  const levelInfo = detectCommonLevel(lines, timestampInfo);
  // Step 3: Detect trailing structured data (key=value, JSON)
  const trailingInfo = detectTrailingData(lines, timestampInfo, levelInfo);
  // Step 4: The rest is the message body
  // Step 5: Build fields and regex

  const fields = [];
  const regexParts = [];
  let fieldIdx = 0;

  if (timestampInfo) {
    fields.push({
      name: 'timestamp',
      type: 'date',
      confidence: timestampInfo.confidence,
      sampleValues: timestampInfo.samples.slice(0, 5),
      regexGroup: 'timestamp'
    });
    regexParts.push(timestampInfo.pattern);
  }

  if (levelInfo) {
    fields.push({
      name: 'level',
      type: 'level',
      confidence: levelInfo.confidence,
      sampleValues: levelInfo.samples.slice(0, 5),
      regexGroup: 'level'
    });
    regexParts.push(levelInfo.pattern);
  }

  // Message field (always present as catch-all)
  const messageFieldName = 'message';
  fields.push({
    name: messageFieldName,
    type: 'string',
    confidence: 80,
    sampleValues: extractMessageSamples(lines, timestampInfo, levelInfo, trailingInfo).slice(0, 5),
    regexGroup: messageFieldName
  });

  // If trailing fields exist, make message non-greedy and append trailing patterns
  if (trailingInfo && trailingInfo.fields.length > 0) {
    regexParts.push('(?<' + messageFieldName + '>.*?)');
    for (const tf of trailingInfo.fields) {
      fields.push({
        name: tf.name,
        type: tf.type,
        confidence: tf.confidence,
        sampleValues: tf.samples.slice(0, 5),
        regexGroup: tf.name
      });
      const valPattern = tf.type === 'number' ? '\\S+' : '\\S+';
      regexParts.push(tf.value + '=(?<' + tf.name + '>' + valPattern + ')');
    }
  } else {
    regexParts.push('(?<' + messageFieldName + '>.+)');
  }

  const regexPattern = '^' + regexParts.join('\\s+') + '$';

  // Test coverage
  let coverage = 0;
  try {
    const regex = compileSafe(regexPattern);
    coverage = Math.round(lines.filter(l => regex.test(l)).length / lines.length * 100);
  } catch { /* non-critical, schema inference falls back */ }

  const avgConfidence = fields.length > 0 ? Math.round(fields.reduce((s, f) => s + f.confidence, 0) / fields.length) : 70;
  const overallConfidence = Math.min(100, Math.round(avgConfidence * 0.7 + coverage * 0.3));

  return {
    success: true,
    format: 'log',
    delimiter: ' ',
    fields,
    regexPattern,
    confidence: overallConfidence,
    coverage,
    columnCount: fields.length
  };
}

function detectCommonTimestamp(lines) {
  // For each line, find the first timestamp-like substring
  const timestampValues = [];

  for (const line of lines) {
    for (const dp of DATE_PATTERNS) {
      const match = line.match(dp.regex);
      if (match && match.index !== undefined && match.index < 60) {
        timestampValues.push({ value: match[0], index: match.index, pattern: dp.name, length: match[0].length });
        break;
      }
    }
    // Also look for syslog bracket format: [Jan 1 12:00:00]
    if (!timestampValues[timestampValues.length - 1] || timestampValues[timestampValues.length - 1].length < lines.indexOf(line)) {
      const bracketMatch = line.match(/\[[A-Z][a-z]{2}\s+\d{1,2}\s+\d{2}:\d{2}:\d{2}(?:\.\d+)?\]/);
      if (bracketMatch && bracketMatch.index !== undefined && bracketMatch.index < 60) {
        // Check if this looks like Apache format (IP - - [date])
        if (timestampValues.length <= lines.indexOf(line) || lines.indexOf(line) === 0) {
          timestampValues.push({ value: bracketMatch[0], index: bracketMatch.index, pattern: 'bracket_syslog', length: bracketMatch[0].length });
        }
      }
    }
  }

  // Only trust timestamps if found in >60% of lines within first 60 chars
  if (timestampValues.length >= lines.length * 0.6) {
    const avgLen = Math.round(timestampValues.reduce((s, t) => s + t.length, 0) / timestampValues.length);
    const pattern = timestampValues[0].pattern;

    let regexPattern;
    switch (pattern) {
      case 'iso8601': regexPattern = '(?<timestamp>\\d{4}-\\d{2}-\\d{2}[T ]\\d{2}:\\d{2}:\\d{2}(?:\\.\\d+)?(?:Z|[+-]\\d{2}:?\\d{2})?)'; break;
      case 'bracket': regexPattern = '(?<timestamp>\\[\\d{4}-\\d{2}-\\d{2}[T ]\\d{2}:\\d{2}:\\d{2}(?:\\.\\d+)?(?:Z|[+-]\\d{2}:?\\d{2})?\\])'; break;
      case 'syslog': regexPattern = '(?<timestamp>[A-Z][a-z]{2}\\s+\\d{1,2}\\s+\\d{2}:\\d{2}:\\d{2})'; break;
      case 'bracket_syslog': regexPattern = '(?<timestamp>\\[[A-Z][a-z]{2}\\s+\\d{1,2}\\s+\\d{2}:\\d{2}:\\d{2}\\])'; break;
      case 'syslog2': regexPattern = '(?<timestamp>\\d{4}-\\d{2}-\\d{2}[T ]\\d{2}:\\d{2}:\\d{2})'; break;
      case 'hdfs': regexPattern = '(?<timestamp>\\d{8}\\s+\\d{2}:\\d{2}:\\d{2})'; break;
      case 'epoch': regexPattern = '(?<timestamp>\\b\\d{10}(?:\\.\\d+)?\\b)'; break;
      default: regexPattern = '(?<timestamp>\\S+)';
    }

    return {
      confidence: Math.round(80 + (timestampValues.length / lines.length) * 20),
      samples: timestampValues.map(t => t.value),
      pattern: regexPattern,
      maxIndex: Math.max(...timestampValues.map(t => t.index + t.length))
    };
  }
  return null;
}

function detectCommonLevel(lines, timestampInfo) {
  const levelValues = [];
  const startOffset = timestampInfo ? timestampInfo.maxIndex : 0;

  for (const line of lines) {
    const segment = line.slice(startOffset).trim();
    const firstWord = segment.split(/\s+/)[0] || '';
    const upper = firstWord.toUpperCase();
    if (LEVEL_KEYWORDS.includes(upper)) {
      levelValues.push({ value: firstWord, index: line.indexOf(firstWord) });
    } else {
      // Try to find a level keyword anywhere in the first ~60 chars
      const earlySegment = line.slice(startOffset, startOffset + 60);
      for (const kw of LEVEL_KEYWORDS) {
        const idx = earlySegment.toUpperCase().indexOf(kw);
        if (idx !== -1) {
          levelValues.push({ value: earlySegment.slice(idx, idx + kw.length), index: startOffset + idx });
          break;
        }
      }
    }
  }

  if (levelValues.length >= lines.length * 0.6) {
    const maxEnd = Math.max(...levelValues.map(lv => lv.index + lv.value.length));
    const regexPattern = '(?<level>\\S+)';
    return {
      confidence: Math.round(80 + (levelValues.length / lines.length) * 20),
      samples: levelValues.map(l => l.value),
      pattern: regexPattern,
      maxIndex: maxEnd
    };
  }
  return null;
}

function detectTrailingData(lines, timestampInfo, levelInfo) {
  // Extract everything after level/message and detect key=value pairs or JSON
  const startOffset = Math.max(
    timestampInfo ? timestampInfo.maxIndex : 0,
    levelInfo ? levelInfo.maxIndex : 0
  );

  // Check for key=value pairs in the trailing data
  const kvPattern = /(\w+)=["']?([^\s"']+)["']?/g;
  const allKeys = {};
  const allValues = {};

  for (const line of lines) {
    const trailing = line.slice(startOffset);
    let match;
    while ((match = kvPattern.exec(trailing)) !== null) {
      const key = match[1];
      const value = match[2];
      if (!allKeys[key]) allKeys[key] = [];
      allKeys[key].push(value);
      if (!allValues[key]) allValues[key] = new Set();
      allValues[key].add(value);
    }
  }

  const fields = [];
  const keyThreshold = Math.max(2, lines.length * 0.3);

  for (const [key, values] of Object.entries(allKeys)) {
    if (values.length >= keyThreshold) {
      const classified = classifyFieldType(values);
      fields.push({
        name: key,
        type: classified.type,
        confidence: Math.min(95, classified.confidence + 10),
        samples: [...new Set(values)].slice(0, 5),
        value: key,
        pattern: '\\S+'
      });
    }
  }

  if (fields.length > 0) {
    return { fields, confidence: 85 };
  }

  // Check for trailing JSON
  const jsonValues = [];
  for (const line of lines) {
    const trailing = line.slice(startOffset).trim();
    const jsonMatch = trailing.match(/\{.*\}/);
    if (jsonMatch) {
      try { JSON.parse(jsonMatch[0]); jsonValues.push(jsonMatch[0]); } catch { /* not valid JSON */ }
    }
  }
  if (jsonValues.length >= lines.length * 0.5) {
    fields.push({
      name: 'metadata',
      type: 'json',
      confidence: 85,
      samples: jsonValues.slice(0, 3),
      pattern: '\\{.*\\}'
    });
    return { fields, confidence: 85 };
  }

  return null;
}

function extractMessageSamples(lines, timestampInfo, levelInfo, trailingInfo) {
  const messages = [];
  for (const line of lines) {
    let start = 0;
    if (timestampInfo) start = Math.max(start, timestampInfo.maxIndex);
    if (levelInfo) start = Math.max(start, levelInfo.maxIndex);

    let end = line.length;
    if (trailingInfo && trailingInfo.fields.length > 0) {
      // Find where trailing data starts by looking for known keys
      const trailing = line.slice(start);
      for (const tf of trailingInfo.fields) {
        const idx = trailing.indexOf(tf.value + '=');
        if (idx !== -1) {
          end = start + idx;
          break;
        }
      }
    }

    const msg = line.slice(start, end).trim();
    if (msg) messages.push(msg);
  }
  return messages;
}

function generateFewShotRegex(sampleLine, selections) {
  if (!sampleLine || !selections?.length) {
    return { success: false, error: 'Sample line and field selections required' };
  }

  const sorted = [...selections].sort((a, b) => a.start - b.start);
  let regexParts = [];
  let lastEnd = 0;

  for (const sel of sorted) {
    const literal = escapeRegex(sampleLine.slice(lastEnd, sel.start));
    if (literal) regexParts.push(literal);

    const pattern = sel.fieldType === 'date' ? '(?<' + sel.fieldName + '>\\S+)'
      : sel.fieldType === 'number' ? '(?<' + sel.fieldName + '>-?\\d+(?:\\.\\d+)?)'
      : sel.fieldType === 'ip' ? '(?<' + sel.fieldName + '>\\S+)'
      : sel.fieldType === 'email' ? '(?<' + sel.fieldName + '>\\S+@\\S+\\.\\S+)'
      : '(?<' + sel.fieldName + '>\\S+)';
    regexParts.push(pattern);
    lastEnd = sel.end;
  }

  const remaining = escapeRegex(sampleLine.slice(lastEnd));
  if (remaining) regexParts.push(remaining);

  return { success: true, regexPattern: '^' + regexParts.join('') + '$' };
}

module.exports = { inferSchema, generateFewShotRegex, classifyFieldType, detectDelimiter };
