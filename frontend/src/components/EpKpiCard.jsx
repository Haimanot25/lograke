import { memo } from 'react';
import { TrendingUp, TrendingDown } from 'lucide-react';
import { motion } from 'framer-motion';
import Sparkline from './Sparkline';

const VARIANT_MAP = {
  accent: 'var(--color-accent)',
  error: 'var(--color-error)',
  warning: 'var(--color-warning)',
  success: 'var(--color-success)',
  purple: 'var(--color-purple)',
  cyan: 'var(--color-cyan)',
  info: 'var(--color-info)',
};

function EpKpiCard({ label, value, icon, variant = 'accent', subtitle, sparkData, onClick, trend }) {
  const color = VARIANT_MAP[variant] || VARIANT_MAP.accent;
  return (
    <motion.div
      className="ep-kpi"
      onClick={onClick}
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={onClick ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); } } : undefined}
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      whileHover={onClick ? { scale: 1.015, y: -1 } : undefined}
      transition={{ type: "spring", stiffness: 300, damping: 20 }}
      style={{ '--kpi-color': color }}
    >
      <div className="ep-kpi-header">
        <span style={{ color }}>{icon}</span>
        {label}
      </div>
      <div className="ep-kpi-value" style={{ color }}>
        {typeof value === 'number' ? value.toLocaleString() : value}
      </div>
      {subtitle && <div className="ep-kpi-sub">{subtitle}</div>}
      {trend !== undefined && (
        <div className="flex-gap-2" style={{ fontSize: 11, color: trend >= 0 ? 'var(--color-info)' : 'var(--color-error)' }}>
          {trend >= 0 ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
          {Math.abs(trend)}% vs last window
        </div>
      )}
      {sparkData && (
        <div style={{ position: 'absolute', bottom: 8, right: 8, opacity: 0.5 }}>
          <Sparkline data={sparkData} variant={variant} id={label.replace(/\s+/g, '-').toLowerCase()} />
        </div>
      )}
    </motion.div>
  );
}

export default memo(EpKpiCard);
