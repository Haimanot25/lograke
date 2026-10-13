import { useState, useEffect } from 'react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine, Brush } from 'recharts';
import { API_BASE } from '../../config';

const CustomTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  const d = payload[0]?.payload;
  return (
    <div className="chart-tooltip-custom">
      <div className="chart-tooltip-time">{label}</div>
      <div className="chart-tooltip-row"><span className="dot" style={{ background: '#3b82f6' }} />Total: <strong>{d?.count || 0}</strong></div>
      <div className="chart-tooltip-row"><span className="dot" style={{ background: '#22c55e' }} />Info: <strong>{d?.info || 0}</strong></div>
      <div className="chart-tooltip-row"><span className="dot" style={{ background: '#f59e0b' }} />Warn: <strong>{d?.warn || 0}</strong></div>
      <div className="chart-tooltip-row"><span className="dot" style={{ background: '#ef4444' }} />Error: <strong>{d?.error || 0}</strong></div>
      {d?.isAnomaly && <div className="chart-tooltip-anomaly">Anomaly detected (z-score: {d.zScore?.toFixed(1)})</div>}
    </div>
  );
};

export default function ChronologicalTimeline({ fileId, onNavigate }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [bucketMinutes, setBucketMinutes] = useState(5);
  const [viewMode, setViewMode] = useState('stacked');

  useEffect(() => {
    if (!fileId) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional fetch-on-change; loading flag mirrors request lifecycle
    setLoading(true);
    Promise.all([
      fetch(`${API_BASE}/logs/${fileId}/chronology?bucketMinutes=${bucketMinutes}`).then(r => r.json()),
      fetch(`${API_BASE}/logs/${fileId}/timeline?bucketMinutes=${bucketMinutes}`).then(r => r.json())
    ]).then(([chron, timeline]) => {
      const buckets = timeline.timeline || [];
      const anomalies = chron.anomalies?.anomalies || [];
      const anomalyTimes = new Set(anomalies.map(a => a.startTime));

      const chartData = buckets.map(b => ({
        time: new Date(b.startTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        fullTime: b.startTime,
        count: b.count,
        info: b.levels?.info || 0,
        warn: b.levels?.warn || 0,
        error: b.levels?.error || 0,
        isAnomaly: anomalyTimes.has(b.startTime),
        zScore: anomalies.find(a => a.startTime === b.startTime)?.zScore || 0
      }));

      setData({
        chartData,
        anomalies,
        stats: timeline.stats,
        temporalInsights: chron.temporalInsights,
        healthScore: chron.healthScore
      });
    }).catch((e) => { console.warn('ChronologicalTimeline fetch failed', e); }).finally(() => setLoading(false));
  }, [fileId, bucketMinutes]);

  if (loading) return <div className="chart-loading">Loading timeline...</div>;
  if (!data?.chartData?.length) return <div className="chart-empty">No timeline data available.</div>;

  const anomalyData = data.chartData.filter(d => d.isAnomaly);

  return (
    <div className="chrono-timeline">
      <div className="chrono-controls">
        <div className="chrono-bucket-selector">
          <label>Bucket:</label>
          {[1, 5, 15, 30, 60].map(m => (
            <button key={m} className={`btn-ghost-sm ${bucketMinutes === m ? 'active' : ''}`} onClick={() => setBucketMinutes(m)}>
              {m}m
            </button>
          ))}
        </div>
        <div className="chrono-view-toggle">
          <button className={`btn-ghost-sm ${viewMode === 'stacked' ? 'active' : ''}`} onClick={() => setViewMode('stacked')}>Stacked</button>
          <button className={`btn-ghost-sm ${viewMode === 'total' ? 'active' : ''}`} onClick={() => setViewMode('total')}>Total</button>
        </div>
      </div>

      <div className="chrono-chart-wrapper">
        <ResponsiveContainer width="100%" height={320}>
          <AreaChart data={data.chartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id="gradInfo" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.6} />
                <stop offset="95%" stopColor="#3b82f6" stopOpacity={0.05} />
              </linearGradient>
              <linearGradient id="gradWarn" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#f59e0b" stopOpacity={0.6} />
                <stop offset="95%" stopColor="#f59e0b" stopOpacity={0.05} />
              </linearGradient>
              <linearGradient id="gradError" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#ef4444" stopOpacity={0.6} />
                <stop offset="95%" stopColor="#ef4444" stopOpacity={0.05} />
              </linearGradient>
              <linearGradient id="gradTotal" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#6366f1" stopOpacity={0.6} />
                <stop offset="95%" stopColor="#6366f1" stopOpacity={0.05} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
            <XAxis dataKey="time" tick={{ fontSize: 10, fill: '#6b7280' }} interval="preserveStartEnd" />
            <YAxis tick={{ fontSize: 10, fill: '#6b7280' }} />
            <Tooltip content={<CustomTooltip />} />
            {viewMode === 'stacked' ? (
              <>
                <Area type="monotone" dataKey="info" stackId="1" stroke="#3b82f6" fill="url(#gradInfo)" strokeWidth={1.5} name="Info" />
                <Area type="monotone" dataKey="warn" stackId="1" stroke="#f59e0b" fill="url(#gradWarn)" strokeWidth={1.5} name="Warn" />
                <Area type="monotone" dataKey="error" stackId="1" stroke="#ef4444" fill="url(#gradError)" strokeWidth={1.5} name="Error" />
              </>
            ) : (
              <Area type="monotone" dataKey="count" stroke="#6366f1" fill="url(#gradTotal)" strokeWidth={2} name="Total" />
            )}
            {anomalyData.map((a, i) => (
              <ReferenceLine key={i} x={a.time} stroke="#ef4444" strokeDasharray="4 4" strokeWidth={1} />
            ))}
            <Brush dataKey="time" height={30} stroke="#6366f1" fill="rgba(99,102,241,0.1)" travellerWidth={10} />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      {anomalyData.length > 0 && (
        <div className={`chrono-anomaly-badge ${onNavigate ? 'clickable' : ''}`}
          onClick={() => { if (onNavigate) onNavigate('explorer', { searchMode: 'text', search: '', level: 'error' }); }}
          role={onNavigate ? 'button' : undefined}
          tabIndex={onNavigate ? 0 : undefined}
          onKeyDown={onNavigate ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onNavigate('explorer', { searchMode: 'text', search: '', level: 'error' }); } } : undefined}
        >
          <span className="pulse-dot red" /> {anomalyData.length} temporal anomal{anomalyData.length === 1 ? 'y' : 'ies'} detected
        </div>
      )}

      {data.temporalInsights && (
        <div className="chrono-insights-row">
          <div className="chrono-insight">
            <span className="chrono-insight-label">Event Velocity</span>
            <span className="chrono-insight-value">{data.temporalInsights.eventVelocity} evt/s</span>
          </div>
          <div className="chrono-insight">
            <span className="chrono-insight-label">Time Gaps</span>
            <span className="chrono-insight-value">{data.temporalInsights.timeGaps?.length || 0}</span>
          </div>
          <div className="chrono-insight">
            <span className="chrono-insight-label">Bursts</span>
            <span className="chrono-insight-value">{data.temporalInsights.bursts?.length || 0}</span>
          </div>
          <div className="chrono-insight">
            <span className="chrono-insight-label">Health</span>
            <span className={`chrono-insight-value ${data.healthScore > 75 ? 'good' : data.healthScore > 40 ? 'warn' : 'bad'}`}>{data.healthScore}</span>
          </div>
        </div>
      )}
    </div>
  );
}
