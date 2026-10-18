const express = require('express');
const sourceManager = require('../services/SourceManager');
const crypto = require('crypto');
const { requireAuth } = require('../middleware/auth');
const { logger } = require('../middleware/logger');
const { isSftpHostAllowed } = require('../utils/hostGuard');

const REDACTED = '••••••';

const router = express.Router();
router.use(requireAuth);

function sendRouteError(res, err, opLabel) {
  if (err.isOperational) {
    return res.status(err.statusCode || 400).json({ error: err.message });
  }
  logger.error(`${opLabel} failed:`, err.message || err);
  return res.status(500).json({ error: 'Internal server error' });
}

function redactConfig(cfg) {
  if (!cfg) return cfg;
  const out = { ...cfg };
  if (out.password) out.password = REDACTED;
  if (out.authValue) out.authValue = REDACTED;
  return out;
}

// GET /api/log-sources — list all sources
router.get('/', (req, res) => {
  try {
    const baseUrl = process.env.PUBLIC_URL || `${req.protocol}://${req.get('host')}`;
    const sources = sourceManager.getAll().map(s => {
      const stats = sourceManager.getStats(s.id);
      return { ...enrichSource(s, baseUrl), stats: stats || {} };
    });
    res.json({ success: true, sources, serverUrl: baseUrl });
  } catch (err) {
    res.status(500).json({ error: 'Failed to list sources' });
  }
});

// POST /api/log-sources — create a new source
router.post('/', (req, res) => {
  try {
    const { name, type, config } = req.body;
    if (!name || !type) return res.status(400).json({ error: 'name and type required' });
    if (!['webhook', 'syslog', 'http_poll', 'sftp'].includes(type)) {
      return res.status(400).json({ error: 'type must be webhook, syslog, http_poll, or sftp' });
    }
    if (type === 'sftp' && !isSftpHostAllowed(config?.host)) {
      return res.status(403).json({ error: `SFTP host "${config?.host || ''}" is not allowed (SFTP_ALLOWED_HOSTS)` });
    }
    const source = sourceManager.create({ name, type, config });
    // The webhook API key is revealed exactly once — in this creation response
    const baseUrl = process.env.PUBLIC_URL || `${req.protocol}://${req.get('host')}`;
    res.json({ success: true, source: enrichSource(source, baseUrl, { revealApiKey: true }) });
  } catch (err) {
    res.status(500).json({ error: 'Failed to create source' });
  }
});

// GET /api/log-sources/:id — get source details
router.get('/:id', (req, res) => {
  try {
    const source = sourceManager.getById(req.params.id);
    if (!source) return res.status(404).json({ error: 'Source not found' });
    const baseUrl = process.env.PUBLIC_URL || `${req.protocol}://${req.get('host')}`;
    const instance = sourceManager.getInstance(req.params.id);
    const stats = instance ? (instance.getStats ? instance.getStats() : {}) : {};
    res.json({ success: true, source: { ...enrichSource(source, baseUrl), stats } });
  } catch (err) {
    res.status(500).json({ error: 'Failed to get source' });
  }
});

