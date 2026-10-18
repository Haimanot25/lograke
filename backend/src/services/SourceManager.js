const db = require('../db');
const SourceWebhook = require('../sources/SourceWebhook');
const SourceSyslog = require('../sources/SourceSyslog');
const SourceHttpPoll = require('../sources/SourceHttpPoll');
const SourceSftp = require('../sources/SourceSftp');

const REDACTED = '••••••';

function userError(message, statusCode = 400) {
  const e = new Error(message);
  e.isOperational = true;
  e.statusCode = statusCode;
  return e;
}

class SourceManager {
  constructor() {
    this.instances = new Map();
    this.ingestCallback = null;
    this.baseUrl = `http://localhost:${process.env.PORT || 5000}`;
  }

  setBaseUrl(url) {
    this.baseUrl = url;
  }

  setIngestCallback(cb) {
    this.ingestCallback = cb;
  }

  getAll() {
    return db.prepare('SELECT * FROM log_sources ORDER BY createdAt DESC').all().map(r => ({
      ...r,
      config: safeJson(r.config),
      running: this.instances.has(r.id)
    }));
  }

  getById(id) {
    const row = db.prepare('SELECT * FROM log_sources WHERE id = ?').get(id);
    if (!row) return null;
    return {
      ...row,
      config: safeJson(row.config),
      running: this.instances.has(row.id)
    };
  }

  create(data) {
    const id = `src_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const now = new Date().toISOString();
    const config = data.config || {};
    if (data.type === 'webhook' && !config.apiKey) {
      const crypto = require('crypto');
      config.apiKey = crypto.randomBytes(24).toString('hex');
    }
    db.prepare(`
      INSERT INTO log_sources (id, name, type, config, status, createdAt, updatedAt)
      VALUES (?, ?, ?, ?, 'inactive', ?, ?)
    `).run(id, data.name, data.type, JSON.stringify(config), now, now);
    return this.getById(id);
  }

  update(id, data) {
    const existing = this.getById(id);
    if (!existing) return null;
    let config = existing.config || {};
    if (data.config) {
      config = { ...config, ...data.config };
      for (const key of ['password', 'authValue']) {
        if (config[key] === REDACTED) config[key] = (existing.config || {})[key];
        if (config[key] === undefined) delete config[key];
      }
    }
    const now = new Date().toISOString();
    db.prepare(`
      UPDATE log_sources SET name = ?, config = ?, updatedAt = ? WHERE id = ?
    `).run(data.name || existing.name, JSON.stringify(config), now, id);
    return this.getById(id);
  }

  async delete(id) {
    // Stopping is best-effort — the row is removed even if a source's
    // transport fails to close cleanly.
    await this.stop(id).catch(() => {});
    db.prepare('DELETE FROM log_sources WHERE id = ?').run(id);
  }

  async start(id) {
    const source = this.getById(id);
    if (!source) throw userError('Source not found', 404);
    if (this.instances.has(id)) return;

    if (!this.ingestCallback) throw userError('Ingest callback not configured', 500);

    let instance;
    switch (source.type) {
      case 'webhook':
        instance = new SourceWebhook(source, this.ingestCallback);
        break;
      case 'syslog':
        instance = new SourceSyslog(source, this.ingestCallback);
        await instance.start();
        break;
      case 'http_poll':
        instance = new SourceHttpPoll(source, this.ingestCallback);
        await instance.start();
        break;
      case 'sftp':
        instance = new SourceSftp(source, this.ingestCallback);
        break;
      default:
        throw userError(`Unknown source type: ${source.type}`, 400);
    }

    this.instances.set(id, instance);
    const now = new Date().toISOString();
    db.prepare('UPDATE log_sources SET status = ?, updatedAt = ?, errorMessage = NULL WHERE id = ?').run('active', now, id);
  }

  async stop(id) {
    const instance = this.instances.get(id);
    if (!instance) return;
    if (typeof instance.stop === 'function') {
      await instance.stop();
    }
    this.instances.delete(id);
    const now = new Date().toISOString();
    db.prepare('UPDATE log_sources SET status = ?, updatedAt = ? WHERE id = ?').run('inactive', now, id);
  }

  async restart(id) {
    await this.stop(id);
    await this.start(id);
  }

  getInstance(id) {
    return this.instances.get(id) || null;
  }

  async stopAll() {
    for (const [id] of this.instances) {
      await this.stop(id);
    }
  }

  validateWebhookKey(sourceId, apiKey) {
    const instance = this.instances.get(sourceId);
    if (!instance || !(instance instanceof SourceWebhook)) return false;
    return instance.validateApiKey(apiKey);
  }

  async handleWebhookPayload(sourceId, body, ip) {
    const instance = this.instances.get(sourceId);
    if (!instance || !(instance instanceof SourceWebhook)) {
      return { accepted: 0, error: 'Webhook source not found or not active' };
    }
    const result = await instance.handlePayload(body, ip);
    const now = new Date().toISOString();
    db.prepare('UPDATE log_sources SET lastSeenAt = ?, bytesIngested = bytesIngested + ?, updatedAt = ? WHERE id = ?')
      .run(now, result.accepted || 0, now, sourceId);
    return result;
  }

  getStats(id) {
    const instance = this.instances.get(id);
    if (!instance) return null;
    return instance.getStats ? instance.getStats() : {};
  }
}

function safeJson(str) {
  try { return JSON.parse(str); } catch { return {}; }
}

const sourceManager = new SourceManager();
module.exports = sourceManager;
