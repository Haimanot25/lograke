import { useState, useEffect } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { API_BASE } from '../../config';

const HOURS = Array.from({ length: 24 }, (_, i) => i);
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const CustomTooltip = ({ active, payload }) => {
  if (!active || !payload?.length) return null;
  const d = payload[0]?.payload;
  return (
    <div className="chart-tooltip-custom">
      <div className="chart-tooltip-row"><strong>{d?.label || d?.name}</strong></div>
      <div className="chart-tooltip-row">Logs: <strong>{d?.count?.toLocaleString() || 0}</strong></div>
    </div>
  );
};

export default function TemporalHeatmap({ fileId }) {
  const [hourlyData, setHourlyData] = useState(null);
  const [dailyData, setDailyData] = useState(null);
  const [heatmapData, setHeatmapData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [viewTab, setViewTab] = useState('hourly');

  useEffect(() => {
    if (!fileId) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional fetch-on-change; loading flag mirrors request lifecycle
    setLoading(true);
    fetch(`${API_BASE}/logs/${fileId}/temporal-patterns`)
      .then(r => r.json())
      .then(d => {
        const hourly = HOURS.map(h => ({
          hour: h,
          label: `${h}:00`,
          name: `${h}:00`,
          count: d.byHour?.[h] || 0
        }));
        setHourlyData(hourly);

        const daily = DAYS.map((day) => ({
          day,
          label: day,
          name: day,
          count: d.byDayOfWeek?.[day] || 0
        }));
        setDailyData(daily);

        const maxCount = Math.max(1, ...hourly.map(h => h.count));
        setHeatmapData({ hourly, daily, maxCount, peakHour: d.peakHour, peakDay: d.peakDayOfWeek });
      })
      .catch((e) => { console.warn('TemporalHeatmap fetch failed', e); })
      .finally(() => setLoading(false));
  }, [fileId]);

  if (loading) return <div className="chart-loading">Loading temporal patterns...</div>;
  if (!heatmapData) return <div className="chart-empty">No temporal data available.</div>;

  const activeData = viewTab === 'hourly' ? hourlyData : dailyData;
  const maxVal = Math.max(1, ...activeData.map(d => d.count));
  const peakVal = Math.max(...activeData.map(d => d.count));

  return (
    <div className="temporal-heatmap">
      <div className="temporal-controls">
        <button className={`btn-ghost-sm ${viewTab === 'hourly' ? 'active' : ''}`} onClick={() => setViewTab('hourly')}>By Hour</button>
        <button className={`btn-ghost-sm ${viewTab === 'daily' ? 'active' : ''}`} onClick={() => setViewTab('daily')}>By Day of Week</button>
      </div>

      {viewTab === 'hourly' && heatmapData.peakHour && (
        <div className="temporal-peak-badge">
          Peak hour: <strong>{heatmapData.peakHour.hour}:00</strong> ({heatmapData.peakHour.count.toLocaleString()} logs)
        </div>
      )}
      {viewTab === 'daily' && heatmapData.peakDay && (
        <div className="temporal-peak-badge">
          Peak day: <strong>{heatmapData.peakDay.day}</strong> ({heatmapData.peakDay.count.toLocaleString()} logs)
        </div>
      )}

      <div className="temporal-chart-wrapper">
        <ResponsiveContainer width="100%" height={260}>
          <BarChart data={activeData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" vertical={false} />
            <XAxis dataKey={viewTab === 'hourly' ? 'label' : 'day'} tick={{ fontSize: 10, fill: '#6b7280' }} />
            <YAxis tick={{ fontSize: 10, fill: '#6b7280' }} />
            <Tooltip content={<CustomTooltip />} cursor={{ fill: 'rgba(99,102,241,0.08)' }} />
            <Bar dataKey="count" radius={[4, 4, 0, 0]} maxBarSize={32}>
              {activeData.map((entry, idx) => {
                const intensity = entry.count / maxVal;
                const isPeak = entry.count === peakVal;
                let fill;
                if (isPeak) fill = '#6366f1';
                else if (intensity > 0.7) fill = '#818cf8';
                else if (intensity > 0.4) fill = '#6366f1aa';
                else if (intensity > 0.15) fill = '#6366f166';
                else fill = '#6366f133';
                return <Cell key={idx} fill={fill} />;
              })}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div className="temporal-heatmap-grid">
        <div className="heatmap-legend">
          <span className="heatmap-legend-label">Low</span>
          <div className="heatmap-legend-cells">
            {[0.05, 0.15, 0.3, 0.5, 0.7, 1.0].map((pct, i) => (
              <div key={i} className="heatmap-cell" style={{ background: `rgba(99,102,241,${pct})` }} />
            ))}
          </div>
          <span className="heatmap-legend-label">High</span>
        </div>
      </div>
    </div>
  );
}
