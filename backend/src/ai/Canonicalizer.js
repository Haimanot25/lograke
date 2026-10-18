/**
 * Canonicalizer.js
 * Universal Log Normalizer & Multiline Preprocessor.
 * Resolves: Property Key Mismatches, Local Timezone Skew, and Level Suppression.
 */

const UNIVERSAL_STATE_REGEX = /\b(state|status|mode)\b.*?\b(changed|switched|transitioned|moved)\b.*?\b(from|to)\b/i;
const ARROW_TRANSITION_REGEX = /\b[A-Z0-9_-]+\s*->\s*[A-Z0-9_-]+\b/;

const MONTH_MAP = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11
};

let runningEpochContext = 0;

/**
 * Robustly extracts raw string text from plain strings or objects using any common key name
 */
function extractRawString(log) {
  if (typeof log === 'string') return log;
  if (!log || typeof log !== 'object') return String(log || '');

  if (log.raw) return String(log.raw);
  if (log.line) return String(log.line);
  if (log.text) return String(log.text);
  if (log.content) return String(log.content);

  if (log.message && log.msg) return log.message + ' ' + log.msg;
  if (log.message) return String(log.message);
  if (log.msg) return String(log.msg);

  try {
    return JSON.stringify(log);
  } catch (e) {
    return String(log);
  }
}

/**
 * Universal Timestamp Normalizer
 * Extracts ISO-8601, BSD Syslog, or Epoch patterns embedded anywhere inside raw text or JSON.
 */
function normalizeTimestamp(rawInput, lastKnownEpoch = 0) {
  if (!rawInput) return { iso: new Date(lastKnownEpoch).toISOString(), epoch: lastKnownEpoch };

  const str = String(rawInput).trim();

  // 1. Standalone 10-13 Digit Epoch
  if (/^\d{10,13}$/.test(str)) {
    const num = Number(str);
    const epoch = num < 1e11 ? num * 1000 : num;
    return { iso: new Date(epoch).toISOString(), epoch };
  }

  // 2. ISO-8601 Substring (e.g., 2026-08-10T15:00:00.000Z or time=2026-08-10T15:00:30Z)
  const isoMatch = str.match(/\b\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?\b/i);
  if (isoMatch) {
    let dateStr = isoMatch[0].replace(' ', 'T');
    if (!/Z|[+-]\d{2}:?\d{2}$/i.test(dateStr)) dateStr += 'Z';
    const epoch = Date.parse(dateStr);
    if (!isNaN(epoch)) return { iso: new Date(epoch).toISOString(), epoch };
  }

  // 3. BSD Syslog Substring (e.g., Aug 10 15:00:15)
  // Force strict UTC epoch generation via Date.UTC() to neutralize host OS timezone interference
  const bsdMatch = str.match(/\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(\d{1,2})\s+(\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?/i);
  if (bsdMatch) {
    const [_, monthStr, day, hrs, mins, secs, ms] = bsdMatch;
    const year = new Date().getUTCFullYear();
    const monthIdx = MONTH_MAP[monthStr.toLowerCase()] ?? 0;
    const dayNum = parseInt(day, 10);
    const hrsNum = parseInt(hrs, 10);
    const minsNum = parseInt(mins, 10);
    const secsNum = parseInt(secs, 10);
    const msNum = ms ? parseInt(ms.padEnd(3, '0').slice(0, 3), 10) : 0;

    const epoch = Date.UTC(year, monthIdx, dayNum, hrsNum, minsNum, secsNum, msNum);
    return { iso: new Date(epoch).toISOString(), epoch };
  }

  // 4. Epoch Number Embedded at Start of Line (e.g. 1786370460000 | INFO | ...)
  const epochLeadMatch = str.match(/^(\d{10,13})\b/);
  if (epochLeadMatch) {
    const num = Number(epochLeadMatch[1]);
    const epoch = num < 1e11 ? num * 1000 : num;
    return { iso: new Date(epoch).toISOString(), epoch };
  }

  return { iso: new Date(lastKnownEpoch).toISOString(), epoch: lastKnownEpoch };
}

function flattenObject(obj, prefix, res) {
  if (!prefix) prefix = '';
  if (!res) res = {};
  if (!obj || typeof obj !== 'object') return res;
  for (const [key, value] of Object.entries(obj)) {
    const newKey = prefix ? prefix + '.' + key : key;
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      flattenObject(value, newKey, res);
    } else {
      res[newKey] = value;
    }
  }
  return res;
}

