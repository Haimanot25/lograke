
export default function ActivityHeatmap({ data = [] }) {
  const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const hours = Array.from({ length: 24 }, (_, i) => i);
  const matrix = Array.from({ length: 7 }, () => Array.from({ length: 24 }, () => 0));
  if (Array.isArray(data)) {
    data.forEach(({ day, hour, count }) => {
      if (day >= 0 && day < 7 && hour >= 0 && hour < 24) matrix[day][hour] = count;
    });
  }
  const maxVal = Math.max(...matrix.flat(), 1);
  const getColor = (val) => {
    if (val === 0) return 'rgba(255,255,255,0.02)';
    const intensity = Math.min(1, val / maxVal);
    return `rgba(99,102,241,${0.15 + intensity * 0.7})`;
  };
  return (
    <div className="card-elevated">
      <div className="card-header-slot">
        <div>
          <div className="card-title">Activity Heatmap</div>
          <div className="card-subtitle">Log volume density over time</div>
        </div>
      </div>
      <div style={{ display: 'flex' }}>
        <div className="heatmap-labels">
          {days.map(d => <div key={d} className="heatmap-label">{d}</div>)}
        </div>
        <div style={{ flexGrow: 1, overflowX: 'auto' }}>
          <div className="heatmap-hours">
            {hours.map(h => <div key={h} className="heatmap-hour">{h}</div>)}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            {matrix.map((row, r) => (
              <div key={r} className="heatmap-row">
                {row.map((val, c) => (
                  <div key={c} title={`${val} logs`} role="img" aria-label={`${val} logs at ${days[r]} ${c}:00`} className="heatmap-cell" style={{ background: getColor(val) }} />
                ))}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
