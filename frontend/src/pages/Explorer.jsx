import React, { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useSearchParams } from 'react-router-dom';
import { ExportButton, TagPanel, Timeline } from '../components/AdvancedFeatures.jsx';
import { Search, Loader2, Brain, Sparkles, Link, Filter, Copy, Fingerprint, Tag, Bot } from 'lucide-react';
import ContextMenu from '../components/ContextMenu';
import EntityTraceModal from '../components/EntityTraceModal';
import { useExplorerLogic, SEARCH_MODES } from '../hooks/useExplorerLogic';
import { useFileContext } from '../context/FileContext';
import { useUI } from '../context/UIContext';
import '../components/TraceTimeline.css';

export default function Explorer() {
  const { activeFileId: fileId, selectedFile, explorerContext: context } = useFileContext();
  const { backendStatus } = useUI();
  const aiEnabled = backendStatus.aiEnabled;
  const [searchParams, setSearchParams] = useSearchParams();
  const {
    search, setSearch, searchMode, setSearchMode,
    level, setLevel, page, setPage,
    loading, expandedIndex, setExpandedIndex,
    explain, aiPrompt, setAiPrompt,
    aiResponse, aiLoading, streamingText,
    trace, setTrace,
    savedQueries, queryName, setQueryName,
    showSaveDialog, setShowSaveDialog,
    showSavedQueries, setShowSavedQueries,
    contextMenu, setContextMenu,
    visibleTimelines, setVisibleTimelines,
    formatTimestamp,
    logs, total, totalPages,
    handleContextMenu, handleRowClick, handleExplain,
    handleAiQuery, handleTrace, handleTraceAiAnalysis,
    handleSaveQuery, applySavedQuery
  } = useExplorerLogic({ fileId, context, aiEnabled });

  // Hydrate search state from the URL once on mount. Deliberately not
  // re-run on later URL changes (that would fight the state→URL sync below).
  useEffect(() => {
    const s = searchParams.get('search');
    const m = searchParams.get('mode');
    const l = searchParams.get('level');
    const p = searchParams.get('page');
    if (s !== null) setSearch(s);
    if (m !== null && ['text', 'regex', 'advanced'].includes(m)) setSearchMode(m);
    if (l !== null) setLevel(l);
    if (p !== null) setPage(Number(p));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount-only hydration
  }, []);

  // Sync state → URL. setSearchParams is excluded on purpose: its identity
  // changes with every navigation, which would re-run this effect in a loop.
  useEffect(() => {
    setSearchParams(prev => {
      const next = new URLSearchParams(prev);
      if (search) next.set('search', search); else next.delete('search');
      if (searchMode && searchMode !== 'text') next.set('mode', searchMode); else next.delete('mode');
      if (level && level !== 'all') next.set('level', level); else next.delete('level');
      if (page > 1) next.set('page', String(page)); else next.delete('page');
      return next;
    }, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- avoid URL-sync loop
  }, [search, searchMode, level, page]);

  if (!selectedFile) {
    return (
      <div className="explorer-layout" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '60vh' }}>
        <div className="card-elevated" style={{ textAlign: 'center', padding: '48px', maxWidth: '480px' }}>
          <Search size={48} style={{ opacity: 0.3, marginBottom: '16px' }} />
          <h2 style={{ fontSize: '22px', fontWeight: 700, marginBottom: '8px' }}>No Log Source Selected</h2>
          <p style={{ color: 'var(--text-secondary)', fontSize: '14px', lineHeight: 1.6 }}>
            Select a log source from the sidebar or upload a new log file to begin exploring.
          </p>
        </div>
      </div>
    );
  }

  const levelColor = {
    INFO: 'var(--color-success)',
    WARN: 'var(--color-warning)',
    ERROR: 'var(--color-error)',
    FATAL: 'var(--color-fatal)',
    info: 'var(--color-success)',
    warn: 'var(--color-warning)',
    error: 'var(--color-error)',
    fatal: 'var(--color-fatal)'
  };

  return (
    <div className="explorer-layout">
      <div className="section-header">
        <div>
          <h1>Log Explorer</h1>
          <p>Search, filter, correlate, and analyse — <strong>{selectedFile.name}</strong></p>
        </div>
        <div className="section-header-actions">
          <ExportButton fileId={fileId} />
        </div>
      </div>

      <div className="explorer-panels">
        <div className="card-elevated card-accent">
          <h3>
            <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Brain size={16} /> AI Semantic Copilot
              <span className={`badge ${aiEnabled ? 'badge-success' : 'badge-subtle'}`} style={{ marginLeft: 'auto', fontSize: '10px' }}>
                {aiEnabled ? 'AI Active' : 'AI Offline'}
              </span>
            </span>
          </h3>
          <form onSubmit={handleAiQuery} className="panel-form">
            <input type="text" aria-label="AI semantic search query" placeholder="e.g. Which service threw the most DB timeouts?" value={aiPrompt} onChange={e => setAiPrompt(e.target.value)} className="input-text" style={{ flexGrow: 1 }} />
            <button className="btn btn-primary" type="submit" disabled={aiLoading} style={{ whiteSpace: 'nowrap' }}>
              {aiLoading ? <><Loader2 size={14} className="animate-spin" /> Thinking…</> : <><Sparkles size={14} /> Ask</>}
            </button>
          </form>
          {streamingText && (
            <div className="ai-summary-box" style={{ marginTop: '14px' }}>
              <div className="ai-summary-header">Copilot Response <span style={{ fontWeight: 400, fontSize: '11px', color: 'var(--text-muted)' }}>streaming…</span></div>
              <div className="ai-summary-content" style={{ whiteSpace: 'pre-wrap' }}>{streamingText}</div>
            </div>
          )}
          {aiResponse && !streamingText && (
            <div className="ai-summary-box" style={{ marginTop: '14px' }}>
              <div className="ai-summary-header">Copilot Response</div>
              <div className="ai-summary-content" style={{ whiteSpace: 'pre-wrap' }}>{aiResponse}</div>
            </div>
          )}
        </div>

        <div className="card-elevated">
          <h3 style={{ fontSize: '15px', fontWeight: 600, marginBottom: '14px' }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}><Link size={16} /> Entity Trace Correlation</span>
          </h3>
          <form onSubmit={handleTrace} style={{ display: 'flex', gap: '8px' }}>
            <input type="text" aria-label="Entity trace correlation ID" placeholder="Enter MSISDN, Correlation ID, IMSI, or IP…" value={trace.value} onChange={e => setTrace(prev => ({ ...prev, value: e.target.value }))} className="input-text" style={{ flexGrow: 1 }} />
            <button className="btn btn-secondary" type="submit" disabled={trace.loading} style={{ whiteSpace: 'nowrap' }}>
              {trace.loading ? <><Loader2 size={14} className="animate-spin" /> Tracing…</> : <><Search size={14} /> Trace</>}
            </button>
          </form>
        </div>
      </div>

      <div className={showSavedQueries ? 'explorer-main-with-sidebar' : 'explorer-main'}>
        <div className="card-elevated" style={{ position: 'relative' }}>
          <div className="ep-filters" style={{ marginBottom: 0, border: 'none', borderRadius: 0, padding: 0, background: 'none' }}>
            <div className="ep-tabs">
              {SEARCH_MODES.map(mode => (
                <button key={mode} role="tab" aria-selected={searchMode === mode} onClick={() => setSearchMode(mode)} className={`ep-tab ${searchMode === mode ? 'active' : ''}`}>{mode}</button>
              ))}
            </div>
            <div className="ep-search-wrap" style={{ flex: 1 }}>
              <span className="ep-search-icon"><Search size={14} /></span>
              <input type="text" aria-label="Search log entries"
                placeholder={searchMode === 'regex' ? 'Enter regex pattern…' : searchMode === 'advanced' ? 'key:value query DSL…' : 'Search message, level, metadata, IDs…'}
                value={search} onChange={e => setSearch(e.target.value)} className="input-text" style={{ width: '100%' }} />
            </div>
            <select aria-label="Filter by log level" value={level} onChange={e => { setLevel(e.target.value); setPage(1); setExpandedIndex(null); }} className="input-select">
              <option value="all">All Levels</option>
              <option value="info">INFO</option><option value="warn">WARNING</option><option value="error">ERROR</option>
            </select>
            <button className="btn btn-secondary" onClick={() => setShowSaveDialog(!showSaveDialog)} disabled={!search.trim()}>💾 Save Query</button>
            <button className={`btn ${showSavedQueries ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setShowSavedQueries(!showSavedQueries)}>📂 Saved ({savedQueries.length})</button>
            {showSaveDialog && createPortal(
              <div className="dialog-overlay" style={{ position: 'fixed', inset: 0, zIndex: 10000, background: 'rgba(0,0,0,0.3)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', paddingTop: '80px' }} onClick={() => setShowSaveDialog(false)}>
                <div className="dialog-panel" style={{ padding: 16, minWidth: 320, maxWidth: 400 }} onClick={e => e.stopPropagation()}>
                  <h4 style={{ marginBottom: 12, fontSize: '15px', fontWeight: 600 }}>Save Current Query</h4>
                  <div className="flex-gap-3">
                    <input type="text" aria-label="Query name for saving" value={queryName} onChange={e => setQueryName(e.target.value)} placeholder="Query Name..." className="input-text" style={{ flex: 1 }} />
                    <button className="btn btn-primary" onClick={handleSaveQuery}>Save Query</button>
                  </div>
                </div>
              </div>,
              document.body
            )}
            <div className="results-count"><strong>{total.toLocaleString()}</strong> results</div>
          </div>

          <div className="ep-table-wrapper" style={{ marginTop: 12 }}>
            {loading ? (
              <div style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {Array.from({ length: 5 }).map((_, i) => <div key={i} className="ep-skeleton" style={{ height: '36px', width: '100%', opacity: 1 - (i * 0.15) }} />)}
              </div>
            ) : logs.length > 0 ? (
              <table className="ep-table">
                <thead>
                  <tr><th style={{ width: 50 }}>#</th><th style={{ width: 180 }}>Timestamp</th><th style={{ width: 90 }}>Level</th><th>Message</th></tr>
                </thead>
                <tbody>
                  {logs.map(log => {
                    const isExpanded = expandedIndex === log.index;
                    return (
                      <React.Fragment key={log.index}>
                        <tr className={`log-row ${isExpanded ? 'expanded' : ''}`} role="button" tabIndex={0} onClick={() => handleRowClick(log.index)}
                          onContextMenu={e => handleContextMenu(e, log)}
                          onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleRowClick(log.index); } }}
                          style={{ borderLeft: isExpanded ? `3px solid ${levelColor[log.level] || 'var(--color-accent)'}` : '3px solid transparent' }}>
                          <td className="log-time" style={{ color: 'var(--text-muted)' }}>{log.index}</td>
                          <td className="log-time">{formatTimestamp(log.timestamp)}</td>
                          <td><span className={`level-badge ${log.level}`}>{log.level}</span></td>
                          <td className="log-msg">{log.message}</td>
                        </tr>
                        {isExpanded && (
                          <tr>
                            <td colSpan="4" style={{ padding: 0, background: 'rgba(0,0,0,0.12)' }}>
                              <div className="log-detail-panel">
                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
                                  <div>
                                    <h4 className="detail-section-title">Identifiers</h4>
                                    {Object.keys(log.ids || {}).length > 0 ? (
                                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                                        {Object.entries(log.ids).map(([key, val]) => (
                                          <div key={key} className="selection-item-tag" style={{ cursor: 'pointer', border: '1px solid var(--color-accent-border)', color: 'var(--color-accent)' }}
                                            onClick={e => { e.stopPropagation(); setTrace(prev => ({ ...prev, value: val })); handleTrace(undefined, val); }} title="Click to trace this entity">
                                            <strong>{key}:</strong> {val}
                                          </div>
                                        ))}
                                      </div>
                                    ) : <span style={{ fontSize: '13px', color: 'var(--text-muted)' }}>No IDs extracted.</span>}
                                  </div>
                                  <TagPanel fileId={fileId} logIndex={log.index} />
                                  {Object.keys(log.ids || {}).length > 0 && !visibleTimelines.has(log.index) && (
                                    <button className="btn btn-secondary" style={{ fontSize: '12px', padding: '6px 12px', justifySelf: 'start' }}
                                      onClick={() => setVisibleTimelines(prev => new Set(prev).add(log.index))}><Link size={12} /> Show Timeline</button>
                                  )}
                                  {visibleTimelines.has(log.index) && <Timeline fileId={fileId} entityId={Object.values(log.ids)[0]} />}
                                  <div>
                                    <h4 className="detail-section-title">Log Metadata</h4>
                                    {Object.keys(log.metadata || {}).length > 0 ? <pre className="json-block" style={{ margin: 0 }}>{JSON.stringify(log.metadata, null, 2)}</pre> : <span style={{ fontSize: '13px', color: 'var(--text-muted)' }}>No metadata.</span>}
                                  </div>
                                </div>
                                <div style={{ borderTop: '1px solid var(--glass-border)', paddingTop: '16px', marginTop: '4px' }}>
                                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                                    <h4 className="detail-section-title" style={{ margin: 0 }}>🤖 AI Root Cause Analysis</h4>
                                    <button className="btn btn-secondary" style={{ padding: '6px 14px', fontSize: '12px' }} onClick={e => handleExplain(e, log.index)} disabled={explain.loading}>
                                      {explain.loading && explain.targetIndex === log.index ? <><Loader2 size={12} className="animate-spin" /> Analyzing…</> : <><Sparkles size={12} /> Generate Insights</>}
                                    </button>
                                  </div>
                                  {explain.text && explain.targetIndex === log.index && (
                                    <div className="ai-summary-box" style={{ margin: 0 }}><div className="ai-summary-content" style={{ whiteSpace: 'pre-wrap' }}>{explain.text}</div></div>
                                  )}
                                </div>
                                <div style={{ borderTop: '1px solid var(--glass-border)', paddingTop: '16px' }}>
                                  <h4 className="detail-section-title">Raw Log Line</h4>
                                  <pre className="json-block" style={{ margin: 0, background: 'var(--bg-inset)', color: 'var(--text-secondary)' }}>{log.raw}</pre>
                                </div>
                              </div>
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  })}
                </tbody>
              </table>
            ) : (
              <div className="ep-empty" style={{ margin: 12 }}>
                <div className="ep-empty-icon"><Search size={24} /></div>
                <p>No log entries match your criteria.</p>
              </div>
            )}
          </div>

          <div className="ep-pagination" style={{ marginTop: 12 }}>
            <span className="ep-pagination-info">{total.toLocaleString()} results</span>
            <div className="flex-gap-3">
              <button className="btn btn-secondary" disabled={page === 1} onClick={() => setPage(p => p - 1)}>← Prev</button>
              <span className="text-mono text-muted" style={{ fontSize: 13 }}>Page <strong style={{ color: 'var(--text-primary)' }}>{page}</strong> / <strong style={{ color: 'var(--text-primary)' }}>{totalPages}</strong></span>
              <button className="btn btn-secondary" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>Next →</button>
            </div>
          </div>
        </div>

        {showSavedQueries && (
          <div className="card-elevated saved-queries-panel">
            <div className="flex-between" style={{ marginBottom: 12 }}>
              <div className="card-title">💾 Saved Queries</div>
              <button className="btn btn-ghost" onClick={() => setShowSavedQueries(false)} style={{ fontSize: 16, padding: '2px 6px' }}>✕</button>
            </div>
            <div className="saved-queries-list">
              {savedQueries.length === 0 ? <div className="text-muted" style={{ fontSize: 13 }}>No saved queries yet.</div> : savedQueries.map(q => (
                <div key={q.id} className="saved-query-item" onClick={() => applySavedQuery(q)}>
                  <div className="saved-query-name"><span>{q.name}</span><span className="saved-query-action">Apply ↗</span></div>
                  <div className="saved-query-text">{q.query}</div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {trace.showModal && (
        <EntityTraceModal trace={trace} setTrace={setTrace} onAnalyzeTrace={handleTraceAiAnalysis} formatTimestamp={formatTimestamp} />
      )}

      {contextMenu.show && contextMenu.log && (
        <ContextMenu position={contextMenu.pos} onClose={() => setContextMenu({ show: false, pos: { x: 0, y: 0 }, log: null })}
          items={[
            { label: `Filter by Level: ${contextMenu.log.level}`, icon: <Filter size={14} />, onClick: () => { setLevel(contextMenu.log.level); setSearch(''); setPage(1); } },
            ...(contextMenu.log.service ? [{ label: `Filter by Service: ${contextMenu.log.service}`, icon: <Filter size={14} />, onClick: () => { setLevel('all'); setSearch(`service:${contextMenu.log.service}`); setPage(1); } }] : []),
            ...(contextMenu.log.host ? [{ label: `Filter by Host: ${contextMenu.log.host}`, icon: <Filter size={14} />, onClick: () => { setLevel('all'); setSearch(`host:${contextMenu.log.host}`); setPage(1); } }] : []),
            { divider: true },
            { label: 'Copy Message', icon: <Copy size={14} />, onClick: () => navigator.clipboard.writeText(contextMenu.log.message) },
            { label: 'Copy Raw', icon: <Copy size={14} />, onClick: () => navigator.clipboard.writeText(contextMenu.log.raw) },
            { label: 'Copy JSON', icon: <Copy size={14} />, onClick: () => navigator.clipboard.writeText(JSON.stringify(contextMenu.log, null, 2)) },
            { divider: true },
            ...(Object.keys(contextMenu.log.ids || {}).length > 0 ? [{ label: 'Trace Entity', icon: <Fingerprint size={14} />, onClick: () => { const val = Object.values(contextMenu.log.ids)[0]; setTrace(prev => ({ ...prev, value: val })); handleTrace(undefined, val); } }] : []),
            { label: 'Add Tag', icon: <Tag size={14} />, onClick: () => { setExpandedIndex(contextMenu.log.index); setTimeout(() => { document.querySelector('.tag-panel-input')?.focus(); }, 100); } },
            { label: 'Explain with AI', icon: <Bot size={14} />, onClick: () => { handleRowClick(contextMenu.log.index); setTimeout(() => handleExplain({ stopPropagation: () => {} }, contextMenu.log.index), 100); }, disabled: !aiEnabled }
          ]}
        />
      )}
    </div>
  );
}
