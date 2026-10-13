
export default function DonutChart({ slices, total, label }) {
  const size = 80, cx = 40, cy = 40, r = 30, stroke = 12;
  const circumference = 2 * Math.PI * r;
  const segments = slices.map((s, i) => {
    const portion = total > 0 ? s.value / total : 0;
    const dash = portion * circumference;
    const gap = circumference - dash;
    const offset = slices.slice(0, i).reduce((sum, prev) => sum + (total > 0 ? prev.value / total : 0) * circumference, 0);
    return { ...s, dash, gap, offset };
  });
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label="Donut chart">
      <circle cx={cx} cy={cy} r={r} fill="none" stroke="var(--bg-tertiary)" strokeWidth={stroke} />
      {segments.map((seg, i) => (
        <circle key={i} cx={cx} cy={cy} r={r} fill="none" stroke={seg.color} strokeWidth={stroke} strokeDasharray={`${seg.dash} ${seg.gap}`} strokeDashoffset={-seg.offset} transform={`rotate(-90 ${cx} ${cy})`} style={{ transition: 'stroke-dasharray 0.8s ease' }} />
      ))}
      <text x={cx} y={cy} textAnchor="middle" dominantBaseline="central" style={{ fontSize: '9px', fill: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>{label}</text>
    </svg>
  );
}
