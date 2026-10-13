/**
 * LogEnricher - Adds normalized metadata, classification, and enrichment to parsed logs.
 * Enhanced with: multi-category, network classification (replaces unreliable geoIp).
 */
const SERVICE_KEYS = ['service', 'app', 'application', 'component', 'module', 'source'];
const HOST_KEYS = ['host', 'hostname', 'node', 'server', 'instance'];
const ENV_KEYS = ['env', 'environment', 'stage', 'deployment'];

const CATEGORY_KEYWORDS = {
  auth: ['auth', 'login', 'authenticate', 'authorization', 'credentials', 'token', 'session', 'signin', 'signout', 'password', 'oauth'],
  database: ['db', 'database', 'sql', 'query', 'mongodb', 'postgres', 'mysql', 'redis', 'connection pool', 'deadlock', 'migration', 'schema'],
  network: ['socket', 'connection', 'timeout', 'tcp', 'udp', 'dns', 'gateway', 'proxy', 'http', 'load balancer', 'firewall', 'iptables'],
  security: ['unauthorized', 'forbidden', 'access denied', 'ssl', 'tls', 'certificate', 'crypto', 'attack', 'malicious', 'intrusion', 'brute force'],
  performance: ['latency', 'slow', 'duration', 'throughput', 'bottleneck', 'timeout', 'cpu usage', 'memory leak', 'garbage collection', 'backpressure', 'throttle'],
  storage: ['disk', 'storage', 's3', 'fs', 'filesystem', 'archive', 'io error', 'mount', 'volume', 'block', 'inode'],
  api: ['request', 'response', 'endpoint', 'api', 'status code', 'payload', 'rest', 'graphql', 'cors', 'webhook', 'grpc'],
  lifecycle: ['startup', 'shutdown', 'initialize', 'terminated', 'restarting', 'booting', 'ready', 'deploy', 'scaling'],
  messaging: ['queue', 'rabbitmq', 'kafka', 'pubsub', 'broker', 'message', 'consumed', 'produced', 'subscriber'],
  container: ['kubernetes', 'k8s', 'docker', 'pod', 'container', 'replica', 'node', 'cluster', 'scheduler']
};

const SEVERITY_METADATA = {
  ERROR: { weight: 3, color: '#ef4444', label: 'Critical' },
  FATAL: { weight: 4, color: '#991b1b', label: 'Emergency' },
  WARN: { weight: 2, color: '#f59e0b', label: 'Warning' },
  INFO: { weight: 1, color: '#3b82f6', label: 'Information' },
  DEBUG: { weight: 0, color: '#64748b', label: 'Debug' },
  TRACE: { weight: 0, color: '#94a3b8', label: 'Trace' },
  UNKNOWN: { weight: 1, color: '#94a3b8', label: 'Info' }
};

function normalizedValue(metadata = {}, text, keys) {
  for (const key of keys) {
    if (metadata[key]) return String(metadata[key]).trim();
  }
  if (!text) return null;
  for (const key of keys) {
    const match = new RegExp(`${key}[:=]\\s*([\\w.-]+)`, 'i').exec(text);
    if (match) return match[1];
  }
  return null;
}

/**
 * Multi-category classification: a log line can belong to multiple categories.
 */
function classifyCategories(text = '', metadata = {}) {
  const lower = `${text} ${JSON.stringify(metadata)}`.toLowerCase();
  const matched = [];
  for (const [category, tokens] of Object.entries(CATEGORY_KEYWORDS)) {
    if (tokens.some(token => lower.includes(token))) {
      matched.push(category);
    }
  }
  return matched.length > 0 ? matched : ['general'];
}

/**
 * Network classification from IP (replaces unreliable geoIp).
 * Returns: 'private', 'loopback', 'link-local', 'multicast', 'public', 'unknown'
 */
function classifyNetwork(ip) {
  if (!ip) return null;
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some(p => isNaN(p) || p < 0 || p > 255)) return null;

  if (parts[0] === 127) return 'loopback';
  if (parts[0] === 10) return 'private';
  if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return 'private';
  if (parts[0] === 192 && parts[1] === 168) return 'private';
  if (parts[0] === 169 && parts[1] === 254) return 'link-local';
  if (parts[0] >= 224 && parts[0] <= 239) return 'multicast';
  if (parts[0] > 0 && parts[0] < 224) return 'public';
  return 'unknown';
}

function getNormalizedFields(parsedLog, recordMeta = {}) {
  const service = normalizedValue(parsedLog.metadata, parsedLog.raw, SERVICE_KEYS) || 'unknown';
  const host = normalizedValue(parsedLog.metadata, parsedLog.raw, HOST_KEYS) || 'unknown';
  const environment = normalizedValue(parsedLog.metadata, parsedLog.raw, ENV_KEYS) || 'production';
  const categories = classifyCategories(parsedLog.message, parsedLog.metadata);
  const ip = parsedLog.ids?.ip || parsedLog.metadata?.ip || null;
  const networkClass = classifyNetwork(ip);
  const level = (parsedLog.level || 'INFO').toUpperCase();
  const severity = SEVERITY_METADATA[level] || SEVERITY_METADATA.UNKNOWN;

  return {
    timestamp: parsedLog.timestamp,
    level,
    message: parsedLog.message,
    service,
    host,
    environment,
    categories,
    category: categories[0] || 'general', // primary category for backwards compat
    source: recordMeta.source || 'upload',
    networkClass,
    ids: parsedLog.ids || {},
    metrics: parsedLog.metrics || {},
    stateChanges: parsedLog.stateChanges || null,
    severityWeight: severity.weight,
    uiColor: severity.color
  };
}

function enrichLogEntry(parsedLog, recordMeta = {}) {
  const normalized = getNormalizedFields(parsedLog, recordMeta);
  return {
    ...parsedLog,
    service: normalized.service,
    host: normalized.host,
    environment: normalized.environment,
    category: normalized.category,
    categories: normalized.categories,
    normalized,
    enrichedAt: new Date().toISOString()
  };
}

module.exports = {
  enrichLogEntry
};
