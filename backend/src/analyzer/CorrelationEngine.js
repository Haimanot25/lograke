/**
 * CorrelationEngine - Traces and tracks identifiers (transactions, sessions, users, IPs) across logs.
 * Enhanced with: broader entity bucketing, service/host correlation, co-occurrence graph.
 */

const ENTITY_RULES = [
  { keywords: ['transaction', 'txid', 'tx_id', 'request', 'trace', 'traceid', 'trace_id', 'session', 'correlation', 'call', 'reqid', 'req_id'], bucket: 'transactionId' },
  { keywords: ['user', 'uid', 'user_id', 'userid', 'account', 'actor', 'principal'], bucket: 'userId' },
  { keywords: ['uuid', 'guid', 'correlation_id', 'correlationid'], bucket: 'uuid' },
  { keywords: ['email', 'mail', 'e-mail'], bucket: 'email' },
  { keywords: ['ip', 'ipaddr', 'ip_address', 'src_ip', 'dst_ip', 'remote_ip', 'client_ip', 'source_ip', 'dest_ip'], bucket: 'ip' },
  { keywords: ['host', 'hostname', 'node', 'server', 'instance', 'machine'], bucket: 'host' },
  { keywords: ['service', 'app', 'application', 'component', 'module', 'source', 'origin'], bucket: 'service' },
  { keywords: ['thread', 'threadid', 'thread_id', 'tid'], bucket: 'thread' },
  { keywords: ['process', 'pid', 'processid'], bucket: 'process' },
  { keywords: ['status', 'statuscode', 'status_code', 'http_code', 'response_code', 'error_code', 'errcode'], bucket: 'statusCode' }
];

function bucketEntity(key, value) {
  if (!key || !value) return null;
  const normalizedKey = String(key).toLowerCase().replace(/[-_\s]/g, '');

  for (const rule of ENTITY_RULES) {
    if (rule.keywords.some(kw => normalizedKey.includes(kw.replace(/[-_\s]/g, '')))) {
      return rule.bucket;
    }
  }
  return null;
}

function collectEntityCandidates(log) {
  const candidates = [];
  const seen = new Set();
  const push = (key, value) => {
    if (value === undefined || value === null || value === '') return;
    const stringValue = String(value).trim();
    if (!stringValue || stringValue.length < 2 || stringValue.length > 500) return;
    const dedupKey = `${key}=${stringValue}`;
    if (seen.has(dedupKey)) return;
    seen.add(dedupKey);
    const bucket = bucketEntity(key, stringValue);
    candidates.push({ key, value: stringValue, bucket });
  };

  if (log.ids) {
    Object.entries(log.ids).forEach(([key, value]) => push(key, value));
  }
  if (log.metadata) {
    Object.entries(log.metadata).forEach(([key, value]) => push(key, value));
  }
  if (log.raw) {
    const rawPairs = [...String(log.raw).matchAll(/([A-Za-z][A-Za-z0-9._-]*)(?:\s*[:=]\s*)([A-Za-z0-9._:-]+)/g)];
    rawPairs.forEach(([_, key, value]) => push(key, value));
  }

  return candidates;
}

function scanTraceableEntities(parsedLogs) {
  const entities = {};
  const BUCKET_TYPES = ['transactionId', 'userId', 'uuid', 'ip', 'email', 'host', 'service', 'thread', 'process', 'statusCode'];
  BUCKET_TYPES.forEach(b => { entities[b] = {}; });

  parsedLogs.forEach(log => {
    collectEntityCandidates(log).forEach(({ key, value, bucket }) => {
      const entityBucket = bucket || (key && key.toLowerCase().includes('id') ? key : null);
      if (!entityBucket) return;
      if (!entities[entityBucket]) entities[entityBucket] = {};
      entities[entityBucket][value] = (entities[entityBucket][value] || 0) + 1;
    });

    // Also track service/host from enriched fields
    if (log.service && log.service !== 'unknown') {
      if (!entities.service) entities.service = {};
      entities.service[log.service] = (entities.service[log.service] || 0) + 1;
    }
    if (log.host && log.host !== 'unknown') {
      if (!entities.host) entities.host = {};
      entities.host[log.host] = (entities.host[log.host] || 0) + 1;
    }
  });

  // Remove empty buckets
  Object.keys(entities).forEach(key => {
    if (Object.keys(entities[key]).length === 0) delete entities[key];
  });

  return entities;
}

