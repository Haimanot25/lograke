/**
 * PatternDetector - Clusters logs into templates to identify recurring and unique events.
 * Enhanced with: percentage, timestamps, HTTP status detection, frequency bands,
 * IPv6 normalization, block ID normalization, HDFS compact timestamps.
 */

const REPLACEMENTS = [
  // UUIDs (must be before HEX to avoid false matches)
  { regex: /\b[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\b/g, replacement: '<UUID>' },
  // IPv6 addresses
  { regex: /\b([0-9a-fA-F]{1,4}(?::[0-9a-fA-F]{1,4}){7})\b/g, replacement: '<IPV6>' },
  // IPv4 addresses (with optional port)
  { regex: /\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}(:\d+)?\b/g, replacement: '<IP>' },
  // MAC addresses
  { regex: /\b[0-9a-fA-F]{2}(?::[0-9a-fA-F]{2}){5}\b/g, replacement: '<MAC>' },
  // HDFS block IDs
  { regex: /\bblk_-?\d{10,20}\b/g, replacement: '<BLOCK_ID>' },
  // Hex values (0x...) and HRESULT
  { regex: /\b0x[0-9a-fA-F]{4,}\b/g, replacement: '<HEX>' },
  // File paths
  { regex: /\b(?:\/[a-zA-Z0-9._-]+){2,}\b/g, replacement: '<PATH>' },
  // ISO 8601 timestamps
  { regex: /\b\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})?\b/g, replacement: '<TIMESTAMP>' },
  // HDFS compact timestamps (20161029142320.050388)
  { regex: /\b\d{4}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])\d{6}[.,]\d{3,6}\b/g, replacement: '<TIMESTAMP>' },
  // Syslog-style timestamps (Jul 14 10:15:30)
  { regex: /\b[A-Z][a-z]{2}\s+\d{1,2}\s+\d{2}:\d{2}:\d{2}\b/g, replacement: '<TIMESTAMP>' },
  // Bracket timestamps [2026.07.14 10.15.30.123]
  { regex: /\[\d{4}\.\d{2}\.\d{2}\s+\d{2}\.\d{2}\.\d{2}\.\d{3}\]/g, replacement: '<TIMESTAMP>' },
  // Epoch timestamps (10-13 digits)
  { regex: /\b\d{10,13}\b/g, replacement: '<EPOCH>' },
  // Email addresses
  { regex: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, replacement: '<EMAIL>' },
  // Quoted strings
  { regex: /"[^"]{1,200}"/g, replacement: '"<STRING>"' },
  { regex: /'[^']{1,200}'/g, replacement: "'<STRING>'" },
  // Session/Trace/Correlation IDs: prefix_hex (e.g., txn_a1b2c3d4, req_9f8e7d6c, session_abc123)
  { regex: /\b(?:txn|req|session|trace|span|corr|trans)_[0-9a-fA-F]{6,}\b/g, replacement: '<TRACE_ID>' },
  // Numbers (must be last — most greedy)
  { regex: /\b\d+(?:\.\d+)?\b/g, replacement: '<NUM>' }
];

const HTTP_STATUS_RE = /\b(?:HTTP\/[\d.]+|status[=:]\s*)?([1-5]\d{2})\b/g;

function getTemplate(message) {
  if (!message) return '';
  let template = message;
  for (const { regex, replacement } of REPLACEMENTS) {
    template = template.replace(regex, replacement);
  }
  return template.replace(/\s+/g, ' ').trim();
}

function extractHttpStatuses(message) {
  if (!message) return [];
  const statuses = [];
  let match;
  const re = new RegExp(HTTP_STATUS_RE.source, 'gi');
  while ((match = re.exec(message)) !== null) {
    const code = parseInt(match[1], 10);
    if (code >= 100 && code < 600) statuses.push(code);
  }
  return statuses;
}

function getFrequencyBand(count, total) {
  if (total === 0) return 'rare';
  const pct = (count / total) * 100;
  if (pct >= 10) return 'dominant';
  if (pct >= 1) return 'common';
  if (pct >= 0.1) return 'occasional';
  return 'rare';
}

