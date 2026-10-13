/**
 * EnhancedParser - Multi-format log parser with streaming support
 * Handles: JSON, XML, CSV, plain text, and all loghub formats
 * Supports: HDFS, BGL, Thunderbird, HealthApp, HPC, Proxifier, Android, Mac, etc.
 */

const fs = require('fs');
const path = require('path');
const { parseLogLine, extractLevel } = require('./AdaptiveParser');
const { formatParsers } = require('./formatParsers');

const XML_PATTERNS = {
  eventTag: /<event[^>]*>([\s\S]*?)<\/event>/gi,
  xmlTag: /<(\w+)>([^<]*)<\/\1>/g,
  attribute: /(\w+)=["']([^"']*)["']/g
};

/* ── Timestamp patterns (11+ formats) ───────────────────────── */
const TS_PATTERNS = [
  { re: /\b(\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:[.,]\d+)?(?:Z|[+-]\d{2}:?\d{2})?)\b/g, type: 'iso8601' },
  { re: /\[(\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}[^\]]*)\]/g, type: 'bracket' },
  { re: /\[(\d{4}\.\d{2}\.\d{2}\s+\d{2}\.\d{2}\.\d{2}\.\d{3})\]/g, type: 'proxifier' },
  { re: /\b(\d{4}\d{2}\d{2}\d{2}\d{2}\d{2}(?:[.,]\d+)?)\b/g, type: 'hdfs-compact' },
  { re: /\b(\d{10,13}(?:\.\d+)?)\b/g, type: 'epoch' },
  { re: /^\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}\.\d{3}/, type: 'android' },
  { re: /^[A-Z][a-z]{2}\s+\d{1,2}\s+\d{2}:\d{2}:\d{2}/, type: 'syslog' }
];

/* ── Entity extraction patterns ─────────────────────────────── */
const ENTITY_PATTERNS = {
  ipv6: /\b([0-9a-fA-F]{1,4}(?::[0-9a-fA-F]{1,4}){7})\b/g,
  ipv4: /\b(\d{1,3}(?:\.\d{1,3}){3})(?::(\d+))?\b/g,
  uuid: /\b([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})\b/g,
  hdfsBlock: /\b(blk_-?\d{10,20})\b/g,
  hexHRESULT: /\b(0x[0-9a-fA-F]{8})\b/g,
  macAddr: /\b([0-9a-fA-F]{2}(?::[0-9a-fA-F]{2}){5})\b/g,
  email: /\b([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})\b/g
};

/* ── Format detection ───────────────────────────────────────── */
function detectFormat(content, filename) {
  const ext = path.extname(filename).toLowerCase();
  const firstNonEmpty = content.split('\n').find(l => l.trim());
  if (!firstNonEmpty) return 'text';

  if (ext === '.json' || firstNonEmpty.trim().startsWith('{') || firstNonEmpty.trim().startsWith('[')) {
    try { JSON.parse(firstNonEmpty); return 'json-lines'; } catch { /* not JSON */ }
  }
  if (ext === '.xml' || firstNonEmpty.trim().startsWith('<')) return 'xml';
  if (ext === '.csv') return 'csv';
  if (ext === '.tsv') return 'tsv';
  if (content.includes('<event') || content.includes('<log')) return 'xml';

  // Detect loghub-specific formats by content sniffing
  if (/^\d{4}\d{2}\d{2}\d{2}\d{2}\d{2}[.,]\d+/.test(firstNonEmpty)) return 'hdfs';
  if (/^\d{2}:\d{2}:\d{2}\.\d{3}\s/.test(firstNonEmpty)) return 'healthapp';
  if (/^\[\d{4}\.\d{2}\.\d{2}/.test(firstNonEmpty)) return 'proxifier';
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2},\d{3}\s+(INFO|WARN|ERROR|DEBUG)/.test(firstNonEmpty)) return 'bgl';
  if (/^\d+-\d+-\d+\s+/.test(firstNonEmpty)) return 'thunderbird';

  return 'text';
}

