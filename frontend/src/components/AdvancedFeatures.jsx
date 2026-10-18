import { useState, useEffect, useRef, useCallback } from 'react';
import { fetchJSON } from '../utils/api';
import { FileJson, FileSpreadsheet, FileDown } from 'lucide-react';

import { API_BASE } from '../config';

/* ─── Tag Panel ───────────────────────────────────────────────── */
export function TagPanel({ fileId, logIndex }) {
  const [tags, setTags] = useState([]);
  const [newTag, setNewTag] = useState('');
  const [saving, setSaving] = useState(false);

  const loadTags = useCallback(async () => {
    try {
      const data = await fetchJSON(`${API_BASE}/logs/${fileId}/tags`);
      if (data && data.success) setTags(data.tags[logIndex] || []);
    } catch (err) {
      console.error('Failed to load tags', err);
    }
  }, [fileId, logIndex]);

  // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional fetch-on-change; tag list mirrors server state
  useEffect(() => { loadTags(); }, [fileId, logIndex, loadTags]);

  const addTag = async () => {
    if (!newTag.trim()) return;
    setSaving(true);
    try {
      await fetchJSON(`${API_BASE}/logs/${fileId}/tags`, {
        method: 'POST',
        body: JSON.stringify({ logIndex, tags: [newTag.trim()] })
      });
      setNewTag('');
      loadTags();
    } catch (err) {
      console.error('Failed to add tag', err);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <h4 className="detail-section-title">Labels & Tags</h4>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '10px' }}>
        {tags.length === 0 && (
          <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>No tags yet.</span>
        )}
        {tags.map((t, i) => (
          <span key={i} style={{
            background: 'rgba(99,102,241,0.15)', border: '1px solid rgba(99,102,241,0.3)',
            color: 'var(--color-accent)', borderRadius: '4px', padding: '2px 8px', fontSize: '12px',
            fontFamily: 'var(--font-mono)'
          }}>{t}</span>
        ))}
      </div>
      <div style={{ display: 'flex', gap: '6px' }}>
        <input
          type="text"
          placeholder="Add label…"
          value={newTag}
          className="input-text"
          style={{ flex: 1, fontSize: '12px', padding: '6px 10px' }}
          onChange={e => setNewTag(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && addTag()}
        />
        <button className="btn btn-primary" style={{ padding: '6px 12px', fontSize: '12px' }}
          onClick={addTag} disabled={saving}>
          {saving ? '…' : '+ Tag'}
        </button>
      </div>
    </div>
  );
}

/* ─── Timeline ────────────────────────────────────────────────── */
export function Timeline({ fileId, entityId }) {
  const [timeline, setTimeline] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadTimeline = async () => {
      setLoading(true);
      const data = await fetchJSON(`${API_BASE}/logs/${fileId}/trace?val=${encodeURIComponent(entityId)}`);
      if (data && data.timeline) setTimeline(data.timeline);
      setLoading(false);
    };
    if (entityId) loadTimeline();
  }, [fileId, entityId]);

  if (loading) return <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Loading trace…</div>;

  return (
    <div>
      <h4 className="detail-section-title">Trace Timeline — {entityId}</h4>
      {timeline.length === 0 ? (
        <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>No correlated events found.</span>
      ) : (
        <div className="trace-timeline" style={{ maxHeight: '160px', overflowY: 'auto' }}>
          {timeline.slice(0, 20).map((t, i) => (
            <div key={i} className={`trace-node ${t.level === 'error' ? 'error' : ''}`}>
              <div className="trace-meta">
                <span>#{t.stepNumber}</span>
                <span>{new Date(t.timestamp).toLocaleTimeString()}</span>
                <span style={{ color: 'var(--color-purple)' }}>+{t.delaySinceLastMs}ms</span>
              </div>
              <div className="trace-msg">
                <span className={`level-badge ${t.level}`} style={{ marginRight: '6px', fontSize: '9px' }}>{t.level}</span>
                {t.message}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ─── Export Button ───────────────────────────────────────────── */
export function ExportButton({ fileId }) {
  const [open, setOpen] = useState(false);
  const ref = useRef();

  useEffect(() => {
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const exportLog = (format) => {
    window.open(`${API_BASE}/logs/${fileId}/export?format=${format}`, '_blank', 'noopener');
    setOpen(false);
  };

  return (
    <div ref={ref} style={{ position: 'relative', display: 'inline-block' }}>
      <button className="btn btn-secondary" onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        aria-haspopup="menu"
        style={{ gap: '6px', fontSize: '13px' }}>
        ⬇ Export ▾
      </button>
      {open && (
        <div role="menu" style={{
          position: 'absolute', right: 0, top: 'calc(100% + 6px)', background: 'var(--bg-tertiary)',
          border: '1px solid var(--glass-border)', borderRadius: '8px', overflow: 'hidden',
          boxShadow: '0 8px 32px rgba(0,0,0,0.5)', zIndex: 100, minWidth: '140px'
        }}>
          {[
            ['json', <><FileJson size={14} /> JSON</>],
            ['csv', <><FileSpreadsheet size={14} /> CSV</>],
            ['markdown', <><FileDown size={14} /> Markdown</>]
          ].map(([fmt, label]) => (
            <button key={fmt} onClick={() => exportLog(fmt)} role="menuitem" style={{
              display: 'block', width: '100%', padding: '10px 16px', textAlign: 'left',
              background: 'none', border: 'none', color: 'var(--text-primary)', cursor: 'pointer',
              fontSize: '13px', fontFamily: 'var(--font-main)', transition: 'background 0.15s'
            }}
              onMouseEnter={e => e.target.style.background = 'rgba(255,255,255,0.05)'}
              onMouseLeave={e => e.target.style.background = 'none'}>
              {label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// AlertToast removed — use useModal().showAlert() from context/ModalContext instead.
