import { useState, useEffect, useCallback } from 'react';
import { API_BASE } from '../config';
import { useFileContext } from '../context/FileContext';

const ALERT_TYPES = [
  { value: 'error_rate', label: 'Error Rate Threshold' },
  { value: 'warning_rate', label: 'Warning Rate Threshold' },
  { value: 'error_count', label: 'Error Count Threshold' },
  { value: 'rare_pattern_detected', label: 'Rare Pattern Detected' },
  { value: 'volume_spike', label: 'Traffic Volume Spike' }
];

const SEVERITY_OPTIONS = ['high', 'medium', 'low'];

export default function Alerts() {
  const { activeFileId: fileId, selectedFile } = useFileContext();
  const [rules, setRules] = useState([]);
  const [alerts, setAlerts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [newRule, setNewRule] = useState({ name: '', type: 'error_rate', threshold: 0.1, severity: 'high', description: '' });
  const [message, setMessage] = useState('');

  const [notifSettings, setNotifSettings] = useState([]);
  const [notifLoading, setNotifLoading] = useState(false);
  const [newNotif, setNewNotif] = useState({ channel: 'webhook', config: { url: '' }, severityFilter: ['high', 'medium', 'low'] });
  const [notifMessage, setNotifMessage] = useState('');

  const loadAlerts = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/logs/${fileId}/alerts`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setRules(data.rules || []);
      setAlerts(data.alerts || []);
    } catch (err) {
      console.error('Failed to load alerts', err);
    } finally {
      setLoading(false);
    }
  }, [fileId]);

  const loadNotifSettings = async () => {
    setNotifLoading(true);
    try {
      const res = await fetch(`${API_BASE}/notifications/settings`);
      if (res.ok) {
        const data = await res.json();
        setNotifSettings(data.settings || []);
      }
    } catch (err) { console.warn('[Alerts] loadNotifSettings failed:', err); } finally {
      setNotifLoading(false);
    }
  };

  useEffect(() => {
    if (!fileId) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional fetch-on-change; loading flags mirror request lifecycle
    loadAlerts();
    loadNotifSettings();
  }, [fileId, loadAlerts]);

  const handleEvaluate = async () => {
    try {
      const res = await fetch(`${API_BASE}/logs/${fileId}/alerts/evaluate`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setAlerts(data.alerts || []);
      setMessage('Alerts evaluated successfully.');
    } catch (err) {
      setMessage(`Evaluation error: ${err.message}`);
    }
  };

  const handleCreateRule = async () => {
    if (!newRule.name.trim()) {
      setMessage('Rule name is required.');
      return;
    }
    setSaving(true);
    setMessage('');
    try {
      const res = await fetch(`${API_BASE}/logs/${fileId}/alerts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newRule)
      });
      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.error || 'Failed to create rule');
      }
      const data = await res.json();
      setRules(prev => [...prev, data.rule]);
      setAlerts(data.activeAlerts || []);
      setMessage('Alert rule created.');
      setNewRule({ name: '', type: 'error_rate', threshold: 0.1, severity: 'high', description: '' });
    } catch (err) {
      setMessage(err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleCreateNotif = async () => {
    if (newNotif.channel === 'webhook' && !newNotif.config.url.trim()) {
      setNotifMessage('Webhook URL is required.');
      return;
    }
    try {
      const res = await fetch(`${API_BASE}/notifications/settings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newNotif)
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error);
      }
      setNotifMessage('Notification channel added.');
      setNewNotif({ channel: 'webhook', config: { url: '' }, severityFilter: ['high', 'medium', 'low'] });
      loadNotifSettings();
    } catch (err) {
      setNotifMessage(err.message);
    }
  };

  const handleToggleNotif = async (id, enabled) => {
    try {
      await fetch(`${API_BASE}/notifications/settings/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled })
      });
      loadNotifSettings();
    } catch (err) { console.warn('[Alerts] handleToggleNotif failed:', err); }
  };

  const handleDeleteNotif = async (id) => {
    try {
      await fetch(`${API_BASE}/notifications/settings/${id}`, { method: 'DELETE' });
      loadNotifSettings();
    } catch (err) { console.warn('[Alerts] handleDeleteNotif failed:', err); }
  };

  const handleSeverityFilterToggle = (sev) => {
    setNewNotif(prev => {
      const current = prev.severityFilter || [];
      const next = current.includes(sev) ? current.filter(s => s !== sev) : [...current, sev];
      return { ...prev, severityFilter: next };
    });
  };

  const activeFileName = selectedFile?.name || fileId;
  const activeRuleCount = rules.length;
  const triggeredAlertCount = alerts.length;
  const severityCounts = alerts.reduce((acc, alert) => {
    acc[alert.severity] = (acc[alert.severity] || 0) + 1;
    return acc;
  }, {});

  return (
    <div className="alerts-layout">
      <div className="section-header">
        <div>
          <h1>Alerts & Monitoring</h1>
          <p>Manage rule-based alerts for <strong>{activeFileName}</strong>.</p>
        </div>
        <div className="section-header-actions">
          <button className="btn btn-secondary" onClick={handleEvaluate} disabled={loading || saving}>
            Evaluate Alerts Now
          </button>
        </div>
      </div>

      <div className="ep-stats">
        <div className="ep-kpi">
          <div className="ep-kpi-header">Configured Rules</div>
          <div className="ep-kpi-value" style={{ color: '#6366f1' }}>{activeRuleCount}</div>
          <div className="ep-kpi-sub">Total alert definitions</div>
        </div>
        <div className="ep-kpi">
          <div className="ep-kpi-header">Triggered Alerts</div>
          <div className="ep-kpi-value" style={{ color: '#ef4444' }}>{triggeredAlertCount}</div>
          <div className="ep-kpi-sub">Active alerts from latest evaluation</div>
        </div>
        <div className="ep-kpi">
          <div className="ep-kpi-header">Severity Mix</div>
          <div className="ep-kpi-value" style={{ color: '#f59e0b', fontSize: 18 }}>
            <span>H: {severityCounts.high || 0}</span>
            <span> M: {severityCounts.medium || 0}</span>
            <span> L: {severityCounts.low || 0}</span>
          </div>
          <div className="ep-kpi-sub">High / Medium / Low distribution</div>
        </div>
      </div>

      {message && <div className="alerts-message">{message}</div>}

      <div className="alerts-main-grid">
        <div className="card-elevated alerts-rules-card">
          <div className="card-title mb-4">Create Alert Rule</div>
          <div className="alerts-form-grid">
            <div className="alerts-form-group">
              <label style={{ display: 'block', marginBottom: '6px', fontSize: '13px', color: 'var(--text-muted)' }}>Rule Name</label>
              <input value={newRule.name} onChange={e => setNewRule({ ...newRule, name: e.target.value })} className="input-text" placeholder="e.g. High error rate" />
            </div>
            <div className="alerts-form-group">
              <label style={{ display: 'block', marginBottom: '6px', fontSize: '13px', color: 'var(--text-muted)' }}>Rule Type</label>
              <select value={newRule.type} onChange={e => setNewRule({ ...newRule, type: e.target.value })} className="input-select">
                {ALERT_TYPES.map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
              </select>
            </div>
            <div className="alerts-form-group">
              <label style={{ display: 'block', marginBottom: '6px', fontSize: '13px', color: 'var(--text-muted)' }}>Threshold</label>
              <input type="number" step="0.01" min="0" value={newRule.threshold} onChange={e => setNewRule({ ...newRule, threshold: Number(e.target.value) })} className="input-text" placeholder="0.1" />
              <div className="alerts-form-hint">Use decimals for ratio rules (0.1 = 10%) or counts for error_count.</div>
            </div>
            <div className="alerts-form-group">
              <label style={{ display: 'block', marginBottom: '6px', fontSize: '13px', color: 'var(--text-muted)' }}>Severity</label>
              <select value={newRule.severity} onChange={e => setNewRule({ ...newRule, severity: e.target.value })} className="input-select">
                <option value="high">High</option>
                <option value="medium">Medium</option>
                <option value="low">Low</option>
              </select>
            </div>
            <div className="alerts-form-group">
              <label style={{ display: 'block', marginBottom: '6px', fontSize: '13px', color: 'var(--text-muted)' }}>Description</label>
              <textarea value={newRule.description} onChange={e => setNewRule({ ...newRule, description: e.target.value })} className="input-text" style={{ minHeight: '88px' }} placeholder="Optional description for the alert." />
            </div>
            <button className="btn btn-primary" onClick={handleCreateRule} disabled={saving}>
              {saving ? 'Saving...' : 'Create Alert Rule'}
            </button>
          </div>
        </div>

        <div className="card-elevated alerts-active-card">
          <div className="card-title mb-4">Active Alerts</div>
          {loading ? (
            <p style={{ color: 'var(--text-muted)' }}>Loading alert status...</p>
          ) : alerts.length === 0 ? (
            <p style={{ color: 'var(--text-muted)' }}>No current alert triggers.</p>
          ) : (
            <div className="alerts-active-list">
              {alerts.map(alert => (
                <div key={alert.ruleId} className="alerts-active-item">
                  <div className="alerts-active-header">
                    <strong>{alert.type}</strong>
                    <span className="alerts-active-severity">{alert.severity.toUpperCase()}</span>
                  </div>
                  <div className="alerts-active-message">{alert.message}</div>
                  <div className="alerts-active-rule">Rule ID: {alert.ruleId}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="card-elevated" style={{ marginBottom: '24px' }}>
        <h3 style={{ marginBottom: '16px' }}>Configured Alert Rules</h3>
        {loading ? (
          <p style={{ color: 'var(--text-muted)' }}>Loading rules...</p>
        ) : rules.length === 0 ? (
          <p style={{ color: 'var(--text-muted)' }}>No alert rules configured yet.</p>
        ) : (
          <div className="alerts-rules-list">
            {rules.map(rule => (
              <div key={rule.id} className="alerts-rule-item">
                <div className="alerts-rule-header">
                  <strong>{rule.name}</strong>
                  <span className="alerts-rule-status">{rule.active ? 'Active' : 'Disabled'}</span>
                </div>
                <div className="alerts-rule-meta">
                  Type: {rule.type} | Threshold: {rule.threshold} | Severity: {rule.severity}
                </div>
                {rule.description && <div className="alerts-rule-desc">{rule.description}</div>}
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="card-elevated alerts-notif-card">
        <h3 style={{ marginBottom: '16px' }}>Notification Channels</h3>
        <p style={{ fontSize: '13px', color: 'var(--text-muted)', marginBottom: '16px' }}>
          Configure how you receive alerts when rules trigger. Alerts are evaluated every 60 seconds automatically.
        </p>

        {notifMessage && <div className="alerts-message" style={{ marginBottom: '12px' }}>{notifMessage}</div>}

        <div className="alerts-notif-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '16px' }}>
          <div className="alerts-form-group">
            <label style={{ display: 'block', marginBottom: '6px', fontSize: '13px', color: 'var(--text-muted)' }}>Channel Type</label>
            <select value={newNotif.channel} onChange={e => setNewNotif({ ...newNotif, channel: e.target.value })} className="input-select">
              <option value="webhook">Webhook (HTTP POST)</option>
              <option value="browser">Browser (SSE)</option>
            </select>
          </div>
          {newNotif.channel === 'webhook' && (
            <div className="alerts-form-group">
              <label style={{ display: 'block', marginBottom: '6px', fontSize: '13px', color: 'var(--text-muted)' }}>Webhook URL</label>
              <input value={newNotif.config.url} onChange={e => setNewNotif({ ...newNotif, config: { ...newNotif.config, url: e.target.value } })} className="input-text" placeholder="https://hooks.slack.com/..." />
            </div>
          )}
        </div>

        <div className="alerts-form-group" style={{ marginBottom: '12px' }}>
          <label style={{ display: 'block', marginBottom: '6px', fontSize: '13px', color: 'var(--text-muted)' }}>Notify on Severity</label>
          <div style={{ display: 'flex', gap: '12px' }}>
            {SEVERITY_OPTIONS.map(sev => (
              <label key={sev} className="checkbox-label" style={{ fontSize: '13px' }}>
                <input type="checkbox" checked={(newNotif.severityFilter || []).includes(sev)} onChange={() => handleSeverityFilterToggle(sev)} />
                <span style={{ textTransform: 'capitalize' }}>{sev}</span>
              </label>
            ))}
          </div>
        </div>

        <button className="btn btn-primary" onClick={handleCreateNotif} style={{ marginBottom: '20px' }}>Add Channel</button>

        {notifLoading ? (
          <p style={{ color: 'var(--text-muted)' }}>Loading channels...</p>
        ) : notifSettings.length === 0 ? (
          <p style={{ color: 'var(--text-muted)' }}>No notification channels configured.</p>
        ) : (
          <div className="alerts-rules-list">
            {notifSettings.map(s => (
              <div key={s.id} className="alerts-rule-item" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <div className="alerts-rule-header">
                    <strong style={{ textTransform: 'capitalize' }}>{s.channel}</strong>
                    <span className="alerts-rule-status">{s.enabled ? 'Active' : 'Disabled'}</span>
                  </div>
                  <div className="alerts-rule-meta">
                    {s.channel === 'webhook' && s.config.url && `URL: ${s.config.url}`}
                    {s.channel === 'browser' && 'In-app browser notifications'}
                    {' '} | Severity: {(s.severityFilter || []).join(', ')}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: '6px' }}>
                  <button className="btn btn-ghost" onClick={() => handleToggleNotif(s.id, !s.enabled)} style={{ fontSize: '12px' }}>
                    {s.enabled ? 'Disable' : 'Enable'}
                  </button>
                  <button className="btn btn-danger" onClick={() => handleDeleteNotif(s.id)} style={{ fontSize: '12px', padding: '4px 8px' }}>
                    Delete
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
