import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { BarChart3, ChevronDown, ChevronUp, Filter, ArrowUpDown, Clock, Layers, Copy, ExternalLink, Download, CheckSquare, Square, GitCompare } from 'lucide-react';
import ContextMenu from '../components/ContextMenu';
import { API_BASE } from '../config';
import { useToastCtx } from '../context/ToastContext';
import { useFileContext } from '../context/FileContext';

function escapeForRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function patternToRegex(template) {
  return escapeForRegex(template).replace(/<[^>]+>/g, '.*');
}

function highlightMatch(text, query) {
  if (!query || !text) return text;
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const parts = text.split(new RegExp(`(${escaped})`, 'gi'));
  return parts.map((part, i) =>
    part.toLowerCase() === query.toLowerCase()
      ? <mark key={i} style={{ background: 'var(--color-accent-bg)', color: 'var(--color-accent)', borderRadius: '2px', padding: '0 2px' }}>{part}</mark>
      : part
  );
}

const FREQUENCY_COLORS = {
  dominant: 'var(--color-error)',
  common: 'var(--color-warning)',
  occasional: 'var(--color-info)',
  rare: 'var(--text-muted)'
};

const SORT_OPTIONS = [
  { value: 'count', label: 'Frequency' },
  { value: 'percentage', label: 'Coverage' },
  { value: 'level', label: 'Severity' },
  { value: 'template', label: 'Template' }
];

const LEVEL_ORDER = { FATAL: 0, ERROR: 1, WARN: 2, WARNING: 2, INFO: 3, DEBUG: 4, TRACE: 5 };

