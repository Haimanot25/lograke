/**
 * LogChunker.js
 * Universal log orchestration, O(N) sliding window, PII scrubbing, and token budgeting.
 */

const { canonicalize, resetEpochContext } = require('./Canonicalizer');

const MAX_ERROR_TOKENS = 8000;
const MAX_NORMAL_SAMPLES = 10;
const NORMAL_SAMPLE_INTERVAL = 40;
const WINDOW_MINUTES = 1;

// Universal Stem Detectors (Domain & Language Independent)
const UNIVERSAL_FAIL_STEMS = /\b(err|fail|fatal|crit|deni|reject|abort|unreach|unhealth|exceed|timeout|block|drop|kill|oom|crash|panic|except(?:ion|ional)?|stack|corrupt|down|refus|violat|hang|deadlock)\w*/i;
const UNIVERSAL_LIFECYCLE_STEMS = /\b(restart|failover|evict|promot|switch|reconnect|drain|scale|heal|recover|term)\w*/i;

// Enterprise PII Scrubbing Rules (GDPR / PCI-DSS / SOC2 Compliance)
const PII_PATTERNS = [
  { regex: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, replacement: '[REDACTED_EMAIL]' },
  { regex: /\b(?:[0-9]{1,3}\.){3}[0-9]{1,3}\b/g, replacement: '<IP_ADDRESS>' },
  { regex: /Bearer\s+[A-Za-z0-9\-._~+/]+=*/gi, replacement: 'Bearer [REDACTED_TOKEN]' },
  { regex: /eyJ[A-Za-z0-9-_=]+\.[A-Za-z0-9-_=]+\.?[A-Za-z0-9-_.+/=]*/g, replacement: '[REDACTED_JWT]' },
  { regex: /\b(?:\d[ -]*?){13,16}\b/g, replacement: '[REDACTED_CARD]' }
];

function redactPII(text) {
  if (!text) return '';
  let scrubbed = String(text);
  for (const { regex, replacement } of PII_PATTERNS) {
    scrubbed = scrubbed.replace(regex, replacement);
  }
  return scrubbed;
}

function extractLogTemplate(rawLog) {
  return (rawLog || '')
    .replace(/[0-9a-fA-F]{8}-(?:[0-9a-fA-F]{4}-){3}[0-9a-fA-F]{12}/g, '<UUID>')
    .replace(/\b0x[0-9a-fA-F]+\b/g, '<HEX>')
    .replace(/\b\d+\b/g, '<NUM>');
}

function estimateTokens(text) {
  return Math.ceil((text || '').length / 4);
}

/**
 * Calculates Token Rarity Score (TF-IDF approximation across batch)
 */
function calculateRarityScores(parsedLogs) {
  const tokenFreq = new Map();
  
  parsedLogs.forEach(log => {
    const template = extractLogTemplate(log.raw || log.message || '').toLowerCase();
    const tokens = template.replace(/[^a-z0-9]/g, ' ').split(/\s+/).filter(t => t.length > 2);
    tokens.forEach(t => tokenFreq.set(t, (tokenFreq.get(t) || 0) + 1));
  });

  return parsedLogs.map(log => {
    const template = extractLogTemplate(log.raw || log.message || '').toLowerCase();
    const tokens = template.replace(/[^a-z0-9]/g, ' ').split(/\s+/).filter(t => t.length > 2);
    if (tokens.length === 0) return 0.0;

    const raritySum = tokens.reduce((acc, t) => acc + (1 / (tokenFreq.get(t) || 1)), 0);
    return Math.min(0.5, (raritySum / tokens.length) * 5);
  });
}

