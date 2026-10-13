import { useState, useEffect, Fragment } from 'react';
import { GitCompare, TrendingUp, TrendingDown, Minus } from 'lucide-react';
import { API_BASE } from '../config';
import { useModal } from '../context/ModalContext';

function DiffIndicator({ value, suffix = '' }) {
  if (value === 0) return <span style={{ color: 'var(--text-muted)' }}><Minus size={14} /></span>;
  const isPos = value > 0;
  return (
    <span style={{ color: isPos ? 'var(--color-success)' : 'var(--color-error)', fontWeight: 600, fontSize: '13px', display: 'flex', alignItems: 'center', gap: '2px' }}>
      {isPos ? <TrendingUp size={14} /> : <TrendingDown size={14} />}
      {isPos ? '+' : ''}{typeof value === 'number' ? value.toLocaleString() : value}{suffix}
    </span>
  );
}

export default function Comparison() {
  const { showAlert } = useModal();
  const [files, setFiles] = useState([]);
  const [file1Id, setFile1Id] = useState('');
  const [file2Id, setFile2Id] = useState('');
  const [comparison, setComparison] = useState(null);
  const [loading, setLoading] = useState(false);
  const [driftData, setDriftData] = useState(null);

  useEffect(() => {
    const loadFiles = async () => {
      try {
        const res = await fetch(`${API_BASE}/logs/metrics/files`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        setFiles(data.files || []);
        if (data.files?.length >= 2) {
          setFile1Id(data.files[0].id);
          setFile2Id(data.files[1].id);
        }
      } catch (err) {
        console.error('Failed to load files', err);
      }
    };
    loadFiles();
  }, []);

  const handleCompare = async () => {
    if (!file1Id || !file2Id) {
      showAlert('Select two files to compare.', 'Missing Selection', 'warn');
      return;
    }
    setLoading(true);
    try {
      const [res1, res2] = await Promise.all([
        fetch(`${API_BASE}/logs/${file1Id}`),
        fetch(`${API_BASE}/logs/${file2Id}`)
      ]);
      if (!res1.ok || !res2.ok) throw new Error('Failed to fetch log data');

      const data1 = await res1.json();
      const data2 = await res2.json();
      const f1 = data1.file;
      const f2 = data2.file;

      const lc1 = f1.levelCounts || {};
      const lc2 = f2.levelCounts || {};
      const total1 = Object.values(lc1).reduce((a, b) => a + b, 0) || 1;
      const total2 = Object.values(lc2).reduce((a, b) => a + b, 0) || 1;

      const comp = {
        file1: f1, file2: f2,
        lineDiff: (f2.linesCount || 0) - (f1.linesCount || 0),
        levelDiff: {
          info: (lc2.info || 0) - (lc1.info || 0),
          warn: (lc2.warn || 0) - (lc1.warn || 0),
          error: (lc2.error || 0) - (lc1.error || 0),
          debug: (lc2.debug || 0) - (lc1.debug || 0)
        },
        errorRate1: ((lc1.error || 0) / total1 * 100).toFixed(2),
        errorRate2: ((lc2.error || 0) / total2 * 100).toFixed(2),
        healthDiff: (f2.healthScore ?? 100) - (f1.healthScore ?? 100),
        patternCount1: (f1.patterns || []).length,
        patternCount2: (f2.patterns || []).length,
        entityTypes1: Object.keys(f1.entities || {}).length,
        entityTypes2: Object.keys(f2.entities || {}).length,
        services1: Object.keys(f1.facetCounts?.service || {}),
        services2: Object.keys(f2.facetCounts?.service || {})
      };
      setComparison(comp);

      // Fetch drift data
      try {
        const driftRes = await fetch(`${API_BASE}/logs/compare/${file1Id}/${file2Id}`);
        if (driftRes.ok) {
          const driftJson = await driftRes.json();
          setDriftData(driftJson.drift || null);
        }
      } catch { setDriftData(null); }
    } catch (err) {
      console.error('Comparison error:', err);
      showAlert(`Error: ${err.message}`, 'Comparison Error', 'error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="comparison-layout">
      <div className="section-header">
        <div>
          <h1>Log File Comparison</h1>
          <p>Analyze differences between two log files to understand changes and anomalies.</p>
        </div>
      </div>

      <div className="comparison-select-grid">
        <div className="card-elevated comparison-select-card">
          <h3 style={{ marginBottom: '16px' }}>Baseline File</h3>
          <select
            value={file1Id}
            onChange={e => setFile1Id(e.target.value)}
            className="input-select"
            aria-label="Select first log file"
            style={{ width: '100%', marginBottom: '12px' }}
          >
            <option value="">-- Choose file --</option>
            {files.map(f => (
              <option key={f.id} value={f.id}>{f.name} ({f.linesCount.toLocaleString()} lines)</option>
            ))}
          </select>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <GitCompare size={24} style={{ color: 'var(--text-muted)' }} />
        </div>

        <div className="card-elevated comparison-select-card">
          <h3 style={{ marginBottom: '16px' }}>Target File</h3>
          <select
            value={file2Id}
            onChange={e => setFile2Id(e.target.value)}
            className="input-select"
            aria-label="Select second log file"
            style={{ width: '100%', marginBottom: '12px' }}
          >
            <option value="">-- Choose file --</option>
            {files.map(f => (
              <option key={f.id} value={f.id}>{f.name} ({f.linesCount.toLocaleString()} lines)</option>
            ))}
          </select>
        </div>
      </div>

      <button className="btn btn-primary" onClick={handleCompare} disabled={loading || !file1Id || !file2Id}>
        {loading ? 'Comparing…' : 'Compare Files'}
      </button>

      {comparison && (
        <div className="card-elevated comparison-results">
          <h3>Comparison Results</h3>

          {/* Diff Summary Cards */}
          <div className="comparison-diff-grid">
            <div className="comparison-diff-card" style={{ borderLeft: '3px solid var(--color-info)' }}>
              <div className="comparison-diff-label">Total Lines</div>
              <DiffIndicator value={comparison.lineDiff} />
              <div className="comparison-diff-sub">
                {comparison.file1.linesCount.toLocaleString()} → {comparison.file2.linesCount.toLocaleString()}
              </div>
            </div>
            <div className="comparison-diff-card" style={{ borderLeft: '3px solid var(--color-error)' }}>
              <div className="comparison-diff-label">Errors</div>
              <DiffIndicator value={comparison.levelDiff.error} />
              <div className="comparison-diff-sub">
                {comparison.errorRate1}% → {comparison.errorRate2}% error rate
              </div>
            </div>
            <div className="comparison-diff-card" style={{ borderLeft: '3px solid var(--color-warning)' }}>
              <div className="comparison-diff-label">Warnings</div>
              <DiffIndicator value={comparison.levelDiff.warn} />
            </div>
            <div className="comparison-diff-card" style={{ borderLeft: '3px solid var(--color-success)' }}>
              <div className="comparison-diff-label">Health Score</div>
              <DiffIndicator value={comparison.healthDiff} />
              <div className="comparison-diff-sub">
                {comparison.file1.healthScore ?? 'N/A'} → {comparison.file2.healthScore ?? 'N/A'}
              </div>
            </div>
            <div className="comparison-diff-card" style={{ borderLeft: '3px solid var(--color-accent)' }}>
              <div className="comparison-diff-label">Patterns</div>
              <DiffIndicator value={comparison.patternCount2 - comparison.patternCount1} />
              <div className="comparison-diff-sub">
                {comparison.patternCount1} → {comparison.patternCount2}
              </div>
            </div>
            <div className="comparison-diff-card" style={{ borderLeft: '3px solid var(--color-purple)' }}>
              <div className="comparison-diff-label">Entity Types</div>
              <DiffIndicator value={comparison.entityTypes2 - comparison.entityTypes1} />
              <div className="comparison-diff-sub">
                {comparison.entityTypes1} → {comparison.entityTypes2}
              </div>
            </div>
          </div>

          {/* Drift Detection */}
          {driftData && driftData.driftDetected && (
            <div className="comparison-details-card" style={{ borderLeft: '3px solid var(--color-warning)' }}>
              <h4 style={{ marginBottom: '8px', color: 'var(--color-warning)' }}>Pattern Drift Detected</h4>
              <p style={{ fontSize: '13px', color: 'var(--text-secondary)', marginBottom: '12px' }}>{driftData.summary}</p>
              {driftData.details?.newPatterns?.length > 0 && (
                <div style={{ display: 'grid', gap: '6px' }}>
                  {driftData.details.newPatterns.slice(0, 10).map((p, i) => (
                    <div key={i} style={{ fontSize: '12px', fontFamily: 'var(--font-mono)', background: 'var(--bg-subtle)', padding: '6px 10px', borderRadius: 'var(--radius-sm)' }}>
                      <span className={`level-badge ${p.level}`} style={{ fontSize: '10px', marginRight: '8px' }}>{p.level}</span>
                      {p.template.substring(0, 100)}
                      <span style={{ color: 'var(--text-muted)', marginLeft: '8px' }}>({p.count}×)</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Level Distribution Side-by-Side */}
          <div className="comparison-details-card">
            <h4 style={{ marginBottom: '12px' }}>Level Distribution Comparison</h4>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr', gap: '8px', alignItems: 'center' }}>
              {['error', 'warn', 'info', 'debug'].map(level => {
                const v1 = comparison.file1.levelCounts?.[level] || 0;
                const v2 = comparison.file2.levelCounts?.[level] || 0;
                const maxV = Math.max(v1, v2, 1);
                const colors = { error: 'var(--color-error)', warn: 'var(--color-warning)', info: 'var(--color-success)', debug: 'var(--color-info)' };
                return (
                  <Fragment key={level}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <div style={{ width: '60px', fontSize: '12px', textTransform: 'capitalize' }}>{level}</div>
                      <div style={{ flex: 1, height: '8px', background: 'var(--bg-subtle)', borderRadius: '4px' }}>
                        <div style={{ height: '100%', width: `${(v1 / maxV) * 100}%`, background: colors[level], borderRadius: '4px', opacity: 0.5 }} />
                      </div>
                      <span style={{ fontSize: '12px', minWidth: '40px', textAlign: 'right' }}>{v1.toLocaleString()}</span>
                    </div>
                    <div style={{ fontSize: '11px', color: 'var(--text-muted)', textAlign: 'center' }}>→</div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <div style={{ width: '60px', fontSize: '12px' }}></div>
                      <div style={{ flex: 1, height: '8px', background: 'var(--bg-subtle)', borderRadius: '4px' }}>
                        <div style={{ height: '100%', width: `${(v2 / maxV) * 100}%`, background: colors[level], borderRadius: '4px' }} />
                      </div>
                      <span style={{ fontSize: '12px', minWidth: '40px', textAlign: 'right' }}>{v2.toLocaleString()}</span>
                    </div>
                  </Fragment>
                );
              })}
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '12px', fontSize: '12px', color: 'var(--text-muted)' }}>
              <span>{comparison.file1.name}</span>
              <span>{comparison.file2.name}</span>
            </div>
          </div>

          {/* Service comparison */}
          {(comparison.services1.length > 0 || comparison.services2.length > 0) && (
            <div className="comparison-details-card">
              <h4 style={{ marginBottom: '8px' }}>Services</h4>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                <div>
                  <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '6px' }}>{comparison.file1.name}</div>
                  {comparison.services1.map(s => (
                    <div key={s} style={{ fontSize: '12px', padding: '2px 0' }}>{s}</div>
                  ))}
                  {comparison.services1.length === 0 && <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>None detected</div>}
                </div>
                <div>
                  <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '6px' }}>{comparison.file2.name}</div>
                  {comparison.services2.map(s => (
                    <div key={s} style={{ fontSize: '12px', padding: '2px 0', color: comparison.services1.includes(s) ? 'var(--text-primary)' : 'var(--color-success)' }}>
                      {s} {!comparison.services1.includes(s) && <span style={{ fontSize: '10px' }}>NEW</span>}
                    </div>
                  ))}
                  {comparison.services2.length === 0 && <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>None detected</div>}
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
