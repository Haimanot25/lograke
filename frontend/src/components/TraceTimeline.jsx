import React, { useEffect, useState } from 'react';
import { Copy, Fingerprint } from 'lucide-react';
import { fetchJSON } from '../utils/api';
import './TraceTimeline.css';
import ContextMenu from './ContextMenu';

import { API_BASE } from '../config';

export default function TraceTimeline({ fileId, entityId, expanded = false }) {
  const [steps, setSteps] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showAll, setShowAll] = useState(expanded);
  const [contextMenu, setContextMenu] = useState({ show: false, pos: { x: 0, y: 0 }, step: null });

  useEffect(() => {
    const load = async () => {
      try {
        const data = await fetchJSON(`${API_BASE}/logs/${fileId}/trace?val=${encodeURIComponent(entityId)}`);
        setSteps((data && Array.isArray(data.timeline)) ? data.timeline : []);
      } catch (e) {
        console.error('Failed to load trace timeline', e);
        setSteps([]);
      } finally {
        setLoading(false);
      }
    };
    if (entityId) load();
  }, [fileId, entityId]);

  const traceSummary = React.useMemo(() => {
    if (!steps.length) return null;

    const first = steps[0]?.timestamp ? new Date(steps[0].timestamp) : null;
    const last = steps[steps.length - 1]?.timestamp ? new Date(steps[steps.length - 1].timestamp) : null;
    const durationMs = first && last ? last.getTime() - first.getTime() : 0;

    const eventTypeCounts = {};
    const levelCounts = {};
    let stateChangeCount = 0;

    steps.forEach(step => {
      const type = step.eventType || 'Info';
      eventTypeCounts[type] = (eventTypeCounts[type] || 0) + 1;

      const level = String(step.level || 'INFO').toUpperCase();
      levelCounts[level] = (levelCounts[level] || 0) + 1;

      if (step.stateChanges) stateChangeCount++;
    });

    return {
      totalSteps: steps.length,
      first,
      last,
      durationMs,
      eventTypeCounts,
      levelCounts,
      stateChangeCount
    };
  }, [steps]);

  if (!entityId) return null;
  if (loading) {
    return (
      <div className="card-elevated">
        <div className="skeleton-line" style={{ width: '60%', height: '12px', marginBottom: '8px' }} />
        <div className="skeleton-line" style={{ width: '80%', height: '12px', marginBottom: '8px' }} />
        <div className="skeleton-line" style={{ width: '40%', height: '12px' }} />
      </div>
    );
  }
  if (!steps.length) return <p className="text-muted">No correlation data.</p>;

  const renderSteps = () => {
    if (showAll || steps.length <= 400) return steps;
    // Windowed view: first 150 and last 150
    const head = steps.slice(0, 150);
    const tail = steps.slice(-150);
    return [...head, { omitted: true, count: steps.length - (head.length + tail.length) }, ...tail];
  };

  const renderSummaryCard = (label, value, subtitle) => (
    <div className="summary-card" key={label}>
      <div className="summary-value">{value}</div>
      <div className="summary-label">{label}</div>
      {subtitle && <div className="summary-subtitle">{subtitle}</div>}
    </div>
  );

  return (
    <div className="trace-timeline">
      {traceSummary && (
        <div className="trace-summary">
          <div className="summary-grid">
            {renderSummaryCard('Events', traceSummary.totalSteps)}
            {renderSummaryCard('Duration', `${Math.round(traceSummary.durationMs / 1000)}s`, traceSummary.first && traceSummary.last ? `${traceSummary.first.toLocaleString()} → ${traceSummary.last.toLocaleString()}` : null)}
            {renderSummaryCard('Errors', traceSummary.levelCounts.ERROR || 0)}
            {renderSummaryCard('State Changes', traceSummary.stateChangeCount || 0)}
          </div>
          <div className="summary-tags">
            {Object.entries(traceSummary.eventTypeCounts)
              .sort((a, b) => b[1] - a[1])
              .map(([type, count]) => (
                <span className="summary-tag" key={type}>{type}: {count}</span>
              ))}
          </div>
        </div>
      )}
      {renderSteps().map((step, idx) => {
        if (step.omitted) {
          return (
            <div key={`omitted-${idx}`} className="trace-node" style={{ textAlign: 'center', padding: '12px' }}>
              <div style={{ color: 'var(--text-muted)' }}>… {step.count} steps omitted …</div>
              <button className="btn btn-secondary" style={{ marginTop: '10px' }} onClick={() => setShowAll(true)}>Show full trace</button>
            </div>
          );
        }

        return (
          <div key={step.stepNumber || idx} className={`trace-node ${step.level === 'ERROR' ? 'error' : ''}`}
            onContextMenu={e => { e.preventDefault(); e.stopPropagation(); setContextMenu({ show: true, pos: { x: e.clientX, y: e.clientY }, step }); }}>
            <div className="trace-meta">
              <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'center' }}>
                <span style={{ fontWeight: 700 }}>Step #{step.stepNumber}</span>
                <span>{step.timestamp ? new Date(step.timestamp).toLocaleString() : ''}</span>
                <span style={{ color: 'var(--color-purple)' }}>+{step.delaySinceLastMs}ms</span>
              </div>
              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
                <span className={`level-badge ${step.level.toLowerCase()}`} style={{ fontSize: '9px' }}>{step.level}</span>
                <span className="event-type-chip">{step.eventType || 'Info'}</span>
                {step.stateChanges && (
                  <span className="state-change-chip">{step.stateChanges.from || 'unknown'} → {step.stateChanges.to || 'unknown'}</span>
                )}
              </div>
            </div>
            <div className="trace-msg">
              <strong style={{ display: 'block', marginBottom: '6px', color: 'var(--text-primary)' }}>{step.eventSummary || step.message}</strong>
              <div style={{ color: 'var(--text-muted)', fontSize: '13px', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{step.message}</div>
              <div style={{ marginTop: '12px', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(110px, auto))', gap: '8px', fontSize: '12px', color: 'var(--text-muted)' }}>
                {step.service && <span>Service: {step.service}</span>}
                {step.category && <span>Category: {step.category}</span>}
                {step.environment && <span>Env: {step.environment}</span>}
              </div>
            </div>
          </div>
        );
      })}
      {contextMenu.show && contextMenu.step && (
        <ContextMenu
          position={contextMenu.pos}
          onClose={() => setContextMenu({ show: false, pos: { x: 0, y: 0 }, step: null })}
          items={[
            { label: 'Copy Message', icon: <Copy size={14} />, onClick: () => navigator.clipboard.writeText(contextMenu.step.message || contextMenu.step.eventSummary || '') },
            { label: 'Copy Raw', icon: <Copy size={14} />, onClick: () => navigator.clipboard.writeText(JSON.stringify(contextMenu.step, null, 2)) },
            { divider: true },
            { label: 'Focus on Entity', icon: <Fingerprint size={14} />, onClick: () => {} }
          ]}
        />
      )}
    </div>
  );
}
