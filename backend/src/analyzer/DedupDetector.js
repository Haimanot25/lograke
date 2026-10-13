/**
 * DedupDetector — Detects duplicate and near-duplicate log entries.
 *
 * Strategy:
 *  1. Exact dedup: Hash the normalized message → identical hashes = duplicates.
 *  2. Near-dedup: Strip variable parts (timestamps, UUIDs, IPs, numbers) before hashing.
 *  3. Keeps first occurrence + count. Subsequent duplicates get `isDuplicate: true`.
 */

const crypto = require('crypto');

const VARIABLE_PATTERNS = [
  /\b\d{10,13}\b/g,                          // Unix timestamps
  /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, // UUIDs
  /\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/g,  // IPv4
  /\b[0-9a-f:]{6,39}\b/gi,                    // IPv6 (broad)
  /\b\d+\.\d{3}s\b/g,                         // Duration: 1.234s
  /\b\d+\.\d+ms\b/g,                          // Duration: 1.234ms
  /timestamp[=:]\s*["']?[\dT:\-\.]+/gi,       // timestamp fields
  /\b\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}[^\s]*/g,  // ISO timestamps
  /\b\d{17,19}\b/g,                            // Nanosecond timestamps
  /\b\d{4,}\b/g,                               // Large numbers (IDs, counters)
  /\b0x[0-9a-f]+\b/gi,                         // Hex addresses
];

function normalizeMessage(message) {
  let normalized = message;
  for (const pattern of VARIABLE_PATTERNS) {
    normalized = normalized.replace(pattern, '<VAR>');
  }
  return normalized;
}

function hashString(str) {
  return crypto.createHash('md5').update(str).digest('hex');
}

/**
 * Detect duplicates in parsedLogs.
 * Mutates each log entry, adding:
 *  - `duplicateCount`: number of times this exact message appears (1 = unique)
 *  - `isDuplicate`: true if this is a non-first occurrence
 *  - `fingerprint`: the normalized message hash
 *
 * Returns summary: { total, unique, duplicates, groups }
 */
function detectDuplicates(parsedLogs) {
  const exactMap = new Map();   // hash → first index
  const nearMap = new Map();    // nearHash → first index
  let duplicateCount = 0;

  for (let i = 0; i < parsedLogs.length; i++) {
    const log = parsedLogs[i];
    const message = log.message || '';

    const exactHash = hashString(message);
    const nearHash = hashString(normalizeMessage(message));

    log.fingerprint = nearHash;

    if (exactMap.has(exactHash)) {
      const firstIdx = exactMap.get(exactHash);
      if (parsedLogs[firstIdx].duplicateCount === undefined) {
        parsedLogs[firstIdx].duplicateGroup = firstIdx;
        parsedLogs[firstIdx].duplicateCount = 1;
      }
      parsedLogs[firstIdx].duplicateCount++;
      log.isDuplicate = true;
      log.duplicateGroup = firstIdx;
      duplicateCount++;
    } else {
      exactMap.set(exactHash, i);
    }

    if (!nearMap.has(nearHash)) {
      nearMap.set(nearHash, i);
    }
  }

  return {
    total: parsedLogs.length,
    unique: exactMap.size,
    duplicates: duplicateCount,
    nearUniqueGroups: nearMap.size
  };
}

module.exports = { detectDuplicates, normalizeMessage };
