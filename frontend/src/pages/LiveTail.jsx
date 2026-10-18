import { useState, useEffect, useRef, useCallback } from 'react';
import { Radio, Pause, Play, WifiOff, Filter, Copy } from 'lucide-react';
import ContextMenu from '../components/ContextMenu';

import { API_BASE } from '../config';
import { useFileContext } from '../context/FileContext';

const MAX_RECONNECT_ATTEMPTS = 5;
const BASE_RECONNECT_DELAY = 1000;

const safeTime = ts => {
  if (ts == null) return '';
  if (typeof ts === 'string' && /^\d+(\.\d+)?$/.test(ts)) ts = parseFloat(ts);
  const d = new Date(ts);
  if (isNaN(d.getTime())) return '';
  return d.toISOString().split('T')[1].replace('Z', '');
};

export default function LiveTail() {
  const { selectedFile } = useFileContext();
  const [logs, setLogs] = useState([]);
  const [isStreaming, setIsStreaming] = useState(true);
  const [filterLevel, setFilterLevel] = useState('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [reconnectAttempt, setReconnectAttempt] = useState(0);
  const [connectionStatus, setConnectionStatus] = useState('connected');

  const eventSourceRef = useRef(null);
  const reconnectTimerRef = useRef(null);
  const reconnectAttemptRef = useRef(0);
  const logsEndRef = useRef(null);
  const [autoScroll, setAutoScroll] = useState(true);
  const [contextMenu, setContextMenu] = useState({ show: false, pos: { x: 0, y: 0 }, log: null });

  const cleanup = useCallback(() => {
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
  }, []);

  const connect = useCallback(function connectImpl() {
    cleanup();
    const url = `${API_BASE}/logs/stream${selectedFile ? `?fileId=${selectedFile.id}` : ''}`;
    const sse = new EventSource(url, { withCredentials: true });
    eventSourceRef.current = sse;

    sse.onopen = () => {
      reconnectAttemptRef.current = 0;
      setReconnectAttempt(0);
      setConnectionStatus('connected');
    };

    sse.onmessage = (e) => {
      try {
        const newLog = JSON.parse(e.data);
        setLogs(prev => {
          const updated = [...prev, newLog];
          if (updated.length > 1000) return updated.slice(updated.length - 1000);
          return updated;
        });
      } catch (err) {
        console.error('Failed to parse incoming log', err);
      }
    };

    sse.onerror = () => {
      sse.close();
      eventSourceRef.current = null;

      const attempt = reconnectAttemptRef.current + 1;
      if (attempt > MAX_RECONNECT_ATTEMPTS) {
        setConnectionStatus('failed');
        setIsStreaming(false);
        return;
      }

      reconnectAttemptRef.current = attempt;
      setReconnectAttempt(attempt);
      setConnectionStatus('reconnecting');

      const delay = Math.min(BASE_RECONNECT_DELAY * Math.pow(2, attempt - 1), 30000);
      reconnectTimerRef.current = setTimeout(() => {
        if (isStreaming) connectImpl();
      }, delay);
    };
  }, [selectedFile, cleanup, isStreaming]);

  useEffect(() => {
    if (!isStreaming) {
      cleanup();
      // Keep a terminal 'failed' status visible instead of flipping to 'paused'
      setConnectionStatus(prev => (prev === 'failed' ? prev : 'paused'));
      return;
    }

    setConnectionStatus('connected');
    reconnectAttemptRef.current = 0;
    setReconnectAttempt(0);
    connect();

    return cleanup;
  }, [isStreaming, selectedFile, connect, cleanup]);

  useEffect(() => {
    if (autoScroll && logsEndRef.current) {
      logsEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [logs, autoScroll]);

  const handleResume = () => {
    reconnectAttemptRef.current = 0;
    setReconnectAttempt(0);
    setConnectionStatus('connected');
    setIsStreaming(true);
  };

  const filteredLogs = logs.filter(log => {
    if (filterLevel !== 'all' && log.level !== filterLevel) return false;
    if (searchTerm && !log.message.toLowerCase().includes(searchTerm.toLowerCase())) return false;
    return true;
  });

  const levelColor = {
    info: 'var(--color-success)',
    warn: 'var(--color-warning)',
    error: 'var(--color-error)',
    fatal: 'var(--color-fatal)'
  };

  return (
    <div className="livetail-layout">
      <div className="section-header">
        <div>
          <h1>Live Tail Stream</h1>
          <p>Real-time streaming logs {selectedFile ? `for ${selectedFile.name}` : '(All Sources)'}</p>
        </div>
        
        <div className="section-header-actions">
          {connectionStatus === 'connected' ? (
            <div className="livetail-status live">
              <div className="pulse-dot livetail-status-dot live"></div>
              LIVE
            </div>
          ) : connectionStatus === 'reconnecting' ? (
            <div className="livetail-status paused" style={{ color: 'var(--color-warning)' }}>
              <div className="livetail-status-dot paused"></div>
              RECONNECTING ({reconnectAttempt}/{MAX_RECONNECT_ATTEMPTS})
            </div>
          ) : connectionStatus === 'failed' ? (
            <div className="livetail-status paused" style={{ color: 'var(--color-error)' }}>
              <WifiOff size={14} />
              DISCONNECTED
            </div>
          ) : (
            <div className="livetail-status paused">
              <div className="livetail-status-dot paused"></div>
              PAUSED
            </div>
          )}
          
          <button 
            className={`btn ${isStreaming ? 'btn-secondary' : 'btn-primary'}`} 
            onClick={isStreaming ? () => setIsStreaming(false) : handleResume}
          >
            {isStreaming ? <><Pause size={14} /> Pause Stream</> : <><Play size={14} /> Resume Stream</>}
          </button>
          
          <button 
            className="btn btn-danger" 
            onClick={() => setLogs([])}
          >
            Clear
          </button>
        </div>
      </div>

      <div className="ep-filters livetail-filter-bar">
        <input 
          type="text" 
          placeholder="Filter live logs..." 
          className="input-text" 
          aria-label="Filter live log messages"
          value={searchTerm}
          onChange={e => setSearchTerm(e.target.value)}
        />
        <select 
          className="input-select" 
          aria-label="Filter by log level"
          value={filterLevel} 
          onChange={e => setFilterLevel(e.target.value)}
        >
          <option value="all">All Levels</option>
          <option value="info">INFO</option>
          <option value="warn">WARN</option>
          <option value="error">ERROR</option>
        </select>
        <label className="livetail-autoscroll-label">
          <input 
            type="checkbox" 
            checked={autoScroll} 
            onChange={e => setAutoScroll(e.target.checked)} 
          />
          Auto-scroll
        </label>
      </div>

      <div className="card-elevated livetail-log-container">
        {filteredLogs.length === 0 ? (
          <div className="livetail-empty">
            <div><Radio size={32} /></div>
            <div>
              {connectionStatus === 'reconnecting'
                ? `Reconnecting... (attempt ${reconnectAttempt}/${MAX_RECONNECT_ATTEMPTS})`
                : connectionStatus === 'failed'
                ? 'Connection lost. Click "Resume Stream" to retry.'
                : isStreaming
                ? 'Waiting for new logs...'
                : 'Stream is paused. No logs.'}
            </div>
          </div>
        ) : (
          <div className="livetail-log-list">
            {filteredLogs.map((log, i) => (
              <div key={i} className="livetail-log-entry" style={{ borderLeft: `3px solid ${levelColor[log.level] || 'var(--text-muted)'}` }}
                onContextMenu={e => { e.preventDefault(); e.stopPropagation(); setContextMenu({ show: true, pos: { x: e.clientX, y: e.clientY }, log }); }}>
                <span className="livetail-log-time">
                  {safeTime(log.timestamp)}
                </span>
                <span className="livetail-log-level" style={{ color: levelColor[log.level] || 'var(--text-muted)' }}>
                  {log.level.toUpperCase()}
                </span>
                <span className="livetail-log-msg">
                  {log.message}
                </span>
              </div>
            ))}
            <div ref={logsEndRef} />
          </div>
        )}
        <div aria-live="polite" aria-atomic="true" style={{ position: 'absolute', width: '1px', height: '1px', overflow: 'hidden' }}>{filteredLogs.length} log entries displayed.</div>
      </div>

      {contextMenu.show && contextMenu.log && (
        <ContextMenu
          position={contextMenu.pos}
          onClose={() => setContextMenu({ show: false, pos: { x: 0, y: 0 }, log: null })}
          items={[
            { label: `Filter by Level: ${contextMenu.log.level}`, icon: <Filter size={14} />, onClick: () => setFilterLevel(contextMenu.log.level) },
            { divider: true },
            { label: 'Copy Message', icon: <Copy size={14} />, onClick: () => navigator.clipboard.writeText(contextMenu.log.message) },
            { label: 'Copy Raw', icon: <Copy size={14} />, onClick: () => navigator.clipboard.writeText(contextMenu.log.raw) },
            { label: 'Copy JSON', icon: <Copy size={14} />, onClick: () => navigator.clipboard.writeText(JSON.stringify(contextMenu.log, null, 2)) }
          ]}
        />
      )}
    </div>
  );
}
