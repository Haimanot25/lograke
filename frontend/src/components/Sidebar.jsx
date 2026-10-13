import { memo, useState, useCallback } from 'react';
import { NavIcons } from './Icons';
import ThemeSwitcher from './ThemeSwitcher';
import { LogOut, Trash2, ChevronLeft, ChevronRight, ServerCrash } from 'lucide-react';
import { API_BASE } from '../config';
import { useFileContext } from '../context/FileContext';
import { useUI } from '../context/UIContext';
import { useAuth } from '../context/AuthContext';
import { useModal } from '../context/ModalContext';
import { useNavigate, useLocation } from 'react-router-dom';

const navGroups = [
  {
    id: 'main', label: 'Main',
    items: (files) => [
      { tab: 'upload', icon: NavIcons.upload, label: 'Upload', desc: 'Ingest log files' },
      { tab: 'sources', icon: NavIcons.livetail, label: 'Connections', desc: 'External sources' },
      ...(files.length > 0 ? [
        { tab: 'dashboard', icon: NavIcons.dashboard, label: 'Dashboard', desc: 'Key metrics overview' },
        { tab: 'livetail', icon: NavIcons.livetail, label: 'Live Tail', desc: 'Streaming log feed' },
        { tab: 'explorer', icon: NavIcons.explorer, label: 'Explorer', desc: 'Deep search & filter' },
      ] : []),
    ],
  },
  {
    id: 'analysis', label: 'Analysis',
    show: (files) => files.length > 0,
    items: () => [
      { tab: 'observability', icon: NavIcons.observability, label: 'Observability', desc: 'Entity correlation' },
      { tab: 'patterns', icon: NavIcons.patterns, label: 'Patterns', desc: 'Recurring templates' },
      { tab: 'statistics', icon: NavIcons.statistics, label: 'Statistics', desc: 'Detailed metrics' },
      { tab: 'comparison', icon: NavIcons.comparison, label: 'Comparison', desc: 'Diff analysis' },
      { tab: 'reports', icon: NavIcons.reports, label: 'Reports', desc: 'Export & share' },
    ],
  },
  {
    id: 'admin', label: 'Admin',
    items: (files) => [
      { tab: 'settings', icon: NavIcons.settings, label: 'Settings', desc: 'Configuration' },
      ...(files.length > 0 ? [
        { tab: 'alerts', icon: NavIcons.alerts, label: 'Alerts', desc: 'Rule-based monitoring' },
        { tab: 'graph', icon: NavIcons.graph, label: 'Graph', desc: 'Visualization' },
        { tab: 'parser', icon: NavIcons.parser, label: 'Parser', desc: 'Custom parsing' },
      ] : []),
      { tab: 'health', icon: NavIcons.health, label: 'Health', desc: 'System status' },
    ],
  },
];

function NavItem({ item, isActive, onClick, collapsed }) {
  const Icon = item.icon;
  const handleKey = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); } };
  if (collapsed) {
    return (
      <div className="sb-item-c" onClick={onClick} title={item.label} role="button" tabIndex={0} onKeyDown={handleKey}>
        <div className="sb-item-c-icon"><Icon size={18} /></div>
        <div className="sb-item-c-tip">
          <span className="sb-item-c-tip-label">{item.label}</span>
          <span className="sb-item-c-tip-desc">{item.desc}</span>
        </div>
      </div>
    );
  }
  return (
    <div className={`sb-item${isActive ? ' active' : ''}`} onClick={onClick} role="button" tabIndex={0} onKeyDown={handleKey} aria-current={isActive ? 'page' : undefined}>
      <div className="sb-item-bar" />
      <div className={`sb-item-icon${isActive ? ' active' : ''}`}><Icon size={16} /></div>
      <div className="sb-item-body">
        <span className="sb-item-label">{item.label}</span>
        <span className="sb-item-desc">{item.desc}</span>
      </div>
    </div>
  );
}

