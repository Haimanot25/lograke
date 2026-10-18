import { useState } from 'react';
import { Sparkles, Download } from 'lucide-react';
import { API_BASE } from '../config';

export default function ExecutiveSummary({ fileId }) {
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const fetchSummary = async () => {
    setLoading(true); setError(null);
    try {
      const res = await fetch(`${API_BASE}/logs/${fileId}/ai-summary`, { credentials: 'include' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to fetch AI summary');
      setSummary(data.summary);
    } catch (err) { setError(err.message); }
    finally { setLoading(false); }
  };
  const handleDownload = () => {
    if (!summary) return;
    const blob = new Blob([summary], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = `Lograke_Report_${fileId}.md`; a.click();
    URL.revokeObjectURL(url);
  };
  return (
    <div className="card-accent" style={{ position: 'relative', overflow: 'hidden' }}>
      <div style={{ position: 'absolute', top: '-50px', right: '-50px', width: '150px', height: '150px', background: 'radial-gradient(circle, rgba(99,102,241,0.15) 0%, transparent 70%)', pointerEvents: 'none' }} />
      <div className="card-header-slot">
        <div>
          <div className="card-title flex-gap-2"><Sparkles size={16} /> AI Executive Summary</div>
          <div className="card-subtitle">Auto-generated insights from file metrics</div>
        </div>
        <div className="flex-gap-3">
          {!summary && !loading && <button className="btn btn-secondary" onClick={fetchSummary}>Generate Summary</button>}
          {summary && <button className="btn btn-primary flex-gap-2" onClick={handleDownload}><Download size={14} /> Export Markdown</button>}
        </div>
      </div>
      {loading && <div className="text-muted" style={{ fontSize: 13 }}>Generating AI Summary...</div>}
      {error && <div style={{ color: 'var(--color-error)', fontSize: 13, background: 'rgba(239,68,68,0.1)', padding: 12, borderRadius: 8 }}>{error}</div>}
      {summary && <div className="ep-code" style={{ marginTop: 12 }}>{summary}</div>}
    </div>
  );
}