// PUT /api/log-sources/:id — update source
router.put('/:id', (req, res) => {
  try {
    const existing = sourceManager.getById(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Source not found' });
    const nextType = req.body?.type || existing.type;
    const nextHost = req.body?.config?.host;
    if (nextType === 'sftp' && nextHost !== undefined && !isSftpHostAllowed(nextHost)) {
      return res.status(403).json({ error: `SFTP host "${nextHost || ''}" is not allowed (SFTP_ALLOWED_HOSTS)` });
    }
    const updated = sourceManager.update(req.params.id, req.body);
    if (!updated) return res.status(404).json({ error: 'Source not found' });
    const baseUrl = process.env.PUBLIC_URL || `${req.protocol}://${req.get('host')}`;
    res.json({ success: true, source: enrichSource(updated, baseUrl) });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update source' });
  }
});

// DELETE /api/log-sources/:id — delete source
router.delete('/:id', async (req, res) => {
  try {
    const source = sourceManager.getById(req.params.id);
    if (!source) return res.status(404).json({ error: 'Source not found' });
    await sourceManager.delete(req.params.id);
    res.json({ success: true });
  } catch (err) {
    sendRouteError(res, err, 'logSources/delete');
  }
});

// POST /api/log-sources/:id/start — start source
router.post('/:id/start', async (req, res) => {
  try {
    await sourceManager.start(req.params.id);
    res.json({ success: true });
  } catch (err) {
    sendRouteError(res, err, 'logSources/start');
  }
});

// POST /api/log-sources/:id/stop — stop source
router.post('/:id/stop', async (req, res) => {
  try {
    await sourceManager.stop(req.params.id);
    res.json({ success: true });
  } catch (err) {
    sendRouteError(res, err, 'logSources/stop');
  }
});

// POST /api/log-sources/:id/restart — restart source
router.post('/:id/restart', async (req, res) => {
  try {
    await sourceManager.restart(req.params.id);
    res.json({ success: true });
  } catch (err) {
    sendRouteError(res, err, 'logSources/restart');
  }
});

// POST /api/log-sources/:id/sftp-list — list remote files on SFTP server
router.post('/:id/sftp-list', async (req, res) => {
  try {
    const source = sourceManager.getById(req.params.id);
    if (!source) return res.status(404).json({ error: 'Source not found' });
    if (source.type !== 'sftp') return res.status(400).json({ error: 'Not an SFTP source' });
    const config = source.config || {};
    if (!isSftpHostAllowed(config.host)) {
      return res.status(403).json({ error: `SFTP host "${config.host || ''}" is not allowed (SFTP_ALLOWED_HOSTS)` });
    }
    const Client = require('ssh2-sftp-client');
    const client = new Client();
    await client.connect({
      host: config.host, port: parseInt(config.port, 10) || 22,
      username: config.username, password: config.password,
      readyTimeout: 10000, retries: 1
    });
    const items = await client.list(config.remotePath || '/');
    await client.end();
    const files = items
      .filter(f => f.type === '-')
      .map(f => ({ name: f.name, size: f.size, modifyTime: f.modifyTime }))
      .sort((a, b) => b.modifyTime - a.modifyTime);
    res.json({ success: true, files, remotePath: config.remotePath || '/' });
  } catch (err) {
    logger.error('logSources/sftp-list failed:', err.message || err);
    res.status(500).json({ error: 'Failed to list files' + (err.code ? ` (${err.code})` : '') });
  }
});

// POST /api/log-sources/:id/sftp-ingest — download & ingest a specific remote file
router.post('/:id/sftp-ingest', async (req, res) => {
  try {
    const { fileName } = req.body;
    if (!fileName) return res.status(400).json({ error: 'fileName required' });
    // Prevent path traversal — reject any fileName containing ../ or ..\
    if (/\.\.(\/|\\)/.test(fileName)) {
      return res.status(400).json({ error: 'Invalid fileName: path traversal detected' });
    }
    const sanitized = fileName.replace(/[^a-zA-Z0-9._-]/g, '_');
    const source = sourceManager.getById(req.params.id);
    if (!source) return res.status(404).json({ error: 'Source not found' });
    if (source.type !== 'sftp') return res.status(400).json({ error: 'Not an SFTP source' });
    const config = source.config || {};
    if (!isSftpHostAllowed(config.host)) {
      return res.status(403).json({ error: `SFTP host "${config.host || ''}" is not allowed (SFTP_ALLOWED_HOSTS)` });
    }
    const remotePath = config.remotePath || '/';
    const remoteFull = `${remotePath.replace(/\/$/, '')}/${sanitized}`;

    const Client = require('ssh2-sftp-client');
    const client = new Client();
    await client.connect({
      host: config.host, port: parseInt(config.port, 10) || 22,
      username: config.username, password: config.password,
      readyTimeout: 10000, retries: 1
    });
    let text = await client.get(remoteFull);
    await client.end();
    if (Buffer.isBuffer(text)) text = text.toString('utf8');

    const allLines = text.split(/\r?\n/).filter(l => l.trim());
    if (allLines.length === 0) return res.json({ success: true, linesIngested: 0 });

    // Process the entire file at once through the log pipeline (same as upload)
    await new Promise(r => setImmediate(r));
    const logsRouter = require('./logs');
    const sourceName = `sftp_${source.id}_${sanitized}_${new Date().toISOString().slice(0, 10)}`;
    logsRouter.processLogFile(sourceName, allLines.join('\n'), { source: `sftp:${source.id}`, sourcePath: remoteFull, userId: req.user?.id });

    const now = new Date().toISOString();
    const db = require('../db');
    db.prepare('UPDATE log_sources SET lastSeenAt = ?, bytesIngested = bytesIngested + ?, updatedAt = ? WHERE id = ?')
      .run(now, text.length, now, source.id);

    res.json({ success: true, fileName, linesIngested: allLines.length, bytesIngested: text.length });
  } catch (err) {
    logger.error('logSources/sftp-ingest failed:', err.message || err);
    res.status(500).json({ error: 'Failed to ingest file' + (err.code ? ` (${err.code})` : '') });
  }
});

function enrichSource(source, baseUrl, options = {}) {
  const { revealApiKey = false } = options;
  if (source.type === 'webhook') {
    const apiKey = source.config?.apiKey || '';
    const curlKey = revealApiKey ? apiKey : '<API_KEY>';
    const webhookUrl = `${baseUrl.replace(/\/+$/, '')}/api/logs/ingest/webhook/${source.id}`;
    return {
      ...source,
      config: { ...redactConfig(source.config), webhookUrl, apiKey: revealApiKey ? apiKey : (apiKey ? REDACTED : '') },
      instructions: {
        curl: `curl -X POST "${webhookUrl}" \\\n  -H "X-API-Key: ${curlKey}" \\\n  -H "Content-Type: text/plain" \\\n  -d "$(tail -100 /var/log/syslog)"`,
        // The key is shown once, in the POST /api/log-sources response
        apiKeyNote: revealApiKey
          ? undefined
          : 'API key is revealed only when the source is created — store it now or rotate the source to get a new one.',
        filebeat: `output.logstash:\n  hosts: ["${baseUrl.replace(/^https?:\/\//, '')}"]`,
        rsyslog: `action(type="omfwd" target="${new URL(baseUrl).hostname}" port="5000" protocol="tcp")`
      }
    };
  }
  if (source.type === 'sftp') {
    return {
      ...source,
      config: redactConfig(source.config),
      instructions: {
        manual: `SFTP source configured for:\n  ${source.config?.username}@${source.config?.host}:${source.config?.port || 22}\n  Path: ${source.config?.remotePath || '/'}\n  Pattern: ${source.config?.filePattern || '*.log'}\n\nIngestion is on-demand: use the SFTP browser in the Sources page to list remote files (POST /api/log-sources/${source.id}/sftp-list) and ingest the ones you choose (POST /api/log-sources/${source.id}/sftp-ingest). Scheduled automatic polling is not implemented yet.`
      }
    };
  }
  if (source.type === 'syslog') {
    const hostname = new URL(baseUrl).hostname;
    const port = source.config?.port || 1514;
    const protocol = source.config?.protocol || 'udp';
    return {
      ...source,
      config: redactConfig(source.config),
      instructions: {
        rsyslog: `# On your remote server, add to /etc/rsyslog.conf:\n*.* action(type="omfwd" target="${hostname}" port="${port}" protocol="${protocol}")`,
        syslogng: `# In syslog-ng.conf:\ndestination d_lograke {\n  ${protocol}("${hostname}" port(${port}));\n};\nlog { source(s_sys); destination(d_lograke); };`
      }
    };
  }
  return { ...source, config: redactConfig(source.config) };
}

module.exports = router;