function NavGroup({ group, files, activeTab, goTo, open, onToggle, collapsed }) {
  if (group.show && !group.show(files)) return null;
  const items = group.items(files);
  if (collapsed) {
    return (
      <div className="sb-grp-c">
        {items.map((item) => (
          <NavItem key={item.tab} item={item} isActive={activeTab === item.tab} onClick={() => goTo(item.tab)} collapsed />
        ))}
      </div>
    );
  }
  return (
    <div className="sb-grp">
      <button className="sb-grp-title" onClick={() => onToggle(group.id)} aria-expanded={open} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onToggle(group.id); } }}>
        <span>{group.label}</span>
        <svg className={`sb-grp-chev${open ? ' open' : ''}`} width="10" height="10" viewBox="0 0 10 10">
          <path d="M3 3.5L5 6.5L7 3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
        </svg>
      </button>
      <div className={`sb-grp-items${open ? '' : ' closed'}`}>
        {items.map((item) => (
          <NavItem key={item.tab} item={item} isActive={activeTab === item.tab} onClick={() => goTo(item.tab)} />
        ))}
      </div>
    </div>
  );
}

function Sidebar() {
  const { files, activeFileId, setActiveFileId, setSelectedFileDetail, setExplorerContext, fetchFiles } = useFileContext();
  const { sidebarCollapsed, setSidebarCollapsed, navGroups: groupsOpen, setNavGroups, backendStatus, theme, setTheme } = useUI();
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [sourceOpen, setSourceOpen] = useState(false);
  const activeTab = location.pathname.replace('/', '') || 'upload';
  const goTo = useCallback((tab) => navigate(`/${tab}`), [navigate]);
  const activeFile = files.find(f => f.id === activeFileId);
  const userInitial = user?.username?.charAt(0).toUpperCase() || '?';
  const { showAlert, showConfirm } = useModal();

  const handleClearServerCache = async () => {
    if (!await showConfirm('Clear server analysis cache?')) return;
    try {
      const res = await fetch(`${API_BASE}/logs/cache/clear`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fileId: activeFileId, clearParsed: true }) });
      if (res.ok) showAlert('Server cache cleared.', 'Cache Cleared');
      else showAlert('Failed to clear server cache.', 'Error', 'error');
    } catch (err) { showAlert(`Error: ${err.message}`, 'Error', 'error'); }
  };

  const handleClearLocalCache = async () => {
    if (!await showConfirm('Clear local UI caches?')) return;
    setSelectedFileDetail(null); setExplorerContext(null);
    showAlert('Local cache cleared.', 'Cache Cleared');
  };

  const handleDelete = async () => {
    if (!activeFileId) return;
    if (!window.confirm('Delete this source and all analysis data?')) return;
    const res = await fetch(`${API_BASE}/logs/${activeFileId}`, { method: 'DELETE' });
    if (res.ok) { setActiveFileId(''); fetchFiles(); }
  };

  return (
    <aside className={`sb${sidebarCollapsed ? ' collapsed' : ''}`}>
      {/* Brand */}
      <div className="sb-brand">
        <div className="sb-brand-logo">
          <svg width="28" height="28" viewBox="0 0 28 28" fill="none">
            <rect width="28" height="28" rx="7" fill="url(#sb-logo)" />
            <path d="M8 10h12M8 14h9M8 18h6" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" />
            <defs>
              <linearGradient id="sb-logo" x1="0" y1="0" x2="28" y2="28">
                <stop offset="0%" stopColor="#6366f1" />
                <stop offset="100%" stopColor="#a855f7" />
              </linearGradient>
            </defs>
          </svg>
        </div>
        {!sidebarCollapsed && (
          <div className="sb-brand-text">
            <span className="sb-brand-name">LogRake</span>
            <span className="sb-brand-badge">2.0</span>
          </div>
        )}
      </div>

      {/* Source Selector */}
      {files.length > 0 && !sidebarCollapsed && (
        <div className="sb-source">
          <div className="sb-source-head">
            <span className="sb-source-label">Active Source</span>
            <button className="sb-source-del" onClick={handleDelete} title="Remove source" aria-label="Remove source"><Trash2 size={11} /></button>
          </div>
          <div className="sb-source-sel" tabIndex={0} role="combobox" aria-expanded={sourceOpen} aria-label="Select active log source"
            onClick={() => setSourceOpen(!sourceOpen)}
            onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSourceOpen(s => !s); } }}
            onBlur={() => setTimeout(() => setSourceOpen(false), 180)}>
            <div className="sb-source-val">
              <ServerCrash size={14} />
              <span className="truncate">{activeFile?.name || 'Select'}</span>
              <svg className={`sb-sel-chev${sourceOpen ? ' open' : ''}`} width="10" height="10" viewBox="0 0 10 10">
                <path d="M3 3.5l2 3 2-3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" fill="none" />
              </svg>
            </div>
            {sourceOpen && (
              <div className="sb-source-dd">
                {files.map(f => (
                  <div key={f.id}
                    className={`sb-source-opt${f.id === activeFileId ? ' selected' : ''}`}
                    onClick={() => { setActiveFileId(f.id); setSourceOpen(false); }}>
                    <div className="sb-source-opt-marker"><div className={`dot ${f.id === activeFileId ? ' dot-accent' : ''}`} /></div>
                    <div className="sb-source-opt-info">
                      <span className="sb-source-opt-name">{f.name}</span>
                      <span className="sb-source-opt-meta">{f.linesCount?.toLocaleString()} lines</span>
                    </div>
                    {f.id === activeFileId && (
                      <svg width="14" height="14" viewBox="0 0 14 14"><path d="M3 7.5l2.5 2.5 5.5-6" stroke="#6366f1" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none" /></svg>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Nav */}
      <nav className="sb-nav">
        {navGroups.map(g => (
          <NavGroup key={g.id} group={g} files={files} activeTab={activeTab}
            goTo={goTo} open={groupsOpen[g.id]} onToggle={(id) => setNavGroups(prev => ({ ...prev, [id]: !prev[id] }))}
            collapsed={sidebarCollapsed} />
        ))}
      </nav>

      {/* Footer */}
      <div className="sb-footer">
        {!sidebarCollapsed && (
          <div className="sb-status">
            <div className="sb-status-row">
              <div className="sb-status-dot"><div className={`dot ${backendStatus.healthy ? 'dot-green' : 'dot-red'}`} /> Backend</div>
              <span className={`sb-status-val${backendStatus.healthy ? ' green' : ' red'}`}>{backendStatus.healthy ? 'Online' : 'Offline'}</span>
            </div>
            <div className="sb-status-row">
              <div className="sb-status-dot"><div className={`dot ${backendStatus.aiEnabled ? 'dot-yellow' : 'dot-red'}`} /> AI</div>
              <span className={`sb-status-val${backendStatus.aiEnabled ? ' green' : ' red'}`}>{backendStatus.aiEnabled ? backendStatus.activeAiProvider : 'Off'}</span>
            </div>
          </div>
        )}

        <div className="sb-actions">
          <ThemeSwitcher theme={theme} onThemeChange={setTheme} />
          {!sidebarCollapsed && (
            <div className="sb-actions-right">
              <button className="sb-action" onClick={handleClearLocalCache} title="Clear local cache" aria-label="Clear local cache"><Trash2 size={12} /></button>
              <button className="sb-action" onClick={handleClearServerCache} title="Clear server cache" aria-label="Clear server cache"><ServerCrash size={12} /></button>
            </div>
          )}
        </div>

        {user && (
          <div className={`sb-user${sidebarCollapsed ? ' collapsed' : ''}`}>
            <div className="sb-avatar">{userInitial}</div>
            {!sidebarCollapsed && (
              <>
                <span className="sb-uname truncate">{user.username}</span>
                <button className="sb-logout" onClick={() => { logout(); navigate('/login'); }} title="Logout"><LogOut size={13} /></button>
              </>
            )}
          </div>
        )}
      </div>

      {/* Collapse */}
      <button className="sb-collapse" onClick={() => setSidebarCollapsed(s => !s)} title={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}>
        {sidebarCollapsed ? <ChevronRight size={14} /> : <ChevronLeft size={14} />}
        {!sidebarCollapsed && <span>Collapse</span>}
      </button>
    </aside>
  );
}

export default memo(Sidebar);
