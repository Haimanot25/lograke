import { useState, useEffect } from 'react';
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer, Sector } from 'recharts';
import { API_BASE } from '../../config';

const COLORS = {
  error: '#ef4444',
  warn: '#f59e0b',
  info: '#3b82f6',
  debug: '#6b7280',
  trace: '#a855f7',
  fatal: '#dc2626'
};

const renderActiveShape = (props) => {
  const { cx, cy, innerRadius, outerRadius, startAngle, endAngle, fill, payload, percent, value } = props;
  return (
    <g>
      <Sector cx={cx} cy={cy} innerRadius={innerRadius} outerRadius={outerRadius + 6} startAngle={startAngle} endAngle={endAngle} fill={fill} opacity={1} />
      <Sector cx={cx} cy={cy} innerRadius={outerRadius + 10} outerRadius={outerRadius + 14} startAngle={startAngle} endAngle={endAngle} fill={fill} opacity={0.5} />
      <text x={cx} y={cy - 8} textAnchor="middle" fill="#e5e7eb" fontSize={14} fontWeight={700}>{payload.name}</text>
      <text x={cx} y={cy + 12} textAnchor="middle" fill="#9ca3af" fontSize={12}>{value.toLocaleString()} ({(percent * 100).toFixed(1)}%)</text>
    </g>
  );
};

const CustomTooltip = ({ active, payload }) => {
  if (!active || !payload?.length) return null;
  const d = payload[0];
  return (
    <div className="chart-tooltip-custom">
      <div className="chart-tooltip-row"><span className="dot" style={{ background: d.payload.fill }} />{d.name}: <strong>{d.value.toLocaleString()}</strong></div>
    </div>
  );
};

export default function LogLevelPieChart({ fileId }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [activeIndex, setActiveIndex] = useState(0);

  useEffect(() => {
    if (!fileId) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional fetch-on-change; loading flag mirrors request lifecycle
    setLoading(true);
    fetch(`${API_BASE}/logs/${fileId}/metadata`)
      .then(r => r.json())
      .then(d => {
        const lc = d.metadata?.levelCounts || d.levelCounts || {};
        const pieData = Object.entries(lc)
          .filter(([, v]) => v > 0)
          .map(([name, value]) => ({ name: name.charAt(0).toUpperCase() + name.slice(1), value, fill: COLORS[name] || '#6b7280' }))
          .sort((a, b) => b.value - a.value);
        setData(pieData);
      })
      .catch((e) => { console.warn('LogLevelPieChart fetch failed', e); })
      .finally(() => setLoading(false));
  }, [fileId]);

  if (loading) return <div className="chart-loading">Loading distribution...</div>;
  if (!data?.length) return <div className="chart-empty">No level data.</div>;

  const total = data.reduce((s, d) => s + d.value, 0);

  return (
    <div className="log-level-pie">
      <div className="pie-chart-wrapper">
        <ResponsiveContainer width="100%" height={240}>
          <PieChart>
            <Pie
              data={data}
              cx="50%"
              cy="50%"
              innerRadius={60}
              outerRadius={90}
              paddingAngle={2}
              dataKey="value"
              activeIndex={activeIndex}
              activeShape={renderActiveShape}
              onMouseEnter={(_, index) => setActiveIndex(index)}
              animationBegin={0}
              animationDuration={800}
            >
              {data.map((entry, idx) => (
                <Cell key={idx} fill={entry.fill} stroke="transparent" />
              ))}
            </Pie>
            <Tooltip content={<CustomTooltip />} />
          </PieChart>
        </ResponsiveContainer>
      </div>
      <div className="pie-legend">
        {data.map((d, i) => (
          <div key={d.name} className={`pie-legend-item ${activeIndex === i ? 'active' : ''}`} onMouseEnter={() => setActiveIndex(i)}>
            <span className="pie-legend-dot" style={{ background: d.fill }} />
            <span className="pie-legend-name">{d.name}</span>
            <span className="pie-legend-value">{d.value.toLocaleString()}</span>
            <span className="pie-legend-pct">{((d.value / total) * 100).toFixed(1)}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}
