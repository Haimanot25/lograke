import { useState, useEffect, useCallback } from 'react';
import { FileText, BarChart3, FileSpreadsheet, FileJson, Download, Clock, Eye } from 'lucide-react';
import { API_BASE } from '../config';
import { useFileContext } from '../context/FileContext';

const REPORT_TYPES = [
  { id: 'summary', label: 'Summary Report', icon: <FileText size={18} />, desc: 'Overview with key metrics and level distribution', format: 'text/plain', ext: 'txt' },
  { id: 'detailed', label: 'Detailed Analysis', icon: <BarChart3 size={18} />, desc: 'Full log analysis with patterns, anomalies, and entities', format: 'text/plain', ext: 'txt' },
  { id: 'html', label: 'HTML Report', icon: <Eye size={18} />, desc: 'Rich visual report with charts and formatted tables', format: 'text/html', ext: 'html' },
  { id: 'csv', label: 'CSV Export', icon: <FileSpreadsheet size={18} />, desc: 'Download parsed logs as CSV spreadsheet', format: 'text/csv', ext: 'csv' },
  { id: 'json', label: 'JSON Export', icon: <FileJson size={18} />, desc: 'Complete structured data export', format: 'application/json', ext: 'json' },
];

/* ── Pure helpers (module scope — no component state) ───────── */
const escapeHtml = (str) => String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');

const downloadFile = (content, fileName, mimeType) => {
  const blob = new Blob([content], { type: mimeType });
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = fileName;
  document.body.appendChild(a); a.click();
  window.URL.revokeObjectURL(url);
  document.body.removeChild(a);
};