/* ── Timestamp extraction (multi-format) ────────────────────── */
function extractTimestamp(line) {
  if (!line) return null;

  // Brackets first (highest confidence)
  const bracketMatch = line.match(/\[(\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}[^\]]*)\]/);
  if (bracketMatch) {
    const d = new Date(bracketMatch[1].replace(',', '.'));
    if (!isNaN(d.getTime())) return d.toISOString();
  }

  // Proxifier bracket-dot: [2026.07.14 10.15.30.123]
  const proxMatch = line.match(/\[(\d{4}\.\d{2}\.\d{2}\s+\d{2}\.\d{2}\.\d{2}\.\d{3})\]/);
  if (proxMatch) {
    const d = new Date(proxMatch[1].replace(/\./g, (m, i) => i < 10 ? (i === 7 || i === 10 ? '-' : i === 13 ? ' ' : i === 16 || i === 19 ? ':' : m) : '.'));
    if (!isNaN(d.getTime())) return d.toISOString();
  }

  // ISO 8601
  const isoMatch = line.match(/(\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:[.,]\d+)?(?:Z|[+-]\d{2}:?\d{2})?)/);
  if (isoMatch) {
    const d = new Date(isoMatch[1].replace(',', '.'));
    if (!isNaN(d.getTime())) return d.toISOString();
  }

  // HDFS compact: 20161029142320.050388
  const hdfsMatch = line.match(/\b(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})[.,](\d{3,6})\b/);
  if (hdfsMatch) {
    const d = new Date(`${hdfsMatch[1]}-${hdfsMatch[2]}-${hdfsMatch[3]}T${hdfsMatch[4]}:${hdfsMatch[5]}:${hdfsMatch[6]}.${hdfsMatch[7].padEnd(3, '0')}`);
    if (!isNaN(d.getTime())) return d.toISOString();
  }

  // Syslog (no year): "Jul 14 10:15:30"
  const syslogMatch = line.match(/^([A-Z][a-z]{2})\s+(\d{1,2})\s+(\d{2}:\d{2}:\d{2})/);
  if (syslogMatch) {
    const d = new Date(`${syslogMatch[1]} ${syslogMatch[2]} ${new Date().getFullYear()} ${syslogMatch[3]}`);
    if (!isNaN(d.getTime())) return d.toISOString();
  }

  // Android: "07-14 10:15:30.123"
  const androidMatch = line.match(/^(\d{2})-(\d{2})\s+(\d{2}:\d{2}:\d{2}\.\d{3})/);
  if (androidMatch) {
    const d = new Date(`${new Date().getFullYear()}-${androidMatch[1]}-${androidMatch[2]}T${androidMatch[3]}`);
    if (!isNaN(d.getTime())) return d.toISOString();
  }

  // Epoch (10-13 digits)
  const epochMatch = line.match(/\b(\d{10,13})\b/);
  if (epochMatch) {
    const num = parseInt(epochMatch[1], 10);
    const d = new Date(num > 1e12 ? num : num * 1000);
    if (!isNaN(d.getTime()) && d.getFullYear() > 2000 && d.getFullYear() < 2100) return d.toISOString();
  }

  return null;
}