function detectPatterns(parsedLogs) {
  const patternMap = new Map();
  const totalLogs = parsedLogs.length;
  const midpoint = Math.floor(totalLogs / 2);

  parsedLogs.forEach((log) => {
    const template = getTemplate(log.message);
    const key = `${log.level}::${template}`;

    if (!patternMap.has(key)) {
      patternMap.set(key, {
        id: '',
        template,
        level: log.level,
        count: 0,
        percentage: 0,
        frequencyBand: 'rare',
        examples: [],
        logs: [],
        firstSeen: null,
        lastSeen: null,
        httpStatuses: [],
        services: {},
        categories: {}
      });
    }

    const group = patternMap.get(key);
    group.count++;
    group.logs.push(log.index);

    // Track trend: first-half vs second-half occurrence
    if (log.index < midpoint) group.firstHalfCount = (group.firstHalfCount || 0) + 1;
    else group.secondHalfCount = (group.secondHalfCount || 0) + 1;

    const ts = log.timestamp ? new Date(log.timestamp).getTime() : null;
    if (ts) {
      if (!group.firstSeen || ts < group.firstSeen) group.firstSeen = ts;
      if (!group.lastSeen || ts > group.lastSeen) group.lastSeen = ts;
    }

    if (group.examples.length < 5 && !group.examples.includes(log.message)) {
      group.examples.push(log.message);
    }

    const statuses = extractHttpStatuses(log.message);
    if (statuses.length) {
      statuses.forEach(s => {
        const existing = group.httpStatuses.find(h => h.code === s);
        if (existing) existing.count++;
        else group.httpStatuses.push({ code: s, count: 1 });
      });
    }

    if (log.service) {
      group.services[log.service] = (group.services[log.service] || 0) + 1;
    }
    if (log.category) {
      group.categories[log.category] = (group.categories[log.category] || 0) + 1;
    }
  });

  const patterns = Array.from(patternMap.values());

  patterns.forEach(p => {
    p.percentage = totalLogs > 0 ? Math.round((p.count / totalLogs) * 10000) / 100 : 0;
    p.frequencyBand = getFrequencyBand(p.count, totalLogs);
    p.httpStatuses.sort((a, b) => b.count - a.count);
    // Trend: positive = increasing, negative = decreasing
    const first = p.firstHalfCount || 0;
    const second = p.secondHalfCount || 0;
    if (first + second > 0) {
      p.trend = Math.round(((second - first) / (first + second)) * 100);
    } else {
      p.trend = 0;
    }
    delete p.firstHalfCount;
    delete p.secondHalfCount;
  });

  patterns.sort((a, b) => b.count - a.count);

  patterns.forEach((p, i) => {
    p.id = `pat_${i + 1}`;
  });

  return patterns;
}

/**
 * Aggregate patterns across severity levels — collapses FATAL+ERROR+WARN into unified groups
 */
function detectPatternsAggregated(parsedLogs) {
  const patternMap = new Map();
  const totalLogs = parsedLogs.length;

  parsedLogs.forEach((log) => {
    const template = getTemplate(log.message);
    // Key is template-only (no level prefix) to aggregate across levels
    const key = template;

    if (!patternMap.has(key)) {
      patternMap.set(key, {
        id: '',
        template,
        levelDistribution: {},
        count: 0,
        percentage: 0,
        frequencyBand: 'rare',
        examples: [],
        logs: [],
        firstSeen: null,
        lastSeen: null,
        httpStatuses: [],
        services: {},
        categories: {}
      });
    }

    const group = patternMap.get(key);
    group.count++;
    group.logs.push(log.index);
    group.levelDistribution[log.level] = (group.levelDistribution[log.level] || 0) + 1;

    const ts = log.timestamp ? new Date(log.timestamp).getTime() : null;
    if (ts) {
      if (!group.firstSeen || ts < group.firstSeen) group.firstSeen = ts;
      if (!group.lastSeen || ts > group.lastSeen) group.lastSeen = ts;
    }

    if (group.examples.length < 5 && !group.examples.includes(log.message)) {
      group.examples.push(log.message);
    }

    const statuses = extractHttpStatuses(log.message);
    if (statuses.length) {
      statuses.forEach(s => {
        const existing = group.httpStatuses.find(h => h.code === s);
        if (existing) existing.count++;
        else group.httpStatuses.push({ code: s, count: 1 });
      });
    }

    if (log.service) {
      group.services[log.service] = (group.services[log.service] || 0) + 1;
    }
    if (log.category) {
      group.categories[log.category] = (group.categories[log.category] || 0) + 1;
    }
  });

  const patterns = Array.from(patternMap.values());
  patterns.forEach(p => {
    p.percentage = totalLogs > 0 ? Math.round((p.count / totalLogs) * 10000) / 100 : 0;
    p.frequencyBand = getFrequencyBand(p.count, totalLogs);
    p.httpStatuses.sort((a, b) => b.count - a.count);
    p.dominantLevel = Object.entries(p.levelDistribution).sort((a, b) => b[1] - a[1])[0]?.[0] || 'INFO';
  });

  patterns.sort((a, b) => b.count - a.count);
  patterns.forEach((p, i) => { p.id = `pat_${i + 1}`; });

  return patterns;
}

module.exports = {
  getTemplate,
  detectPatterns,
  detectPatternsAggregated
};
