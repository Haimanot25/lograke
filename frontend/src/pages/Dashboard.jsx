import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle, Puzzle, Info, AlertCircle, Zap, Hash, BarChart3 } from 'lucide-react';
import { API_BASE } from '../config';
import { ChronologicalTimeline, LogLevelPieChart, TemporalHeatmap, ErrorBurstChart } from '../components/charts';
import { useToastCtx } from '../context/ToastContext';
import { useFileContext } from '../context/FileContext';
import EpKpiCard from '../components/EpKpiCard';
import ActivityHeatmap from '../components/ActivityHeatmap';
import ExecutiveSummary from '../components/ExecutiveSummary';
import DonutChart from '../components/DonutChart';
import { patternToRegex } from '../utils/pattern';

export default function Dashboard() {
  const navigate = useNavigate();
  const { addToast } = useToastCtx();
  const { activeFileId: fileId, selectedFile, setExplorerContext } = useFileContext();
  const onNavigate = useCallback((tab, ctx) => {
    setExplorerContext(ctx);
    navigate(`/${tab}`);
  }, [setExplorerContext, navigate]);
  const [dashboardData, setDashboardData] = useState(null);
  const [dashLoading, setDashLoading] = useState(true);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [lastUpdated, setLastUpdated] = useState(null);
  const refreshIntervalRef = useRef(null);

  const timeBuckets = (dashboardData?.timeBuckets || selectedFile?.timeBuckets || []);
  const volumeData = timeBuckets.map(b => b.total);
  const maxBucket = timeBuckets.length > 0 ? timeBuckets.reduce((max, b) => Math.max(max, b.total), 1) : 1;

  const fetchDashboard = useCallback(async () => {
    if (!fileId) return;
    setDashLoading(true);
    try {
      const r = await fetch(`${API_BASE}/logs/${fileId}/dashboard`, { credentials: 'include' });
      if (r.ok) { const data = await r.json(); setDashboardData(data); setLastUpdated(new Date()); }
    } catch { /* ignore transient dashboard fetch errors */ }
    finally { setDashLoading(false); }
  }, [fileId]);

  // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional fetch-on-mount; loading flag mirrors request lifecycle
  useEffect(() => { fetchDashboard(); }, [fetchDashboard]);

  useEffect(() => {
    if (autoRefresh) {
      refreshIntervalRef.current = setInterval(fetchDashboard, 30000);
      return () => clearInterval(refreshIntervalRef.current);
    } else {
      if (refreshIntervalRef.current) clearInterval(refreshIntervalRef.current);
    }
  }, [autoRefresh, fetchDashboard]);

  if (!selectedFile) return null;

  if (dashLoading) {
    return (
      <div className="dashboard-layout">
        <div className="section-header">
          <div>
            <div className="skeleton skeleton-title" style={{ width: 280, height: 24, marginBottom: 8 }} />
            <div className="skeleton skeleton-text" style={{ width: 320, height: 14 }} />
          </div>
          <div className="section-header-actions">
            <div className="skeleton" style={{ width: 120, height: 32, borderRadius: 6 }} />
          </div>
        </div>
        <div className="ep-stats" style={{ marginBottom: 20 }}>
          {[1,2,3,4,5,6,7].map(i => <div key={i} className="skeleton" style={{ height: 100, borderRadius: 10, flex: 1, minWidth: 140 }} />)}
        </div>
        <div className="skeleton" style={{ height: 120, borderRadius: 10, marginBottom: 20 }} />
        <div className="dashboard-grid" style={{ marginBottom: 20 }}>
          <div className="skeleton" style={{ height: 260, borderRadius: 10 }} />
          <div className="skeleton" style={{ height: 260, borderRadius: 10 }} />
        </div>
        <div className="skeleton" style={{ height: 400, borderRadius: 10, marginBottom: 20 }} />
        <div className="dashboard-grid-2">
          <div className="skeleton" style={{ height: 300, borderRadius: 10 }} />
          <div className="skeleton" style={{ height: 300, borderRadius: 10 }} />
        </div>
        <div className="skeleton" style={{ height: 300, borderRadius: 10, marginTop: 20 }} />
      </div>
    );
  }

  const {
    aggregations = { service: [], host: [], category: [] },
    heatmap = { cells: [] },
    patterns = [],
    anomalies = [],
    healthScore: serverHealth,
    levelCounts = {},
    linesCount = 1,
    totalPatterns: patCount = 0,
    totalAnomalies: anomCount = 0
  } = dashboardData || {};

  const errorSparkData = timeBuckets.map(b => b.error || 0);
  const errorCount = levelCounts.error || 0;
  const warnCount  = levelCounts.warn  || 0;
  const infoCount  = levelCounts.info  || 0;
  const healthScore = serverHealth ?? Math.max(0, Math.min(100, Math.round(100 - ((errorCount / linesCount) * 50 + (warnCount / linesCount) * 15 + (anomCount * 3)))));
  const healthColor = healthScore > 75 ? '#10b981' : healthScore > 40 ? '#f59e0b' : '#ef4444';

  const topAnomalies = anomalies.slice(0, 5);
  const topPatterns  = patterns.slice(0, 5);

  const handleKpiClick = (type) => {
    if (!onNavigate) { addToast(`Opening ${type} drill-down view…`, 'info'); return; }
    const context = { level: 'all', searchMode: 'text', search: '' };
    switch (type) {
      case 'errors': context.level = 'error'; break;
      case 'warnings': context.level = 'warn'; break;
      case 'anomalies': context.searchMode = 'text'; context.search = 'anomaly'; break;
      case 'patterns': context.searchMode = 'regex'; context.search = topPatterns.length > 0 ? patternToRegex(topPatterns[0].template) : ''; break;
      default: break;
    }
    addToast(`Opening ${type} drill-down view…`, 'info');
    onNavigate('explorer', context);
  };

  return (
    <div className="dashboard-layout">
      <div className="section-header">
        <div>
          <h1>Operational Dashboard</h1>
          <p>
            Real-time analytics for <strong>{selectedFile.name}</strong> &middot;
            Format: <strong className="ep-chip"><BarChart3 size={12} />{selectedFile.inferredType?.toUpperCase()}</strong>
          </p>
        </div>
        <div className="section-header-actions">
          <div className="flex-gap-3" style={{ alignItems: 'center' }}>
            {lastUpdated && (
              <span className="text-muted" style={{ fontSize: 11, display: 'flex', alignItems: 'center', gap: 4 }}>
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: autoRefresh ? 'var(--color-success)' : 'var(--text-muted)', display: 'inline-block' }} />
                {lastUpdated.toLocaleTimeString()}
              </span>
            )}
            <button className={`btn btn-sm ${autoRefresh ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setAutoRefresh(!autoRefresh)} style={{ fontSize: 11, padding: '3px 8px' }}>
              {autoRefresh ? 'Live' : 'Auto-refresh'}
            </button>
          </div>
          <div className="health-badge" style={{ background: `${healthColor}18`, border: `1px solid ${healthColor}55` }}>
            <div className="health-badge-label">HEALTH SCORE</div>
            <div className="health-badge-value" style={{ color: healthColor }}>{healthScore}<span>/100</span></div>
          </div>
        </div>
      </div>

      <div className="ep-stats">
        <EpKpiCard label="Total Logs" value={linesCount} icon={<Hash size={16} />} variant="accent" subtitle="Lines parsed & indexed" sparkData={volumeData} onClick={() => handleKpiClick('logs')} />
        <EpKpiCard label="Error Rate" value={`${((errorCount / linesCount) * 100).toFixed(1)}%`} icon={<AlertCircle size={16} />} variant="error" subtitle={`${errorCount.toLocaleString()} critical events`} sparkData={errorSparkData} onClick={() => handleKpiClick('errors')} />
        <EpKpiCard label="Warnings" value={warnCount} icon={<AlertTriangle size={16} />} variant="warning" subtitle="Degraded service events" onClick={() => handleKpiClick('warnings')} />
        <EpKpiCard label="Info Logs" value={infoCount} icon={<Info size={16} />} variant="success" subtitle="Normal operational logs" onClick={() => handleKpiClick('info')} />
        <EpKpiCard label="Anomalies" value={anomCount} icon={<Zap size={16} />} variant="purple" subtitle="Statistical outliers" onClick={() => handleKpiClick('anomalies')} />
        <EpKpiCard label="Patterns" value={patCount} icon={<Puzzle size={16} />} variant="cyan" subtitle="Recurring log templates" onClick={() => handleKpiClick('patterns')} />
      </div>

      {/* SLI / SLO / Error Budget Card */}
      <div className="card-elevated" style={{ padding: '16px 20px' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '16px' }}>
          <div>
            <div className="text-muted" style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>Error Budget</div>
            <div style={{ fontSize: 22, fontWeight: 700, color: errorCount === 0 ? 'var(--color-success)' : 'var(--color-error)' }}>
              {errorCount === 0 ? '100%' : `${Math.max(0, 100 - Math.round((errorCount / Math.max(1, linesCount)) * 100))}%`}
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>of {linesCount.toLocaleString()} total logs</div>
          </div>
          <div>
            <div className="text-muted" style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>Error Rate (24h SLO)</div>
            <div style={{ fontSize: 22, fontWeight: 700, color: errorCount === 0 ? 'var(--color-success)' : errorCount / linesCount < 0.05 ? 'var(--color-warning)' : 'var(--color-error)' }}>
              {((1 - errorCount / Math.max(1, linesCount)) * 100).toFixed(2)}%
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
              {errorCount.toLocaleString()} errors · {(errorCount / Math.max(1, linesCount) * 100).toFixed(1)}% error rate
            </div>
          </div>
          <div>
            <div className="text-muted" style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>Warning Rate</div>
            <div style={{ fontSize: 22, fontWeight: 700, color: warnCount === 0 ? 'var(--color-success)' : 'var(--color-warning)' }}>
              {((1 - warnCount / Math.max(1, linesCount)) * 100).toFixed(2)}%
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{warnCount.toLocaleString()} warnings</div>
          </div>
          <div>
            <div className="text-muted" style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>Anomaly Density</div>
            <div style={{ fontSize: 22, fontWeight: 700, color: anomCount === 0 ? 'var(--color-success)' : 'var(--color-error)' }}>
              {anomCount}
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{anomCount === 0 ? 'No anomalies' : `${(anomCount / Math.max(1, linesCount) * 1000).toFixed(1)} per 1K logs`}</div>
          </div>
        </div>
      </div>

      <div className="dashboard-grid-2">
        <div className="card-elevated">
          <div className="card-header-slot">
            <div className="card-title">Log Volume & Severity Timeline</div>
            <div className="chart-legend">
              <span style={{ color: 'var(--color-info)' }}>■ INFO</span>
              <span style={{ color: 'var(--color-warn)' }}>■ WARN</span>
              <span style={{ color: 'var(--color-error)' }}>■ ERROR</span>
            </div>
          </div>
          <div className="chart-container">
            {timeBuckets.map((bucket, i) => {
              const h = (bucket.total / maxBucket) * 100;
              return (
                <div key={i} className="chart-bar-wrapper">
                  {bucket.total > 0 ? (
                    <div className="chart-bar" style={{ height: `${Math.max(4, h)}%` }}>
                      <div style={{ height: `${bucket.total ? (bucket.error / bucket.total) * 100 : 0}%`, background: 'var(--color-error)', width: '100%' }} />
                      <div style={{ height: `${bucket.total ? (bucket.warn  / bucket.total) * 100 : 0}%`, background: 'var(--color-warn)',  width: '100%' }} />
                      <div style={{ height: `${bucket.total ? (bucket.info  / bucket.total) * 100 : 0}%`, background: 'var(--color-info)',  width: '100%' }} />
                      <div className="chart-tooltip">
                        <div style={{ fontWeight: 600, marginBottom: '4px' }}>{bucket.label}</div>
                        <div style={{ color: 'var(--color-info)'  }}>INFO: {bucket.info}</div>
                        <div style={{ color: 'var(--color-warn)'  }}>WARN: {bucket.warn}</div>
                        <div style={{ color: 'var(--color-error)' }}>ERR:  {bucket.error}</div>
                        <div style={{ borderTop: '1px solid var(--text-muted)', marginTop: '4px', paddingTop: '4px', fontWeight: 600 }}>Total: {bucket.total}</div>
                      </div>
                    </div>
                  ) : (
                    <div style={{ height: '4px', width: '100%', background: 'var(--glass-border)', borderRadius: '2px' }} />
                  )}
                  {i % 4 === 0 && <span className="chart-label">{bucket.label}</span>}
                </div>
              );
            })}
          </div>
        </div>

        <div className="card-elevated">
          <div className="card-title mb-4">Severity Distribution</div>
          <div className="level-distribution">
            {[
              { label: 'INFO / LIFECYCLE', count: infoCount, color: 'var(--color-info)' },
              { label: 'WARNINGS',         count: warnCount, color: 'var(--color-warn)' },
              { label: 'ERRORS & FAILS',   count: errorCount, color: 'var(--color-error)' }
            ].map(({ label, count, color }) => (
              <div key={label} className="level-row">
                <div className="level-info">
                  <span style={{ color }}>{label}</span>
                  <span className="text-mono" style={{ fontWeight: 600 }}>
                    {count.toLocaleString()} <span className="text-muted">({((count / linesCount) * 100).toFixed(1)}%)</span>
                  </span>
                </div>
                <div className="level-bar-bg">
                  <div className="level-bar-fill" style={{ width: `${(count / linesCount) * 100}%`, background: color }} />
                </div>
              </div>
            ))}
            <div className="flex-center mt-4">
              <DonutChart slices={[
                { value: infoCount, color: '#10b981' },
                { value: warnCount, color: '#f59e0b' },
                { value: errorCount, color: '#ef4444' }
              ]} total={linesCount} label="Total" />
            </div>
          </div>
        </div>
      </div>

      <div className="section-header" style={{ marginTop: 8 }}>
        <div>
          <h1 style={{ fontSize: 18 }}>Aggregated Insights</h1>
          <p>Top service, host, and category distributions for this dataset.</p>
        </div>
      </div>

      <ActivityHeatmap fileId={fileId} data={heatmap.cells} />
      <div className="mt-4"><ExecutiveSummary fileId={fileId} /></div>

      <div className="aggregation-grid mt-4">
        {['service', 'host', 'category'].map(field => (
          <div key={field} className="aggregation-card">
            <div className="aggregation-field">{field}</div>
            {(aggregations[field] || []).length > 0 ? (
              aggregations[field].map(item => (
                <div key={item.value} className="aggregation-item">
                  <span className="truncate">{item.value}</span>
                  <strong>{item.count}</strong>
                </div>
              ))
            ) : (
              <div className="text-muted" style={{ fontSize: 13 }}>No {field} aggregation data available.</div>
            )}
          </div>
        ))}
      </div>

      <div className="dashboard-grid-2 mt-4">
        <div className="card-elevated">
          <div className="card-header-slot">
            <div className="card-title flex-gap-2"><Zap size={16} /> Detected Anomalies</div>
            <span className="ep-chip">{anomCount} total</span>
          </div>
          {topAnomalies.length > 0 ? (
            <div>
              {topAnomalies.map(anom => (
                <div key={anom.id} className={`anomaly-item ${anom.severity === 'high' ? 'high' : 'medium'}`}>
                  <div className="pulse-dot" />
                  <div className="anomaly-content">
                    <div className="anomaly-title">{anom.title}</div>
                    <div className="anomaly-desc">{anom.description}</div>
                  </div>
                  <div className="anomaly-score" style={{ color: anom.severity === 'high' ? 'var(--color-error)' : 'var(--color-warn)' }}>{anom.score}</div>
                </div>
              ))}
            </div>
          ) : (
            <div className="ep-empty" style={{ margin: 0 }}>
              <p>No anomalies detected. System healthy.</p>
            </div>
          )}
        </div>

        <div className="card-elevated">
          <div className="card-header-slot">
            <div>
              <div className="card-title flex-gap-2"><Puzzle size={16} /> Top Recurring Patterns</div>
              <div className="card-subtitle">Click a template to jump to the explorer.</div>
            </div>
            <span className="ep-chip">{patCount} total</span>
          </div>
          {topPatterns.length > 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {topPatterns.map((p, idx) => (
                <button key={p.id || idx} type="button" onClick={() => onNavigate && onNavigate('explorer', { searchMode: 'regex', search: patternToRegex(p.template), level: 'all' })} className="pattern-btn" title={p.template}>
                  <span className={`level-badge ${p.level}`} style={{ whiteSpace: 'nowrap' }}>{p.level}</span>
                  <div className="pattern-template">{p.template}</div>
                  <div className="pattern-count">{p.count}</div>
                </button>
              ))}
            </div>
          ) : (
            <div className="ep-empty" style={{ margin: 0 }}>
              <p>No patterns extracted yet.</p>
            </div>
          )}
        </div>
      </div>

      {selectedFile.entities && Object.keys(selectedFile.entities).length > 0 && (
        <div className="card-elevated mt-4">
          <div className="card-title mb-4 flex-gap-2"><Zap size={16} /> Traceable Entities Overview</div>
          <div className="entity-grid">
            {Object.entries(selectedFile.entities).map(([bucket, values]) => (
              <div key={bucket} className="entity-card">
                <div className="entity-field">{bucket}</div>
                {Object.entries(values).slice(0, 6).map(([val, count]) => (
                  <div key={val} className="entity-item">
                    <span className="truncate">{val}</span>
                    <strong>{count}</strong>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="card-elevated mt-4">
        <div className="card-title mb-3 flex-gap-2">Chronological Timeline</div>
        <p className="text-muted mb-4" style={{ fontSize: 13 }}>Interactive time-series with level stacking, anomaly markers, and zoom brush.</p>
        <ChronologicalTimeline fileId={fileId} onNavigate={onNavigate} />
      </div>

      <div className="dashboard-grid-2 mt-4">
        <div className="card-elevated">
          <div className="card-title mb-4 flex-gap-2">Log Level Distribution</div>
          <LogLevelPieChart fileId={fileId} />
        </div>
        <div className="card-elevated">
          <div className="card-title mb-3 flex-gap-2">Temporal Patterns</div>
          <p className="text-muted mb-3" style={{ fontSize: 12 }}>Activity distribution by hour of day and day of week.</p>
          <TemporalHeatmap fileId={fileId} />
        </div>
      </div>

      <div className="card-elevated mt-4">
        <div className="card-title mb-3 flex-gap-2">Error Burst Detection</div>
        <p className="text-muted mb-4" style={{ fontSize: 13 }}>Automatic detection of error spikes, traffic bursts, and time gaps.</p>
        <ErrorBurstChart fileId={fileId} onNavigate={onNavigate} />
      </div>

    </div>
  );
}