function extractTraceEventType(log) {
  if (!log) return 'Info';
  if (log.stateChanges) return 'State Change';
  const msg = String(log.message || log.raw || '').toLowerCase();
  if (log.level === 'ERROR' || log.level === 'FATAL') return 'Error';
  if (/(\berror\b|\bfail\b|\bfailure\b|\bexception\b|\btimeout\b|\bcrash\b|\bpanic\b|\breject\b|\bdenied\b|\bforbidden\b)/i.test(msg)) return 'Error';
  if (/(\bupdate\b|\bupdated\b|\bmodify\b|\bmodified\b|\bchanged\b|\bchange\b|\bpatch\b|\bdeploy\b|\bdeployed\b)/i.test(msg)) return 'Update';
  if (/(\bstart\b|\bstarted\b|\bbegin\b|\binitialize\b|\binitialized\b|\bready\b|\bonline\b|\bactive\b|\bshutdown\b|\bterminated\b|\brestarting\b|\breboot\b)/i.test(msg)) return 'Lifecycle';
  if (/(\bwarn\b|\bwarning\b|\bdeprecated\b|\bretry\b|\bthrottle\b|\bbackoff\b|\bslow\b|\blatency\b|\bthreshold\b)/i.test(msg)) return 'Warning';
  if (/(\btrace\b|\bdebug\b)/i.test(msg)) return 'Trace';
  return 'Info';
}

function buildTraceEventSummary(log, eventType) {
  if (!log) return '';
  if (eventType === 'State Change' && log.stateChanges) {
    return `State changed from ${log.stateChanges.from || 'unknown'} to ${log.stateChanges.to || 'unknown'}`;
  }
  if (eventType === 'Error') return log.message || 'Error event';
  if (eventType === 'Update') return log.message || 'Update event';
  return log.message || 'Correlated event';
}

function traceEntity(parsedLogs, entityVal) {
  if (!entityVal) return [];

  const valLower = String(entityVal).toLowerCase();

  const matches = parsedLogs.filter(log => {
    const candidates = [];
    if (log.ids) candidates.push(...Object.values(log.ids));
    if (log.metadata) candidates.push(...Object.values(log.metadata));
    if (log.raw) candidates.push(log.raw);

    return candidates.some(val => {
      if (!val) return false;
      const stringValue = String(val).trim().toLowerCase();
      return stringValue === valLower || stringValue.includes(valLower);
    });
  });

  const sorted = [...matches].sort((a, b) => {
    return new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime();
  });

  const timeline = [];
  let startTime = null;
  let lastTime = null;

  sorted.forEach((log, index) => {
    const currentTime = new Date(log.timestamp).getTime();

    if (index === 0) {
      startTime = currentTime;
      lastTime = currentTime;
    }

    const elapsedMs = currentTime - startTime;
    const delaySinceLastMs = currentTime - lastTime;
    lastTime = currentTime;

    const eventType = extractTraceEventType(log);
    const eventSummary = buildTraceEventSummary(log, eventType);

    timeline.push({
      stepNumber: index + 1,
      logIndex: log.index,
      timestamp: log.timestamp,
      elapsedMs,
      delaySinceLastMs,
      level: log.level,
      message: log.message,
      eventType,
      eventSummary,
      stateChanges: log.stateChanges,
      service: log.service,
      category: log.category,
      environment: log.environment,
      log
    });
  });

  return timeline;
}

module.exports = {
  scanTraceableEntities,
  traceEntity
};
