import { useState, useEffect, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Activity, GitBranch, Search, MousePointerClick, BarChart3, Zap } from 'lucide-react';
import { fetchJSON } from '../utils/api';
import TraceTimeline from '../components/TraceTimeline';
import { API_BASE } from '../config';
import { useFileContext } from '../context/FileContext';

const BUCKET_ICONS = {
  transactionId: '🔄',
  userId: '👤',
  uuid: '🆔',
  ip: '🌐',
  email: '📧',
  host: '🖥️',
  service: '⚙️',
  thread: '🧵',
  process: '📦',
  statusCode: '📊'
};

const BUCKET_COLORS = {
  transactionId: 'var(--color-accent)',
  userId: 'var(--color-success)',
  uuid: 'var(--color-purple)',
  ip: 'var(--color-info)',
  email: 'var(--color-warning)',
  host: 'var(--color-fatal)',
  service: 'var(--color-cyan)',
  thread: 'var(--color-accent)',
  process: 'var(--color-info)',
  statusCode: 'var(--color-success)'
};

export default function Observability() {
  const navigate = useNavigate();
  const { activeFileId: fileId } = useFileContext();
  const onNavigate = useCallback((tab) => { navigate(`/${tab}`); }, [navigate]);
  const [entities, setEntities] = useState({});
  const [graphData, setGraphData] = useState({ nodes: [], edges: [] });
  const [selectedEntity, setSelectedEntity] = useState('');
  const [entitySource, setEntitySource] = useState('stored');
  const [showFullTrace, setShowFullTrace] = useState(false);
  const [bucketFilter, setBucketFilter] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [expandedBuckets, setExpandedBuckets] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    const load = async () => {
      if (!fileId) return;
      setLoading(true);
      setError(null);
      try {
        const [entitiesData, graphResult] = await Promise.all([
          fetchJSON(`${API_BASE}/logs/${fileId}/entities`),
          fetchJSON(`${API_BASE}/logs/visualisation/graph?fileId=${fileId}`)
        ]);

        setEntities(entitiesData.entities || {});
        setEntitySource(entitiesData.source || 'stored');
        setGraphData({
          nodes: graphResult.nodes || [],
          edges: graphResult.edges || []
        });
      } catch (err) {
        console.error('Observability load error:', err);
        setError(err.message);
        setEntities({});
        setGraphData({ nodes: [], edges: [] });
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [fileId]);

  const buckets = useMemo(() => {
    return Object.entries(entities).map(([bucket, values]) => ({
      bucket,
      values: Object.entries(values).sort((a, b) => b[1] - a[1]),
      total: Object.values(values).reduce((s, c) => s + c, 0)
    })).filter(b => b.values.length > 0);
  }, [entities]);

  const bucketOptions = useMemo(() => buckets.map(b => b.bucket), [buckets]);

  const filteredBuckets = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();
    return buckets
      .filter(b => !bucketFilter || b.bucket === bucketFilter)
      .map(bucket => ({
        ...bucket,
        values: term ? bucket.values.filter(([value]) => value.toLowerCase().includes(term)) : bucket.values
      }))
      .filter(bucket => bucket.values.length > 0);
  }, [buckets, bucketFilter, searchTerm]);

  const topEntities = useMemo(() => {
    // Use partial sort: collect top-10 per bucket, then merge
    const candidates = [];
    for (const { bucket, values } of buckets) {
      const top = values.slice(0, 10);
      for (const [value, count] of top) {
        candidates.push({ bucket, value, count });
      }
    }
    candidates.sort((a, b) => b.count - a.count);
    return candidates.slice(0, 10);
  }, [buckets]);

  const entityCount = useMemo(() =>
    buckets.reduce((sum, b) => sum + b.values.length, 0), [buckets]);
  const bucketCount = buckets.length;

  const graphStats = useMemo(() => {
    const nodeCount = graphData.nodes.length;
    const edgeCount = graphData.edges.length;
    const density = nodeCount > 0 ? Math.round((edgeCount / nodeCount) * 100) / 100 : 0;
    let maxEdgeWeight = 0;
    for (const e of graphData.edges) { const w = e.weight || 1; if (w > maxEdgeWeight) maxEdgeWeight = w; }
    let totalNodeWeight = 0;
    for (const n of graphData.nodes) { totalNodeWeight += (n.weight || 1); }
    const avgNodeWeight = nodeCount > 0 ? Math.round(totalNodeWeight / nodeCount) : 0;
    return { nodeCount, edgeCount, density, maxEdgeWeight, avgNodeWeight };
  }, [graphData]);

  useEffect(() => {
    if (!selectedEntity) return;
    const found = buckets.some(b => b.values.some(([v]) => v === selectedEntity));
    // eslint-disable-next-line react-hooks/set-state-in-effect -- clear stale selection when entity disappears from refreshed buckets
    if (!found) setSelectedEntity('');
  }, [buckets, selectedEntity]);

  const handleSelectEntity = useCallback((value) => {
    setSelectedEntity(value);
    setShowFullTrace(false);
  }, []);

  const handleOpenTrace = useCallback(() => {
    if (selectedEntity) setShowFullTrace(true);
  }, [selectedEntity]);

  const handleOpenGraph = useCallback(() => {
    if (onNavigate) onNavigate('graph');
  }, [onNavigate]);

  return (
    <div className="obs-layout">
      <div className="section-header">
        <div>
          <h1>Enterprise Observability</h1>
          <p>Correlate state changes, errors, and lifecycle events across your log streams.</p>
          <div className="obs-entity-source">
            Entity source: <strong style={{ color: 'var(--text-primary)' }}>{entitySource}</strong>
          </div>
        </div>
        <div className="section-header-actions">
          <button className="btn btn-secondary" onClick={handleOpenGraph}>
            View Full Entity Graph
          </button>
        </div>
      </div>

      {loading ? (
        <div className="card-elevated obs-loading-card">
          Loading observability data…
        </div>
      ) : error ? (
        <div className="card-elevated obs-error-card">
          {error}
        </div>
      ) : (
        <>
          {/* Stats Grid */}
          <div className="ep-stats">
            <div className="ep-kpi" style={{ borderLeft: '3px solid var(--color-info)' }}>
              <div className="ep-kpi-header"><Activity size={14} /> Traceable Entities</div>
              <div className="ep-kpi-value" style={{ fontSize: 22 }}>{entityCount}</div>
              <div className="ep-kpi-sub">Unique correlated identifiers discovered</div>
            </div>
            <div className="ep-kpi" style={{ borderLeft: '3px solid var(--color-accent)' }}>
              <div className="ep-kpi-header"><GitBranch size={14} /> Correlation Buckets</div>
              <div className="ep-kpi-value" style={{ fontSize: 22 }}>{bucketCount}</div>
              <div className="ep-kpi-sub">Entity types available for tracing</div>
            </div>
            <div className="ep-kpi" style={{ borderLeft: '3px solid var(--color-purple)' }}>
              <div className="ep-kpi-header"><BarChart3 size={14} /> Graph Nodes</div>
              <div className="ep-kpi-value" style={{ fontSize: 22 }}>{graphStats.nodeCount}</div>
              <div className="ep-kpi-sub">{graphStats.edgeCount} edges · density {graphStats.density}</div>
            </div>
            <div className="ep-kpi" style={{ borderLeft: '3px solid var(--color-success)' }}>
              <div className="ep-kpi-header"><Zap size={14} /> Avg Node Weight</div>
              <div className="ep-kpi-value" style={{ fontSize: 22 }}>{graphStats.avgNodeWeight}</div>
              <div className="ep-kpi-sub">Average occurrence per entity node</div>
            </div>
          </div>

          <div className="obs-main-grid">
            <div className="obs-column">
              {/* Entity Buckets Card */}
              <div className="card-elevated" style={{ display: 'grid', gap: '18px' }}>
                <div className="obs-card-header">
                  <div>
                    <h3>Entity Buckets</h3>
                    <p>Click an entity value to trace it. Filter and inspect correlation buckets.</p>
                  </div>
                  <button className="btn btn-secondary" onClick={() => { setBucketFilter(''); setSearchTerm(''); }}>
                    Reset filters
                  </button>
                </div>

                <div className="obs-filter-row">
                  <select
                    value={bucketFilter}
                    onChange={e => setBucketFilter(e.target.value)}
                    className="input-select"
                  >
                    <option value="">All buckets</option>
                    {bucketOptions.map(bucket => (
                      <option key={bucket} value={bucket}>{bucket} ({buckets.find(b => b.bucket === bucket)?.values.length || 0})</option>
                    ))}
                  </select>
                  <div style={{ position: 'relative', flex: 1 }}>
                    <Search size={14} style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
                    <input
                      className="input-select"
                      value={searchTerm}
                      placeholder="Search entity value…"
                      onChange={e => setSearchTerm(e.target.value)}
                      style={{ paddingLeft: '32px' }}
                    />
                  </div>
                </div>

                <div className="obs-bucket-grid">
                  {filteredBuckets.length > 0 ? filteredBuckets.map(bucket => {
                    const isExpanded = expandedBuckets[bucket.bucket] || false;
                    const maxVisible = 4;
                    const visible = isExpanded ? bucket.values : bucket.values.slice(0, maxVisible);
                    const toggleExpand = () => setExpandedBuckets(prev => ({ ...prev, [bucket.bucket]: !prev[bucket.bucket] }));
                    return (
                    <div key={bucket.bucket} className="obs-bucket-item">
                      <div className="obs-bucket-label">
                        <span>{BUCKET_ICONS[bucket.bucket] || '📌'}</span>
                        <span>{bucket.bucket}</span>
                        <span className="badge badge-subtle" style={{ fontSize: '10px', padding: '1px 5px' }}>{bucket.values.length}</span>
                      </div>
                      {visible.map(([value, count]) => (
                        <div
                          key={value}
                          className="obs-bucket-entry"
                          onClick={() => handleSelectEntity(value)}
                          style={{
                            background: selectedEntity === value ? 'var(--color-accent-bg)' : undefined,
                            borderLeftColor: selectedEntity === value ? 'var(--color-accent)' : 'transparent'
                          }}
                        >
                          <span style={{ fontFamily: 'var(--font-mono)', fontSize: '12px' }}>{value}</span>
                          <span style={{ color: BUCKET_COLORS[bucket.bucket] || 'var(--text-muted)', fontWeight: 600, fontSize: '12px', flexShrink: 0 }}>{count}</span>
                        </div>
                      ))}
                      {bucket.values.length > maxVisible && (
                        <button className="obs-bucket-expand" onClick={toggleExpand}>
                          {isExpanded ? '▴ Show less' : `▾ Show ${bucket.values.length - maxVisible} more`}
                        </button>
                      )}
                    </div>
                    );
                  }) : (
                    <div style={{ color: 'var(--text-muted)', gridColumn: '1 / -1', padding: '20px', textAlign: 'center' }}>
                      {buckets.length > 0 ? 'No matching entities for the current filter.' : 'No traceable entities found in this file.'}
                    </div>
                  )}
                </div>
              </div>

              {/* Trace Timeline Card */}
              <div className="card-elevated" style={{ display: 'grid', gap: '18px' }}>
                <div className="obs-card-header">
                  <div>
                    <h3>Trace Timeline</h3>
                    <p>Analyze correlated lifecycle events for the selected entity.</p>
                  </div>
                  <button className="btn btn-primary" disabled={!selectedEntity} onClick={handleOpenTrace}>
                    Full Trace View
                  </button>
                </div>

                <div className="obs-entity-select-row">
                  <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <MousePointerClick size={14} style={{ color: 'var(--text-muted)' }} />
                    <span style={{ fontSize: '13px', color: selectedEntity ? 'var(--text-primary)' : 'var(--text-muted)', fontWeight: selectedEntity ? 600 : 400 }}>
                      {selectedEntity ? (
                        <>Tracing: <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-accent)' }}>{selectedEntity}</span></>
                      ) : (
                        'Click an entity value above to trace'
                      )}
                    </span>
                  </div>
                  <button className="btn btn-secondary" onClick={() => setSelectedEntity('')} disabled={!selectedEntity}>
                    Clear selection
                  </button>
                </div>

                {selectedEntity ? (
                  <TraceTimeline fileId={fileId} entityId={selectedEntity} />
                ) : (
                  <div className="obs-trace-empty">
                    {entityCount > 0
                      ? 'Click any entity value above to display its correlated trace timeline.'
                      : 'No correlated entities available for this file.'}
                  </div>
                )}
              </div>
            </div>

            <div className="obs-column">
              {/* Graph Insights */}
              <div className="card-elevated obs-insights-card">
                <h3>Graph Insights</h3>
                <div className="obs-insight-list">
                  <div className="obs-insight-row">
                    <div>
                      <div className="obs-insight-label">Edge Density</div>
                      <div className="obs-insight-desc">Edges per node — higher means stronger linkage.</div>
                    </div>
                    <div className="obs-insight-value" style={{ color: graphStats.density > 2 ? 'var(--color-success)' : graphStats.density > 0.5 ? 'var(--color-warning)' : 'var(--text-muted)' }}>
                      {graphStats.density}
                    </div>
                  </div>
                  <div className="obs-insight-row">
                    <div>
                      <div className="obs-insight-label">Max Edge Weight</div>
                      <div className="obs-insight-desc">Strongest entity co-occurrence pair.</div>
                    </div>
                    <div className="obs-insight-value">{graphStats.maxEdgeWeight}</div>
                  </div>
                  <div className="obs-insight-row">
                    <div>
                      <div className="obs-insight-label">Entity Categories</div>
                      <div className="obs-insight-desc">Different entity types tracked.</div>
                    </div>
                    <div className="obs-insight-value">{bucketCount}</div>
                  </div>
                  <div className="obs-insight-row">
                    <div>
                      <div className="obs-insight-label">Graph Coverage</div>
                      <div className="obs-insight-desc">Nodes with at least one edge.</div>
                    </div>
                    <div className="obs-insight-value">
                      {graphStats.nodeCount > 0
                        ? `${Math.round((graphData.edges.length > 0 ? graphData.nodes.filter(n => n.weight > 1).length : 0) / graphStats.nodeCount * 100)}%`
                        : '0%'}
                    </div>
                  </div>
                </div>
              </div>

              {/* Top Entities */}
              <div className="card-elevated obs-top-entities-card">
                <h3>Top Entities</h3>
                {topEntities.length > 0 ? (
                  <div className="obs-top-list">
                    {topEntities.map((entity) => (
                      <div
                        key={`${entity.bucket}-${entity.value}`}
                        className="obs-top-item"
                        onClick={() => handleSelectEntity(entity.value)}
                        style={{
                          cursor: 'pointer',
                          background: selectedEntity === entity.value ? 'var(--color-accent-bg)' : undefined,
                          borderLeft: selectedEntity === entity.value ? '2px solid var(--color-accent)' : '2px solid transparent',
                          transition: 'all 0.12s ease'
                        }}
                      >
                        <div>
                          <div className="obs-top-item-label" style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                            <span>{BUCKET_ICONS[entity.bucket] || '📌'}</span>
                            {entity.bucket}
                          </div>
                          <div className="obs-top-item-value">{entity.value}</div>
                        </div>
                        <div className="obs-top-item-count" style={{ color: BUCKET_COLORS[entity.bucket] || 'var(--text-secondary)' }}>{entity.count}</div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div style={{ color: 'var(--text-muted)', padding: '12px 0' }}>No top entities available.</div>
                )}
              </div>

              {/* Enterprise Notes */}
              <div className="card-elevated obs-notes-card">
                <h3>How It Works</h3>
                <ul className="obs-notes-list">
                  <li><strong>Entity Buckets</strong> — Click any entity value to trace its lifecycle across all logs.</li>
                  <li><strong>Graph Insights</strong> — Edge density shows how interconnected your entities are.</li>
                  <li><strong>Trace Timeline</strong> — Shows chronological events, state changes, and errors.</li>
                  <li><strong>Full Trace View</strong> — Opens an expanded overlay for detailed analysis.</li>
                </ul>
              </div>
            </div>
          </div>
        </>
      )}

      {showFullTrace && (
        <div className="trace-overlay" onClick={() => setShowFullTrace(false)}>
          <div className="trace-container" onClick={e => e.stopPropagation()}>
            <button className="close-btn" onClick={() => setShowFullTrace(false)}>Close</button>
            <TraceTimeline fileId={fileId} entityId={selectedEntity} expanded={true} />
          </div>
        </div>
      )}
    </div>
  );
}