/* ── Entity extraction from text ────────────────────────────── */
function extractEntities(text) {
  if (!text) return {};
  const ids = {};
  const metadata = {};

  for (const [type, re] of Object.entries(ENTITY_PATTERNS)) {
    const localRe = new RegExp(re.source, re.flags);
    let match;
    while ((match = localRe.exec(text)) !== null) {
      if (type === 'ipv6' && !ids.ip) ids.ip = match[1];
      else if (type === 'ipv4') {
        if (!ids.ip) ids.ip = match[1];
        if (match[2]) metadata.port = parseInt(match[2], 10);
      }
      else if (type === 'uuid' && !ids.uuid) ids.uuid = match[1];
      else if (type === 'hdfsBlock' && !ids.blockId) ids.blockId = match[1];
      else if (type === 'hexHRESULT' && !metadata.hresult) metadata.hresult = match[1];
      else if (type === 'macAddr' && !ids.mac) ids.mac = match[1];
      else if (type === 'email' && !ids.email) ids.email = match[1];
    }
  }

  // Key=value pairs
  const kvPairs = [...text.matchAll(/\b([a-zA-Z][a-zA-Z0-9._-]*)\s*[:=]\s*([A-Za-z0-9._:\/-]+)/g)];
  for (const [, key, value] of kvPairs) {
    const lk = key.toLowerCase();
    if (lk.includes('user') && !ids.userId) ids.userId = value;
    else if (lk.includes('session') && !ids.sessionId) ids.sessionId = value;
    else if (lk.includes('transaction') && !ids.transactionId) ids.transactionId = value;
    else if (lk.includes('request') && !ids.requestId) ids.requestId = value;
    else if (lk.includes('trace') && !ids.traceId) ids.traceId = value;
    else if (lk.includes('host') && !metadata.hostname) metadata.hostname = value;
    else if (lk.includes('pid') && !metadata.pid) metadata.pid = value;
  }

  return { ids, metadata };
}

/* ── Level detection (extended) ─────────────────────────────── */
function detectLevel(line) {
  if (!line) return 'info';

  // Android single-letter codes at start
  const androidMatch = line.match(/^\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}\.\d{3}\s+\d+\s+\d+\s+([VDIWEF])\s/);
  if (androidMatch) {
    const map = { V: 'debug', D: 'debug', I: 'info', W: 'warn', E: 'error', F: 'error' };
    return map[androidMatch[1]] || 'info';
  }

  // HDFS numeric levels
  const hdfsMatch = line.match(/^(\d{4})\d{12}[.,]\d+\s+(\d+)\s/);
  if (hdfsMatch) {
    const num = parseInt(hdfsMatch[2], 10);
    if (num <= 10) return 'info';
    if (num <= 19) return 'debug';
    if (num === 20) return 'info';
    if (num <= 29) return 'warn';
    if (num === 30) return 'error';
    return 'error';
  }

  // Windows event log levels
  const winMatch = line.match(/^\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}(?:,\d{3})?\s+(Info|Warning|Error|Verbose|Critical|Audit|Failure)/i);
  if (winMatch) {
    const l = winMatch[1].toLowerCase();
    if (['error', 'critical', 'failure', 'audit'].includes(l)) return 'error';
    if (['warning', 'warn'].includes(l)) return 'warn';
    if (['verbose'].includes(l)) return 'debug';
    return 'info';
  }

  // BGL levels: INFO, WARN, ERROR, SEVERE, FATAL, DEBUG, CONFIG, TRACE
  const bglMatch = line.match(/^\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2},\d{3}\s+(\w+)/);
  if (bglMatch) {
    const l = bglMatch[1].toUpperCase();
    if (['ERROR', 'SEVERE', 'FATAL'].includes(l)) return 'error';
    if (['WARN', 'WARNING'].includes(l)) return 'warn';
    if (['DEBUG', 'TRACE', 'CONFIG'].includes(l)) return 'debug';
    return 'info';
  }

  // Standard keyword detection
  if (/\b(FATAL|PANIC|ABORT|SEGFAULT|SIGKILL|OOM)\b/i.test(line)) return 'error';
  if (/\b(ERROR|FAIL|FAILED|FAILURE|EXCEPTION|CRITICAL|SEVERE|DENIED|UNAUTHORIZED|TIMEOUT)\b/i.test(line)) return 'error';
  if (/\b(WARN|WARNING|DEPRECATED|SLOW|THROTTLED|DEGRADED)\b/i.test(line)) return 'warn';
  if (/\b(DEBUG|TRACE|VERBOSE)\b/i.test(line)) return 'debug';

  return 'info';
}

