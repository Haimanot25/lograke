const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const dbDir = path.resolve(__dirname, '../../data');
const dbPath = process.env.DB_PATH
  ? path.resolve(process.env.DB_PATH)
  : path.join(dbDir, 'lograke.db');
fs.mkdirSync(path.dirname(dbPath), { recursive: true });
const db = new Database(dbPath);

// Initialize schema
function initDB() {
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  // Migration system
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      applied_at TEXT DEFAULT (datetime('now'))
    );
  `);

  const applied = db.prepare('SELECT version FROM schema_migrations').all().map(r => r.version);

  // Migration 1: Initial schema
  if (!applied.includes(1)) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS files (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        sourcePath TEXT,
        linesCount INTEGER DEFAULT 0,
        levelCounts TEXT,
        facetCounts TEXT,
        healthScore INTEGER DEFAULT 100,
        detectedFormat TEXT,
        inferredType TEXT,
        inferredFields TEXT,
        multiLineEDR INTEGER DEFAULT 0,
        patterns TEXT,
        anomalies TEXT,
        entities TEXT,
        chronology TEXT,
        timestamp TEXT
      );

      CREATE TABLE IF NOT EXISTS logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        fileId TEXT NOT NULL,
        logIndex INTEGER,
        logTimestamp TEXT,
        level TEXT,
        message TEXT,
        raw TEXT,
        service TEXT,
        host TEXT,
        category TEXT,
        environment TEXT,
        metadata TEXT,
        ids TEXT,
        tags TEXT,
        FOREIGN KEY(fileId) REFERENCES files(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_logs_fileId ON logs(fileId);
      CREATE INDEX IF NOT EXISTS idx_logs_level ON logs(level);
      CREATE INDEX IF NOT EXISTS idx_logs_logIndex ON logs(logIndex);

      CREATE TABLE IF NOT EXISTS alert_rules (
        id TEXT PRIMARY KEY,
        fileId TEXT NOT NULL,
        name TEXT NOT NULL,
        type TEXT NOT NULL,
        threshold REAL,
        severity TEXT,
        description TEXT,
        active INTEGER DEFAULT 1,
        FOREIGN KEY(fileId) REFERENCES files(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_alert_rules_fileId ON alert_rules(fileId);

      CREATE TABLE IF NOT EXISTS alerts (
        id TEXT PRIMARY KEY,
        fileId TEXT NOT NULL,
        ruleId TEXT,
        type TEXT,
        message TEXT,
        severity TEXT,
        timestamp TEXT,
        FOREIGN KEY(fileId) REFERENCES files(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_alerts_fileId ON alerts(fileId);

      CREATE TABLE IF NOT EXISTS saved_queries (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        query TEXT NOT NULL,
        fileId TEXT,
        timestamp TEXT
      );

      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT
      );
    `);
    db.prepare('INSERT INTO schema_migrations (version) VALUES (1)').run();
  }

  // Migration 2: Add multiLineEDR column if missing (pre-existing migration logic)
  if (!applied.includes(2)) {
    const fileColumns = db.prepare("PRAGMA table_info('files')").all().map(col => col.name);
    if (!fileColumns.includes('multiLineEDR')) {
      db.exec("ALTER TABLE files ADD COLUMN multiLineEDR INTEGER DEFAULT 0;");
    }
    // Add fileId to saved_queries if missing
    const sqColumns = db.prepare("PRAGMA table_info('saved_queries')").all().map(col => col.name);
    if (!sqColumns.includes('fileId')) {
      db.exec("ALTER TABLE saved_queries ADD COLUMN fileId TEXT;");
    }
    db.prepare('INSERT INTO schema_migrations (version) VALUES (2)').run();
  }

  // Migration 3: Add dedupSummary column
  if (!applied.includes(3)) {
    const fileColumns = db.prepare("PRAGMA table_info('files')").all().map(col => col.name);
    if (!fileColumns.includes('dedupSummary')) {
      db.exec("ALTER TABLE files ADD COLUMN dedupSummary TEXT;");
    }
    db.prepare('INSERT INTO schema_migrations (version) VALUES (3)').run();
  }

  // Migration 4: Users table + audit_log table + indexes
  if (!applied.includes(4)) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        username TEXT NOT NULL UNIQUE,
        passwordHash TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'user',
        createdAt TEXT DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS audit_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        userId TEXT,
        action TEXT NOT NULL,
        resource TEXT,
        resourceId TEXT,
        details TEXT,
        timestamp TEXT DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_audit_log_userId ON audit_log(userId);
      CREATE INDEX IF NOT EXISTS idx_audit_log_action ON audit_log(action);
      CREATE INDEX IF NOT EXISTS idx_audit_log_timestamp ON audit_log(timestamp);

      CREATE INDEX IF NOT EXISTS idx_logs_logTimestamp ON logs(logTimestamp);
      CREATE INDEX IF NOT EXISTS idx_alerts_timestamp ON alerts(timestamp);
      CREATE INDEX IF NOT EXISTS idx_alerts_severity ON alerts(severity);
    `);
    db.prepare('INSERT INTO schema_migrations (version) VALUES (4)').run();
  }

  // Migration 5: Notification settings + notification log
  if (!applied.includes(5)) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS notification_settings (
        id TEXT PRIMARY KEY,
        channel TEXT NOT NULL,
        enabled INTEGER DEFAULT 1,
        config TEXT,
        severityFilter TEXT DEFAULT '["high","medium","low"]',
        createdAt TEXT DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS notification_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        alertId TEXT,
        channel TEXT NOT NULL,
        status TEXT NOT NULL,
        response TEXT,
        timestamp TEXT DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_notification_log_channel ON notification_log(channel);
      CREATE INDEX IF NOT EXISTS idx_notification_log_timestamp ON notification_log(timestamp);
    `);
    db.prepare('INSERT INTO schema_migrations (version) VALUES (5)').run();
  }

  // Migration 6: Custom parsers
  if (!applied.includes(6)) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS custom_parsers (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT DEFAULT '',
        version INTEGER DEFAULT 1,
        regexPattern TEXT,
        fieldMappings TEXT,
        sampleLines TEXT,
        testResults TEXT,
        tags TEXT DEFAULT '',
        isBuiltin INTEGER DEFAULT 0,
        multiLine INTEGER DEFAULT 0,
        createdAt TEXT DEFAULT (datetime('now')),
        updatedAt TEXT DEFAULT (datetime('now')),
        metadata TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_custom_parsers_name ON custom_parsers(name);
      CREATE INDEX IF NOT EXISTS idx_custom_parsers_tags ON custom_parsers(tags);
    `);
    db.prepare('INSERT INTO schema_migrations (version) VALUES (6)').run();
  }

  // Migration 7: Log sources for webhook/syslog/http_poll
  if (!applied.includes(7)) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS log_sources (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        type TEXT NOT NULL CHECK(type IN ('webhook','syslog','http_poll')),
        config TEXT NOT NULL DEFAULT '{}',
        status TEXT NOT NULL DEFAULT 'inactive',
        lastSeenAt TEXT,
        bytesIngested INTEGER DEFAULT 0,
        errorMessage TEXT,
        createdAt TEXT NOT NULL,
        updatedAt TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_log_sources_type ON log_sources(type);
      CREATE INDEX IF NOT EXISTS idx_log_sources_status ON log_sources(status);
    `);
    db.prepare('INSERT INTO schema_migrations (version) VALUES (7)').run();
  }

  // Migration 8: Drop CHECK constraint on log_sources.type to allow 'sftp'
  if (!applied.includes(8)) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS log_sources_new (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        type TEXT NOT NULL,
        config TEXT NOT NULL DEFAULT '{}',
        status TEXT NOT NULL DEFAULT 'inactive',
        lastSeenAt TEXT,
        bytesIngested INTEGER DEFAULT 0,
        errorMessage TEXT,
        createdAt TEXT NOT NULL,
        updatedAt TEXT NOT NULL
      );
      INSERT INTO log_sources_new SELECT * FROM log_sources;
      DROP TABLE log_sources;
      ALTER TABLE log_sources_new RENAME TO log_sources;
      CREATE INDEX IF NOT EXISTS idx_log_sources_type ON log_sources(type);
      CREATE INDEX IF NOT EXISTS idx_log_sources_status ON log_sources(status);
    `);
    db.prepare('INSERT INTO schema_migrations (version) VALUES (8)').run();
  }

  // Migration 9: Cache table + AI cost log
  if (!applied.includes(9)) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS ai_cache (
        cache_key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        expires_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_ai_cache_expires ON ai_cache(expires_at);

      CREATE TABLE IF NOT EXISTS ai_cost_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        provider TEXT NOT NULL,
        model TEXT NOT NULL,
        tokens_in INTEGER DEFAULT 0,
        tokens_out INTEGER DEFAULT 0,
        cost_estimate REAL DEFAULT 0,
        endpoint TEXT,
        duration_ms INTEGER DEFAULT 0,
        success INTEGER DEFAULT 1,
        error_message TEXT,
        timestamp TEXT DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_ai_cost_log_provider ON ai_cost_log(provider);
      CREATE INDEX IF NOT EXISTS idx_ai_cost_log_timestamp ON ai_cost_log(timestamp);
    `);
    db.prepare('INSERT INTO schema_migrations (version) VALUES (9)').run();
  }

  // Migration 10: Promote earliest user to admin if no admin exists (upgrade path
  // for installs created before first-user-admin was introduced)
  if (!applied.includes(10)) {
    const hasUsers = db.prepare('SELECT 1 FROM users LIMIT 1').get();
    const hasAdmin = db.prepare("SELECT 1 FROM users WHERE role = 'admin' LIMIT 1").get();
    if (hasUsers && !hasAdmin) {
      const first = db.prepare('SELECT id FROM users ORDER BY createdAt ASC, rowid ASC LIMIT 1').get();
      if (first) db.prepare("UPDATE users SET role = 'admin' WHERE id = ?").run(first.id);
    }
    db.prepare('INSERT INTO schema_migrations (version) VALUES (10)').run();
  }

  // Migration 11: Add userId column to files (ownership scoping).
  // NULL = legacy/uploaded-by-source file, shared with all authenticated users.
  if (!applied.includes(11)) {
    const fileColumns = db.prepare("PRAGMA table_info('files')").all().map(col => col.name);
    if (!fileColumns.includes('userId')) {
      db.exec("ALTER TABLE files ADD COLUMN userId TEXT;");
    }
    db.prepare('INSERT INTO schema_migrations (version) VALUES (11)').run();
  }

  // Initialize default active AI provider if not exists
  const activeProvider = db.prepare("SELECT value FROM settings WHERE key = 'active_ai_provider'").get();
  if (!activeProvider) {
    db.prepare("INSERT INTO settings (key, value) VALUES ('active_ai_provider', 'groq')").run();
  }
}

initDB();

module.exports = db;
