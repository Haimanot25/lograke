import { useState, useEffect, useCallback } from 'react';
import { FileText, BarChart3 } from 'lucide-react';
import { API_BASE } from '../config';
import { useFileContext } from '../context/FileContext';
import ParserDashboard from '../components/ParserDashboard';
import ParserBuilder from '../components/ParserBuilder';
import ParserTester from '../components/ParserTester';

export default function ParserConfig() {
  const { selectedFile } = useFileContext();
  const [view, setView] = useState('dashboard');
  const [selectedParser, setSelectedParser] = useState(null);
  const [parsers, setParsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [fileSamples, setFileSamples] = useState(null);

  const fetchParsers = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/parsers`, { credentials: 'include' });
      if (res.ok) {
        const data = await res.json();
        setParsers(data.parsers || []);
      }
    } catch (err) { console.warn('[ParserConfig] fetchParsers failed:', err); } finally {
      setLoading(false);
    }
  }, []);

  // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional fetch-on-mount; loading flag mirrors request lifecycle
  useEffect(() => { fetchParsers(); }, [fetchParsers]);

  useEffect(() => {
    if (!selectedFile?.id) return;
    const controller = new AbortController();
    (async () => {
      try {
        const res = await fetch(`${API_BASE}/logs/${selectedFile.id}/query?limit=20`, {
          signal: controller.signal,
          credentials: 'include'
        });
        if (res.ok) {
          const data = await res.json();
          const samples = (data.logs || []).slice(0, 20).map(l => l.raw || l.message || l._raw || JSON.stringify(l)).join('\n');
          if (samples) setFileSamples(samples);
        }
      } catch { /* sample fetch aborted or failed */ }
    })();
    return () => controller.abort();
  }, [selectedFile?.id]);

  const handleSelect = (p) => {
    setSelectedParser(p);
    setView('builder');
  };

  return (
    <div className="parser-studio">
      <div className="section-header">
        <div>
          <h1>Enterprise Adaptive Parser Studio</h1>
          <p>Create custom parsers for any log format. Paste samples, auto-detect fields, test for accuracy.</p>
        </div>
        <div className="parser-view-tabs">
          <button className={`btn-ghost-sm ${view === 'dashboard' ? 'active' : ''}`} onClick={() => { setView('dashboard'); setSelectedParser(null); }}>
            <FileText size={14} /> Parsers
          </button>
          {selectedParser && !selectedParser._new && (
            <button className={`btn-ghost-sm ${view === 'test' ? 'active' : ''}`} onClick={() => setView('test')}>
              <BarChart3 size={14} /> Test
            </button>
          )}
        </div>
      </div>

      {view === 'dashboard' && (
        <ParserDashboard parsers={parsers} loading={loading} onSelect={handleSelect} onRefresh={fetchParsers} />
      )}
      {view === 'builder' && (
        <ParserBuilder parser={selectedParser || { _new: true }} onBack={() => { setView('dashboard'); setSelectedParser(null); }} onRefresh={fetchParsers} fileSamples={fileSamples} />
      )}
      {view === 'test' && selectedParser && !selectedParser._new && (
        <ParserTester parser={selectedParser} onBack={() => setView('dashboard')} />
      )}

      {selectedFile && (
        <div className="card-elevated" style={{ marginTop: '24px' }}>
          <h3 style={{ fontSize: '14px', fontWeight: 600, marginBottom: '12px' }}>Current Log Source</h3>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '16px', fontSize: '13px' }}>
            <div><span className="parser-info-label">Name</span><div className="parser-info-value">{selectedFile.name || 'N/A'}</div></div>
            <div><span className="parser-info-label">Inferred Type</span><div className="parser-info-value">{selectedFile.inferredType || 'auto'}</div></div>
            <div><span className="parser-info-label">Inferred Fields</span><div className="parser-info-value">{(selectedFile.inferredFields || []).join(', ') || 'N/A'}</div></div>
          </div>
        </div>
      )}
    </div>
  );
}