/* ── Repeated message compaction ────────────────────────────── */
function detectRepeatedCount(line) {
  const repeatMatch = line.match(/\((\d+)\) (?:occurrences?|times?|repeats?)/i);
  if (repeatMatch) return parseInt(repeatMatch[1], 10);
  const bracketRepeat = line.match(/\[(?:repeated|count)[:\s]*(\d+)\]/i);
  if (bracketRepeat) return parseInt(bracketRepeat[1], 10);
  return 1;
}

/* ── Stack trace detection ──────────────────────────────────── */
function isStackTraceLine(line) {
  return /^\s+at\s+/.test(line) ||
    /^\s+by\s+/.test(line) ||
    /^\s+in\s+/.test(line) ||
    /^\s+File\s+"/.test(line) ||
    /^\s+Caused by:/.test(line) ||
    /^\s+…\s+\d+\s+more/.test(line) ||
    /^\s*at\s+\S+\.\S+\(/.test(line);
}

/* ── Parse JSON line ────────────────────────────────────────── */
function parseJSONLine(line, index) {
  try {
    const json = JSON.parse(line.trim());
    const obj = Array.isArray(json) ? json[0] : json;
    if (!obj || typeof obj !== 'object') return null;

    const timeKeys = ['time', 'timestamp', '@timestamp', 'date', 'ts', 'datetime', 'createdAt', 'eventTime', 'logTime', 'timeStamp', 'LogTime'];
    const levelKeys = ['level', 'severity', 'log_level', 'status', 'type', 'lvl', 'priority'];
    const msgKeys = ['msg', 'message', 'log', 'text', 'body', 'desc', 'description', 'event', 'content', 'LogMessage'];

    let timestamp = new Date().toISOString();
    for (const key of timeKeys) {
      if (obj[key]) {
        const d = new Date(obj[key]);
        if (!isNaN(d.getTime())) { timestamp = d.toISOString(); break; }
      }
    }

    let level = 'info';
    for (const key of levelKeys) {
      if (obj[key]) { level = extractLevel(String(obj[key])); break; }
    }

    let message = '';
    for (const key of msgKeys) {
      if (obj[key]) { message = String(obj[key]); break; }
    }

    const ids = {};
    const idKeys = ['id', 'uuid', 'userId', 'transactionId', 'requestId', 'traceId', 'spanId', 'correlationId'];
    for (const key of idKeys) {
      if (obj[key]) ids[key] = String(obj[key]);
    }

    const metrics = {};
    const metricKeys = ['duration', 'latency', 'responseTime', 'statusCode', 'count', 'size'];
    for (const key of metricKeys) {
      if (typeof obj[key] === 'number') metrics[key] = obj[key];
    }

    // BGL/Thunderbird dual-timestamp support
    if (obj.timeMillis) {
      const d = new Date(parseInt(obj.timeMillis, 10));
      if (!isNaN(d.getTime())) timestamp = d.toISOString();
    }

    return { index, timestamp, level, message, metadata: { ...obj }, ids, metrics, raw: line, format: 'json' };
  } catch (e) {
    return null;
  }
}

/* ── Parse XML event ────────────────────────────────────────── */
function parseXMLEvent(line, index) {
  try {
    const timeMatch = line.match(/time=["']([^"']*)["']/i) || line.match(/<time>([^<]*)<\/time>/i);
    const timestamp = timeMatch ? (extractTimestamp(timeMatch[1]) || new Date(timeMatch[1]).toISOString()) : new Date().toISOString();
    const levelMatch = line.match(/level=["']([^"']*)["']/i) || line.match(/<level>([^<]*)<\/level>/i);
    const level = levelMatch ? extractLevel(levelMatch[1]) : 'info';
    const msgMatch = line.match(/message=["']([^"']*)["']/i) || line.match(/<message>([^<]*)<\/message>/i) || line.match(/<event>([^<]*)<\/event>/i);
    const message = msgMatch ? msgMatch[1] : line.substring(0, 200);

    const metadata = {};
    let attrMatch;
    while ((attrMatch = XML_PATTERNS.attribute.exec(line)) !== null) {
      metadata[attrMatch[1]] = attrMatch[2];
    }

    const { ids } = extractEntities(line);
    return { index, timestamp, level, message, metadata, ids, metrics: {}, raw: line, format: 'xml' };
  } catch (e) {
    return null;
  }
}

/* ── Parse CSV line ─────────────────────────────────────────── */
function parseCSVLine(line, index, headers = null) {
  try {
    const parts = line.split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/).map(s => s.trim().replace(/^"|"$/g, ''));
    if (!headers || parts.length === 0) return null;

    const obj = {};
    headers.forEach((h, i) => { if (i < parts.length) obj[h] = parts[i]; });

    const timeKeys = ['time', 'timestamp', 'date', 'datetime'];
    const levelKeys = ['level', 'severity'];
    const msgKeys = ['message', 'msg', 'event'];

    let timestamp = new Date().toISOString();
    for (const key of timeKeys) {
      if (obj[key]) {
        const d = new Date(obj[key]);
        if (!isNaN(d.getTime())) { timestamp = d.toISOString(); break; }
      }
    }

    let level = 'info';
    for (const key of levelKeys) {
      if (obj[key]) { level = extractLevel(obj[key]); break; }
    }

    let message = '';
    for (const key of msgKeys) {
      if (obj[key]) { message = obj[key]; break; }
    }

    return { index, timestamp, level, message, metadata: obj, ids: {}, metrics: {}, raw: line, format: 'csv' };
  } catch (e) {
    return null;
  }
}

