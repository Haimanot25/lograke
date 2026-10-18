/**
 * Entry point for Lograke Express Backend server.
 */
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const path = require('path');
const fs = require('fs');
const multer = require('multer');

const config = require('./config');
const logsRouter = require('./routes/logs');
const settingsRouter = require('./routes/settings');
const authRouter = require('./routes/auth');
const notificationsRouter = require('./routes/notifications');
const parsersRouter = require('./routes/parsers');
const logSourcesRouter = require('./routes/logSources');
const sourceManager = require('./services/SourceManager');
const RetentionPruner = require('./services/RetentionPruner');
const { isEnabled, getActiveProvider } = require('./ai/AiService');
const { evaluateAlerts } = require('./analyzer/AlertEngine');
const { dispatchAlert } = require('./services/NotificationService');
const { generalLimiter, uploadLimiter, aiLimiter } = require('./middleware/rateLimiter');
const { errorHandler, notFoundHandler } = require('./middleware/errorHandler');
const { logger, requestLogger } = require('./middleware/logger');
const { optionalAuth } = require('./middleware/auth');

const compression = require('compression');

const app = express();

// ── Reverse proxy support (set TRUST_PROXY when behind nginx/etc.) ──
if (config.trustProxy !== false && config.trustProxy !== undefined) {
  app.set('trust proxy', config.trustProxy);
}

// ── Security headers ───────────────────────────────────────────
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      // No 'unsafe-inline'/'unsafe-eval': the theme bootstrap ships as an
      // external file (public/theme-init.js). style-src keeps
      // 'unsafe-inline' because React inline style attributes are used
      // throughout the UI — see SECURITY.md.
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      imgSrc: ["'self'", "data:", "blob:"],
      connectSrc: ["'self'", "http://localhost:5000", "http://localhost:5173", "ws://localhost:5173"],
      frameSrc: ["'none'"],
      objectSrc: ["'none'"]
    }
  },
  crossOriginEmbedderPolicy: false,
  crossOriginResourcePolicy: { policy: 'cross-origin' }
}));

// ── CORS ───────────────────────────────────────────────────────
const corsOrigin = config.cors.origin;
const corsOptions = {
  origin: corsOrigin === '*' ? '*' : corsOrigin.split(',').map(o => o.trim()).filter(Boolean),
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
  credentials: config.cors.credentials
};
app.use(cors(corsOptions));

// ── Compression ────────────────────────────────────────────────
app.use(compression());

// ── Rate limiting ──────────────────────────────────────────────
app.use(generalLimiter);

// ── Body parsing (unified from config) ─────────────────────────
const bodyLimit = config.upload.maxJsonBody;
app.use(express.json({ limit: bodyLimit }));
app.use(express.urlencoded({ limit: bodyLimit, extended: true }));



// ── Auth (optional — reads token if present) ───────────────────
app.use(optionalAuth);

// ── Request logging ────────────────────────────────────────────
app.use(requestLogger);

// ── Serve static React build files in production ───────────────
const frontendBuildPath = path.join(__dirname, '../../frontend/dist');
if (fs.existsSync(frontendBuildPath)) {
  app.use(express.static(frontendBuildPath));
}

// ── Init SourceManager with ingest callback ────────────────────
sourceManager.setBaseUrl(`http://localhost:${config.port}`);
sourceManager.setIngestCallback(async (sourceName, lines, options) => {
  try {
    const rawText = Array.isArray(lines) ? lines.map(l => typeof l === 'object' ? JSON.stringify(l) : l).join('\n') : String(lines);
    const record = logsRouter.processLogFile(sourceName, rawText, options);
    return record;
  } catch (err) {
    logger.error('Source ingestion failed:', err.message);
    return null;
  }
});

// ── API Routes (with targeted rate limiters) ───────────────────
app.use('/api/auth', authRouter);
app.use('/api/logs', logsRouter);
app.use('/api/settings', settingsRouter);
app.use('/api/notifications', notificationsRouter);
app.use('/api/parsers', parsersRouter);
app.use('/api/log-sources', logSourcesRouter);

// Health check
app.get('/api/health', (req, res) => {
  res.json({
    status: 'healthy',
    aiEnabled: isEnabled(),
    activeAiProvider: getActiveProvider(),
    // Dev-only condition: running on a generated per-boot JWT secret
    // (security finding #12) — production refuses to boot without JWT_SECRET
    authInsecure: config.auth.jwtEphemeral,
    uptime: Math.floor(process.uptime()),
    timestamp: new Date().toISOString()
  });
});

