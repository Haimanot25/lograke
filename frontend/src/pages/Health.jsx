import { useState, useEffect } from 'react';
import { Lightbulb, Check, X, Activity, Clock, Brain, Server, BarChart3 } from 'lucide-react';
import { API_BASE } from '../config';

export default function Health() {
  const [health, setHealth] = useState(null);
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState({ totalFiles: 0, totalLogs: 0, avgLogSize: 0 });

  useEffect(() => {
    const load = async () => {
      try {
        const [healthRes, metricsRes] = await Promise.all([
          fetch(`${API_BASE}/health`),
          fetch(`${API_BASE}/logs/metrics/files`)
        ]);
        if (healthRes.ok) { const healthData = await healthRes.json(); setHealth(healthData); }
        if (metricsRes.ok) {
          const metricsData = await metricsRes.json();
          const files = metricsData.files || [];
          const totalLogs = files.reduce((sum, f) => sum + (f.linesCount || 0), 0);
          setStats({ totalFiles: files.length, totalLogs, avgLogSize: files.length > 0 ? (totalLogs / files.length).toFixed(0) : 0 });
        }
      } catch (err) { console.error('Health check error:', err); }
      finally { setLoading(false); }
    };
    const timer = setInterval(load, 30000);
    load();
    return () => clearInterval(timer);
  }, []);

  if (loading) return <div className="ep-empty"><div className="ep-empty-icon"><Activity size={24} /></div><p>Loading system health...</p></div>;

  const statusColor = health?.status === 'healthy' ? '#22c55e' : '#ef4444';
  const uptime = health?.uptime || 0;
  const uptimeHours = (uptime / 1000 / 3600).toFixed(1);

  return (
    <div className="health-layout">
      <div className="section-header">
        <div>
          <h1>System Health & Performance</h1>
          <p>Backend service status and platform analytics.</p>
        </div>
        <div className="section-header-actions">
          <span className={`status-dot ${health?.status === 'healthy' ? 'online' : 'error'}`} />
          <span className="ep-chip">{health?.status === 'healthy' ? 'All Systems Operational' : 'Service Disruption'}</span>
        </div>
      </div>

      <div className="ep-stats">
        <div className="ep-kpi" style={{ borderLeft: `3px solid ${statusColor}` }}>
          <div className="ep-kpi-header"><Activity size={14} /> Service Status</div>
          <div className="ep-kpi-value" style={{ color: statusColor, fontSize: 22 }}>{health?.status?.toUpperCase() || 'UNKNOWN'}</div>
          <div className="ep-kpi-sub">Last check: {health?.timestamp ? new Date(health.timestamp).toLocaleTimeString() : 'N/A'}</div>
        </div>
        <div className="ep-kpi">
          <div className="ep-kpi-header"><Clock size={14} /> Uptime</div>
          <div className="ep-kpi-value" style={{ fontSize: 22 }}>{uptimeHours}<span style={{ fontSize: 14, fontWeight: 400, color: 'var(--text-muted)' }}>h</span></div>
          <div className="ep-kpi-sub">Continuous operation</div>
        </div>
        <div className="ep-kpi">
          <div className="ep-kpi-header"><Brain size={14} /> AI Features</div>
          <div className="ep-kpi-value" style={{ color: health?.aiEnabled ? '#22c55e' : '#888', fontSize: 18 }}>
            {health?.aiEnabled ? 'ENABLED' : 'DISABLED'}
          </div>
          <div className="ep-kpi-sub">
            {health?.aiEnabled
              ? `Active: ${health?.activeAiProvider || 'groq'}`
              : 'Configure keys in Admin Settings'}
          </div>
        </div>
      </div>

      <div className="card-elevated mt-4">
        <div className="card-header-slot">
          <div className="card-title flex-gap-2"><BarChart3 size={16} /> Platform Statistics</div>
        </div>
        <div className="ep-stats">
          <div className="aggregation-card">
            <div className="aggregation-field">Files Processed</div>
            <div className="ep-kpi-value" style={{ fontSize: 28, color: 'var(--color-accent)' }}>{stats.totalFiles}</div>
          </div>
          <div className="aggregation-card">
            <div className="aggregation-field">Total Log Lines</div>
            <div className="ep-kpi-value" style={{ fontSize: 28, color: 'var(--color-info)' }}>{stats.totalLogs.toLocaleString()}</div>
          </div>
          <div className="aggregation-card">
            <div className="aggregation-field">Avg File Size</div>
            <div className="ep-kpi-value" style={{ fontSize: 28, color: 'var(--color-warn)' }}>{stats.avgLogSize.toLocaleString()}</div>
            <div className="aggregation-item"><span>lines per file</span></div>
          </div>
        </div>
      </div>

      <div className="card-elevated mt-4">
        <div className="card-title mb-3 flex-gap-2"><Lightbulb size={16} /> Performance Tips</div>
        <div className="health-tips-list">
          {[
            'Use patterns page to quickly identify recurring templates in large logs',
            'Set up alert rules to auto-detect critical issues without manual review',
            'Compare logs from different time periods to track improvements or regressions',
            'Use entities page to trace request flows across distributed systems',
            'Export reports for archival and compliance documentation',
          ].map((tip, i) => (
            <div key={i} className="health-tips-item flex-gap-3" style={{ padding: '8px 0', borderBottom: i < 4 ? '1px solid var(--border-muted)' : 'none' }}>
              <Lightbulb size={14} style={{ flexShrink: 0, color: 'var(--color-accent)' }} />
              <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{tip}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="card-elevated mt-4">
        <div className="card-title mb-3 flex-gap-2"><Server size={16} /> Backend Information</div>
        <div className="health-backend-grid flex-gap-4" style={{ flexWrap: 'wrap' }}>
          <div className="aggregation-card" style={{ flex: 1, minWidth: 200 }}>
            <div className="aggregation-field">API Endpoint</div>
            <div className="text-mono" style={{ fontSize: 13, color: 'var(--text-primary)' }}>{API_BASE}</div>
          </div>
          <div className="aggregation-card" style={{ flex: 1, minWidth: 200 }}>
            <div className="aggregation-field">Status</div>
            <div className="flex-gap-2" style={{ color: statusColor, fontSize: 13, fontWeight: 600 }}>
              {health?.status === 'healthy' ? <><Check size={14} /> Connected</> : <><X size={14} /> Disconnected</>}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