/* ── Parse TSV ──────────────────────────────────────────────── */
function parseTSVLine(line, index, headers = null) {
  try {
    const parts = line.split('\t').map(s => s.trim());
    return parseCSVLine(parts.join(','), index, headers);
  } catch (e) {
    return null;
  }
}

/* ── Parse pipe-delimited (HealthApp format) ────────────────── */
function parsePipeDelimited(line, index) {
  const parts = line.split('|').map(s => s.trim());
  if (parts.length < 3) return null;

  // HealthApp format: timestamp | level | message | [optional fields...]
  const ts = extractTimestamp(line);
  const level = detectLevel(line);

  // Try to find a level keyword in the second field
  const levelWord = parts.find(p => /^(INFO|WARN|ERROR|DEBUG|VERBOSE|TRACE|FATAL)$/i.test(p));
  const message = levelWord ? parts.filter(p => p !== levelWord && !/^\d{4}/.test(p)).join(' | ') : parts.slice(2).join(' | ');

  const { ids, metadata } = extractEntities(line);
  metadata.pipeFields = parts;

  return {
    index,
    timestamp: ts || new Date().toISOString(),
    level: levelWord ? extractLevel(levelWord) : level,
    message: message || parts.slice(1).join(' | '),
    metadata,
    ids,
    metrics: {},
    raw: line,
    format: 'pipe-delimited'
  };
}

/* ── Format parser wrappers (delegate to shared formatParsers) ── */
function parseHDFSLine(line, index) {
  const shared = formatParsers.hdfs.parseLine(line, index);
  if (!shared) return null;
  const { fields } = shared;
  const ts = extractTimestamp(line);
  const level = detectLevel(line);
  const rest = fields.rest;
  const { ids, metadata } = extractEntities(line);
  const numLevelMatch = rest.match(/^(\d+)\s/);
  if (numLevelMatch) metadata.numericLevel = parseInt(numLevelMatch[1], 10);
  return {
    index, timestamp: ts || new Date().toISOString(), level, message: rest,
    metadata: { ...metadata, format: 'hdfs-compact' }, ids, metrics: {}, raw: line, format: 'hdfs'
  };
}