// ── 404 for unknown API routes ─────────────────────────────────
app.use('/api', notFoundHandler);

// ── SPA fallback ───────────────────────────────────────────────
app.get('/{*splat}', (req, res) => {
  const indexFile = path.join(frontendBuildPath, 'index.html');
  if (fs.existsSync(indexFile)) {
    res.sendFile(indexFile);
  } else {
    res.status(404).send('Backend running. Frontend not built.');
  }
});

// ── Handle malformed JSON and multipart errors ─────────────────
app.use((err, req, res, next) => {
  if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
    return res.status(400).json({ error: 'Invalid JSON payload' });
  }
  if (err instanceof multer.MulterError) {
    return res.status(400).json({ error: err.code });
  }
  next(err);
});

// ── Global error handler (no internal details leaked) ──────────
app.use(errorHandler);

// ── Periodic alert evaluator (every 60 seconds) ────────────────
const store = require('./services/StorageService');
let lastEval = Date.now();
let alertEvalRunning = false;

function startAlertEvaluator() {
  return setInterval(async () => {
    if (alertEvalRunning) return;
    alertEvalRunning = true;
    try {
      const files = store.getMetadataList();
      for (const file of files) {
        const record = store.getMetadata(file.id);
        if (!record) continue;
        const triggered = evaluateAlerts(record);
        if (triggered.length > 0) {
          record.alerts = triggered;
          for (const alert of triggered) {
            await dispatchAlert(alert, file.id);
          }
        }
      }
      lastEval = Date.now();
    } catch (err) {
      logger.error('Periodic alert evaluation failed:', err.message);
    } finally {
      alertEvalRunning = false;
    }
  }, 60000);
}

/**
 * Start the HTTP server + runtime jobs (alert evaluator, source restart,
 * signal handlers). Only invoked when the process is started directly —
 * importing this module (e.g. in tests) yields a side-effect-free app.
 */
function startServer() {
  const server = app.listen(config.port, () => {
    logger.info('='.repeat(50));
    logger.info(`Lograke backend running on http://localhost:${config.port}`);
    logger.info(`AI (${getActiveProvider()}): ${isEnabled() ? 'ENABLED' : 'DISABLED'}`);
    logger.info('='.repeat(50));

    // Re-start previously active sources (skip outbound-connect types that may hang on boot)
    const sources = sourceManager.getAll();
    for (const source of sources) {
      if (source.status === 'active' && source.type !== 'sftp' && source.type !== 'http_poll') {
        sourceManager.start(source.id).catch(err => {
          logger.warn(`Failed to restart source ${source.name}: ${err.message}`);
        });
      }
    }
  });

  const alertTimer = startAlertEvaluator();
  alertTimer.unref();

  // ── Storage retention (opt-in via STORAGE_MAX_AGE_DAYS, default off) ──
  const retentionPruner = new RetentionPruner();
  retentionPruner.start(); // startup sweep + hourly interval; no-op when disabled
  if (retentionPruner.enabled) {
    logger.info(`Storage retention enabled: raw files older than ${retentionPruner.maxAgeDays} day(s) are pruned hourly`);
  }

  // ── Graceful shutdown ──────────────────────────────────────────
  function shutdown(signal) {
    logger.info(`${signal} received — shutting down gracefully...`);
    clearInterval(alertTimer);
    retentionPruner.stop();
    server.close(() => {
      logger.info('HTTP server closed');
      sourceManager.stopAll().catch(() => {});
      logger.info('All sources stopped');
      process.exit(0);
    });
    setTimeout(() => {
      logger.error('Forced shutdown after timeout');
      process.exit(1);
    }, 10000).unref();
  }

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  // ── Last-resort handlers so a stray rejection/exception is logged, not silent ──
  process.on('unhandledRejection', (reason) => {
    logger.error('Unhandled promise rejection:', reason instanceof Error ? (reason.stack || reason.message) : String(reason));
  });
  process.on('uncaughtException', (err) => {
    logger.error('Uncaught exception — exiting:', err.stack || err.message || err);
    process.exit(1);
  });

  return server;
}

if (require.main === module) {
  startServer();
}

module.exports = { app, startServer };
