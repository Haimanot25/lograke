// Runs before each test file. Must set env before any src module loads so
// config.js/db.js see deterministic values regardless of local .env files.
const os = require('os');
const path = require('path');

process.env.NODE_ENV = 'test';
process.env.AUTH_ENABLED = 'true';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
// Unique temp DB per test file so tests never touch the real data/lograke.db
process.env.DB_PATH = path.join(
  os.tmpdir(),
  `lograke-test-${process.pid}-${process.env.JEST_WORKER_ID || 0}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.db`
);
