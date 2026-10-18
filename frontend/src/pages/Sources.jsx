import { useState, useEffect, useCallback } from 'react';
import { API_BASE } from '../config';
import { useModal } from '../context/ModalContext';
import { Webhook, Radio, Globe, Plus, Play, Square, Trash2, Copy, Check, Loader2, Server, Terminal, BookOpen, FolderOpen, Download } from 'lucide-react';

const SOURCE_TYPES = {
  webhook: { icon: Webhook, label: 'Webhook', color: 'var(--color-info)', desc: 'Push events from apps & CI systems via HTTP' },
  syslog: { icon: Radio, label: 'Syslog Listener', color: 'var(--color-warning)', desc: 'Receive syslog from servers & network devices' },
  http_poll: { icon: Globe, label: 'HTTP Poll', color: 'var(--color-accent)', desc: 'Pull logs from a remote URL on a schedule' },
  sftp: { icon: Server, label: 'SFTP Pull', color: 'var(--color-success)', desc: 'Fetch log files over SFTP periodically' }
};

export default function Sources() {
  const { showAlert } = useModal();
  const [sources, setSources] = useState([]);
  const [serverUrl, setServerUrl] = useState('');
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [showInstructions, setShowInstructions] = useState(null);
  const [formData, setFormData] = useState({ name: '', type: 'webhook', config: {} });
  const [actionLoading, setActionLoading] = useState(null);
  const [copyFeedback, setCopyFeedback] = useState({});
  const [sftpBrowser, setSftpBrowser] = useState(null);
  const [sftpFiles, setSftpFiles] = useState([]);
  const [sftpBrowsing, setSftpBrowsing] = useState(false);
  const [sftpImporting, setSftpImporting] = useState(null);

  const openSftpBrowser = async (source) => {
    setSftpBrowser(source);
    setSftpBrowsing(true);
    setSftpFiles([]);
    try {
      const res = await fetch(`${API_BASE}/log-sources/${source.id}/sftp-list`, { method: 'POST' });
      const data = await res.json();
      if (data.success) setSftpFiles(data.files || []);
      else showAlert(data.error || 'Failed to list files', 'Error', 'error');
    } catch (err) {
      showAlert(err.message, 'Error', 'error');
    } finally {
      setSftpBrowsing(false);
    }
  };

  const importSftpFile = async (source, fileName) => {
    setSftpImporting(fileName);
    try {
      const res = await fetch(`${API_BASE}/log-sources/${source.id}/sftp-ingest`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileName })
      });
      const data = await res.json();
      if (data.success) {
        showAlert(`Imported "${fileName}" — ${data.linesIngested} lines`, 'Import Complete');
        await fetchSources();
      } else {
        showAlert(data.error || 'Import failed', 'Error', 'error');
      }
    } catch (err) {
      showAlert(err.message, 'Error', 'error');
    } finally {
      setSftpImporting(null);
    }
  };

  const formatSize = (bytes) => {
    if (!bytes) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB'];
    let i = 0;
    let size = bytes;
    while (size >= 1024 && i < units.length - 1) { size /= 1024; i++; }
    return size.toFixed(1) + ' ' + units[i];
  };

  const formatTime = (ts) => {
    if (!ts) return '—';
    const d = new Date(ts * 1000);
    return d.toLocaleString();
  };

  const fetchSources = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/log-sources`);
      const data = await res.json();
      if (data.success) {
        setSources(data.sources || []);
        setServerUrl(data.serverUrl || '');
      }
    } catch (err) {
      console.error('Failed to fetch sources', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchSources(); }, [fetchSources]);

  const handleCreate = async () => {
    if (!formData.name.trim()) { showAlert('Source name required', 'Validation', 'warn'); return; }
    setActionLoading('create');
    try {
      const config = { ...formData.config };
      if (formData.type === 'syslog') {
        config.port = parseInt(config.port, 10) || 1514;
        config.protocol = config.protocol || 'udp';
      }
      if (formData.type === 'http_poll') {
        config.intervalSeconds = parseInt(config.intervalSeconds, 10) || 60;
      }
      if (formData.type === 'sftp') {
        config.port = parseInt(config.port, 10) || 22;
        config.intervalSeconds = parseInt(config.intervalSeconds, 10) || 60;
        config.filePattern = config.filePattern || '*.log';
        config.deleteAfterDownload = config.deleteAfterDownload === true;
      }
      const res = await fetch(`${API_BASE}/log-sources`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: formData.name, type: formData.type, config })
      });
      const data = await res.json();
      if (data.success) {
        showAlert(`Source "${formData.name}" created`, 'Source Created');
        setShowForm(false);
        setFormData({ name: '', type: 'webhook', config: {} });
        await fetchSources();
      } else {
        showAlert(data.error || 'Failed to create', 'Error', 'error');
      }
    } catch (err) {
      showAlert(err.message, 'Error', 'error');
    } finally {
      setActionLoading(null);
    }
  };

  const handleDelete = async (id) => {
    setActionLoading(id);
    try {
      const res = await fetch(`${API_BASE}/log-sources/${id}`, { method: 'DELETE' });
      const data = await res.json();
      if (data.success) {
        showAlert('Source deleted', 'Deleted');
        await fetchSources();
      }
    } catch (err) {
      showAlert(err.message, 'Error', 'error');
    } finally {
      setActionLoading(null);
    }
  };

  const handleToggle = async (source) => {
    const id = source.id;
    setActionLoading(id);
    try {
      const action = source.running ? 'stop' : 'start';
      const res = await fetch(`${API_BASE}/log-sources/${id}/${action}`, { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        showAlert(`Source ${action}ed`, action === 'start' ? 'Started' : 'Stopped');
        await fetchSources();
      } else {
        showAlert(data.error || `Failed to ${action}`, 'Error', 'error');
      }
    } catch (err) {
      showAlert(err.message, 'Error', 'error');
    } finally {
      setActionLoading(null);
    }
  };

  const copyToClipboard = async (text, key) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopyFeedback(prev => ({ ...prev, [key]: true }));
      setTimeout(() => setCopyFeedback(prev => ({ ...prev, [key]: false })), 2000);
    } catch { /* clipboard write not supported */ }
  };

  const getConfigForm = () => {
    switch (formData.type) {
      case 'syslog':
        return (
          <>
            <div className="form-row">
              <label>Port</label>
              <input type="number" className="input-text" value={formData.config.port || 1514}
                onChange={e => setFormData(f => ({ ...f, config: { ...f.config, port: e.target.value } }))} />
            </div>
            <div className="form-row">
              <label>Protocol</label>
              <select className="input-select" value={formData.config.protocol || 'udp'}
                onChange={e => setFormData(f => ({ ...f, config: { ...f.config, protocol: e.target.value } }))}>
                <option value="udp">UDP</option>
                <option value="tcp">TCP</option>
                <option value="both">Both UDP + TCP</option>
              </select>
            </div>
          </>
        );
      case 'http_poll':
        return (
          <>
            <div className="form-row">
              <label>URL</label>
              <input type="url" className="input-text" placeholder="https://example.com/logs"
                value={formData.config.url || ''}
                onChange={e => setFormData(f => ({ ...f, config: { ...f.config, url: e.target.value } }))} />
            </div>
            <div className="form-row">
              <label>Poll Interval (seconds)</label>
              <input type="number" className="input-text" value={formData.config.intervalSeconds || 60}
                onChange={e => setFormData(f => ({ ...f, config: { ...f.config, intervalSeconds: e.target.value } }))} />
            </div>
            <div className="form-row">
              <label>Auth Type</label>
              <select className="input-select" value={formData.config.authType || 'none'}
                onChange={e => setFormData(f => ({ ...f, config: { ...f.config, authType: e.target.value, authValue: '' } }))}>
                <option value="none">None</option>
                <option value="basic">Basic Auth (user:pass)</option>
                <option value="bearer">Bearer Token</option>
              </select>
            </div>
            {formData.config.authType !== 'none' && (
              <div className="form-row">
                <label>{formData.config.authType === 'basic' ? 'Username:Password' : 'Token'}</label>
                <input type="password" className="input-text" value={formData.config.authValue || ''}
                  onChange={e => setFormData(f => ({ ...f, config: { ...f.config, authValue: e.target.value } }))} />
              </div>
            )}
          </>
        );
      case 'sftp':
        return (
          <>
            <div className="form-row">
              <label>Host</label>
              <input type="text" className="input-text" placeholder="e.g. 10.2.37.14"
                value={formData.config.host || ''}
                onChange={e => setFormData(f => ({ ...f, config: { ...f.config, host: e.target.value } }))} />
            </div>
            <div className="form-row">
              <label>Port</label>
              <input type="number" className="input-text" value={formData.config.port || 22}
                onChange={e => setFormData(f => ({ ...f, config: { ...f.config, port: e.target.value } }))} />
            </div>
            <div className="form-row">
              <label>Username</label>
              <input type="text" className="input-text" placeholder="sftp username"
                value={formData.config.username || ''}
                onChange={e => setFormData(f => ({ ...f, config: { ...f.config, username: e.target.value } }))} />
            </div>
            <div className="form-row">
              <label>Password</label>
              <input type="password" className="input-text" placeholder="sftp password"
                value={formData.config.password || ''}
                onChange={e => setFormData(f => ({ ...f, config: { ...f.config, password: e.target.value } }))} />
            </div>
            <div className="form-row">
              <label>Remote Path</label>
              <input type="text" className="input-text" placeholder="/var/log/app"
                value={formData.config.remotePath || ''}
                onChange={e => setFormData(f => ({ ...f, config: { ...f.config, remotePath: e.target.value } }))} />
            </div>
            <div className="form-row">
              <label>File Pattern</label>
              <input type="text" className="input-text" placeholder="*.log"
                value={formData.config.filePattern || '*.log'}
                onChange={e => setFormData(f => ({ ...f, config: { ...f.config, filePattern: e.target.value } }))} />
            </div>
            <div className="form-row">
              <label>Poll Interval (seconds)</label>
              <input type="number" className="input-text" value={formData.config.intervalSeconds || 60}
                onChange={e => setFormData(f => ({ ...f, config: { ...f.config, intervalSeconds: e.target.value } }))} />
            </div>
            <div className="form-row check-row">
              <input type="checkbox" id="delAfter"
                checked={formData.config.deleteAfterDownload || false}
                onChange={e => setFormData(f => ({ ...f, config: { ...f.config, deleteAfterDownload: e.target.checked } }))} />
              <label htmlFor="delAfter">Delete remote files after download</label>
            </div>
          </>
        );
      default:
        return null;
    }
  };

  const renderSourceActions = (source) => {
    const TypeIcon = SOURCE_TYPES[source.type]?.icon || Webhook;
    const isRunning = source.running;
    const isLoading = actionLoading === source.id;
    const showingInstructions = showInstructions === source.id;

    return (
      <div key={source.id} className="source-card" data-type={source.type}>
        <div className="source-card-head">
          <div className="source-card-type-icon">
            <TypeIcon size={18} style={{ color: SOURCE_TYPES[source.type]?.color }} />
          </div>
          <div className="source-card-meta">
            <div className="source-card-title">{source.name}</div>
            <div className="source-card-subtitle">{SOURCE_TYPES[source.type]?.label || source.type}</div>
          </div>
          <span className={`source-status ${isRunning ? 'on' : 'off'}`}>
            <span className="source-status-dot" />
            {isRunning ? 'Active' : 'Inactive'}
          </span>
        </div>

        <div className="source-card-body">
          {source.type === 'webhook' && (
            <div className="source-webhook-box">
              {isRunning ? (
                <>
                  <div style={{ fontSize: '10px', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Webhook URL</div>
                  <div className="source-webhook-row">
                    <code>{source.config?.webhookUrl || '—'}</code>
                    <button className="btn btn-ghost btn-icon" onClick={() => copyToClipboard(source.config?.webhookUrl || '', `url_${source.id}`)} title="Copy URL">
                      {copyFeedback[`url_${source.id}`] ? <Check size={14} /> : <Copy size={14} />}
                    </button>
                  </div>
                  <div style={{ fontSize: '10px', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>API Key</div>
                  <div className="source-webhook-row">
                    <code>{source.config?.apiKey || '—'}</code>
                    <button className="btn btn-ghost btn-icon" onClick={() => copyToClipboard(source.config?.apiKey || '', `key_${source.id}`)} title="Copy API Key">
                      {copyFeedback[`key_${source.id}`] ? <Check size={14} /> : <Copy size={14} />}
                    </button>
                  </div>
                </>
              ) : (
                <div style={{ color: 'var(--text-muted)', fontSize: '13px' }}>
                  Start this source to reveal the webhook URL and API key.
                </div>
              )}
            </div>
          )}
          {source.type === 'syslog' && (
            <div className="source-detail">
              <Radio size={14} className="source-detail-icon" />
              <span className="source-detail-text">Listening on port {source.config?.port || 1514} ({source.config?.protocol || 'udp'})</span>
            </div>
          )}
          {source.type === 'http_poll' && (
            <>
              <div className="source-detail">
                <Globe size={14} className="source-detail-icon" />
                <span className="source-detail-text">{source.config?.url || '—'}</span>
              </div>
              <div className="source-stats-row">
                <span className="source-stat-chip">Every <strong>{source.config?.intervalSeconds || 60}s</strong></span>
              </div>
            </>
          )}
          {source.type === 'sftp' && (
            <>
              <div className="source-detail">
                <Server size={14} className="source-detail-icon" />
                <span className="source-detail-text">{source.config?.username}@{source.config?.host}:{source.config?.port || 22}</span>
              </div>
              <div className="source-stats-row">
                <span className="source-stat-chip">{source.config?.remotePath || '/'}</span>
                <span className="source-stat-chip">{source.config?.filePattern || '*.log'}</span>
                <span className="source-stat-chip">Every <strong>{source.config?.intervalSeconds || 60}s</strong></span>
              </div>
              <div className="source-stats-row">
                <span className="source-stat-chip"><strong>{source.stats?.filesDownloaded || 0}</strong> files</span>
                <span className="source-stat-chip"><strong>{source.stats?.linesIngested || 0}</strong> lines</span>
                {source.stats?.errors > 0 && (
                  <span className="source-stat-chip error"><strong>{source.stats.errors}</strong> errors</span>
                )}
              </div>
              {source.stats?.lastError && (
                <div className="source-error-msg">Last error: {source.stats.lastError}</div>
              )}
            </>
          )}
          {source.errorMessage && (
            <div className="source-error-msg">{source.errorMessage}</div>
          )}
        </div>

        <div className="source-card-actions">
          <button className="btn btn-sm btn-secondary" onClick={() => handleToggle(source)} disabled={isLoading}>
            {isLoading ? <Loader2 size={12} className="animate-spin" /> : isRunning ? <Square size={12} /> : <Play size={12} />}
            {isRunning ? ' Stop' : ' Start'}
          </button>
          <button className="btn btn-sm btn-secondary" onClick={() => handleDelete(source.id)} disabled={isLoading}>
            <Trash2 size={12} /> Delete
          </button>
          {source.type === 'sftp' && (
            <button className="btn btn-sm btn-primary" onClick={() => openSftpBrowser(source)}>
              <FolderOpen size={12} /> Browse
            </button>
          )}
          {source.instructions && source.type !== 'sftp' && (
            <button className="btn btn-sm btn-secondary" onClick={() => setShowInstructions(showingInstructions ? null : source.id)}>
              <Terminal size={12} /> Setup
            </button>
          )}
        </div>

        {/* Setup Instructions */}
        {showingInstructions && source.instructions && (
          <div className="source-setup">
            <div className="source-setup-title">Connection Setup</div>
            {source.type === 'webhook' && (
              <>
                <div className="source-setup-block">
                  <div className="source-setup-block-title"><Terminal size={13} /> cURL (one-time test)</div>
                  <pre className="source-setup-code">{source.instructions.curl}</pre>
                  <button className="btn btn-ghost btn-icon" onClick={() => copyToClipboard(source.instructions.curl, `curl_${source.id}`)}>
                    {copyFeedback[`curl_${source.id}`] ? <Check size={13} /> : <Copy size={13} />} Copy
                  </button>
                </div>
                <div className="source-setup-block">
                  <div className="source-setup-block-title"><BookOpen size={13} /> rsyslog config (add to /etc/rsyslog.conf)</div>
                  <pre className="source-setup-code">{source.instructions.rsyslog}</pre>
                  <button className="btn btn-ghost btn-icon" onClick={() => copyToClipboard(source.instructions.rsyslog, `rsyslog_${source.id}`)}>
                    {copyFeedback[`rsyslog_${source.id}`] ? <Check size={13} /> : <Copy size={13} />} Copy
                  </button>
                </div>
              </>
            )}
            {source.type === 'sftp' && (
              <div className="source-setup-block">
                <div className="source-setup-block-title"><Server size={13} /> Connection Info</div>
                <pre className="source-setup-code">{source.instructions.manual}</pre>
              </div>
            )}
            {source.type === 'syslog' && (
              <>
                <div className="source-setup-block">
                  <div className="source-setup-block-title"><Terminal size={13} /> rsyslog forward config</div>
                  <pre className="source-setup-code">{source.instructions.rsyslog}</pre>
                  <button className="btn btn-ghost btn-icon" onClick={() => copyToClipboard(source.instructions.rsyslog, `rsyslog_${source.id}`)}>
                    {copyFeedback[`rsyslog_${source.id}`] ? <Check size={13} /> : <Copy size={13} />} Copy
                  </button>
                </div>
                <div className="source-setup-block">
                  <div className="source-setup-block-title"><BookOpen size={13} /> syslog-ng config</div>
                  <pre className="source-setup-code">{source.instructions.syslogng}</pre>
                  <button className="btn btn-ghost btn-icon" onClick={() => copyToClipboard(source.instructions.syslogng, `syslogng_${source.id}`)}>
                    {copyFeedback[`syslogng_${source.id}`] ? <Check size={13} /> : <Copy size={13} />} Copy
                  </button>
                </div>
              </>
            )}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="sources-layout">
      <div className="section-header">
        <div>
          <h1>Log Source Connections</h1>
          <p>Connect to external log sources via webhooks, syslog, HTTP polling, or SFTP.</p>
        </div>
        <div className="section-header-actions">
          <button className="btn btn-primary flex-gap-2" onClick={() => setShowForm(true)}>
            <Plus size={16} /> Add Source
          </button>
        </div>
      </div>

      {/* Server URL Banner */}
      {serverUrl && (
        <div className="server-url-banner">
          <div className="server-url-banner-icon">
            <Server size={18} />
          </div>
          <div className="server-url-banner-body">
            <div className="server-url-banner-label">Your Lograke Server Address</div>
            <div className="server-url-banner-value">{serverUrl}</div>
            <div className="server-url-banner-hint">
              Make sure your external servers can reach this address. Firewalls must allow traffic on port {new URL(serverUrl).port || '5000'}.
            </div>
          </div>
          <button className="btn btn-ghost btn-icon" onClick={() => copyToClipboard(serverUrl, 'serverUrl')} title="Copy server URL">
            {copyFeedback['serverUrl'] ? <Check size={14} /> : <Copy size={14} />}
          </button>
        </div>
      )}

      {loading ? (
        <div className="sources-loading">
          <div className="loading-spinner" />
          <div style={{ fontSize: '14px' }}>Loading sources…</div>
        </div>
      ) : sources.length === 0 ? (
        <div className="sources-empty">
          <div className="sources-empty-icon">
            <Webhook size={26} />
          </div>
          <h3>No log sources configured</h3>
          <p>Add a webhook endpoint, syslog listener, HTTP poll, or SFTP source to start ingesting live logs from your infrastructure.</p>
          <button className="btn btn-primary" onClick={() => setShowForm(true)}>
            <Plus size={16} /> Add Your First Source
          </button>
        </div>
      ) : (
        <>
          <div className="sources-stats">
            <div className="sources-stat">
              <div className="sources-stat-icon active">
                <Play size={16} />
              </div>
              <div>
                <div className="sources-stat-num">{sources.filter(s => s.running).length}</div>
                <div className="sources-stat-label">Active</div>
              </div>
            </div>
            <div className="sources-stat">
              <div className="sources-stat-icon total">
                <Server size={16} />
              </div>
              <div>
                <div className="sources-stat-num">{sources.length}</div>
                <div className="sources-stat-label">Total</div>
              </div>
            </div>
          </div>
          <div className="sources-grid">
            {sources.map(renderSourceActions)}
          </div>
        </>
      )}

      {/* SFTP File Browser Modal */}
      {sftpBrowser && (
        <div className="modal-overlay" onClick={() => setSftpBrowser(null)}>
          <div className="dialog-panel" style={{ maxWidth: 800, width: '95%' }} onClick={e => e.stopPropagation()}>
            <div className="sftp-browser-head">
              <div className="sftp-browser-head-icon">
                <FolderOpen size={18} />
              </div>
              <h3>{sftpBrowser.name}</h3>
            </div>
            <div className="sftp-browser-sub">
              {sftpBrowser.config?.username}@{sftpBrowser.config?.host}:{sftpBrowser.config?.port || 22}
              {' · '}
              {sftpBrowser.config?.remotePath || '/'}
            </div>

            {sftpBrowsing ? (
              <div className="sftp-browser-loading">
                <Loader2 size={24} className="animate-spin" />
                <div className="load-label">Connecting to SFTP server…</div>
              </div>
            ) : sftpFiles.length === 0 ? (
              <div className="sftp-browser-empty">No log files found at this path.</div>
            ) : (
              <div className="sftp-file-list">
                {sftpFiles.map(file => (
                  <div key={file.name} className="sftp-file-row">
                    <div>
                      <div className="sftp-file-name">{file.name}</div>
                      <div className="sftp-file-meta">
                        <span>{formatSize(file.size)}</span>
                        <span>·</span>
                        <span>{formatTime(file.modifyTime)}</span>
                      </div>
                    </div>
                    <button
                      className="btn btn-sm btn-primary"
                      onClick={() => importSftpFile(sftpBrowser, file.name)}
                      disabled={sftpImporting === file.name}
                    >
                      {sftpImporting === file.name ? (
                        <><Loader2 size={12} className="animate-spin" /> Importing…</>
                      ) : (
                        <><Download size={12} /> Import</>
                      )}
                    </button>
                  </div>
                ))}
              </div>
            )}

            <div className="sftp-browser-close">
              <button className="btn btn-secondary" onClick={() => setSftpBrowser(null)}>Close</button>
            </div>
          </div>
        </div>
      )}

      {showForm && (
        <div className="modal-overlay" onClick={() => setShowForm(false)}>
          <div className="dialog-panel" style={{ maxWidth: 620, width: '95%' }} onClick={e => e.stopPropagation()}>
            <div className="src-modal-head">
              <div className="src-modal-icon"><Webhook size={20} /></div>
              <div>
                <h3 className="src-modal-title">Add Log Source</h3>
                <p className="src-modal-sub">Choose how logs will reach LogRake, then configure the connection.</p>
              </div>
            </div>

            <div className="src-type-grid" role="radiogroup" aria-label="Source type">
              {Object.entries(SOURCE_TYPES).map(([type, meta]) => {
                const TypeIcon = meta.icon;
                return (
                  <button
                    key={type}
                    type="button"
                    role="radio"
                    aria-checked={formData.type === type}
                    className={`src-type-card${formData.type === type ? ' selected' : ''}`}
                    onClick={() => setFormData(f => ({ ...f, type, config: {} }))}
                  >
                    <span className="src-type-icon" style={{ color: meta.color }}><TypeIcon size={18} /></span>
                    <span className="src-type-label">{meta.label}</span>
                    <span className="src-type-desc">{meta.desc}</span>
                  </button>
                );
              })}
            </div>

            <div className="form-row">
              <label>Source Name</label>
              <input type="text" className="input-text" placeholder="e.g. Production Web Servers"
                value={formData.name}
                onChange={e => setFormData(f => ({ ...f, name: e.target.value }))} />
            </div>
            {getConfigForm()}
            <div className="form-actions">
              <button className="btn btn-secondary" onClick={() => setShowForm(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={handleCreate} disabled={actionLoading === 'create'}>
                {actionLoading === 'create' ? <><Loader2 size={14} className="animate-spin" /> Creating…</> : 'Create Source'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
