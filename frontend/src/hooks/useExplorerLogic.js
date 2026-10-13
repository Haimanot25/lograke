import { useState, useEffect, useCallback, useRef } from 'react';
import { API_BASE } from '../config';
import { useToastCtx } from '../context/ToastContext';

const SEARCH_MODES = ['text', 'regex', 'advanced'];

export { SEARCH_MODES };

export function useExplorerLogic({ fileId, context }) {
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [searchMode, setSearchMode] = useState('text');
  const [level, setLevel] = useState('all');
  const [page, setPage] = useState(1);
  const limit = 50;
  const [result, setResult] = useState({ logs: [], total: 0 });
  const [loading, setLoading] = useState(false);
  const [expandedIndex, setExpandedIndex] = useState(null);

  const [explain, setExplain] = useState({ loading: false, text: '', targetIndex: null });

  const [aiPrompt, setAiPrompt] = useState('');
  const [aiResponse, setAiResponse] = useState('');
  const [aiLoading, setAiLoading] = useState(false);
  const [streamingText, setStreamingText] = useState('');

  const [trace, setTrace] = useState({
    value: '', timeline: [], loading: false, showModal: false,
    aiResponse: '', aiLoading: false
  });

  const [savedQueries, setSavedQueries] = useState([]);
  const [queryName, setQueryName] = useState('');
  const [showSaveDialog, setShowSaveDialog] = useState(false);

  const [showSavedQueries, setShowSavedQueries] = useState(false);
  const [contextMenu, setContextMenu] = useState({ show: false, pos: { x: 0, y: 0 }, log: null });
  const [visibleTimelines, setVisibleTimelines] = useState(new Set());

  const abortRef = useRef(null);
  const aiAbortRef = useRef(null);

  const { addToast } = useToastCtx();

  const formatTimestamp = useCallback((ts) => {
    if (ts === null || ts === undefined || ts === '') return '-';
    let ms;
    if (typeof ts === 'number') {
      ms = ts;
    } else {
      const asFloat = parseFloat(ts);
      if (!isNaN(asFloat) && /^[\d.]+$/.test(String(ts).trim())) {
        ms = asFloat;
      } else {
        const d = new Date(ts);
        if (!isNaN(d.getTime())) {
          return d.toISOString().replace('T', ' ').slice(0, 19) + ' UTC';
        }
        return String(ts);
      }
    }
    const digitCount = Math.floor(Math.log10(Math.abs(ms))) + 1;
    if (digitCount <= 10) ms = ms * 1000;
    const d = new Date(ms);
    if (isNaN(d.getTime())) return String(ts);
    return d.toISOString().replace('T', ' ').slice(0, 19) + ' UTC';
  }, []);

  useEffect(() => {
    if (!context) return;
    if (context.search !== undefined) setSearch(context.search);
    if (context.searchMode) setSearchMode(context.searchMode);
    if (context.level) setLevel(context.level);
    if (context.search !== undefined || context.level) setPage(1);
    if (context.traceValue) {
      setTrace(prev => ({ ...prev, value: context.traceValue }));
      handleTrace(undefined, context.traceValue);
    }
  }, [context]);

  const fetchLogs = useCallback(async () => {
    if (abortRef.current) abortRef.current.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setLoading(true);
    try {
      let res;
      if ((searchMode === 'advanced' || searchMode === 'regex') && debouncedSearch.trim()) {
        const query = searchMode === 'regex' ? `regex:"${debouncedSearch}"` : debouncedSearch;
        res = await fetch(`${API_BASE}/logs/${fileId}/query-dsl`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ query, page, limit, level }),
          signal: controller.signal
        });
      } else {
        const params = new URLSearchParams({ search: debouncedSearch, level, page, limit });
        res = await fetch(`${API_BASE}/logs/${fileId}/query?${params}`, { signal: controller.signal });
      }
      if (res.ok) {
        const data = await res.json();
        setResult({ logs: data.logs || [], total: data.total || 0 });
      }
    } catch (err) {
      if (err.name !== 'AbortError') addToast('Failed to load logs: ' + err.message, 'error', 'Error');
    } finally {
      setLoading(false);
    }
  }, [fileId, debouncedSearch, searchMode, level, page, limit, addToast]);

  const fetchSavedQueries = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/logs/queries/saved`);
      if (res.ok) {
        const data = await res.json();
        setSavedQueries(data.queries || []);
      }
    } catch (err) {
      console.error('Failed to load saved queries', err);
    }
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(search);
      setPage(1);
      setExpandedIndex(null);
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);

  useEffect(() => { fetchLogs(); }, [fetchLogs]);
  useEffect(() => { fetchSavedQueries(); }, [fetchSavedQueries]);

  useEffect(() => {
    return () => {
      if (abortRef.current) abortRef.current.abort();
      if (aiAbortRef.current) aiAbortRef.current.abort();
      if (explainAbortRef.current) explainAbortRef.current.abort();
    };
  }, []);

  const handleContextMenu = useCallback((e, log) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({ show: true, pos: { x: e.clientX, y: e.clientY }, log });
  }, []);

  const handleRowClick = useCallback((idx) => {
    const wasExpanded = expandedIndex === idx;
    setExpandedIndex(wasExpanded ? null : idx);
    setExplain(prev => ({ ...prev, text: '', targetIndex: null }));
    if (wasExpanded) {
      setVisibleTimelines(prev => { const next = new Set(prev); next.delete(idx); return next; });
    }
  }, [expandedIndex]);

  const explainAbortRef = useRef(null);

  const handleExplain = useCallback(async (e, logIndex) => {
    if (e && e.stopPropagation) e.stopPropagation();
    if (explainAbortRef.current) explainAbortRef.current.abort();
    setExplain({ loading: true, text: '', targetIndex: logIndex });
    let accumulated = '';
    try {
      const res = await fetch(`${API_BASE}/logs/${fileId}/explain/${logIndex}?stream=true`);
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setExplain(prev => ({ ...prev, loading: false, text: data.error || 'Failed to generate analysis.' }));
        return;
      }
      if (!res.body) {
        // Fallback to synchronous
        const data = await res.json();
        setExplain(prev => ({ ...prev, loading: false, text: data.explanation || 'Failed to generate analysis.' }));
        return;
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const parsed = JSON.parse(line.slice(6));
              if (parsed.done) break;
              if (parsed.token) {
                accumulated += parsed.token;
                setExplain(prev => ({ ...prev, text: accumulated }));
              }
              if (parsed.error) {
                setExplain(prev => ({ ...prev, text: parsed.error }));
              }
            } catch { /* best-effort */ }
          }
        }
      }
      setExplain(prev => ({ ...prev, loading: false, text: accumulated }));
    } catch (err) {
      if (err.name !== 'AbortError') {
        setExplain(prev => ({ ...prev, loading: false, text: `Error: ${err.message}` }));
      }
    }
  }, [fileId]);

  const handleAiQuery = useCallback(async (e) => {
    e.preventDefault();
    if (!aiPrompt.trim()) return;
    if (aiAbortRef.current) aiAbortRef.current.abort();
    setAiLoading(true);
    setAiResponse('');
    setStreamingText('');
    const controller = new AbortController();
    aiAbortRef.current = controller;
    let accumulated = '';
    try {
      const logContext = result.logs.slice(0, 50);
      const res = await fetch(`${API_BASE}/logs/${fileId}/query-ai/stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: aiPrompt, logContext }),
        signal: controller.signal
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setAiResponse(data.error || 'AI query failed.');
        setAiLoading(false);
        return;
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const parsed = JSON.parse(line.slice(6));
              if (parsed.done) break;
              if (parsed.token) {
                accumulated += parsed.token;
                setStreamingText(accumulated);
              }
              if (parsed.error) setAiResponse(parsed.error);
            } catch { /* best-effort */ }
          }
        }
      }
      setAiResponse(accumulated);
      setStreamingText('');
    } catch (err) {
      if (err.name !== 'AbortError') {
        const partial = accumulated || aiResponse;
        setAiResponse(partial ? partial + '\n\n[Connection lost — response may be incomplete]' : `Error: ${err.message}`);
      }
    } finally {
      setAiLoading(false);
    }
  }, [fileId, aiPrompt, result.logs, aiResponse]);

  const handleTrace = useCallback(async (e, explicitValue) => {
    if (e && e.preventDefault) e.preventDefault();
    const queryValue = explicitValue !== undefined ? explicitValue : trace.value;
    if (!queryValue.trim()) return;
    setTrace(prev => ({ ...prev, loading: true, timeline: [] }));
    try {
      const res = await fetch(`${API_BASE}/logs/${fileId}/trace?val=${encodeURIComponent(queryValue)}`);
      const data = await res.json();
      if (data.timeline?.length === 0) {
        setTrace(prev => ({ ...prev, loading: false }));
        addToast('No correlated events found for this entity.', 'warn', 'Warning');
      } else {
        setTrace(prev => ({ ...prev, loading: false, timeline: data.timeline || [], showModal: true, aiResponse: '' }));
      }
    } catch (err) {
      setTrace(prev => ({ ...prev, loading: false }));
      addToast('Trace failed: ' + err.message, 'error', 'Error');
    }
  }, [trace.value, fileId, addToast]);

  const handleTraceAiAnalysis = useCallback(async () => {
    if (!trace.timeline || trace.timeline.length === 0) return;
    setTrace(prev => ({ ...prev, aiLoading: true, aiResponse: '' }));
    let sampled = trace.timeline;
    if (sampled.length > 20) {
      const errors = sampled.filter(s => s.level === 'ERROR' || s.level === 'FATAL');
      const first5 = sampled.slice(0, 5);
      const last5 = sampled.slice(-5);
      const middle = errors.filter(e => !first5.includes(e) && !last5.includes(e)).slice(0, 10);
      sampled = [...first5, ...middle, ...last5];
    }
    const prompt = `Analyze this sequence of correlated log events for entity "${trace.value}". Identify any anomalies, errors, and the likely root cause:\n\n${JSON.stringify(sampled, null, 2)}`;
    try {
      const res = await fetch(`${API_BASE}/logs/${fileId}/query-ai`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt })
      });
      const data = await res.json();
      setTrace(prev => ({ ...prev, aiLoading: false, aiResponse: res.ok ? data.response : 'AI analysis failed.' }));
    } catch (err) {
      setTrace(prev => ({ ...prev, aiLoading: false, aiResponse: `Error: ${err.message}` }));
    }
  }, [trace.timeline, trace.value, fileId]);

  const handleSaveQuery = useCallback(async () => {
    if (!queryName.trim() || !search.trim()) return;
    try {
      const res = await fetch(`${API_BASE}/logs/queries/saved`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: queryName, query: search })
      });
      if (res.ok) {
        const data = await res.json();
        setSavedQueries([data.query, ...savedQueries]);
        setShowSaveDialog(false);
        setQueryName('');
        addToast('Query saved successfully', 'info', 'Saved');
      }
    } catch {
      addToast('Failed to save query', 'error', 'Error');
    }
  }, [queryName, search, savedQueries, addToast]);

  const applySavedQuery = useCallback((q) => {
    setSearchMode('text');
    setSearch(q.query);
  }, []);

  const { logs, total } = result;
  const totalPages = Math.ceil(total / limit) || 1;

  return {
    search, setSearch, searchMode, setSearchMode,
    level, setLevel, page, setPage, limit,
    result, loading, expandedIndex, setExpandedIndex,
    explain, setExplain, aiPrompt, setAiPrompt,
    aiResponse, aiLoading, streamingText,
    trace, setTrace,
    savedQueries, queryName, setQueryName,
    showSaveDialog, setShowSaveDialog,
    showSavedQueries, setShowSavedQueries,
    contextMenu, setContextMenu,
    visibleTimelines, setVisibleTimelines,
    SEARCH_MODES, formatTimestamp,
    logs, total, totalPages,
    handleContextMenu, handleRowClick, handleExplain,
    handleAiQuery, handleTrace, handleTraceAiAnalysis,
    handleSaveQuery, applySavedQuery
  };
}
