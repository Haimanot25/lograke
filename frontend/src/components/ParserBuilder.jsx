import { useState, useRef } from 'react';
import { Save, Upload, Plus, Zap, CheckCircle, Eye, ChevronRight, Settings, Code, RefreshCw, Trash2 } from 'lucide-react';
import { API_BASE } from '../config';
import { FIELD_TYPES, DEFAULT_SAMPLE, getFieldColor, extractGroupPattern } from '../utils/parserConstants';
import { HighlightedLine } from '../utils/parserHelpers';

export default function ParserBuilder({ parser, onBack, onRefresh, fileSamples }) {
  const [sampleLines, setSampleLines] = useState(parser?._fileSamples || parser?.sampleLines || fileSamples || DEFAULT_SAMPLE);
  const [fields, setFields] = useState(parser?.fieldMappings || []);
  const [regexPattern, setRegexPattern] = useState(parser?.regexPattern || '');
  const [suggesting, setSuggesting] = useState(false);
  const [preview, setPreview] = useState(null);
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState(parser?.name || '');
  const [description, setDescription] = useState(parser?.description || '');
  const [tags, setTags] = useState(parser?.tags?.join(', ') || '');
  const [multiLine, setMultiLine] = useState(parser?.multiLine || false);
  const [activeTab, setActiveTab] = useState('fields');
  const [message, setMessage] = useState('');
  const logFileRef = useRef(null);

  const handleLogFileUpload = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result || '';
      setSampleLines(text);
      setMessage(`Loaded ${text.split('\n').filter(l => l.trim()).length} lines from ${file.name}`);
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const handleSuggest = async () => {
    if (!sampleLines.trim()) { setMessage('Paste sample log lines first'); return; }
    setSuggesting(true);
    setMessage('');
    try {
      const res = await fetch(`${API_BASE}/parsers/suggest`, {
        credentials: 'include',
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sampleLines })
      });
      if (!res.ok) { const err = await res.json(); throw new Error(err.error); }
      const data = await res.json();
      if (data.success && data.fields?.length) {
        setFields(data.fields);
        setRegexPattern(data.regexPattern || '');
        setMessage(`Detected ${data.fields.length} fields with ${data.confidence}% confidence (${data.coverage}% sample coverage)`);
        try {
          const previewRes = await fetch(`${API_BASE}/parsers/preview`, {
            credentials: 'include',
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ regexPattern: data.regexPattern, testLines: sampleLines })
          });
          if (previewRes.ok) {
            const previewData = await previewRes.json();
            setPreview(previewData);
            setActiveTab('preview');
          }
        } catch { /* preview generation failed silently */ }
      } else {
        setMessage('Could not detect fields. Try adding more sample lines or adjust the format.');
      }
    } catch (err) {
      setMessage('Error: ' + err.message);
    } finally {
      setSuggesting(false);
    }
  };

  const handlePreview = async () => {
    if (!regexPattern) { setMessage('Generate fields first or enter a regex pattern'); return; }
    try {
      const res = await fetch(`${API_BASE}/parsers/preview`, {
        credentials: 'include',
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ regexPattern, testLines: sampleLines })
      });
      if (!res.ok) { const err = await res.json(); throw new Error(err.error); }
      setPreview(await res.json());
      setActiveTab('preview');
    } catch (err) {
      setMessage('Preview error: ' + err.message);
    }
  };

  const handleSave = async () => {
    if (!name.trim()) { setMessage('Parser name required'); return; }
    if (!fields.length) { setMessage('At least one field required'); return; }
    setSaving(true);
    setMessage('');
    try {
      const body = { name: name.trim(), description: description.trim(), sampleLines, fields, tags: tags.split(',').map(t => t.trim()).filter(Boolean), multiLine };
      let res;
      if (parser?.id && !parser._new) {
        res = await fetch(`${API_BASE}/parsers/${parser.id}`, {
          method: 'PUT', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ ...body, regexPattern })
        });
      } else {
        res = await fetch(`${API_BASE}/parsers`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ ...body, regexPattern })
        });
      }
      if (!res.ok) { const err = await res.json(); throw new Error(err.error || 'Request failed'); }
      setMessage('Parser saved successfully!');
      onRefresh?.();
      setTimeout(() => onBack?.(), 800);
    } catch (err) {
      setMessage('Save error: ' + err.message);
    } finally {
      setSaving(false);
    }
  };

  const updateField = (idx, updates) => {
    setFields(prev => prev.map((f, i) => i === idx ? { ...f, ...updates } : f));
  };

  const removeField = (idx) => {
    setFields(prev => prev.filter((_, i) => i !== idx));
  };

  const addField = () => {
    setFields(prev => [...prev, { name: 'field_' + (prev.length + 1), type: 'string', confidence: 50, sampleValues: [], regexGroup: 'field_' + (prev.length + 1) }]);
  };

  const fieldColors = {};
  fields.forEach((f, i) => { fieldColors[f.regexGroup] = getFieldColor(i); });

  const sampleLinesArray = sampleLines.split('\n').filter(l => l.trim());

  return (
    <div className="parser-builder">
      <div className="parser-builder-header">
        <button className="btn btn-ghost" onClick={onBack}><ChevronRight size={16} style={{ transform: 'rotate(180deg)' }} /> Back</button>
        <h2>{parser?.id && !parser._new ? 'Edit Parser' : 'Create New Parser'}</h2>
      </div>

      {message && (
        <div className={`parser-message ${message.includes('Error') || message.includes('error') ? 'error' : message.includes('success') ? 'success' : ''}`}>
          {message}
        </div>
      )}

      <div className="parser-builder-tabs">
        <button className={`parser-builder-tab ${activeTab === 'fields' ? 'active' : ''}`} onClick={() => setActiveTab('fields')}>
          <Code size={14} /> Fields
        </button>
        <button className={`parser-builder-tab ${activeTab === 'preview' ? 'active' : ''}`} onClick={() => setActiveTab('preview')}>
          <Eye size={14} /> Preview
        </button>
        <button className={`parser-builder-tab ${activeTab === 'settings' ? 'active' : ''}`} onClick={() => setActiveTab('settings')}>
          <Settings size={14} /> Settings
        </button>
      </div>

      {activeTab === 'fields' && (
        <div className="parser-builder-fields">
          <div className="parser-sample-panel">
            <label className="parser-label">Paste up to 20 sample log lines (one per line):</label>
            <textarea
              className="parser-sample-input"
              value={sampleLines}
              onChange={e => setSampleLines(e.target.value)}
              placeholder={`Paste your log lines here...\ne.g.\n2024-01-01 12:00:00 ERROR Something failed`}
              rows={10}
            />
            <div className="parser-sample-actions">
              <span className="parser-line-count">{sampleLinesArray.length} lines</span>
              <div style={{ display: 'flex', gap: '8px' }}>
                <button className="btn btn-secondary" onClick={() => logFileRef.current?.click()}>
                  <Upload size={14} /> Upload Log File
                </button>
                <input ref={logFileRef} type="file" accept=".log,.txt,.json" style={{ display: 'none' }} onChange={handleLogFileUpload} />
                <button className="btn btn-primary" onClick={handleSuggest} disabled={suggesting}>
                  {suggesting ? <><RefreshCw size={14} className="spin" /> Analyzing...</> : <><Zap size={14} /> Suggest Fields</>}
                </button>
              </div>
            </div>
          </div>

          <div className="parser-fields-panel">
            <div className="parser-fields-header">
              <h3>Detected Fields ({fields.length})</h3>
              <button className="btn btn-ghost" onClick={addField}><Plus size={12} /> Add Field</button>
            </div>

            {fields.length === 0 ? (
              <div className="parser-fields-empty">
                Paste sample lines and click "Suggest Fields" to auto-detect fields, or add them manually.
              </div>
            ) : (
              <div className="parser-fields-list">
                {fields.map((f, idx) => (
                  <div key={idx} className="parser-field-card">
                    <div className="parser-field-color" style={{ background: getFieldColor(idx) }} />
                    <div className="parser-field-body">
                      <div className="parser-field-row">
                        <input className="parser-field-name" value={f.name} onChange={e => updateField(idx, { name: e.target.value })} placeholder="field_name" />
                        <select className="parser-field-type" value={f.type} onChange={e => updateField(idx, { type: e.target.value })}>
                          {FIELD_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                        </select>
                        <div className={`parser-field-conf ${f.confidence >= 80 ? 'high' : f.confidence >= 50 ? 'mid' : 'low'}`}>
                          <div className="parser-conf-bar" style={{ width: (f.confidence || 50) + '%' }} />
                          <span>{f.confidence || 50}%</span>
                        </div>
                        <button className="btn-icon danger" onClick={() => removeField(idx)}><Trash2 size={12} /></button>
                      </div>
                      <div className="parser-field-meta">
                        <span className="parser-field-regex">{extractGroupPattern(regexPattern, f.regexGroup) || `(?<${f.regexGroup}>\\S+)`}</span>
                        {f.sampleValues?.length > 0 && (
                          <span className="parser-field-samples">e.g. {f.sampleValues.slice(0, 3).join(', ')}</span>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div className="parser-regex-editor">
              <label className="parser-label">Regex Pattern <button className="btn btn-ghost" onClick={handlePreview} style={{ float: 'right' }}><Eye size={12} /> Preview</button></label>
              <textarea className="parser-regex-input" value={regexPattern} onChange={e => setRegexPattern(e.target.value)} rows={3} placeholder="^...$" />
            </div>
          </div>
        </div>
      )}

      {activeTab === 'preview' && (
        <div className="parser-preview-panel">
          <div className="parser-preview-controls">
            <span className="parser-preview-stat">
              <CheckCircle size={14} color="#22c55e" /> {preview?.matchedLines || 0}/{preview?.totalLines || 0} matched ({preview?.matchRate || 0}%)
            </span>
            <button className="btn btn-ghost" onClick={handlePreview}><RefreshCw size={12} /> Refresh Preview</button>
          </div>

          {preview ? (
            <div className="parser-preview-lines">
              {preview.results?.map((r, i) => (
                <HighlightedLine key={i} line={r.line} matchedGroups={r.matched ? r.groups : null} fieldColors={fieldColors} index={i} />
              ))}
            </div>
          ) : (
            <div className="parser-fields-empty">Click "Preview" to see how the regex matches your sample lines with color-highlighted fields.</div>
          )}

          <div className="parser-preview-legend">
            {fields.map((f, i) => (
              <span key={i} className="parser-legend-item">
                <span className="parser-legend-dot" style={{ background: getFieldColor(i) }} />
                {f.name} <span className="parser-legend-type">({f.type})</span>
              </span>
            ))}
          </div>
        </div>
      )}

      {activeTab === 'settings' && (
        <div className="parser-settings-panel">
          <div className="parser-setting-group">
            <label className="parser-label">Parser Name</label>
            <input className="input-text" value={name} onChange={e => setName(e.target.value)} placeholder="e.g. MyApp Log Parser" />
          </div>
          <div className="parser-setting-group">
            <label className="parser-label">Description</label>
            <textarea className="input-text" value={description} onChange={e => setDescription(e.target.value)} placeholder="What does this parser do?" rows={3} />
          </div>
          <div className="parser-setting-group">
            <label className="parser-label">Tags (comma-separated)</label>
            <input className="input-text" value={tags} onChange={e => setTags(e.target.value)} placeholder="e.g. web, error, production" />
          </div>
          <div className="parser-setting-group">
            <label className="checkbox-label">
              <input type="checkbox" checked={multiLine} onChange={e => setMultiLine(e.target.checked)} />
              <span>Multi-line records (stack traces, EDR records spanning multiple lines)</span>
            </label>
          </div>

          <button className="btn btn-primary" onClick={handleSave} disabled={saving} style={{ marginTop: '20px' }}>
            <Save size={14} /> {saving ? 'Saving...' : 'Save Parser'}
          </button>
        </div>
      )}
    </div>
  );
}