export default function Patterns() {
  const navigate = useNavigate();
  const { addToast } = useToastCtx();
  const { activeFileId: fileId, selectedFile, setExplorerContext } = useFileContext();
  const onNavigate = useCallback((tab, ctx) => {
    setExplorerContext(ctx);
    navigate(`/${tab}`);
  }, [setExplorerContext, navigate]);
  const [patterns, setPatterns] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [error, setError] = useState(null);
  const [sortBy, setSortBy] = useState('count');
  const [sortDir, setSortDir] = useState('desc');
  const [levelFilter, setLevelFilter] = useState('');
  const [expandedId, setExpandedId] = useState(null);
  const [page, setPage] = useState(1);
  const [totalPatterns, setTotalPatterns] = useState(0);
  const [totalLogLines, setTotalLogLines] = useState(0);
  const [contextMenu, setContextMenu] = useState({ show: false, pos: { x: 0, y: 0 }, pattern: null });
  const [selectedPatterns, setSelectedPatterns] = useState(new Set());
  const [compareMode, setCompareMode] = useState(false);
  const exportMenuRef = useRef(null);

  // Hide export dropdown
  const hideExportMenu = useCallback(() => {
    const el = exportMenuRef.current?.querySelector('.export-dropdown');
    if (el) el.style.display = 'none';
  }, []);

  // Toggle pattern selection
  const toggleSelect = useCallback((id) => {
    setSelectedPatterns(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  // Export handlers
  const exportPatterns = useCallback((format) => {
    const data = patterns;
    let content = '';
    let mime;
    let ext;
    if (format === 'csv') {
      mime = 'text/csv'; ext = 'csv';
      content = 'ID,Level,Count,Percentage,Frequency,Trend,Template\n';
      data.forEach(p => content += `"${p.id}","${p.level}",${p.count},${p.percentage},"${p.frequencyBand}",${p.trend || 0},"${p.template}"\n`);
    } else if (format === 'json') {
      mime = 'application/json'; ext = 'json';
      content = JSON.stringify(data, null, 2);
    } else {
      mime = 'text/markdown'; ext = 'md';
      content = `# Pattern Report — ${selectedFile?.name || 'Unknown'}\n\n`;
      content += `| ID | Level | Count | % | Band | Trend | Template |\n`;
      content += `|---|---|---|---|---|---|---|\n`;
      data.forEach(p => content += `| ${p.id} | ${p.level} | ${p.count} | ${p.percentage}% | ${p.frequencyBand} | ${p.trend > 0 ? '↑' : p.trend < 0 ? '↓' : '—'} | ${p.template} |\n`);
    }
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `patterns_${fileId}.${ext}`;
    a.click(); URL.revokeObjectURL(url);
  }, [patterns, fileId, selectedFile]);

  // Debounced search
  const [debouncedSearch, setDebouncedSearch] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 200);
    return () => clearTimeout(t);
  }, [search]);

  // Reset page on filter changes
  // eslint-disable-next-line react-hooks/set-state-in-effect -- pagination must restart when filters change; resetting page here is the intended behavior
  useEffect(() => { setPage(1); }, [debouncedSearch, levelFilter, sortBy, sortDir]);

  useEffect(() => {
    const loadPatterns = async () => {
      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams({
          page: String(page),
          limit: '50',
          sortBy,
          sortDir,
          level: levelFilter,
          search: debouncedSearch
        });
        const response = await fetch(`${API_BASE}/logs/${fileId}/patterns?${params}`);
        if (!response.ok) throw new Error(`HTTP ${response.status}: Failed to load patterns`);
        const data = await response.json();
        setPatterns(Array.isArray(data.patterns) ? data.patterns : []);
        setTotalPatterns(data.total || 0);
        setTotalLogLines(selectedFile?.linesCount || 0);
      } catch (err) {
        console.error('Pattern load error:', err);
        setError(err.message);
        setPatterns([]);
      } finally {
        setLoading(false);
      }
    };
    if (fileId) loadPatterns();
  }, [fileId, page, debouncedSearch, levelFilter, sortBy, sortDir]);

  const levels = useMemo(() => {
    const s = new Set(patterns.map(p => p.level));
    return Array.from(s).sort((a, b) => (LEVEL_ORDER[a] ?? 99) - (LEVEL_ORDER[b] ?? 99));
  }, [patterns]);

  const levelCounts = useMemo(() => {
    const counts = {};
    patterns.forEach(p => {
      counts[p.level] = (counts[p.level] || 0) + p.count;
    });
    return counts;
  }, [patterns]);

  const totalPages = Math.max(1, Math.ceil(totalPatterns / 50));
  const uniqueLevels = levels.length;
  const coverageSum = patterns.reduce((s, p) => s + p.percentage, 0);

  const histogram = useMemo(() => {
    let maxCount = 1;
    for (const p of patterns) { if (p.count > maxCount) maxCount = p.count; }
    return patterns.slice(0, 20).map(p => ({
      id: p.id,
      count: p.count,
      level: p.level,
      pct: Math.round((p.count / maxCount) * 100)
    }));
  }, [patterns]);

  const handleExplore = useCallback((pattern) => {
    const regex = patternToRegex(pattern.template);
    if (onNavigate) {
      onNavigate('explorer', { searchMode: 'regex', search: regex, level: 'all' });
    }
  }, [onNavigate]);

  const toggleSort = useCallback((field) => {
    if (sortBy === field) {
      setSortDir(d => d === 'desc' ? 'asc' : 'desc');
    } else {
      setSortBy(field);
      setSortDir('desc');
    }
  }, [sortBy]);

  const toggleExpand = useCallback((id) => {
    setExpandedId(prev => prev === id ? null : id);
  }, []);

  return (
    <div className="patterns-layout">
      <div className="section-header">
        <div>
          <h1>Patterns Explorer</h1>
          <p>Browse recurring log templates and drill down from pattern insight to log exploration.</p>
        </div>
        <div className="section-header-actions" style={{ gap: '6px' }}>
          {compareMode ? (
            <>
              <span className="text-muted" style={{ fontSize: 12 }}>Select patterns to compare</span>
              <button className="btn btn-secondary" onClick={() => { setCompareMode(false); setSelectedPatterns(new Set()); }} style={{ fontSize: '12px' }}>Exit Compare</button>
              {selectedPatterns.size >= 2 && (
                <button className="btn btn-primary" onClick={() => {
                  const sel = patterns.filter(p => selectedPatterns.has(p.id));
                  const diff = sel.map(p => `${p.level}: ${p.template} (${p.count})`).join('\n');
                  navigator.clipboard.writeText(diff);
                  addToast?.('Comparison copied to clipboard', 'success');
                }} style={{ fontSize: '12px' }}><GitCompare size={14} /> Compare ({selectedPatterns.size})</button>
              )}
            </>
          ) : (
            <>
              <button className="btn btn-secondary" onClick={() => setCompareMode(true)} style={{ fontSize: '12px' }}><GitCompare size={14} /> Compare</button>
              <div style={{ position: 'relative' }} ref={exportMenuRef}>
                <button className="btn btn-secondary" onClick={() => {
                  const menu = exportMenuRef.current?.querySelector('.export-dropdown');
                  if (menu) menu.style.display = menu.style.display === 'none' ? 'flex' : 'none';
                }} style={{ fontSize: '12px' }}><Download size={14} /> Export</button>
                <div className="export-dropdown" style={{ display: 'none', position: 'absolute', top: '100%', right: 0, zIndex: 100, background: 'var(--bg-card)', border: '1px solid var(--border-default)', borderRadius: 'var(--radius-sm)', padding: '4px', flexDirection: 'column', gap: '2px', minWidth: 120, marginTop: 4 }}>
                  <button className="btn btn-ghost" onClick={() => { exportPatterns('csv'); hideExportMenu(); }} style={{ fontSize: '12px', justifyContent: 'flex-start' }}>Export CSV</button>
                  <button className="btn btn-ghost" onClick={() => { exportPatterns('json'); hideExportMenu(); }} style={{ fontSize: '12px', justifyContent: 'flex-start' }}>Export JSON</button>
                  <button className="btn btn-ghost" onClick={() => { exportPatterns('markdown'); hideExportMenu(); }} style={{ fontSize: '12px', justifyContent: 'flex-start' }}>Export Markdown</button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      <div className="card-elevated patterns-summary-card">
        <div className="patterns-summary-header">
          <div>
            <div style={{ fontSize: '13px', color: 'var(--text-muted)', marginBottom: '6px' }}>Pattern summary</div>
            <div className="patterns-summary-stats">
              <span><strong>{totalPatterns}</strong> patterns</span>
              <span><strong>{uniqueLevels}</strong> severity groups</span>
              <span><strong>{totalLogLines.toLocaleString()}</strong> log lines</span>
              <span style={{ color: 'var(--color-success)' }}><strong>{coverageSum.toFixed(1)}%</strong> coverage</span>
            </div>
          </div>
          <div className="patterns-summary-search">
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search templates, examples, levels…"
              className="input-text"
              style={{ width: '100%' }}
            />
          </div>
        </div>

        {/* Level filter bar */}
        <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', alignItems: 'center', marginTop: '12px' }}>
          <Filter size={14} style={{ color: 'var(--text-muted)' }} />
          <button
            className={`btn btn-sm ${!levelFilter ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => setLevelFilter('')}
            style={{ fontSize: '12px', padding: '3px 10px' }}
          >
            All ({totalPatterns})
          </button>
          {levels.map(level => (
            <button
              key={level}
              className={`btn btn-sm ${levelFilter === level ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => setLevelFilter(levelFilter === level ? '' : level)}
              style={{ fontSize: '12px', padding: '3px 10px' }}
            >
              {level} ({levelCounts[level] || 0})
            </button>
          ))}
        </div>

        {/* Frequency histogram */}
        {histogram.length > 0 && (
          <div style={{ marginTop: '16px' }}>
            <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '6px' }}>
              <BarChart3 size={13} /> Top 20 patterns by frequency
            </div>
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: '3px', height: '60px' }}>
              {histogram.map(bar => (
                <div
                  key={bar.id}
                  title={`${bar.count} occurrences (${bar.level})`}
                  style={{
                    flex: 1,
                    height: `${Math.max(4, bar.pct)}%`,
                    background: FREQUENCY_COLORS[bar.level] || 'var(--text-muted)',
                    borderRadius: '2px 2px 0 0',
                    opacity: 0.7,
                    transition: 'opacity 0.15s',
                    cursor: 'default',
                    minWidth: '4px'
                  }}
                  onMouseEnter={e => e.target.style.opacity = '1'}
                  onMouseLeave={e => e.target.style.opacity = '0.7'}
                />
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="card-elevated patterns-summary-card">
        {/* Sort controls */}
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginBottom: '16px', flexWrap: 'wrap' }}>
          <ArrowUpDown size={14} style={{ color: 'var(--text-muted)' }} />
          <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Sort:</span>
          {SORT_OPTIONS.map(opt => (
            <button
              key={opt.value}
              className={`btn btn-sm ${sortBy === opt.value ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => toggleSort(opt.value)}
              style={{ fontSize: '12px', padding: '3px 10px' }}
            >
              {opt.label} {sortBy === opt.value && (sortDir === 'desc' ? '↓' : '↑')}
            </button>
          ))}
          <span style={{ marginLeft: 'auto', fontSize: '12px', color: 'var(--text-muted)' }}>
            {patterns.length} of {totalPatterns} patterns (page {page}/{totalPages})
          </span>
        </div>

        {loading ? (
          <div className="patterns-grid">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="card-elevated pattern-card" style={{ opacity: 0.5 }}>
                <div style={{ display: 'flex', gap: '12px', flexDirection: 'column' }}>
                  <div className="ep-skeleton" style={{ height: 20, width: '60%' }} />
                  <div className="ep-skeleton" style={{ height: 14, width: '90%' }} />
                  <div className="ep-skeleton" style={{ height: 14, width: '40%' }} />
                </div>
              </div>
            ))}
          </div>
        ) : error ? (
          <div className="pattern-error-card">{error}</div>
        ) : patterns.length === 0 ? (
          <div style={{ padding: '40px 0', textAlign: 'center', color: 'var(--text-muted)' }}>No patterns matched your search.</div>
        ) : (
          <div className="patterns-grid">
            {patterns.map((pattern) => {
              const isExpanded = expandedId === pattern.id;
              const maxExampleLen = 120;
              return (
                <div key={pattern.id} className="card-elevated pattern-card" style={{ borderColor: selectedPatterns.has(pattern.id) ? 'var(--color-accent-border)' : isExpanded ? 'var(--color-accent-border)' : undefined }}
                onContextMenu={e => { e.preventDefault(); e.stopPropagation(); setContextMenu({ show: true, pos: { x: e.clientX, y: e.clientY }, pattern }); }}>
                  <div className="pattern-card-header">
                    {compareMode && (
                      <button onClick={() => toggleSelect(pattern.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '2px', color: 'var(--text-muted)', alignSelf: 'start' }} aria-label={selectedPatterns.has(pattern.id) ? 'Deselect' : 'Select'}>
                        {selectedPatterns.has(pattern.id) ? <CheckSquare size={16} /> : <Square size={16} />}
                      </button>
                    )}
                  <div className="pattern-card-body" style={{ flex: 1 }}>
                    <div className="pattern-card-badges">
                      <span className={`level-badge ${pattern.level.toLowerCase()}`}>{pattern.level}</span>
                      <span style={{ fontSize: '12px', color: 'var(--text-secondary)', fontWeight: 600 }}>
                        {pattern.count.toLocaleString()} ({pattern.percentage}%)
                        {pattern.trend !== undefined && pattern.trend !== 0 && (
                          <span style={{ color: pattern.trend > 0 ? 'var(--color-error)' : 'var(--color-info)', marginLeft: '4px', fontSize: '11px' }}>
                            {pattern.trend > 0 ? '↑' : '↓'}{Math.abs(pattern.trend)}%
                          </span>
                        )}
                      </span>
                      <span
                        style={{
                          fontSize: '10px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em',
                          color: FREQUENCY_COLORS[pattern.frequencyBand] || 'var(--text-muted)',
                          background: 'var(--bg-subtle)',
                          padding: '1px 6px', borderRadius: 'var(--radius-xs)'
                        }}
                      >
                        {pattern.frequencyBand}
                      </span>
                      {pattern.httpStatuses && pattern.httpStatuses.length > 0 && (
                        <span style={{ fontSize: '11px', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                          HTTP {pattern.httpStatuses.map(h => h.code).join(', ')}
                        </span>
                      )}
                    </div>
                    <div
                      className="pattern-card-template"
                      title={pattern.template}
                      style={{ cursor: 'pointer' }}
                      onClick={() => toggleExpand(pattern.id)}
                    >
                      {highlightMatch(pattern.template.length > maxExampleLen ? pattern.template.substring(0, maxExampleLen) + '…' : pattern.template, search)}
                    </div>
                    {pattern.firstSeen && pattern.lastSeen && (
                      <div style={{ fontSize: '11px', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '4px', marginTop: '4px' }}>
                        <Clock size={11} />
                        {new Date(pattern.firstSeen).toLocaleString()} → {new Date(pattern.lastSeen).toLocaleString()}
                      </div>
                    )}
                  </div>
                  <div style={{ display: 'flex', gap: '6px', alignItems: 'start' }}>
                    <button
                      className="btn btn-secondary"
                      onClick={() => handleExplore(pattern)}
                      style={{ whiteSpace: 'nowrap', fontSize: '12px' }}
                    >
                      Explore
                    </button>
                    <button
                      className="btn btn-secondary"
                      onClick={() => toggleExpand(pattern.id)}
                      style={{ padding: '6px 8px' }}
                      aria-label={isExpanded ? 'Collapse details' : 'Expand details'}
                    >
                      {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                    </button>
                  </div>
                </div>

                {/* Expanded detail view */}
                {isExpanded && (
                  <div style={{ marginTop: '12px', borderTop: '1px solid var(--border-default)', paddingTop: '12px', display: 'grid', gap: '10px' }}>
                    {/* Full template */}
                    <div>
                      <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '4px' }}>Full Template</div>
                      <pre style={{ fontSize: '12px', fontFamily: 'var(--font-mono)', color: 'var(--text-primary)', background: 'var(--bg-inset)', padding: '10px', borderRadius: 'var(--radius-sm)', whiteSpace: 'pre-wrap', wordBreak: 'break-all', margin: 0 }}>
                        {highlightMatch(pattern.template, search)}
                      </pre>
                    </div>

                    {/* Log indices preview */}
                    {pattern.logs && pattern.logs.length > 0 && (
                      <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                        <Layers size={12} style={{ verticalAlign: 'middle', marginRight: '4px' }} />
                        Matches {pattern.logs.length.toLocaleString()} log entries
                        {pattern.logs.length <= 20 && (
                          <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-muted)', marginLeft: '6px' }}>
                            (indices: {pattern.logs.join(', ')})
                          </span>
                        )}
                      </div>
                    )}

                    {/* Services/Categories breakdown */}
                    {pattern.services && Object.keys(pattern.services).length > 0 && (
                      <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
                        <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                          Services: {Object.entries(pattern.services).sort((a, b) => b[1] - a[1]).map(([svc, cnt]) => (
                            <span key={svc} style={{ background: 'var(--bg-subtle)', padding: '1px 6px', borderRadius: 'var(--radius-xs)', marginRight: '4px' }}>
                              {svc} ({cnt})
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                    {pattern.categories && Object.keys(pattern.categories).length > 0 && (
                      <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                        Categories: {Object.entries(pattern.categories).sort((a, b) => b[1] - a[1]).map(([cat, cnt]) => (
                          <span key={cat} style={{ background: 'var(--bg-subtle)', padding: '1px 6px', borderRadius: 'var(--radius-xs)', marginRight: '4px' }}>
                            {cat} ({cnt})
                          </span>
                        ))}
                      </div>
                    )}

                    {/* HTTP status distribution */}
                    {pattern.httpStatuses && pattern.httpStatuses.length > 0 && (
                      <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                        HTTP Status: {pattern.httpStatuses.map(h => (
                          <span key={h.code} style={{
                            fontFamily: 'var(--font-mono)',
                            color: h.code >= 500 ? 'var(--color-error)' : h.code >= 400 ? 'var(--color-warning)' : 'var(--color-success)',
                            marginRight: '8px'
                          }}>
                            {h.code}×{h.count}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {/* Examples (collapsible) */}
                {pattern.examples && pattern.examples.length > 0 && !isExpanded && (
                  <div className="pattern-card-examples">
                    {pattern.examples.slice(0, 2).map((example, index) => (
                      <div key={index} className="pattern-example">
                        <div className="pattern-example-label">ex {index + 1}</div>
                        <div className="pattern-example-text">{highlightMatch(example.substring(0, 120), search)}</div>
                      </div>
                    ))}
                  </div>
                )}

                {pattern.examples && pattern.examples.length > 0 && isExpanded && (
                  <div className="pattern-card-examples">
                    {pattern.examples.slice(0, 10).map((example, index) => (
                      <div key={index} className="pattern-example">
                        <div className="pattern-example-label">ex {index + 1}</div>
                        <div className="pattern-example-text" style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
                          {highlightMatch(example, search)}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
            })}
            {totalPatterns > 50 && (
              <div style={{ gridColumn: '1 / -1', display: 'flex', justifyContent: 'center', gap: '8px', padding: '16px', alignItems: 'center' }}>
                <button className="btn btn-secondary" disabled={page <= 1} onClick={() => setPage(p => p - 1)} style={{ fontSize: '12px' }}>← Prev</button>
                <span className="text-mono text-muted" style={{ fontSize: 13 }}>Page <strong>{page}</strong> / <strong>{totalPages}</strong></span>
                <button className="btn btn-secondary" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)} style={{ fontSize: '12px' }}>Next →</button>
              </div>
            )}
          </div>
        )}
      </div>

      {contextMenu.show && contextMenu.pattern && (
        <ContextMenu
          position={contextMenu.pos}
          onClose={() => setContextMenu({ show: false, pos: { x: 0, y: 0 }, pattern: null })}
          items={[
            { label: `Filter by Level: ${contextMenu.pattern.level}`, icon: <Filter size={14} />, onClick: () => setLevelFilter(contextMenu.pattern.level) },
            { divider: true },
            { label: 'Copy Pattern Template', icon: <Copy size={14} />, onClick: () => navigator.clipboard.writeText(contextMenu.pattern.template) },
            { label: 'Explore in Explorer', icon: <ExternalLink size={14} />, onClick: () => handleExplore(contextMenu.pattern) }
          ]}
        />
      )}
    </div>
  );
}
