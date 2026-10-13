import { memo } from 'react';
import { Search, Link, X, BarChart3, AlertCircle, Clock, Filter, Loader2, Sparkles, Activity } from 'lucide-react';
import { useFocusTrap } from '../hooks/useAccessibility';

const SummaryCard = memo(function SummaryCard({ value, label, icon, color, trend }) {
  return (
    <div className="summary-card" style={{
      padding: '14px 16px', borderRadius: '12px',
      background: 'var(--bg-subtle)',
      border: '1px solid var(--border-default)'
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '6px' }}>
        <span style={{ color, opacity: 0.7 }}>{icon}</span>
        <span style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: 500 }}>{label}</span>
        {trend === 'up' && <span style={{ marginLeft: 'auto', fontSize: '10px', color: 'var(--color-error)', fontWeight: 700 }}>▲</span>}
      </div>
      <div className="summary-value" style={{ fontSize: '24px', fontWeight: 800, color: 'var(--text-primary)', fontFamily: 'var(--font-mono)', lineHeight: 1.1 }}>
        {value}
      </div>
    </div>
  );
});

function EntityTraceModal({ trace, setTrace, onAnalyzeTrace, formatTimestamp }) {
  const fmt = formatTimestamp || ((ts) => ts);
  const focusTrapRef = useFocusTrap(trace.showModal);

  return (
    <div className="trace-overlay" onClick={() => setTrace(prev => ({ ...prev, showModal: false }))}>
      <div ref={focusTrapRef} role="dialog" aria-modal="true" aria-label="Entity correlation trace"
        className="trace-container" onClick={e => e.stopPropagation()}
        style={{ position: 'relative', padding: '28px 32px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '24px', paddingBottom: '20px', borderBottom: '1px solid var(--border-default)' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '6px' }}>
              <div style={{ width: 36, height: 36, borderRadius: 10, background: 'linear-gradient(135deg, var(--color-accent), #8b5cf6)', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 4px 12px rgba(99,102,241,0.25)' }}>
                <Link size={18} color="white" />
              </div>
              <h2 style={{ fontSize: '22px', fontWeight: 800, color: 'var(--text-primary)', letterSpacing: '-0.02em' }}>Entity Correlation Trace</h2>
              <span className="event-type-chip" style={{ fontSize: '10px' }}>{trace.timeline.length} events</span>
            </div>
            <p style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>
              Correlated sequence of events for:{' '}
              <strong style={{ color: 'var(--color-cyan)', fontFamily: 'var(--font-mono)', background: 'rgba(6,182,212,0.08)', padding: '2px 10px', borderRadius: '6px', fontSize: '14px', fontWeight: 700 }}>
                {trace.value}
              </strong>
            </p>
          </div>
          <button className="close-btn" onClick={() => setTrace(prev => ({ ...prev, showModal: false }))} aria-label="Close trace modal"
            style={{ position: 'absolute', top: 20, right: 24, width: 32, height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg-subtle)', border: '1px solid var(--border-default)', borderRadius: 8, color: 'var(--text-secondary)', cursor: 'pointer', transition: 'all 0.15s ease', fontSize: 16 }}>
            <X size={16} />
          </button>
        </div>

        {trace.timeline.length > 0 && (
          <div className="trace-summary" style={{ marginBottom: '24px', padding: '18px 20px' }}>
            <div style={{ fontSize: '11px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-muted)', marginBottom: '12px' }}>
              <Activity size={12} style={{ marginRight: 6 }} /> Overview
            </div>
            <div className="summary-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '12px' }}>
              <SummaryCard value={trace.timeline.length} label="Total Events" icon={<BarChart3 size={14} />} color="var(--color-accent)" />
              <SummaryCard value={trace.timeline.filter(s => s.level === 'error' || s.level === 'fatal').length} label="Errors" icon={<AlertCircle size={14} />} color="var(--color-error)" trend={trace.timeline.filter(s => s.level === 'error' || s.level === 'fatal').length > 0 ? 'up' : 'none'} />
              <SummaryCard value={(() => { const ts = trace.timeline.map(s => new Date(s.timestamp).getTime()).filter(t => !isNaN(t)); if (ts.length < 2) return '—'; const span = Math.max(...ts) - Math.min(...ts); return span < 1000 ? `${span}ms` : span < 60000 ? `${(span / 1000).toFixed(1)}s` : `${(span / 60000).toFixed(1)}m`; })()} label="Time Span" icon={<Clock size={14} />} color="var(--color-purple)" />
              <SummaryCard value={new Set(trace.timeline.map(s => s.level)).size} label="Severity Levels" icon={<Filter size={14} />} color="var(--color-cyan)" />
            </div>
          </div>
        )}

        <div className="trace-timeline" style={{ borderLeftColor: trace.timeline.some(s => s.level === 'error' || s.level === 'fatal') ? 'var(--color-error)' : 'var(--color-accent)', marginLeft: '8px', padding: '8px 0 8px 24px', gap: '20px' }}>
          {trace.timeline.length > 0 ? trace.timeline.map((step, idx) => {
            const isError = step.level === 'error' || step.level === 'fatal';
            const isWarn = step.level === 'warn' || step.level === 'warning';
            return (
              <div key={step.stepNumber || idx} className={`trace-node ${isError ? 'error' : ''}`} style={{ padding: '16px 20px', borderRadius: '12px', background: isError ? 'var(--color-error-bg)' : isWarn ? 'rgba(245,158,11,0.06)' : 'var(--bg-subtle)', border: `1px solid ${isError ? 'var(--color-error-border)' : isWarn ? 'rgba(245,158,11,0.15)' : 'var(--border-default)'}` }}>
                <div className="trace-meta" style={{ display: 'flex', flexWrap: 'wrap', gap: '12px', alignItems: 'center', marginBottom: '10px' }}>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', fontWeight: 700, fontSize: '11px', color: isError ? 'var(--color-error)' : 'var(--color-accent)', background: isError ? 'rgba(239,68,68,0.1)' : 'rgba(99,102,241,0.08)', padding: '3px 10px', borderRadius: '6px' }}>
                    <span style={{ width: 6, height: 6, borderRadius: '50%', background: isError ? 'var(--color-error)' : 'var(--color-accent)', display: 'inline-block' }} />
                    Step #{step.stepNumber}
                  </span>
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: '12px', color: 'var(--text-secondary)' }}>{fmt(step.timestamp)}</span>
                  {step.service && <span style={{ fontSize: '11px', color: 'var(--text-muted)', background: 'var(--bg-inset)', padding: '2px 8px', borderRadius: '4px', fontFamily: 'var(--font-mono)' }}>{step.service}</span>}
                  {step.delaySinceLastMs > 0 && <span style={{ color: isError ? 'var(--color-error)' : 'var(--color-purple)', fontWeight: 700, fontSize: '11px', fontFamily: 'var(--font-mono)', marginLeft: 'auto' }}>+{step.delaySinceLastMs}ms</span>}
                </div>
                <div className="trace-msg" style={{ display: 'flex', alignItems: 'flex-start', gap: '10px', fontSize: '13px', fontFamily: 'var(--font-mono)', color: isError ? 'var(--color-error)' : 'var(--text-primary)', wordBreak: 'break-all', lineHeight: 1.6 }}>
                  <span className={`level-badge ${step.level}`} style={{ flexShrink: 0, marginTop: '1px', fontSize: '10px', padding: '2px 8px' }}>{step.level}</span>
                  <span>{step.message}</span>
                </div>
                {step.metadata && Object.keys(step.metadata).length > 0 && (
                  <div style={{ marginTop: '10px', padding: '8px 10px', background: 'rgba(0,0,0,0.12)', borderRadius: '8px', border: '1px solid var(--border-default)', fontSize: '11px', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                    {Object.entries(step.metadata).map(([k, v]) => <span key={k} style={{ marginRight: '16px' }}><span style={{ color: 'var(--text-secondary)' }}>{k}:</span> {String(v)}</span>)}
                  </div>
                )}
              </div>
            );
          }) : (
            <div style={{ padding: '48px', textAlign: 'center', color: 'var(--text-muted)' }}>
              <div style={{ fontSize: '32px', marginBottom: '12px', opacity: 0.3 }}><Search size={32} /></div>
              <p style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-secondary)' }}>No trace timeline data available.</p>
              <p style={{ fontSize: '12px', marginTop: '4px' }}>Try a different entity ID or correlation value.</p>
            </div>
          )}
        </div>

        <div style={{ marginTop: '28px', paddingTop: '20px', borderTop: '1px solid var(--border-default)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <div style={{ width: 28, height: 28, borderRadius: 8, background: 'linear-gradient(135deg, rgba(99,102,241,0.15), rgba(139,92,246,0.15))', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Sparkles size={14} style={{ color: 'var(--color-accent)' }} />
              </div>
              <h3 style={{ fontSize: '15px', fontWeight: 700, color: 'var(--text-primary)' }}>AI Trace Analysis</h3>
            </div>
            <button className="btn btn-primary" onClick={() => { if (onAnalyzeTrace) onAnalyzeTrace(); }} disabled={trace.aiLoading || trace.timeline.length === 0} style={{ padding: '8px 18px', fontSize: '12px', fontWeight: 600, gap: '6px' }}>
              {trace.aiLoading ? <><Loader2 size={14} className="animate-spin" /> Analyzing Trace...</> : <><Sparkles size={14} /> Analyze Trace</>}
            </button>
          </div>
          {trace.aiResponse && (
            <div className="ai-summary-box" style={{ marginTop: 0, background: 'var(--bg-inset)', border: '1px solid var(--border-default)', borderRadius: '12px' }}>
              <div className="ai-summary-content" style={{ whiteSpace: 'pre-wrap', fontSize: '13px', color: 'var(--text-primary)', lineHeight: 1.7 }}>{trace.aiResponse}</div>
            </div>
          )}
          {trace.aiLoading && !trace.aiResponse && (
            <div style={{ padding: '24px', textAlign: 'center', color: 'var(--text-muted)', background: 'var(--bg-inset)', borderRadius: '12px', border: '1px solid var(--border-default)' }}>
              <Loader2 size={20} className="animate-spin" style={{ marginBottom: '8px' }} />
              <p style={{ fontSize: '13px' }}>Analyzing trace events…</p>
            </div>
          )}
        </div>

        <div style={{ marginTop: '24px', paddingTop: '16px', borderTop: '1px solid var(--border-default)', display: 'flex', justifyContent: 'flex-end' }}>
          <button className="btn btn-secondary" onClick={() => setTrace(prev => ({ ...prev, showModal: false }))} style={{ padding: '8px 20px', fontSize: '13px', fontWeight: 600 }}>Close Trace</button>
        </div>
      </div>
    </div>
  );
}

export default memo(EntityTraceModal);
