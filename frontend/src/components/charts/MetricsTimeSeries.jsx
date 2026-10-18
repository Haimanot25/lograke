import { useState, useMemo } from 'react';
import { ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine, Legend } from 'recharts';
import { useChartData } from '../../hooks/useChartData';

const CustomTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="chart-tooltip-custom">
      <div className="chart-tooltip-time">{label}</div>
      {payload.map((p, i) => (
        <div key={i} className="chart-tooltip-row">
          <span className="dot" style={{ background: p.color }} />{p.name}: <strong>{typeof p.value === 'number' ? p.value.toFixed(1) : p.value}</strong>
        </div>
      ))}
    </div>
  );
};

export default function MetricsTimeSeries({ fileId }) {
  const [metricTab, setMetricTab] = useState('duration');

  const { results, loading } = useChartData(fileId, (id) => [
    `/logs/${id}/metrics-series?metric=durationMs`,
    `/logs/${id}/metrics-series?metric=statusCode`
  ]);

  const [durationData, statusData] = useMemo(() => {
    if (!results) return [null, null];
    const [dur, status] = results;
    const build = (d, round) => {
      if (!d.bucketedStats?.length) return null;
      return {
        stats: d.stats,
        chartData: d.bucketedStats.map(b => ({
          time: b.time.split(' ')[1] || b.time,
          avg: round(b.avg),
          min: round(b.min),
          max: round(b.max),
          count: b.count
        }))
      };
    };
    return [
      build(dur, v => Math.round(v * 10) / 10),
      build(status, v => Math.round(v))
    ];
  }, [results]);

  if (loading) return <div className="chart-loading">Loading metrics...</div>;

  const activeData = metricTab === 'duration' ? durationData : statusData;

  return (
    <div className="metrics-timeseries">
      <div className="metrics-controls">
        <button className={`btn-ghost-sm ${metricTab === 'duration' ? 'active' : ''}`} onClick={() => setMetricTab('duration')}>Duration (ms)</button>
        <button className={`btn-ghost-sm ${metricTab === 'status' ? 'active' : ''}`} onClick={() => setMetricTab('status')}>Status Codes</button>
      </div>

      {activeData?.stats && (
        <div className="metrics-stats-row">
          <div className="metrics-stat"><span className="metrics-stat-label">Min</span><span className="metrics-stat-value">{activeData.stats.min?.toFixed(1)}</span></div>
          <div className="metrics-stat"><span className="metrics-stat-label">Avg</span><span className="metrics-stat-value">{activeData.stats.avg?.toFixed(1)}</span></div>
          <div className="metrics-stat"><span className="metrics-stat-label">Median</span><span className="metrics-stat-value">{activeData.stats.median?.toFixed(1)}</span></div>
          <div className="metrics-stat"><span className="metrics-stat-label">P95</span><span className="metrics-stat-value warn">{activeData.stats.p95?.toFixed(1)}</span></div>
          <div className="metrics-stat"><span className="metrics-stat-label">P99</span><span className="metrics-stat-value bad">{activeData.stats.p99?.toFixed(1)}</span></div>
          <div className="metrics-stat"><span className="metrics-stat-label">Max</span><span className="metrics-stat-value">{activeData.stats.max?.toFixed(1)}</span></div>
        </div>
      )}

      {activeData?.chartData?.length ? (
        <div className="metrics-chart-wrapper">
          <ResponsiveContainer width="100%" height={280}>
            <ComposedChart data={activeData.chartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
              <XAxis dataKey="time" tick={{ fontSize: 10, fill: '#6b7280' }} interval="preserveStartEnd" />
              <YAxis tick={{ fontSize: 10, fill: '#6b7280' }} />
              <Tooltip content={<CustomTooltip />} />
              <Legend wrapperStyle={{ fontSize: 11, color: '#9ca3af' }} />
              <Bar dataKey="count" fill="rgba(99,102,241,0.3)" name="Count" barSize={20} />
              <Line type="monotone" dataKey="avg" stroke="#3b82f6" strokeWidth={2} dot={false} name="Avg" />
              <Line type="monotone" dataKey="max" stroke="#ef4444" strokeWidth={1.5} dot={false} strokeDasharray="4 4" name="Max" />
              {metricTab === 'duration' && durationData?.stats?.p95 && (
                <ReferenceLine y={durationData.stats.p95} stroke="#f59e0b" strokeDasharray="6 3" label={{ value: 'P95', position: 'right', fill: '#f59e0b', fontSize: 10 }} />
              )}
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <div className="chart-empty">No {metricTab === 'duration' ? 'duration' : 'status code'} metrics available.</div>
      )}
    </div>
  );
}