function parseProxifierLine(line, index) {
  const shared = formatParsers.proxifier.parseLine(line, index);
  if (!shared) return null;
  const { fields } = shared;
  const tsStr = `${fields.year}-${fields.month}-${fields.day}T${fields.hour}:${fields.min}:${fields.sec}.${fields.ms}`;
  const ts = new Date(tsStr);
  const level = detectLevel(line);
  const { ids, metadata } = extractEntities(fields.message);
  return {
    index, timestamp: isNaN(ts.getTime()) ? new Date().toISOString() : ts.toISOString(), level,
    message: fields.message, metadata: { ...metadata, format: 'proxifier' }, ids, metrics: {}, raw: line, format: 'proxifier'
  };
}

function parseBGLLine(line, index) {
  const shared = formatParsers.bgl.parseLine(line, index);
  if (!shared) return null;
  const { fields } = shared;
  const ts = extractTimestamp(line);
  const levelMap = { FATAL: 'error', SEVERE: 'error', ERROR: 'error', WARN: 'warn', WARNING: 'warn', INFO: 'info', DEBUG: 'debug', TRACE: 'debug', CONFIG: 'info' };
  const level = levelMap[fields.levelWord.toUpperCase()] || 'info';
  const message = fields.message;
  const secondTs = extractTimestamp(message);
  const { ids, metadata } = extractEntities(line);
  metadata.source = 'BGL';
  return {
    index, timestamp: ts || (secondTs || new Date().toISOString()), level, message,
    metadata, ids, metrics: {}, raw: line, format: 'bgl'
  };
}

function parseThunderbirdLine(line, index) {
  const shared = formatParsers.thunderbird.parseLine(line, index);
  if (!shared) return null;
  const { fields } = shared;
  const ts = extractTimestamp(line);
  const level = detectLevel(line);
  const pipeParts = fields.pipeParts;
  let message;
  if (pipeParts.length >= 3) {
    message = pipeParts.slice(1).join('|').trim();
  } else {
    message = line;
  }
  const { ids, metadata } = extractEntities(line);
  metadata.source = 'Thunderbird';
  return {
    index, timestamp: ts || new Date().toISOString(), level, message,
    metadata, ids, metrics: {}, raw: line, format: 'thunderbird'
  };
}

function parseHPCLine(line, index) {
  const shared = formatParsers.hpc.parseLine(line, index);
  if (!shared) return null;
  const { fields } = shared;
  const ts = extractTimestamp(line);
  const level = detectLevel(line);
  const { ids, metadata } = extractEntities(line);
  metadata.source = 'HPC';
  if (fields.procMatch) {
    metadata.process = fields.procMatch[1];
    metadata.pid = fields.procMatch[2];
  }
  return {
    index, timestamp: ts || new Date().toISOString(), level, message: line,
    metadata, ids, metrics: {}, raw: line, format: 'hpc'
  };
}