function computeUniversalScore(log, rarityBonus = 0) {
  let score = rarityBonus;
  const searchStr = ((log.message || '') + ' ' + (log.raw || '')).toLowerCase();

  if (log.effectiveLevel === 'ERROR') score += 0.40;
  else if (log.effectiveLevel === 'WARN') score += 0.15;

  if (log.statusCode && log.statusCode >= 500) score += 0.30;
  if (log.actionResult && ['DENY', 'REJECT', 'FAILED', 'BLOCKED', 'INVALID'].includes(log.actionResult)) score += 0.25;
  if (log.isStateTransition) score += 0.25;

  if (UNIVERSAL_FAIL_STEMS.test(searchStr)) score += 0.35;
  if (UNIVERSAL_LIFECYCLE_STEMS.test(searchStr)) score += 0.25;

  return Math.min(1.0, score);
}

function buildTimeWindows(parsedLogs) {
  const buckets = {};
  let minTs = Infinity, maxTs = -Infinity;
  
  for (const log of parsedLogs) {
    const ms = log.timestampEpochMs;
    if (isNaN(ms) || ms === 0) continue;
    if (ms < minTs) minTs = ms;
    if (ms > maxTs) maxTs = ms;
    
    const key = Math.floor(ms / (WINDOW_MINUTES * 60000));
    if (!buckets[key]) buckets[key] = { errors: 0, warns: 0, info: 0, total: 0 };
    
    buckets[key].total++;
    const lvl = log.effectiveLevel || 'INFO';
    if (lvl === 'ERROR' || lvl === 'FATAL') buckets[key].errors++;
    else if (lvl === 'WARN') buckets[key].warns++;
    else buckets[key].info++;
  }
  
  const windows = Object.entries(buckets)
    .sort(([a], [b]) => Number(a) - Number(b))
    .map(([key, val]) => ({
      window: new Date(Number(key) * WINDOW_MINUTES * 60000).toISOString().slice(11, 16),
      errors: val.errors,
      warns: val.warns,
      info: val.info,
      total: val.total
    }));
    
  return { windows, spanMs: maxTs > minTs ? maxTs - minTs : 0 };
}

