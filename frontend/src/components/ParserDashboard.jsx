import { useState, useRef } from 'react';
import { Search, Upload, Plus, Target, Download, Trash2 } from 'lucide-react';
import { API_BASE } from '../config';

export default function ParserDashboard({ onSelect, onRefresh, parsers, loading }) {
  const [search, setSearch] = useState('');
  const fileInputRef = useRef(null);

  const filtered = parsers.filter(p =>
    !search || p.name.toLowerCase().includes(search.toLowerCase()) ||
    p.description?.toLowerCase().includes(search.toLowerCase()) ||
    p.tags?.some(t => t.toLowerCase().includes(search.toLowerCase()))
  );

  const handleImport = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      try {
        const json = JSON.parse(text);
        if (json.parser || json.regexPattern || json.fieldMappings) {
          const res = await fetch(`${API_BASE}/parsers/import`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
            body: JSON.stringify(json.parser || json)
          });
          if (res.ok) { onRefresh(); alert('Parser imported successfully'); }
          else { const err = await res.json(); alert('Import failed: ' + (err.error || 'Unknown error')); }
          e.target.value = '';
          return;
        }
      } catch { /* not JSON, continue */ }
      if (text.trim()) {
        onSelect({ _new: true, _fileSamples: text.slice(0, 5000) });
      }
    } catch (err) { alert('Error reading file: ' + err.message); }
    e.target.value = '';
  };

  const handleExport = async (id) => {
    try {
      const res = await fetch(`${API_BASE}/parsers/${id}/export`, {
        credentials: 'include'
      });
      if (!res.ok) throw new Error('Export failed');
      const data = await res.json();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url; a.download = `parser-${data.parser.name}.json`; a.click();
      URL.revokeObjectURL(url);
    } catch (err) { alert(err.message); }
  };

  const handleDelete = async (id, name) => {
    if (!confirm(`Delete parser "${name}"?`)) return;
    const res = await fetch(`${API_BASE}/parsers/${id}`, {
      method: 'DELETE', credentials: 'include'
    });
    if (res.ok) onRefresh();
  };

  return (
    <div className="parser-dashboard">
      <div className="parser-dash-header">
        <div className="parser-search">
          <Search size={14} />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search parsers by name, description, or tag..." className="input-text" />
        </div>
        <div className="parser-dash-actions">
          <button className="btn btn-secondary" onClick={() => fileInputRef.current?.click()}>
            <Upload size={14} /> Import
          </button>
          <input ref={fileInputRef} type="file" accept=".json,.log,.txt" style={{ display: 'none' }} onChange={handleImport} />
          <button className="btn btn-primary" onClick={() => onSelect({ _new: true })}>
            <Plus size={14} /> Create Parser
          </button>
        </div>
      </div>

      {loading ? (
        <div className="chart-loading">Loading parsers...</div>
      ) : filtered.length === 0 ? (
        <div className="parser-empty">
          <Target size={48} />
          <h3>No parsers yet</h3>
          <p>Create your first custom parser to automatically extract structured fields from any log format.</p>
          <button className="btn btn-primary" onClick={() => onSelect({ _new: true })}>
            <Plus size={14} /> Create Your First Parser
          </button>
        </div>
      ) : (
        <div className="parser-card-grid">
          {filtered.map(p => (
            <div key={p.id} className="parser-card" onClick={() => onSelect(p)}>
              <div className="parser-card-header">
                <h3 className="parser-card-name">{p.name}</h3>
                <span className={`parser-card-acc ${(p.testResults?.matchRate || 0) >= 90 ? 'high' : (p.testResults?.matchRate || 0) >= 60 ? 'mid' : 'low'}`}>
                  {p.testResults?.matchRate || 0}%
                </span>
              </div>
              <div className="parser-card-desc">{p.description || 'No description'}</div>
              <div className="parser-card-meta">
                <span>v{p.version}</span>
                <span>{p.fieldMappings?.length || 0} fields</span>
                {p.tags?.length > 0 && p.tags.map(t => <span key={t} className="parser-tag">{t}</span>)}
              </div>
              <div className="parser-card-footer">
                <span className="parser-card-date">Updated {p.updatedAt ? new Date(p.updatedAt).toLocaleDateString() : 'N/A'}</span>
                <div className="parser-card-actions">
                  <button className="btn-icon" title="Export" onClick={e => { e.stopPropagation(); handleExport(p.id); }}><Download size={12} /></button>
                  <button className="btn-icon danger" title="Delete" onClick={e => { e.stopPropagation(); handleDelete(p.id, p.name); }}><Trash2 size={12} /></button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
