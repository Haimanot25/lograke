import { useState, useEffect, useMemo } from 'react';
import { Activity, AlertTriangle, BarChart3, Layers, Clock, TrendingUp, Timer } from 'lucide-react';
import { API_BASE } from '../config';
import { MetricsTimeSeries } from '../components/charts';
import { ChronologicalTimeline } from '../components/charts';
import { useFileContext } from '../context/FileContext';

export default function Statistics() {
  const { activeFileId: fileId, selectedFile } = useFileContext();
  const [meta, setMeta] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    const load = async () => {
      if (!fileId) return;
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`${API_BASE}/logs/${fileId}/metadata`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        setMeta(data.metadata);
      } catch (err) {
        console.error('Stats load error:', err);
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [fileId]);

  const stats = useMemo(() => {
    if (!meta) return null;
    const lc = meta.levelCounts || {};
    const total = Object.values(lc).reduce((a, b) => a + b, 0) || 1;
    const errorCount = lc.error || 0;
    const warnCount = lc.warn || 0;
    const infoCount = lc.info || 0;
    const debugCount = lc.debug || 0;
    const healthScore = meta.healthScore ?? 100;
    const fc = meta.facetCounts || {};
    const patterns = meta.patterns || [];
    const anomalies = meta.anomalies || [];
    const entities = meta.entities || {};
    const chronology = meta.chronology || {};
    const tb = meta.timeBuckets || [];

    return {
      totalLines: meta.linesCount || total,
      errorCount, warnCount, infoCount, debugCount,
      errorRate: ((errorCount / total) * 100).toFixed(2),
      warnRate: ((warnCount / total) * 100).toFixed(2),
      infoRate: ((infoCount / total) * 100).toFixed(2),
      debugRate: ((debugCount / total) * 100).toFixed(2),
      healthScore,
      inferredType: meta.inferredType || 'unknown',
      timestamp: meta.timestamp,
      services: fc.service || {},
      hosts: fc.host || {},
      categories: fc.category || {},
      environments: fc.environment || {},
      patternCount: patterns.length,
      anomalyCount: anomalies.length,
      entityTypes: Object.keys(entities).length,
      totalEntities: Object.values(entities).reduce((s, bucket) => s + Object.keys(bucket).length, 0),
      chronology,
      timeBuckets: tb
    };
  }, [meta]);

  if (loading) {
    return <div style={{ padding: '40px', textAlign: 'center', color: 'var(--text-muted)' }}>Loading statistics…</div>;
  }
  if (error) {
    return <div className="card-elevated" style={{ padding: '24px', color: 'var(--color-error)' }}>Error: {error}</div>;
  }
  if (!stats) {
    return <div className="card-elevated" style={{ padding: '24px', color: 'var(--text-muted)' }}>No data available.</div>;
  }

  const maxTimeBucket = Math.max(...stats.timeBuckets.map(b => b.total), 1);
  const maxFacetCount = (obj) => Math.max(...Object.values(obj), 1);

  const healthColor = stats.healthScore >= 80 ? 'var(--color-success)' : stats.healthScore >= 50 ? 'var(--color-warning)' : 'var(--color-error)';

  return (
    <div className="stats-page-layout">
      <div className="section-header">
        <div>
          <h1>Log Statistics</h1>
          <p>Detailed metrics and analysis for <strong>{selectedFile?.name || fileId}</strong>.</p>
        </div>
      </div>

      {/* KPI Grid */}
      <div className="ep-stats">
        <div className="ep-kpi" style={{ borderLeft: '3px solid var(--color-info)' }}>
          <div className="ep-kpi-header"><Layers size={14} /> Total Lines</div>
          <div className="ep-kpi-value" style={{ fontSize: 22 }}>{stats.totalLines.toLocaleString()}</div>
        </div>
        <div className="ep-kpi" style={{ borderLeft: '3px solid var(--color-error)' }}>
          <div className="ep-kpi-header"><AlertTriangle size={14} /> Errors</div>
          <div className="ep-kpi-value" style={{ fontSize: 22, color: 'var(--color-error)' }}>{stats.errorCount.toLocaleString()}</div>
          <div className="ep-kpi-sub">{stats.errorRate}% of logs</div>
        </div>
        <div className="ep-kpi" style={{ borderLeft: '3px solid var(--color-warning)' }}>
          <div className="ep-kpi-header"><AlertTriangle size={14} /> Warnings</div>
          <div className="ep-kpi-value" style={{ fontSize: 22, color: 'var(--color-warning)' }}>{stats.warnCount.toLocaleString()}</div>
          <div className="ep-kpi-sub">{stats.warnRate}% of logs</div>
        </div>
        <div className="ep-kpi" style={{ borderLeft: '3px solid var(--color-success)' }}>
          <div className="ep-kpi-header"><Activity size={14} /> Info</div>
          <div className="ep-kpi-value" style={{ fontSize: 22, color: 'var(--color-success)' }}>{stats.infoCount.toLocaleString()}</div>
          <div className="ep-kpi-sub">{stats.infoRate}% of logs</div>
        </div>
      </div>

      <div className="ep-stats" style={{ gridTemplateColumns: '1fr 1fr' }}>
        {/* Health Score */}
        <div className="ep-kpi" style={{ borderLeft: '3px solid var(--color-success)' }}>
          <div className="ep-kpi-header"><TrendingUp size={14} /> Health Score</div>
          <div className="ep-kpi-value" style={{ fontSize: 28, color: healthColor }}>{stats.healthScore}</div>
          <div className="ep-kpi-sub">
            {stats.healthScore >= 80 ? 'Healthy system' : stats.healthScore >= 50 ? 'Needs attention' : 'Critical issues detected'}
          </div>
        </div>

        <div className="card-elevated" style={{ borderLeft: '3px solid var(--color-accent)' }}>
          <div className="ep-kpi-header mb-3"><BarChart3 size={14} /> Insights</div>
          <div className="ep-stats" style={{ gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
            <div className="text-muted">Patterns: <strong style={{ color: 'var(--text-primary)' }}>{stats.patternCount}</strong></div>
            <div className="text-muted">Anomalies: <strong style={{ color: 'var(--text-primary)' }}>{stats.anomalyCount}</strong></div>
            <div className="text-muted">Entity Types: <strong style={{ color: 'var(--text-primary)' }}>{stats.entityTypes}</strong></div>
            <div className="text-muted">Total Entities: <strong style={{ color: 'var(--text-primary)' }}>{stats.totalEntities}</strong></div>
          </div>
        </div>
      </div>

      {/* Level Distribution */}
      <div className="card-elevated stats-card">
        <h3>Level Distribution</h3>
        <div style={{ display: 'grid', gap: '10px', marginTop: '12px' }}>
          {[
            { label: 'Errors', value: stats.errorCount, pct: stats.errorRate, color: 'var(--color-error)' },
            { label: 'Warnings', value: stats.warnCount, pct: stats.warnRate, color: 'var(--color-warning)' },
            { label: 'Info', value: stats.infoCount, pct: stats.infoRate, color: 'var(--color-success)' },
            { label: 'Debug', value: stats.debugCount, pct: stats.debugRate, color: 'var(--color-info)' }
          ].filter(l => l.value > 0).map(l => (
            <div key={l.label}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px', marginBottom: '4px' }}>
                <span>{l.label}</span>
                <span style={{ fontWeight: 600 }}>{l.value.toLocaleString()} ({l.pct}%)</span>
              </div>
              <div style={{ height: '8px', background: 'var(--bg-subtle)', borderRadius: '4px', overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${l.pct}%`, background: l.color, borderRadius: '4px', transition: 'width 0.3s ease', minWidth: l.value > 0 ? '2px' : 0 }} />
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Time Series */}
      {stats.timeBuckets.length > 0 && (
        <div className="card-elevated stats-card">
          <h3 style={{ display: 'flex', alignItems: 'center', gap: '8px' }}><Clock size={16} /> Timeline Distribution</h3>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: '2px', height: '80px', marginTop: '12px' }}>
            {stats.timeBuckets.map((bucket, idx) => (
              <div
                key={idx}
                title={`${bucket.label}: ${bucket.total} logs (E:${bucket.error} W:${bucket.warn} I:${bucket.info})`}
                style={{
                  flex: 1,
                  height: `${Math.max(4, (bucket.total / maxTimeBucket) * 100)}%`,
                  display: 'flex',
                  flexDirection: 'column',
                  justifyContent: 'flex-end',
                  borderRadius: '2px 2px 0 0',
                  overflow: 'hidden'
                }}
              >
                <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
                  {bucket.error > 0 && <div style={{ flex: bucket.error, background: 'var(--color-error)', minWidth: '1px' }} />}
                  {bucket.warn > 0 && <div style={{ flex: bucket.warn, background: 'var(--color-warning)', minWidth: '1px' }} />}
                  {bucket.info > 0 && <div style={{ flex: bucket.info, background: 'var(--color-success)', opacity: 0.6, minWidth: '1px' }} />}
                </div>
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px' }}>
            <span>{stats.timeBuckets[0]?.label}</span>
            <span>{stats.timeBuckets[stats.timeBuckets.length - 1]?.label}</span>
          </div>
        </div>
      )}

      {/* Facet Breakdowns */}
      <div className="stats-big-cards">
        {Object.entries(stats.services).length > 0 && (
          <div className="card-elevated stats-card" style={{ flex: '1 1 45%' }}>
            <h3>By Service</h3>
            <div style={{ display: 'grid', gap: '6px', marginTop: '12px' }}>
              {Object.entries(stats.services).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([svc, cnt]) => (
                <div key={svc} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span style={{ fontSize: '12px', minWidth: '120px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{svc}</span>
                  <div style={{ flex: 1, height: '6px', background: 'var(--bg-subtle)', borderRadius: '3px' }}>
                    <div style={{ height: '100%', width: `${(cnt / maxFacetCount(stats.services)) * 100}%`, background: 'var(--color-accent)', borderRadius: '3px' }} />
                  </div>
                  <span style={{ fontSize: '11px', color: 'var(--text-muted)', minWidth: '30px', textAlign: 'right' }}>{cnt}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {Object.entries(stats.categories).length > 0 && (
          <div className="card-elevated stats-card" style={{ flex: '1 1 45%' }}>
            <h3>By Category</h3>
            <div style={{ display: 'grid', gap: '6px', marginTop: '12px' }}>
              {Object.entries(stats.categories).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([cat, cnt]) => (
                <div key={cat} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span style={{ fontSize: '12px', minWidth: '120px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{cat}</span>
                  <div style={{ flex: 1, height: '6px', background: 'var(--bg-subtle)', borderRadius: '3px' }}>
                    <div style={{ height: '100%', width: `${(cnt / maxFacetCount(stats.categories)) * 100}%`, background: 'var(--color-purple)', borderRadius: '3px' }} />
                  </div>
                  <span style={{ fontSize: '11px', color: 'var(--text-muted)', minWidth: '30px', textAlign: 'right' }}>{cnt}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Metrics Time Series */}
      <div className="card-elevated stats-card">
        <h3 style={{ display: 'flex', alignItems: 'center', gap: '8px' }}><Timer size={16} /> Metrics Time Series</h3>
        <p style={{ fontSize: '13px', color: 'var(--text-muted)', marginBottom: '16px' }}>Latency and status code trends with P95/P99 percentile lines.</p>
        <MetricsTimeSeries fileId={fileId} />
      </div>

      {/* Chronological Timeline */}
      <div className="card-elevated stats-card">
        <h3 style={{ display: 'flex', alignItems: 'center', gap: '8px' }}><Activity size={16} /> Chronological Analysis</h3>
        <p style={{ fontSize: '13px', color: 'var(--text-muted)', marginBottom: '16px' }}>Interactive timeline with anomaly detection, event velocity, and burst analysis.</p>
        <ChronologicalTimeline fileId={fileId} />
      </div>

      {/* File Info */}
      <div className="card-elevated stats-card">
        <h3>File Information</h3>
        <div className="stats-info-grid">
          <div>
            <div className="stats-info-label">Inferred Type</div>
            <div className="stats-info-value">{stats.inferredType}</div>
          </div>
          <div>
            <div className="stats-info-label">Processed At</div>
            <div className="stats-info-value">{new Date(stats.timestamp).toLocaleString()}</div>
          </div>
          <div>
            <div className="stats-info-label">Environments</div>
            <div className="stats-info-value">{Object.keys(stats.environments).join(', ') || 'N/A'}</div>
          </div>
          <div>
            <div className="stats-info-label">Hosts</div>
            <div className="stats-info-value">{Object.keys(stats.hosts).length} unique</div>
          </div>
        </div>
      </div>
    </div>
  );
}
