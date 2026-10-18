const multer = require('multer');
const path = require('path');
const fs = require('fs');

const config = require('../../config');
const FileIngestor = require('../../ingestion/FileIngestor');

const fileIngestor = new FileIngestor();
const store = require('../../services/StorageService');

// Module-level SSE emitter registry
const liveClients = [];

// Wire up SSE emitter to StorageService and global for processLogFile
const sseEmitter = (fileId, logEntry) => {
  liveClients.forEach(client => {
    if (!client.fileId || client.fileId === fileId) {
      client.res.write(`data: ${JSON.stringify(logEntry)}\n\n`);
    }
  });
};
store.setEmitter(sseEmitter);

const analysisCache = new Map();
const CACHE_TTL = 5 * 60 * 1000;

function wrapRoute(fn) {
  return (req, res, next) => {
    try {
      const result = fn(req, res, next);
      if (result && typeof result.catch === 'function') {
        result.catch(err => next(err));
      }
    } catch (err) {
      next(err);
    }
  };
}

// Authorization middleware — checks file ownership when auth is enabled
function authorizeFileAccess(req, res, next) {
  if (!config.auth.enabled) return next();
  const { fileId } = req.params;
  if (!fileId) return next();
  const record = store.get(fileId);
  if (record && record.userId && record.userId !== req.user?.id && req.user?.role !== 'admin') {
    return res.status(403).json({ error: 'Access denied' });
  }
  next();
}

function cacheSet(key, value) {
  if (analysisCache.size >= 50) {
    const oldestKey = analysisCache.keys().next().value;
    analysisCache.delete(oldestKey);
  }
  analysisCache.set(key, { value, timestamp: Date.now() });
}

function cacheGet(key) {
  const entry = analysisCache.get(key);
  if (!entry) return undefined;
  if (Date.now() - entry.timestamp > CACHE_TTL) {
    analysisCache.delete(key);
    return undefined;
  }
  return entry.value;
}

// Multer configuration for file uploads inside the workspace upload dir
const uploadsDir = path.join(__dirname, '../../../uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadsDir),
  filename: (req, file, cb) => {
    const safe = (path.basename(file.originalname || '').replace(/[^\w.\-]+/g, '_')).slice(0, 120) || 'upload.log';
    cb(null, `${Date.now()}-${safe}`);
  }
});
const upload = multer({
  storage: storage,
  limits: { fileSize: config.upload.maxFileSize }
});

module.exports = {
  store,
  fileIngestor,
  liveClients,
  sseEmitter,
  analysisCache,
  wrapRoute,
  authorizeFileAccess,
  cacheSet,
  cacheGet,
  uploadsDir,
  upload
};
