import { memo, useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Network, AlertTriangle, X } from 'lucide-react';
import { useFileContext } from '../context/FileContext';

import { API_BASE } from '../config';

/* ── Minimal force-directed graph using SVG ─────────────────── */
function useForceLayout(nodes, edges, width = 700, height = 480) {
  const [positions, setPositions] = useState({});

  useEffect(() => {
    if (!nodes.length) return;

    // Seed positions randomly
    const pos = {};
    nodes.forEach(n => {
      pos[n.id] = {
        x: Math.random() * (width - 80) + 40,
        y: Math.random() * (height - 80) + 40,
        vx: 0, vy: 0
      };
    });

    // Run 80 iterations of simplified force sim
    for (let iter = 0; iter < 80; iter++) {
      // Repulsion between all nodes
      nodes.forEach((a, i) => {
        nodes.forEach((b, j) => {
          if (i >= j) return;
          const dx = pos[a.id].x - pos[b.id].x;
          const dy = pos[a.id].y - pos[b.id].y;
          const dist = Math.max(Math.sqrt(dx * dx + dy * dy), 1);
          const force = 2000 / (dist * dist);
          pos[a.id].vx += (dx / dist) * force;
          pos[a.id].vy += (dy / dist) * force;
          pos[b.id].vx -= (dx / dist) * force;
          pos[b.id].vy -= (dy / dist) * force;
        });
      });

      // Attraction along edges
      edges.forEach(e => {
        const a = pos[e.source], b = pos[e.target];
        if (!a || !b) return;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const dist = Math.max(Math.sqrt(dx * dx + dy * dy), 1);
        const force = (dist - 120) * 0.02;
        const fx = (dx / dist) * force;
        const fy = (dy / dist) * force;
        a.vx += fx; a.vy += fy;
        b.vx -= fx; b.vy -= fy;
      });

      // Integrate
      nodes.forEach(n => {
        pos[n.id].x = Math.max(30, Math.min(width - 30, pos[n.id].x + pos[n.id].vx * 0.3));
        pos[n.id].y = Math.max(30, Math.min(height - 30, pos[n.id].y + pos[n.id].vy * 0.3));
        pos[n.id].vx *= 0.6;
        pos[n.id].vy *= 0.6;
      });
    }

    // eslint-disable-next-line react-hooks/set-state-in-effect -- stores computed force-layout positions; simulation runs only here
    setPositions({ ...pos });
  }, [nodes, edges, width, height]);

  return positions;
}