function buildLogContextForAI(parsedLogs) {
  if (!parsedLogs || parsedLogs.length === 0) {
    return { 
      stats: { totalLogs: 0, countsByLevel: { INFO: 0, WARN: 0, ERROR: 0, FATAL: 0 }, errorsByCategory: {} }, 
      timeline: [], 
      errorTraces: [], 
      incidentSandbox: [], 
      sampleNormalLogs: [], 
      omittedErrorCount: 0 
    };
  }

  // Ensure canonicalized fields are present (they may be absent if logs came from DB)
  resetEpochContext();
  parsedLogs.forEach((log, i) => {
    if (log.effectiveLevel === undefined) Object.assign(log, canonicalize(log, i));
  });

  const sorted = [...parsedLogs].sort((a, b) => 
    (a.timestampEpochMs - b.timestampEpochMs) || (a.originalIndex - b.originalIndex)
  );

  const rarityScores = calculateRarityScores(sorted);
  const scoredLogs = sorted.map((log, idx) => ({
    ...log,
    importanceScore: computeUniversalScore(log, rarityScores[idx])
  }));

  // Linear O(N) Two-Pointer Sliding Window Optimization
  let peakWindowStart = scoredLogs[0].timestampEpochMs || 0;
  let maxScoreInWindow = -1;
  let currentWindowScore = 0;
  let left = 0;

  for (let right = 0; right < scoredLogs.length; right++) {
    currentWindowScore += scoredLogs[right].importanceScore;

    while (scoredLogs[right].timestampEpochMs - scoredLogs[left].timestampEpochMs > 60000) {
      currentWindowScore -= scoredLogs[left].importanceScore;
      left++;
    }

    if (currentWindowScore > maxScoreInWindow) {
      maxScoreInWindow = currentWindowScore;
      peakWindowStart = scoredLogs[left].timestampEpochMs;
    }
  }

  const peakWindowEnd = peakWindowStart + 60000;
  
  const highPriorityLogs = scoredLogs.filter(l => l.importanceScore >= 0.50);
  const insideSpike = scoredLogs.filter(l => l.timestampEpochMs >= peakWindowStart && l.timestampEpochMs <= peakWindowEnd);
  
  const inSandbox = new Set([...insideSpike, ...highPriorityLogs]);
  
  const beforeSpike = scoredLogs.filter(l => l.timestampEpochMs < peakWindowStart && !inSandbox.has(l));
  const afterSpike = scoredLogs.filter(l => l.timestampEpochMs > peakWindowEnd && !inSandbox.has(l));

  const triggerHorizon = beforeSpike.slice(-10);
  const stabilizationHorizon = afterSpike.slice(0, 10);

  const sandwichMap = new Map();
  [...triggerHorizon, ...insideSpike, ...highPriorityLogs, ...stabilizationHorizon].forEach(l => {
    sandwichMap.set(l.originalIndex + '-' + l.timestampEpochMs, l);
  });

  const incidentSandbox = Array.from(sandwichMap.values()).sort((a, b) => 
    (a.timestampEpochMs - b.timestampEpochMs) || (a.originalIndex - b.originalIndex)
  );

  const inSandboxSet = new Set(incidentSandbox);
  const normals = scoredLogs
    .filter(l => !inSandboxSet.has(l))
    .filter((_, idx) => idx % NORMAL_SAMPLE_INTERVAL === 0)
    .slice(0, MAX_NORMAL_SAMPLES)
    .map(log => ({ 
      ...log, 
      raw: redactPII(log.raw || log.message), 
      message: redactPII(log.message || log.raw) 
    }));

  let omittedErrorCount = 0;
  let tokenBudget = MAX_ERROR_TOKENS;
  const errorTraces = [];
  
  for (const log of incidentSandbox) {
    const scrubbedLog = { 
      ...log, 
      raw: redactPII(log.raw || log.message), 
      message: redactPII(log.message || log.raw) 
    };
    const tokens = estimateTokens(JSON.stringify(scrubbedLog));
    
    if (tokens <= tokenBudget) {
      errorTraces.push(scrubbedLog);
      tokenBudget -= tokens;
    } else {
      omittedErrorCount++;
    }
  }

  const { windows, spanMs } = buildTimeWindows(sorted);

  const countsByLevel = { INFO: 0, WARN: 0, ERROR: 0, FATAL: 0 };
  const errorsByCategory = {};
  
  for (const log of parsedLogs) {
    const lvl = log.effectiveLevel || 'INFO';
    if (countsByLevel[lvl] !== undefined) countsByLevel[lvl]++;
    else countsByLevel.INFO++;

    if (lvl === 'ERROR' || lvl === 'FATAL') {
      const cat = log.category || 'general';
      errorsByCategory[cat] = (errorsByCategory[cat] || 0) + 1;
    }
  }

  const scores = scoredLogs.map(l => l.importanceScore);

  return {
    stats: {
      totalLogs: parsedLogs.length,
      countsByLevel,
      errorsByCategory,
      highPriorityCount: highPriorityLogs.length,
      meanImportance: parseFloat((scores.reduce((a, b) => a + b, 0) / (scores.length || 1)).toFixed(2)),
      peakImportance: parseFloat(Math.max(...scores, 0).toFixed(2)),
      errorRate: countsByLevel.ERROR + countsByLevel.FATAL,
    },
    timeline: windows,
    timeSpanMs: spanMs,
    earliestTimestamp: sorted.length > 0 ? sorted[0].timestampIso : null,
    latestTimestamp: sorted.length > 0 ? sorted[sorted.length - 1].timestampIso : null,
    incidentSandbox: errorTraces, 
    errorTraces,
    sampleNormalLogs: normals,
    securityAlerts: [],
    recoveryEvents: [],
    omittedErrorCount,
  };
}

module.exports = {
  buildLogContextForAI,
  buildTimeWindows,
  computeUniversalScore,
  computeImportanceScore: computeUniversalScore,
  redactPII,
  extractLogTemplate
};