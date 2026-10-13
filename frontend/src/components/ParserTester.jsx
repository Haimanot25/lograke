import { useState, useRef } from 'react';
import { Upload, RefreshCw, BarChart3, CheckCircle, XCircle, ChevronRight } from 'lucide-react';
import { API_BASE } from '../config';

export default function ParserTester({ parser, onBack }) {
  const [testInput, setTestInput] = useState(parser?.sampleLines || '');
  const [testing, setTesting] = useState(false);
  const [results, setResults] = useState(null);
  const [message, setMessage] = useState('');
  const testFileRef = useRef(null);

  const handleFileUpload = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      setTestInput(ev.target?.result || '');
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const handleTest = async () => {
    if (!testInput.trim()) { setMessage('Paste or upload log lines to test'); return; }
    if (!parser?.id) { setMessage('Save the parser first before testing'); return; }
    setTesting(true);
    setMessage('');
    try {
      const res = await fetch(`${API_BASE}/parsers/${parser.id}/test`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
        body: JSON.stringify({ testLogLines: testInput })
      });
      if (!res.ok) { const err = await res.json(); throw new Error(err.error || 'Request failed'); }
      const data = await res.json();
      setResults(data);
      setMessage(`Test complete: ${data.parsedLines}/${data.totalLines} lines matched (${data.matchRate}%)`);
    } catch (err) {
      setMessage('Test error: ' + err.message);
    } finally {
      setTesting(false);
    }
  };

  const fieldStats = results?.fieldStats || {};
  const fieldEntries = Object.entries(fieldStats);

  return (
    <div className="parser-tester">
      <div className="parser-builder-header">
        <button className="btn btn-ghost" onClick={onBack}><ChevronRight size={16} style={{ transform: 'rotate(180deg)' }} /> Back</button>
        <h2>Test: {parser.name}</h2>
      </div>

      {message && (
        <div className={`parser-message ${message.includes('Error') || message.includes('error') ? 'error' : message.includes('Test complete') ? 'success' : ''}`}>
          {message}
        </div>
      )}

      <div className="parser-test-input">
        <label className="parser-label">Paste log lines to test (or use the sample lines from the parser):</label>
        <textarea className="parser-sample-input" value={testInput} onChange={e => setTestInput(e.target.value)} rows={10} placeholder="Paste log lines here to test the parser accuracy..." />
        <div className="parser-sample-actions">
          <span className="parser-line-count">{testInput.split('\n').filter(l => l.trim()).length} lines</span>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button className="btn btn-secondary" onClick={() => testFileRef.current?.click()}>
              <Upload size={14} /> Upload File
            </button>
            <input ref={testFileRef} type="file" accept=".log,.txt,.json" style={{ display: 'none' }} onChange={handleFileUpload} />
            <button className="btn btn-primary" onClick={handleTest} disabled={testing}>
              {testing ? <><RefreshCw size={14} className="spin" /> Testing...</> : <><BarChart3 size={14} /> Run Test</>}
            </button>
          </div>
        </div>
      </div>

      {results && (
        <div className="parser-test-results">
          <div className="parser-test-summary">
            <div className={`parser-test-gauge ${results.matchRate >= 90 ? 'high' : results.matchRate >= 60 ? 'mid' : 'low'}`}>
              <div className="parser-gauge-value">{results.matchRate}%</div>
              <div className="parser-gauge-label">Match Rate</div>
            </div>
            <div className="parser-test-stats">
              <div className="parser-test-stat"><span className="parser-test-stat-val">{results.parsedLines}</span><span className="parser-test-stat-lbl">Parsed</span></div>
              <div className="parser-test-stat"><span className="parser-test-stat-val">{results.totalLines - results.parsedLines}</span><span className="parser-test-stat-lbl">Missed</span></div>
              <div className="parser-test-stat"><span className="parser-test-stat-val">{results.totalLines}</span><span className="parser-test-stat-lbl">Total</span></div>
            </div>
          </div>

          {fieldEntries.length > 0 && (
            <div className="parser-field-stats">
              <h4>Per-Field Accuracy</h4>
              <div className="parser-field-stats-grid">
                {fieldEntries.map(([groupName, stat]) => (
                  <div key={groupName} className="parser-field-stat-card">
                    <div className="parser-field-stat-name">{stat.name}</div>
                    <div className="parser-field-stat-bar">
                      <div className="parser-field-stat-fill" style={{ width: stat.successRate + '%', background: stat.successRate >= 90 ? '#22c55e' : stat.successRate >= 60 ? '#f59e0b' : '#ef4444' }} />
                    </div>
                    <div className="parser-field-stat-pct">{stat.successRate}%</div>
                    <div className="parser-field-stat-detail">{stat.extractedCount}/{stat.extractedCount + stat.emptyCount} rows</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="parser-test-lines">
            <div className="parser-test-lines-header">
              <h4>Line Results</h4>
              <span className="parser-line-count">{results.lineResults?.length || 0} lines</span>
            </div>
            <div className="parser-test-lines-table">
              <div className="parser-test-table-header">
                <span className="pl-line-num">#</span>
                <span className="parser-test-col-line">Raw Line</span>
                {fieldEntries.map(([k, s]) => <span key={k} className="parser-test-col-field">{s.name}</span>)}
                <span className="parser-test-col-status">Status</span>
              </div>
              {(results.lineResults || []).slice(0, 50).map((r, i) => (
                <div key={i} className={`parser-test-table-row ${r.matched ? '' : 'missed'}`}>
                  <span className="pl-line-num">{r.index + 1}</span>
                  <span className="parser-test-col-line" title={r.raw}>{r.raw.length > 60 ? r.raw.slice(0, 60) + '...' : r.raw}</span>
                  {fieldEntries.map(([k]) => <span key={k} className="parser-test-col-field">{r.fields?.[k] || '-'}</span>)}
                  <span className="parser-test-col-status">{r.matched ? <CheckCircle size={14} color="#22c55e" /> : <XCircle size={14} color="#ef4444" />}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
