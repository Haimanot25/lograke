const db = require('../db');
const { logger } = require('../middleware/logger');

const sseClients = new Set();

function addSSEClient(res) {
  sseClients.add(res);
  res.on('close', () => sseClients.delete(res));
}

function broadcastSSE(event) {
  const data = `data: ${JSON.stringify(event)}\n\n`;
  for (const client of sseClients) {
    try { client.write(data); } catch { sseClients.delete(client); }
  }
}

function getNotificationSettings() {
  return db.prepare('SELECT * FROM notification_settings').all().map(r => ({
    ...r,
    enabled: r.enabled === 1,
    config: r.config ? JSON.parse(r.config) : {},
    severityFilter: r.severityFilter ? JSON.parse(r.severityFilter) : ['high', 'medium', 'low']
  }));
}

function createNotificationSetting(setting) {
  const id = `notif_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
  db.prepare(`
    INSERT INTO notification_settings (id, channel, enabled, config, severityFilter)
    VALUES (?, ?, ?, ?, ?)
  `).run(id, setting.channel, setting.enabled !== false ? 1 : 0,
    JSON.stringify(setting.config || {}),
    JSON.stringify(setting.severityFilter || ['high', 'medium', 'low']));
  return { id, ...setting, enabled: setting.enabled !== false };
}

function updateNotificationSetting(id, updates) {
  const existing = db.prepare('SELECT * FROM notification_settings WHERE id = ?').get(id);
  if (!existing) {
    const e = new Error('Setting not found');
    e.isOperational = true;
    e.statusCode = 404;
    throw e;
  }
  const merged = {
    channel: updates.channel || existing.channel,
    enabled: updates.enabled !== undefined ? (updates.enabled ? 1 : 0) : existing.enabled,
    config: JSON.stringify(updates.config || JSON.parse(existing.config || '{}')),
    severityFilter: JSON.stringify(updates.severityFilter || JSON.parse(existing.severityFilter || '["high","medium","low"]'))
  };
  db.prepare('UPDATE notification_settings SET channel = ?, enabled = ?, config = ?, severityFilter = ? WHERE id = ?')
    .run(merged.channel, merged.enabled, merged.config, merged.severityFilter, id);
}

function deleteNotificationSetting(id) {
  db.prepare('DELETE FROM notification_settings WHERE id = ?').run(id);
}

function logNotification(alertId, channel, status, response) {
  try {
    db.prepare('INSERT INTO notification_log (alertId, channel, status, response) VALUES (?, ?, ?, ?)')
      .run(alertId || null, channel, status, response || null);
  } catch (err) { console.warn('HTTP notification send failed:', err.message); }
}

async function sendWebhook(url, payload, headers = {}) {
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10000)
    });
    const ok = res.ok;
    logNotification(payload.alertId, 'webhook', ok ? 'sent' : 'failed', `HTTP ${res.status}`);
    return ok;
  } catch (err) {
    logNotification(payload.alertId, 'webhook', 'failed', err.message);
    return false;
  }
}

function shouldNotify(setting, alert) {
  if (!setting.enabled) return false;
  return setting.severityFilter.includes(alert.severity);
}

async function dispatchAlert(alert, fileId) {
  const settings = getNotificationSettings();
  const payload = {
    alertId: alert.ruleId,
    fileId,
    type: alert.type,
    severity: alert.severity,
    message: alert.message,
    timestamp: alert.inspectedAt || new Date().toISOString()
  };

  broadcastSSE({ type: 'alert', ...payload });

  for (const setting of settings) {
    if (!shouldNotify(setting, alert)) continue;
    if (setting.channel === 'webhook' && setting.config.url) {
      await sendWebhook(setting.config.url, payload, setting.config.headers);
    }
  }
}

module.exports = {
  addSSEClient,
  broadcastSSE,
  getNotificationSettings,
  createNotificationSetting,
  updateNotificationSetting,
  deleteNotificationSetting,
  dispatchAlert,
  logNotification
};
