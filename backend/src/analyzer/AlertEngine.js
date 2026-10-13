/**
 * AlertEngine - rule-based alert evaluation for log records.
 * Rules are persisted in the database and loaded into memory on startup.
 */
const db = require('../db');

const alertRules = new Map();

function loadRulesFromFile(fileId) {
  const rows = db.prepare('SELECT * FROM alert_rules WHERE fileId = ?').all(fileId);
  const rules = rows.map(r => ({
    ...r,
    active: r.active === 1,
    params: r.params ? JSON.parse(r.params) : {}
  }));
  alertRules.set(fileId, rules);
  return rules;
}

function createRule(fileId, rule) {
  if (!rule || !rule.name || !rule.type) {
    throw new Error('Alert rule must include name and type.');
  }

  const id = `alert_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
  const normalized = {
    id,
    fileId,
    name: rule.name,
    type: rule.type,
    severity: rule.severity || 'medium',
    threshold: rule.threshold || 0,
    field: rule.field || 'errorCount',
    description: rule.description || `Auto alert rule ${rule.name}`,
    active: rule.active !== false,
    createdAt: new Date().toISOString(),
    params: rule.params || {}
  };

  db.prepare(`
    INSERT INTO alert_rules (id, fileId, name, type, threshold, severity, description, active)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, fileId, normalized.name, normalized.type, normalized.threshold, normalized.severity, normalized.description, normalized.active ? 1 : 0);

  if (!alertRules.has(fileId)) {
    alertRules.set(fileId, []);
  }
  alertRules.get(fileId).push(normalized);
  return normalized;
}

function deleteRule(fileId, ruleId) {
  db.prepare('DELETE FROM alert_rules WHERE id = ? AND fileId = ?').run(ruleId, fileId);
  const rules = alertRules.get(fileId) || [];
  alertRules.set(fileId, rules.filter(r => r.id !== ruleId));
}

function getRules(fileId) {
  if (!alertRules.has(fileId)) {
    loadRulesFromFile(fileId);
  }
  return alertRules.get(fileId) || [];
}

function evaluateRule(rule, record) {
  if (!rule.active) return { rule, triggered: false, message: 'Rule inactive' };
  const totalLogs = record.linesCount || (record.parsedLogs || []).length;
  const errorCount = record.levelCounts?.error || 0;
  const warnCount = record.levelCounts?.warn || 0;
  const errorRate = totalLogs > 0 ? errorCount / totalLogs : 0;
  const warnRate = totalLogs > 0 ? warnCount / totalLogs : 0;

  let triggered = false;
  let message = '';

  switch (rule.type) {
    case 'error_rate':
      triggered = errorRate >= Number(rule.threshold);
      message = `Error rate is ${(errorRate * 100).toFixed(1)}%, threshold ${(rule.threshold * 100).toFixed(1)}%`;
      break;
    case 'warning_rate':
      triggered = warnRate >= Number(rule.threshold);
      message = `Warning rate is ${(warnRate * 100).toFixed(1)}%, threshold ${(rule.threshold * 100).toFixed(1)}%`;
      break;
    case 'error_count':
      triggered = errorCount >= Number(rule.threshold);
      message = `Error count is ${errorCount}, threshold ${rule.threshold}`;
      break;
    case 'rare_pattern_detected':
      triggered = (record.anomalies || []).some(a => a.type === 'rare_pattern' && a.score >= Number(rule.threshold || 50));
      message = `Rare log pattern detected in ${record.anomalies?.length || 0} anomalies.`;
      break;
    case 'volume_spike':
      triggered = (record.anomalies || []).some(a => a.type === 'volume_spike' && a.score >= Number(rule.threshold || 50));
      message = `Traffic volume spike found.`;
      break;
    default:
      message = `Unsupported alert type ${rule.type}`;
  }

  return {
    ruleId: rule.id,
    triggered,
    severity: rule.severity,
    type: rule.type,
    message,
    inspectedAt: new Date().toISOString()
  };
}

function evaluateAlerts(record) {
  const rules = getRules(record.id);
  const results = rules.map(rule => evaluateRule(rule, record));
  return results.filter(result => result.triggered);
}

module.exports = {
  createRule,
  deleteRule,
  getRules,
  loadRulesFromFile,
  evaluateAlerts
};