/**
 * Dynamic severity and metadata extractor
 */
function extractDynamicFields(logInput) {
  const rawStr = extractRawString(logInput);
  let effectiveLevel = null;
  let statusCode = null;
  let actionResult = null;

  let searchObj = typeof logInput === 'object' && logInput !== null ? logInput : {};

  if (rawStr.startsWith('{') && rawStr.endsWith('}')) {
    try {
      searchObj = { ...searchObj, ...JSON.parse(rawStr) };
    } catch (e) { /* Non-JSON */ }
  }

  const flat = flattenObject(searchObj);

  // Direct severity regex scan on full raw string text
  const severeMatch = rawStr.match(/\b(FATAL|CRIT|CRITICAL|EMERG|ERROR|ERR|WARN|WARNING)\b/i);
  if (severeMatch) {
    effectiveLevel = severeMatch[1].toUpperCase();
  } else if (searchObj.level && String(searchObj.level).toUpperCase() !== 'INFO') {
    effectiveLevel = String(searchObj.level).toUpperCase();
  } else {
    effectiveLevel = 'INFO';
  }

  // Standardize severity levels
  if (['ERR', 'FATAL', 'CRIT', 'CRITICAL', 'EMERG'].includes(effectiveLevel)) {
    effectiveLevel = 'ERROR';
  } else if (effectiveLevel === 'WARNING') {
    effectiveLevel = 'WARN';
  }

  // Extract Status Code (4xx / 5xx)
  const codeKey = Object.keys(flat).find(k => /status|code|result|rc|httpStatus/i.test(k));
  if (codeKey && !isNaN(flat[codeKey])) {
    statusCode = Number(flat[codeKey]);
  } else {
    const match = rawStr.match(/"?(?:status|statusCode|code)"?\s*[:=]\s*"?([45]\d{2})"?/i);
    if (match) statusCode = parseInt(match[1], 10);
  }

  // Extract Action Result
  const matchAction = rawStr.match(/"?(?:action|decision|result)"?\s*[:=]\s*"(deny|reject|failed|blocked|invalid)"/i);
  if (matchAction) actionResult = matchAction[1].toUpperCase();

  return { effectiveLevel, statusCode, actionResult, rawStr };
}

function canonicalize(logInput, index) {
  if (index === undefined || index === null) index = 0;
  const rawStr = extractRawString(logInput);

  // Use rawStr for timestamp extraction (original line text).
  // Avoids host timezone pollution from AdaptiveParser's pre-computed epoch.
  const { iso, epoch } = normalizeTimestamp(rawStr, runningEpochContext);
  if (epoch > 0) runningEpochContext = epoch;

  const { effectiveLevel, statusCode, actionResult } = extractDynamicFields(logInput);
  const isStateTransition = UNIVERSAL_STATE_REGEX.test(rawStr) || ARROW_TRANSITION_REGEX.test(rawStr);

  return {
    originalIndex: index,
    timestampIso: iso,
    timestampEpochMs: epoch,
    effectiveLevel,
    statusCode,
    actionResult,
    isStateTransition,
    raw: rawStr,
    category: (typeof logInput === 'object' && logInput !== null && logInput.category) || 'general'
  };
}

function resetEpochContext() {
  runningEpochContext = 0;
}

module.exports = {
  canonicalize,
  normalizeTimestamp,
  extractDynamicFields,
  extractRawString,
  resetEpochContext
};