function LogGraph() {
  const navigate = useNavigate();
  const { activeFileId: fileId } = useFileContext();
  const onClose = useCallback(() => navigate('/dashboard'), [navigate]);
  const [graphData, setGraphData] = useState({ nodes: [], edges: [] });
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState(null);
  const [selected, setSelected]   = useState(null);
  const [zoom, setZoom]           = useState(1);

  const W = 760, H = 480;
  const positions = useForceLayout(graphData.nodes, graphData.edges, W, H);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      try {
        const res = await fetch(`${API_BASE}/logs/visualisation/graph?fileId=${fileId}`, { credentials: 'include' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        // Limit to 60 nodes for readability
        const nodes = (data.nodes || []).slice(0, 60);
        const nodeIds = new Set(nodes.map(n => n.id));
        const edges = (data.edges || []).filter(e => nodeIds.has(e.source) && nodeIds.has(e.target));
        setGraphData({ nodes, edges });
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [fileId]);

  // Deduplicate edges
  const uniqueEdges = graphData.edges.filter((e, i, arr) =>
    i === arr.findIndex(x =>
      (x.source === e.source && x.target === e.target) ||
      (x.source === e.target && x.target === e.source)
    )
  ).slice(0, 120);

  const nodeColors = ['#6366f1', '#a855f7', '#06b6d4', '#10b981', '#f59e0b', '#ef4444'];

  return (
    /* Full-screen modal overlay */
    <div style={{
      position: 'fixed', inset: 0, zIndex: 1000,
      background: 'rgba(8,12,20,0.92)', backdropFilter: 'blur(8px)',
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      animation: 'fadeIn 0.25s ease'
    }}
      role="dialog" aria-modal="true" aria-label="Log Entity Graph"
    >
      <div style={{
        width: '90vw', maxWidth: '900px',
        background: 'var(--bg-secondary)',
        border: '1px solid var(--glass-border)',
        borderRadius: '16px', overflow: 'hidden',
        boxShadow: '0 32px 80px rgba(0,0,0,0.7)'
      }}>
        {/* Header */}
        <div style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          padding: '18px 24px', borderBottom: '1px solid var(--glass-border)',
          background: 'rgba(99,102,241,0.06)'
        }}>
          <div>
            <h2 style={{ fontSize: '18px', fontWeight: 700, margin: 0, display: 'flex', alignItems: 'center', gap: '8px' }}><Network size={18} /> Log Entity Graph</h2>
            <p style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '2px' }}>
              {graphData.nodes.length} entities · {uniqueEdges.length} correlations
            </p>
          </div>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <button
              onClick={() => setZoom(z => Math.min(2, z + 0.2))}
              aria-label="Zoom in"
              style={{ background: 'var(--bg-tertiary)', border: '1px solid var(--glass-border)', borderRadius: '6px', width: '30px', height: '30px', color: 'var(--text-primary)', cursor: 'pointer', fontSize: '16px' }}>+</button>
            <button
              onClick={() => setZoom(z => Math.max(0.4, z - 0.2))}
              aria-label="Zoom out"
              style={{ background: 'var(--bg-tertiary)', border: '1px solid var(--glass-border)', borderRadius: '6px', width: '30px', height: '30px', color: 'var(--text-primary)', cursor: 'pointer', fontSize: '16px' }}>&minus;</button>
            <button
              onClick={onClose}
              style={{ background: 'rgba(239,68,68,0.15)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: '8px', padding: '6px 14px', color: 'var(--color-error)', cursor: 'pointer', fontSize: '13px', fontWeight: 600 }}>
              <X size={14} /> Close
            </button>
          </div>
        </div>

        {/* Graph canvas */}
        <div style={{ background: 'var(--bg-canvas)', overflow: 'hidden', position: 'relative', height: `${H}px` }}>
          {loading && (
            <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '12px' }}>
              <div style={{ width: '32px', height: '32px', border: '3px solid rgba(255,255,255,0.1)', borderTopColor: '#6366f1', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
              <div style={{ color: 'var(--text-secondary)', fontSize: '14px' }}>Building entity graph&hellip;</div>
            </div>
          )}
          {error && (
            <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <div style={{ color: 'var(--color-error)', textAlign: 'center' }}>
                <div style={{ color: 'var(--text-muted)', marginBottom: '8px' }}><AlertTriangle size={32} /></div>
                <div style={{ fontSize: '14px' }}>Failed to load graph: {error}</div>
              </div>
            </div>
          )}
          {!loading && !error && graphData.nodes.length === 0 && (
            <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)', flexDirection: 'column', gap: '8px' }}>
              <div style={{ color: 'var(--text-muted)' }}><Network size={40} /></div>
              <div>No traceable entities found in this log file.</div>
            </div>
          )}
          {!loading && !error && graphData.nodes.length > 0 && (
            <svg
              width="100%"
              height="100%"
              viewBox={`0 0 ${W} ${H}`}
              style={{ transform: `scale(${zoom})`, transformOrigin: 'center center', transition: 'transform 0.2s' }}
            >
              <defs>
                <marker id="arrow" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
                  <path d="M0,0 L0,6 L6,3 z" fill="rgba(99,102,241,0.5)" />
                </marker>
                <filter id="glow">
                  <feGaussianBlur stdDeviation="3" result="coloredBlur" />
                  <feMerge><feMergeNode in="coloredBlur" /><feMergeNode in="SourceGraphic" /></feMerge>
                </filter>
              </defs>

              {/* Edges */}
              {uniqueEdges.map((e, i) => {
                const a = positions[e.source], b = positions[e.target];
                if (!a || !b) return null;
                return (
                  <line key={i}
                    x1={a.x} y1={a.y} x2={b.x} y2={b.y}
                    stroke="rgba(99,102,241,0.25)" strokeWidth="1"
                    markerEnd="url(#arrow)"
                  />
                );
              })}

              {/* Nodes */}
              {graphData.nodes.map((node, i) => {
                const pos = positions[node.id];
                if (!pos) return null;
                const color = nodeColors[i % nodeColors.length];
                const isSelected = selected === node.id;
                return (
                  <g key={node.id} onClick={() => setSelected(isSelected ? null : node.id)} style={{ cursor: 'pointer' }}>
                    <circle cx={pos.x} cy={pos.y} r={isSelected ? 12 : 8}
                      fill={color} fillOpacity="0.2"
                      stroke={color} strokeWidth={isSelected ? 2 : 1}
                      filter={isSelected ? 'url(#glow)' : undefined}
                      style={{ transition: 'r 0.2s, stroke-width 0.2s' }}
                    />
                    {isSelected && (
                      <circle cx={pos.x} cy={pos.y} r={18}
                        fill="none" stroke={color} strokeWidth="1" strokeOpacity="0.3"
                        strokeDasharray="4 3"
                      />
                    )}
                    <text x={pos.x} y={pos.y + 22} textAnchor="middle"
                      style={{ fontSize: '8px', fill: 'var(--text-muted)', fontFamily: 'monospace', pointerEvents: 'none' }}>
                      {node.id.length > 14 ? node.id.slice(0, 12) + '&hellip;' : node.id}
                    </text>
                  </g>
                );
              })}
            </svg>
          )}
        </div>

        {/* Footer / selected node details */}
        <div style={{ padding: '12px 24px', borderTop: '1px solid var(--glass-border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', minHeight: '44px' }}>
          {selected ? (
            <div style={{ fontSize: '13px', color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)' }}>
              Selected entity: <strong style={{ color: 'var(--color-accent)' }}>{selected}</strong>
              &nbsp;·&nbsp; click the node again to deselect
            </div>
          ) : (
            <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
              Click any node to inspect · scroll or use +/− to zoom
            </div>
          )}
          <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
            {graphData.nodes.length} nodes · {uniqueEdges.length} edges
          </div>
        </div>
      </div>
    </div>
  );
}

export default memo(LogGraph);
