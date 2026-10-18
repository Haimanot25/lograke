const dotenv = require('dotenv');
// Only load .env once to prevent test re-requires from overwriting env vars
if (!process.env._LOGRAKE_DOTENV_LOADED) {
  dotenv.config();
  process.env._LOGRAKE_DOTENV_LOADED = '1';
}

const isProduction = process.env.NODE_ENV === 'production';

let jwtSecret = process.env.JWT_SECRET;
// True when running on a generated per-boot secret (dev convenience only) —
// surfaced via /api/health so operators can detect it (security finding #12)
let jwtEphemeral = false;
if (!jwtSecret) {
  if (isProduction) {
    console.error('FATAL: JWT_SECRET environment variable is required in production.');
    process.exit(1);
  }
  jwtSecret = require('crypto').randomBytes(32).toString('hex');
  jwtEphemeral = true;
  console.warn('WARN: JWT_SECRET not set. Generated ephemeral secret — tokens invalidated on restart.');
}

const config = {
  port: parseInt(process.env.PORT, 10) || 5000,
  nodeEnv: process.env.NODE_ENV || 'development',
  cors: {
    origin: process.env.CORS_ORIGIN || '*',
    credentials: process.env.CORS_CREDENTIALS === 'true'
  },
  auth: {
    // Auth is ON unless explicitly disabled with AUTH_ENABLED=false
    get enabled() { return process.env.AUTH_ENABLED !== 'false'; },
    jwtSecret,
    jwtEphemeral,
    jwtExpiresIn: process.env.JWT_EXPIRES_IN || '7d'
  },
  ai: {
    activeProvider: process.env.ACTIVE_AI_PROVIDER || 'groq',
    groqApiKey: process.env.GROQ_API_KEY || '',
    geminiApiKey: process.env.GEMINI_API_KEY || '',
    grokApiKey: process.env.GROK_API_KEY || '',
    ollamaBaseUrl: process.env.OLLAMA_BASE_URL || 'http://localhost:11434'
  },
  upload: {
    maxFileSize: parseInt(process.env.MAX_FILE_SIZE, 10) || 10 * 1024 * 1024,
    maxJsonBody: process.env.MAX_JSON_BODY || '10mb',
    // Archive extraction caps — decompression-bomb protection (finding #6)
    maxExtractedBytes: (parseInt(process.env.ARCHIVE_MAX_EXTRACTED_MB, 10) || 512) * 1024 * 1024,
    maxArchiveEntries: parseInt(process.env.ARCHIVE_MAX_ENTRIES, 10) || 5000
  },
  log: {
    level: process.env.LOG_LEVEL || 'info'
  },
  // Syslog listener bind address: default all interfaces (docker-compose peers
  // need it); set to 127.0.0.1 or a LAN IP to restrict exposure (finding #9)
  syslog: {
    bind: process.env.SYSLOG_BIND || '0.0.0.0'
  },
  // Behind a reverse proxy: TRUST_PROXY=1 (hop count), 'true', or an IP/CIDR list
  trustProxy: process.env.TRUST_PROXY
    ? (/^\d+$/.test(process.env.TRUST_PROXY) ? parseInt(process.env.TRUST_PROXY, 10)
      : process.env.TRUST_PROXY === 'true' ? true
      : process.env.TRUST_PROXY === 'false' ? false
      : process.env.TRUST_PROXY)
    : false
};

module.exports = config;