/* ── Main text parse (called by streamParseFile default case) ─ */
function parseTextLine(line, index) {
  const ts = extractTimestamp(line);
  const level = detectLevel(line);
  const repeatCount = detectRepeatedCount(line);
  const { ids, metadata } = extractEntities(line);

  // Detect pipe-delimited
  if (line.includes('|') && line.split('|').length >= 3) {
    return parsePipeDelimited(line, index);
  }

  // HDFS compact
  if (/^\d{4}\d{2}\d{2}\d{2}\d{2}\d{2}[.,]\d+/.test(line)) {
    return parseHDFSLine(line, index);
  }

  // Proxifier
  if (/^\[\d{4}\.\d{2}\.\d{2}/.test(line)) {
    return parseProxifierLine(line, index);
  }

  // BGL
  if (/^\d{4}\d{2}\d{2}\s+\d{2}:\d{2}:\d{2}\.\d+\s+\w+\s/.test(line)) {
    return parseBGLLine(line, index);
  }

  // Thunderbird (date with pipes)
  if (/^\d{2}-\d{2}-\d{4}\s+/.test(line) && line.includes('|')) {
    return parseThunderbirdLine(line, index);
  }

  return {
    index,
    timestamp: ts || new Date().toISOString(),
    level,
    message: line,
    metadata: { ...metadata, repeatedCount: repeatCount > 1 ? repeatCount : undefined },
    ids,
    metrics: {},
    raw: line,
    format: 'text'
  };
}

/* ── Streaming ──────────────────────────────────────────────── */
async function* streamParseFile(filePath, batchSize = 1000, format = null) {
  const readline = require('readline');
  const fileStream = fs.createReadStream(filePath, { encoding: 'utf-8' });
  const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });

  let batch = [];
  let lineIndex = 0;
  let detectedFormat = format;
  let prevMessage = null;
  let repeatStreak = 0;
  let prevParsed = null;

  const flushPrev = () => {
    if (!prevParsed) return;
    if (repeatStreak > 0) {
      prevParsed.metadata = prevParsed.metadata || {};
      prevParsed.metadata.repeatedCount = repeatStreak + 1;
    }
    batch.push(prevParsed);
  };

  for await (const line of rl) {
    if (!line.trim()) continue;

    if (!detectedFormat) {
      detectedFormat = detectFormat(line, filePath);
    }

    let parsed = null;
    switch (detectedFormat) {
      case 'json-lines':
        parsed = parseJSONLine(line, lineIndex);
        break;
      case 'xml':
        parsed = parseXMLEvent(line, lineIndex);
        break;
      case 'csv':
        parsed = parseCSVLine(line, lineIndex, null);
        break;
      case 'tsv':
        parsed = parseTSVLine(line, lineIndex, null);
        break;
      case 'hdfs':
        parsed = parseHDFSLine(line, lineIndex);
        break;
      case 'proxifier':
        parsed = parseProxifierLine(line, lineIndex);
        break;
      case 'bgl':
        parsed = parseBGLLine(line, lineIndex);
        break;
      case 'thunderbird':
        parsed = parseThunderbirdLine(line, lineIndex);
        break;
      case 'healthapp':
        parsed = parsePipeDelimited(line, lineIndex);
        break;
      default:
        parsed = parseTextLine(line, lineIndex);
    }

    if (!parsed) { lineIndex++; continue; }

    const currentMsg = parsed.message;
    if (currentMsg === prevMessage && prevParsed) {
      repeatStreak++;
    } else {
      flushPrev();
      prevMessage = currentMsg;
      prevParsed = parsed;
      repeatStreak = 0;
    }

    if (batch.length >= batchSize) {
      yield { batch, format: detectedFormat };
      batch = [];
    }
    lineIndex++;
  }

  flushPrev();
  if (batch.length > 0) {
    yield { batch, format: detectedFormat };
  }
}

/* ── Full file parse ────────────────────────────────────────── */
async function parseFile(filePath, options = {}) {
  const { batchSize = 1000, detectFormat: shouldDetect = true, format = null } = options;
  const allLogs = [];
  const fileSize = fs.statSync(filePath).size;
  const detectedFormat = shouldDetect ? detectFormat(fs.readFileSync(filePath, 'utf-8'), filePath) : format;

  for await (const chunk of streamParseFile(filePath, batchSize, detectedFormat)) {
    allLogs.push(...chunk.batch);
  }

  return { logs: allLogs, format: detectedFormat, fileSize, totalLogs: allLogs.length, parseDate: new Date().toISOString() };
}

module.exports = {
  detectFormat,
  parseFile,
  streamParseFile,
  parseJSONLine,
  parseXMLEvent,
  parseCSVLine,
  parseTSVLine,
  parsePipeDelimited,
  parseHDFSLine,
  parseProxifierLine,
  parseBGLLine,
  parseThunderbirdLine,
  parseHPCLine,
  extractTimestamp,
  extractEntities,
  detectLevel,
  detectRepeatedCount,
  isStackTraceLine
};
