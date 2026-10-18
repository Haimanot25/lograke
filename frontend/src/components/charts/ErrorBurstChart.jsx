import { useMemo } from 'react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine, ReferenceArea } from 'recharts';
import { useChartData } from '../../hooks/useChartData';

const CustomTooltip = ({ active, payload }) => {
  if (!active || !payload?.length) return null;
  const d = payload[0]?.payload;
  return (
    <div className="chart-tooltip-custom">
      <div className="chart-tooltip-time">{d?.time}</div>
      <div className="chart-tooltip-row"><span className="dot" style={{ background: '#ef4444' }} />Errors: <strong>{d?.error || 0}</strong></div>
      <div className="chart-tooltip-row"><span className="dot" style={{ background: '#f59e0b' }} />Warnings: <strong>{d?.warn || 0}</strong></div>
      {d?.isAnomaly && <div className="chart-tooltip-anomaly">{d.anomalyType === 'spike' ? 'Spike' : 'Drop'} (z: {d.zScore?.toFixed(1)})</div>}
    </div>
  );
};

export default function ErrorBurstChart({ fileId, onNavigate }) {
  const { results, loading } = useChartData(fileId, (id) => [
    `/logs/${id}/timeline?bucketMinutes=2`,
    `/logs/${id}/chronology?bucketMinutes=2&anomalyThreshold=1.5`
  ]);

  const data = useMemo(() => {
    if (!results) return null;
    const [timeline, chron] = results;
    const buckets = timeline.timeline || [];
    const anomalies = chron.anomalies?.anomalies || [];
    const stats = chron.anomalies?.stats || {};
    const bursts = chron.temporalInsights?.bursts || [];
    const gaps = chron.temporalInsights?.timeGaps || [];

    const chartData = buckets.map(b => {
      const anomaly = anomalies.find(a => a.startTime === b.startTime);
      return {
        time: new Date(b.startTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        fullTime: b.startTime,
        error: b.levels?.error || 0,
        warn: b.levels?.warn || 0,
        total: b.count,
        isAnomaly: !!anomaly,
        zScore: anomaly?.zScore || 0,
        anomalyType: anomaly?.type || null
      };
    });

    return {
      chartData,
      meanCount: stats.mean || 0,
      stdDev: stats.stdDev || 0,
      bursts,
      gaps,
      anomalyCount: anomalies.length
    };
  }, [results]);

  if (loading) return <div className="chart-loading">Analyzing error bursts...</div>;
  if (!data?.chartData?.length) return <div className="chart-empty">No burst data available.</div>;

  return (
    <div className="error-burst-chart">
      <div className="burst-header">
        <h4>Error Burst Detection</h4>
        <div className="burst-stats">
          {data.anomalyCount > 0 && (
            <span className="burst-stat-badge red">
              <span className="pulse-dot red" /> {data.anomalyCount} anomal{data.anomalyCount === 1 ? 'y' : 'ies'}
            </span>
          )}
          {data.bursts?.length > 0 && (
            <span className="burst-stat-badge orange">{data.bursts?.length} burst{data.bursts?.length === 1 ? '' : 's'}</span>
          )}
          {data.gaps?.length > 0 && (
            <span className="burst-stat-badge yellow">{data.gaps?.length} gap{data.gaps?.length === 1 ? '' : 's'}</span>
          )}
        </div>
      </div>

      <div className="burst-chart-wrapper">
        <ResponsiveContainer width="100%" height={260}>
          <AreaChart data={data.chartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id="gradBurstError" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#ef4444" stopOpacity={0.7} />
                <stop offset="95%" stopColor="#ef4444" stopOpacity={0.05} />
              </linearGradient>
              <linearGradient id="gradBurstWarn" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#f59e0b" stopOpacity={0.5} />
                <stop offset="95%" stopColor="#f59e0b" stopOpacity={0.05} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
            <XAxis dataKey="time" tick={{ fontSize: 10, fill: '#6b7280' }} interval="preserveStartEnd" />
            <YAxis tick={{ fontSize: 10, fill: '#6b7280' }} />
            <Tooltip content={<CustomTooltip />} />
            {data.meanCount > 0 && (
              <ReferenceLine y={data.meanCount} stroke="#6b7280" strokeDasharray="6 3" label={{ value: 'avg', position: 'right', fill: '#6b7280', fontSize: 10 }} />
            )}
            {data.meanCount > 0 && data.stdDev > 0 && (
              <ReferenceArea y1={data.meanCount + data.stdDev * 2} y2={Infinity} fill="rgba(239,68,68,0.08)" />
            )}
            <Area type="monotone" dataKey="warn" stackId="1" stroke="#f59e0b" fill="url(#gradBurstWarn)" strokeWidth={1} name="Warnings" />
            <Area type="monotone" dataKey="error" stackId="1" stroke="#ef4444" fill="url(#gradBurstError)" strokeWidth={2} name="Errors" />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      {data.bursts?.length > 0 && (
        <div className="burst-details">
          <h5>Detected Bursts</h5>
          {data.bursts.slice(0, 5).map((b, i) => (
            <div key={i}
              className={`burst-detail-item ${onNavigate ? 'clickable' : ''}`}
              onClick={() => {
                if (!onNavigate) return;
                const from = new Date(b.from).toISOString();
                const to = new Date(b.to).toISOString();
                onNavigate('explorer', { searchMode: 'range', search: `${from}..${to}` });
              }}
              role={onNavigate ? 'button' : undefined}
              tabIndex={onNavigate ? 0 : undefined}
              onKeyDown={onNavigate ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); document.activeElement?.click(); } } : undefined}
            >
              <span className="burst-detail-icon">&#9889;</span>
              <span className="burst-detail-text">
                {new Date(b.from).toLocaleTimeString()} - {new Date(b.to).toLocaleTimeString()}
                {' '}({b.count} logs in {b.durationMs ? `${Math.round(b.durationMs / 1000)}s` : 'N/A'})
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
