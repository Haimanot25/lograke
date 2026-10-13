import { Inbox, Upload as UploadIcon, FileText, Database, ChevronRight, Trash2 } from 'lucide-react';
import { showAlert } from '../utils/alerts';
import { API_BASE } from '../config';
import { useFileContext } from '../context/FileContext';
import { useUI } from '../context/UIContext';
import { useNavigate } from 'react-router-dom';

export default function UploadPage() {
  const { files, setActiveFileId, fetchFiles, customParsers } = useFileContext();
  const { selectedLogType, setSelectedLogType, multiLineEDR, setMultiLineEDR, dragActive, handleDrag, handleDrop, pasteText, setPasteText, pasteName, setPasteName, loading, setLoading } = useUI();
  const navigate = useNavigate();

  const handleFileUpload = async (uploadFiles) => {
    setLoading(true);
    const formData = new FormData();
    if (uploadFiles && uploadFiles.length) {
      for (const file of uploadFiles) formData.append('file', file);
    }
    formData.append('logType', selectedLogType);
    formData.append('multiLineEDR', multiLineEDR);
    if (selectedLogType.startsWith('custom_')) {
      formData.append('parserId', selectedLogType.replace('custom_', ''));
    }
    try {
      const saved = localStorage.getItem('lograke-anonymize');
      formData.append('anonymize', saved || JSON.stringify({ email: true, ip: true, creditCard: true, credentials: true }));
      const res = await fetch(`${API_BASE}/logs/upload`, { method: 'POST', body: formData });
      if (res.ok) {
        const data = await res.json();
        await fetchFiles();
        if (data.files && data.files.length > 0) {
          setActiveFileId(data.files[0].id);
          navigate('/dashboard');
        }
      } else {
        const errData = await parseJsonSafe(res);
        showAlert(`Upload failed: ${errData.error || 'Server error'}`, 'Upload Failed', 'error');
      }
    } catch (err) {
      showAlert(`Upload error: ${err.message}`, 'Upload Error', 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleFileChange = (e) => { if (e.target.files?.length) handleFileUpload(Array.from(e.target.files)); };
  const handleDrop_ = (e) => { handleDrop(e); if (e.dataTransfer.files?.length) handleFileUpload(Array.from(e.dataTransfer.files)); };
  const goTo = (tab) => navigate(`/${tab}`);
  const parseJsonSafe = async (response) => {
    try { return await response.json(); } catch {
      const text = await response.text().catch(() => 'Unable to parse response');
      return { error: text };
    }
  }; 
  const handleDelete = async (fileId) => {
    if (!window.confirm('Delete this source and all analysis data?')) return;
    const res = await fetch(`${API_BASE}/logs/${fileId}`, { method: 'DELETE' });
    if (res.ok) fetchFiles();
    else showAlert('Failed to delete source', 'Error', 'error');
  };

  const handleIngestPaste = async () => {
    if (!pasteText.trim()) { showAlert('Paste some log text first.', 'Empty Input', 'warn'); return; }
    try {
      const saved = localStorage.getItem('lograke-anonymize');
      const body = {
        sourceName: pasteName, rawText: pasteText, logType: selectedLogType, multiLineEDR,
        anonymize: saved ? JSON.parse(saved) : { email: true, ip: true, creditCard: true, credentials: true }
      };
      if (selectedLogType.startsWith('custom_')) body.parserId = selectedLogType.replace('custom_', '');
      const res = await fetch(`${API_BASE}/logs/ingest/raw`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
      });
      if (res.ok) {
        const data = await res.json();
        await fetchFiles();
        if (data.file?.id) { setActiveFileId(data.file.id); goTo('dashboard'); }
        setPasteText('');
      } else {
        const errData = await parseJsonSafe(res);
        showAlert(`Ingest failed: ${errData.error || 'Server error'}`, 'Failed', 'error');
      }
    } catch (err) { showAlert(`Error: ${err.message}`, 'Error', 'error'); }
  };

  return (
    <div className="upload-page">
      {/* Enterprise Header */}
      <div className="section-header">
        <div>
          <h1>Data Ingestion Platform</h1>
          <p>Upload plain text log files or compressed archives to begin indexing.</p>
        </div>
        <div className="section-header-actions">
          <div className="flex-gap-3">
            <span className="ep-chip" style={{ fontSize: 11 }}>Parser Profile:</span>
            <select value={selectedLogType} onChange={(e) => setSelectedLogType(e.target.value)} className="input-select" style={{ minWidth: 180 }}>
              <option value="default">Adaptive (Auto-Detect)</option>
              <optgroup label="Built-in Parsers">
                <option value="web">Web Server (Nginx/Apache)</option>
                <option value="network">Network Flow (VPC)</option>
                <option value="os">OS Syslog (Standard)</option>
                <option value="db">Database Logs</option>
                <option value="cdr">Telecom EDR/CDR</option>
                <option value="security">Security Audit</option>
              </optgroup>
              {customParsers?.length > 0 && (
                <optgroup label="Custom Parsers">
                  {customParsers.map(p => <option key={p.id} value={`custom_${p.id}`}>{p.name}</option>)}
                </optgroup>
              )}
            </select>
            {selectedLogType === 'cdr' && (
              <label className="checkbox-label flex-gap-2">
                <input type="checkbox" checked={multiLineEDR} onChange={(e) => setMultiLineEDR(e.target.checked)} />
                <span style={{ fontSize: 12 }}>Multi-line Record</span>
              </label>
            )}
          </div>
        </div>
      </div>

      {/* Upload Zone - Glass Card */}
      <div className="card-glass" style={{ textAlign: 'center', padding: 0 }}>
        <div
          role="button" tabIndex={0}
          className={`upload-zone ${dragActive ? 'active' : ''}`}
          onDragEnter={handleDrag} onDragOver={handleDrag} onDragLeave={handleDrag}
          onDrop={handleDrop_}
          onClick={() => document.getElementById('log-file-input').click()}
          aria-label="Upload log files"
          style={{
            padding: '48px 24px', cursor: 'pointer', transition: 'all 0.2s ease',
            borderBottom: '1px solid var(--border-default)',
            background: dragActive ? 'rgba(99,102,241,0.06)' : 'transparent'
          }}
        >
          <input id="log-file-input" type="file" multiple style={{ display: 'none' }}
            onChange={handleFileChange} accept=".log,.txt,.json,.gz,.zip,.tar" />
          <div style={{
            width: 64, height: 64, margin: '0 auto 16px', borderRadius: 'var(--radius-lg)',
            background: 'var(--bg-inset)', border: '2px dashed var(--border-default)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--content-tertiary)'
          }}>
            <Inbox size={32} />
          </div>
          <h3 style={{ fontSize: 18, fontWeight: 600, marginBottom: 8, color: 'var(--text-primary)' }}>
            Drag & Drop Log Files Here
          </h3>
          <p style={{ fontSize: 13, color: 'var(--content-secondary)' }}>
            Supports .log, .txt, .json, .zip, .gz, .tar, .tgz (Max: 100MB)
          </p>
        </div>

        {/* Paste Section */}
        <div style={{ padding: '24px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
            <div style={{ width: 32, height: 32, borderRadius: 'var(--radius-sm)', background: 'var(--color-accent-bg)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--color-accent)' }}>
              <FileText size={16} />
            </div>
            <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)' }}>Or paste log text</span>
          </div>
          <textarea
            aria-label="Paste log lines here"
            value={pasteText}
            onChange={(e) => setPasteText(e.target.value)}
            placeholder="Paste log lines here..."
            className="paste-textarea"
          />
          <div className="paste-actions" style={{ marginTop: 12 }}>
            <input type="text" aria-label="Source name" value={pasteName}
              onChange={(e) => setPasteName(e.target.value)} placeholder="Optional source name"
              className="input-text" style={{ flex: '1 1 220px' }} />
            <button className="btn btn-primary flex-gap-2" onClick={handleIngestPaste}>
              <UploadIcon size={14} /> Ingest Pasted Logs
            </button>
          </div>
        </div>
      </div>

      {/* Loading State */}
      {loading && (
        <div className="card-elevated mt-4" style={{ textAlign: 'center', padding: '32px' }}>
          <div className="loading-spinner" style={{ margin: '0 auto 12px' }} />
          <p className="text-muted">Parsing archives...</p>
        </div>
      )}

      {/* Recently Processed Sources */}
      {files.length > 0 && (
        <div className="card-elevated mt-4">
          <div className="card-header-slot">
            <div className="card-title flex-gap-2"><Database size={16} /> Recently Processed Sources</div>
            <span className="ep-chip">{files.length} sources</span>
          </div>
          <div className="ep-table-wrapper">
            <table className="ep-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Size</th>
                  <th>Lines</th>
                  <th>Type</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {files.slice(0, 10).map(f => (
                  <tr key={f.id}>
                    <td><span className="text-mono" style={{ fontSize: 12 }}>{f.name}</span></td>
                    <td className="text-mono text-muted">{f.fileSize || '-'}</td>
                    <td className="text-mono">{f.linesCount?.toLocaleString()}</td>
                    <td><span className="ep-badge ep-badge-info">{f.inferredType?.toUpperCase() || 'UNKNOWN'}</span></td>
                    <td style={{ textAlign: 'right' }}>
                      <button className="btn btn-secondary flex-gap-2" onClick={() => { setActiveFileId(f.id); goTo('dashboard'); }}
                        style={{ fontSize: 12, padding: '4px 12px' }}>
                        Open <ChevronRight size={12} />
                      </button>
                      <button onClick={() => handleDelete(f.id)} title="Delete source"
                        style={{ marginLeft: 6, width: 26, height: 26, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: 'none', border: '1px solid var(--border-muted)', borderRadius: 6, color: 'var(--text-muted)', cursor: 'pointer' }}>
                        <Trash2 size={12} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
