import { memo } from 'react';

const VARIANT_MAP = {
  accent: 'var(--color-accent)',
  error: 'var(--color-error)',
  warning: 'var(--color-warning)',
  success: 'var(--color-success)',
  purple: 'var(--color-purple)',
  cyan: 'var(--color-cyan)',
  info: 'var(--color-info)',
};

function Sparkline({ data = [], variant = 'accent', height = 36, id = 'default' }) {
  if (!data || data.length < 2) return null;
  const max = data.reduce((m, v) => Math.max(m, v), 1);
  const w = 80, h = height;
  const pts = data.map((v, i) => {
    const x = (i / (data.length - 1)) * w;
    const y = h - (v / max) * h;
    return `${x},${y}`;
  }).join(' ');
  const color = VARIANT_MAP[variant] || VARIANT_MAP.accent;
  const gradId = `sg-${id}`;
  return (
    <svg width={w} height={h} style={{ overflow: 'visible', color }} role="img" aria-label="Sparkline chart">
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="currentColor" stopOpacity="0.4" />
          <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
        </linearGradient>
      </defs>
      <polygon points={`0,${h} ${pts} ${w},${h}`} fill={`url(#${gradId})`} />
      <polyline points={pts} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

export default memo(Sparkline);