export default function Reports() {
  const { activeFileId: fileId } = useFileContext();
  const [reports, setReports] = useState([]);
  const [generating, setGenerating] = useState(null);
  const [message, setMessage] = useState('');
  const [previewContent, setPreviewContent] = useState(null);
  const [previewType, setPreviewType] = useState(null);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reset derived report list when the active file changes
    setReports([]);
    setPreviewContent(null);
  }, [fileId]);

  const generateSummaryReport = useCallback((file, fileName) => {
    const lc = file.levelCounts || {};
    const total = Object.values(lc).reduce((a, b) => a + b, 0) || 1;
    return [
      `LOG SUMMARY REPORT`,
      `Generated: ${new Date().toLocaleString()}`,
      `File: ${fileName}`,
      ``,
      `OVERVIEW`,
      `Total Lines: ${file.linesCount?.toLocaleString() || 0}`,
      `Inferred Type: ${file.inferredType || 'unknown'}`,
      `Health Score: ${file.healthScore ?? 'N/A'}/100`,
      ``,
      `LEVEL DISTRIBUTION`,
      `  Errors:   ${(lc.error || 0).toLocaleString()} (${((lc.error || 0) / total * 100).toFixed(1)}%)`,
      `  Warnings: ${(lc.warn || 0).toLocaleString()} (${((lc.warn || 0) / total * 100).toFixed(1)}%)`,
      `  Info:     ${(lc.info || 0).toLocaleString()} (${((lc.info || 0) / total * 100).toFixed(1)}%)`,
      `  Debug:    ${(lc.debug || 0).toLocaleString()} (${((lc.debug || 0) / total * 100).toFixed(1)}%)`,
      ``,
      `INSIGHTS`,
      `Patterns Detected: ${(file.patterns || []).length}`,
      `Anomalies Found: ${(file.anomalies || []).length}`,
      `Entity Types: ${Object.keys(file.entities || {}).length}`,
    ].join('\n');
  }, []);

  const generateDetailedReport = useCallback((file, fileName) => {
    let content = generateSummaryReport(file, fileName);
    const patterns = file.patterns || [];
    const anomalies = file.anomalies || [];
    const entities = file.entities || {};

    content += '\n\n═══ TOP PATTERNS ═══\n';
    patterns.slice(0, 15).forEach((p, idx) => {
      content += `\n${idx + 1}. [${p.level}] ${p.count} occurrences (${p.percentage || '?'}%)`;
      if (p.frequencyBand) content += ` [${p.frequencyBand}]`;
      content += `\n   Template: ${p.template.substring(0, 120)}\n`;
      if (p.httpStatuses?.length) content += `   HTTP: ${p.httpStatuses.map(h => `${h.code}×${h.count}`).join(', ')}\n`;
      if (p.services && Object.keys(p.services).length) content += `   Services: ${Object.entries(p.services).map(([s, c]) => `${s}(${c})`).join(', ')}\n`;
    });

    content += '\n\n═══ ANOMALIES ═══\n';
    anomalies.slice(0, 15).forEach((a, idx) => {
      content += `${idx + 1}. Line ${a.lineIndex || 'N/A'}: ${a.reason || 'Anomalous pattern'}\n`;
    });

    content += '\n\n═══ TRACEABLE ENTITIES ═══\n';
    Object.entries(entities).forEach(([bucket, vals]) => {
      const count = Object.keys(vals).length;
      const top = Object.entries(vals).sort((a, b) => b[1] - a[1]).slice(0, 5);
      content += `\n${bucket}: ${count} unique values\n`;
      top.forEach(([val, cnt]) => { content += `  - ${val} (${cnt}×)\n`; });
    });

    return content;
  }, [generateSummaryReport]);

  const generateHtmlReport = useCallback((file, fileName) => {
    const lc = file.levelCounts || {};
    const total = Object.values(lc).reduce((a, b) => a + b, 0) || 1;
    const patterns = (file.patterns || []).slice(0, 15);
    const entities = file.entities || {};
    const errPct = ((lc.error || 0) / total * 100).toFixed(1);
    const warnPct = ((lc.warn || 0) / total * 100).toFixed(1);
    const infoPct = ((lc.info || 0) / total * 100).toFixed(1);
    return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Lograke Report - ${escapeHtml(fileName)}</title>
<style>
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;margin:40px;color:#1a1a2e;background:#fafafa}
h1{color:#2d3748;border-bottom:2px solid #6366f1;padding-bottom:8px}
h2{color:#4a5568;margin-top:32px}
.kpi{display:grid;grid-template-columns:repeat(4,1fr);gap:16px;margin:20px 0}
.kpi-card{background:#fff;padding:20px;border-radius:8px;box-shadow:0 1px 3px rgba(0,0,0,.1);text-align:center}
.kpi-value{font-size:28px;font-weight:700;margin:8px 0}
.kpi-label{font-size:12px;color:#718096;text-transform:uppercase}
.bar{height:20px;border-radius:4px;margin:4px 0}
table{width:100%;border-collapse:collapse;margin:12px 0}
th,td{padding:8px 12px;text-align:left;border-bottom:1px solid #e2e8f0;font-size:13px}
th{background:#f7fafc;font-weight:600}
.level-error{color:#dc2626}.level-warn{color:#d97706}.level-info{color:#16a34a}.level-debug{color:#6b7280}
</style></head><body>
<h1>Lograke Analysis Report</h1>
<p>File: <strong>${escapeHtml(fileName)}</strong> | Generated: ${new Date().toLocaleString()} | Health Score: <strong>${file.healthScore ?? 'N/A'}/100</strong></p>
<div class="kpi">
<div class="kpi-card"><div class="kpi-label">Total Lines</div><div class="kpi-value">${(file.linesCount || 0).toLocaleString()}</div></div>
<div class="kpi-card"><div class="kpi-label">Errors</div><div class="kpi-value level-error">${(lc.error || 0).toLocaleString()}</div><div class="kpi-label">${escapeHtml(errPct)}%</div></div>
<div class="kpi-card"><div class="kpi-label">Warnings</div><div class="kpi-value level-warn">${(lc.warn || 0).toLocaleString()}</div><div class="kpi-label">${escapeHtml(warnPct)}%</div></div>
<div class="kpi-card"><div class="kpi-label">Patterns</div><div class="kpi-value">${(file.patterns || []).length}</div></div>
</div>
<h2>Level Distribution</h2>
<div class="bar" style="background:#dc2626;width:${escapeHtml(errPct)}%;opacity:0.8" title="Errors: ${escapeHtml(errPct)}%"></div>
<div class="bar" style="background:#d97706;width:${escapeHtml(warnPct)}%;opacity:0.8" title="Warnings: ${escapeHtml(warnPct)}%"></div>
<div class="bar" style="background:#16a34a;width:${escapeHtml(infoPct)}%;opacity:0.8" title="Info: ${escapeHtml(infoPct)}%"></div>
<h2>Top Patterns</h2>
<table><thead><tr><th>#</th><th>Level</th><th>Count</th><th>%</th><th>Template</th></tr></thead><tbody>
${patterns.map((p, i) => `<tr><td>${i + 1}</td><td class="level-${escapeHtml(p.level.toLowerCase())}">${escapeHtml(p.level)}</td><td>${p.count.toLocaleString()}</td><td>${p.percentage || ''}%</td><td style="font-family:monospace;font-size:11px;max-width:400px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(p.template.substring(0, 100))}</td></tr>`).join('\n')}
</tbody></table>
${Object.keys(entities).length ? `<h2>Entity Summary</h2><table><thead><tr><th>Type</th><th>Unique Values</th><th>Top Value</th></tr></thead><tbody>
${Object.entries(entities).map(([bucket, vals]) => {
  const keys = Object.keys(vals);
  const top = Object.entries(vals).sort((a, b) => b[1] - a[1])[0];
  return `<tr><td>${escapeHtml(bucket)}</td><td>${keys.length}</td><td style="font-family:monospace;font-size:11px">${top ? escapeHtml(top[0].substring(0, 50)) : '—'} ${top ? `(${top[1]}×)` : ''}</td></tr>`;
}).join('\n')}
</tbody></table>` : ''}
<p style="margin-top:32px;color:#a0aec0;font-size:12px">Generated by Lograke Enterprise Log Analyzer</p>
</body></html>`;
  }, []);

  const downloadExportFile = useCallback((format) => {
    const anchor = document.createElement('a');
    anchor.href = `${API_BASE}/logs/${fileId}/export?format=${format}`;
    anchor.target = '_blank';
    anchor.rel = 'noopener noreferrer';
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
  }, [fileId]);

  const handleGenerateReport = useCallback(async (reportType) => {
    if (!fileId) {
      setMessage('Please select a log file first.');
      return;
    }
    setGenerating(reportType);
    setMessage(`Generating ${reportType} report…`);

    try {
      const res = await fetch(`${API_BASE}/logs/${fileId}/metadata`, { credentials: 'include' });
      if (!res.ok) throw new Error('Failed to fetch file metadata');
      const data = await res.json();
      const file = data.metadata;
      const fileName = file.name.replace(/\.[^/.]+$/, '');

      if (reportType === 'csv' || reportType === 'json') {
        downloadExportFile(reportType);
        setMessage(`${reportType.toUpperCase()} export started.`);
        setReports(prev => [...prev, {
          id: Date.now(), type: reportType,
          fileName: `${fileName}_${reportType}.${reportType === 'csv' ? 'csv' : 'json'}`,
          timestamp: new Date().toLocaleString(), size: 'server-side'
        }]);
        return;
      }

      let content, mimeType, extension;
      switch (reportType) {
        case 'summary':
          content = generateSummaryReport(file, fileName);
          mimeType = 'text/plain'; extension = 'txt';
          break;
        case 'detailed':
          content = generateDetailedReport(file, fileName);
          mimeType = 'text/plain'; extension = 'txt';
          break;
        case 'html':
          content = generateHtmlReport(file, fileName);
          mimeType = 'text/html'; extension = 'html';
          break;
        default: throw new Error('Unknown report type');
      }

      downloadFile(content, `${fileName}_${reportType}.${extension}`, mimeType);
      setMessage(`${reportType} report downloaded successfully.`);
      setReports(prev => [...prev, {
        id: Date.now(), type: reportType,
        fileName: `${fileName}_${reportType}.${extension}`,
        timestamp: new Date().toLocaleString(),
        size: `${(content.length / 1024).toFixed(2)} KB`,
        content
      }]);
    } catch (err) {
      setMessage(`Error: ${err.message}`);
    } finally {
      setGenerating(null);
    }
  }, [fileId, downloadExportFile, generateDetailedReport, generateHtmlReport, generateSummaryReport]);

  const handlePreview = useCallback((report) => {
    if (report.content) {
      setPreviewContent(report.content);
      setPreviewType(report.type);
    }
  }, []);

  const handleQuickPreview = useCallback(async (reportType) => {
    if (!fileId) { setMessage('Please select a log file first.'); return; }
    setGenerating(reportType);
    setMessage(`Generating ${reportType} preview…`);
    try {
      const res = await fetch(`${API_BASE}/logs/${fileId}/metadata`, { credentials: 'include' });
      if (!res.ok) throw new Error('Failed to fetch file metadata');
      const data = await res.json();
      const file = data.metadata;
      const fileName = file.name.replace(/\.[^/.]+$/, '');
      let content;
      switch (reportType) {
        case 'summary':
          content = generateSummaryReport(file, fileName);
          break;
        case 'detailed':
          content = generateDetailedReport(file, fileName);
          break;
        case 'html':
          content = generateHtmlReport(file, fileName);
          break;
        default: throw new Error('Unsupported preview type');
      }
      setPreviewContent(content);
      setPreviewType(reportType);
      setMessage('');
    } catch (err) {
      setMessage(`Error: ${err.message}`);
    } finally {
      setGenerating(null);
    }
  }, [fileId, generateDetailedReport, generateHtmlReport, generateSummaryReport]);

  return (
    <div className="reports-layout">
      <div className="section-header">
        <div>
          <h1>Reports & Export</h1>
          <p>Generate analysis reports and export log data for external processing.</p>
        </div>
      </div>

      {message && (
        <div className={`reports-message ${message.includes('Error') ? 'error' : 'success'}`}>
          {message}
        </div>
      )}

      <div className="reports-grid">
        {REPORT_TYPES.map(report => (
          <div key={report.id} className="card-elevated reports-type-card">
            <div className="reports-type-icon">{report.icon}</div>
            <div style={{ flex: 1 }}>
              <h3 style={{ marginBottom: '6px' }}>{report.label}</h3>
              <p className="reports-type-desc">{report.desc}</p>
            </div>
            <div style={{ display: 'flex', gap: '6px' }}>
              <button
                className="btn btn-primary"
                onClick={() => handleGenerateReport(report.id)}
                disabled={!fileId || generating !== null}
                style={{ fontSize: '12px', flex: 1 }}
              >
                {generating === report.id ? 'Generating…' : 'Download'}
              </button>
              {(report.id === 'summary' || report.id === 'detailed' || report.id === 'html') && (
                <button
                  className="btn btn-secondary"
                  onClick={() => handleQuickPreview(report.id)}
                  disabled={!fileId || generating !== null}
                  style={{ fontSize: '12px', padding: '6px 10px' }}
                  title="Preview"
                >
                  <Eye size={14} />
                </button>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Preview Panel */}
      {previewContent && (
        <div className="card-elevated reports-recent-card">
          <div className="flex-between" style={{ marginBottom: '12px' }}>
            <h3>Report Preview</h3>
            <button className="btn btn-secondary" onClick={() => setPreviewContent(null)} style={{ fontSize: '12px' }}>Close</button>
          </div>
          {previewType === 'html' ? (
            <iframe
              srcDoc={previewContent}
              sandbox="allow-same-origin"
              style={{ width: '100%', height: '600px', border: '1px solid var(--border-default)', borderRadius: 'var(--radius-md)', background: '#fff' }}
              title="HTML Report Preview"
            />
          ) : (
            <pre style={{ fontSize: '12px', fontFamily: 'var(--font-mono)', background: 'var(--bg-inset)', padding: '16px', borderRadius: 'var(--radius-md)', maxHeight: '500px', overflow: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-word', color: 'var(--text-primary)' }}>
              {previewContent}
            </pre>
          )}
        </div>
      )}

      {reports.length > 0 && (
        <div className="card-elevated reports-recent-card">
          <h3 style={{ marginBottom: '16px' }}>Recent Reports</h3>
          <div className="reports-recent-list">
            {reports.map(report => (
              <div key={report.id} className="reports-recent-item">
                <div style={{ flex: 1 }}>
                  <div className="reports-recent-name">{report.fileName}</div>
                  <div className="reports-recent-meta">
                    <Clock size={12} style={{ verticalAlign: 'middle', marginRight: '4px' }} />
                    {report.timestamp} · {report.size}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: '6px' }}>
                  {report.content && (
                    <button
                      className="btn btn-secondary"
                      onClick={() => handlePreview(report)}
                      style={{ fontSize: '12px', padding: '6px 10px' }}
                    >
                      <Eye size={14} />
                    </button>
                  )}
                  <button
                    className="btn btn-secondary"
                    onClick={() => {
                      if (report.type === 'csv' || report.type === 'json') {
                        downloadExportFile(report.type);
                      } else {
                        handleGenerateReport(report.type);
                      }
                    }}
                    style={{ fontSize: '12px', padding: '6px 10px' }}
                  >
                    <Download size={14} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
