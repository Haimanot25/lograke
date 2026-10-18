import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { API_BASE } from '../config';

const FileContext = createContext(null);

export function FileProvider({ children }) {
  const navigate = useNavigate();
  const [files, setFiles] = useState([]);
  const [activeFileId, setActiveFileId] = useState('');
  const [selectedFileDetail, setSelectedFileDetail] = useState(null);
  const [explorerContext, setExplorerContext] = useState(null);
  const [customParsers, setCustomParsers] = useState([]);

  const selectedFileMeta = files.find(f => f.id === activeFileId);
  const selectedFile = selectedFileDetail?.id === activeFileId ? selectedFileDetail : selectedFileMeta;

  const fetchFiles = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/logs/files`, { credentials: 'include' });
      if (res.ok) {
        const data = await res.json();
        setFiles(data.files || []);
        if (data.files && data.files.length > 0 && !activeFileId) {
          setActiveFileId(data.files[0].id);
          navigate('/dashboard');
        }
      }
    } catch (err) {
      console.error('Failed to fetch files:', err);
    }
  }, [activeFileId, navigate]);

  const fetchFileDetail = useCallback(async (fileId, signal) => {
    try {
      const res = await fetch(`${API_BASE}/logs/${fileId}/metadata`, { credentials: 'include', signal });
      if (res.ok) {
        const data = await res.json();
        if (data.success) setSelectedFileDetail(data.metadata);
      }
    } catch (err) {
      if (err.name !== 'AbortError') console.error('Failed to fetch file detail:', err);
    }
  }, []);

  useEffect(() => {
    fetch(`${API_BASE}/parsers`, { credentials: 'include' })
      .then(r => r.json())
      .then(data => { if (data.parsers) setCustomParsers(data.parsers); })
      .catch((e) => { console.warn('Failed to fetch parsers', e); });
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch file detail + reset explorer context when active file changes
    if (activeFileId) fetchFileDetail(activeFileId, controller.signal);
    setExplorerContext(null);
    return () => controller.abort();
  }, [activeFileId, fetchFileDetail]);

  return (
    <FileContext.Provider value={{
      files, setFiles, activeFileId, setActiveFileId,
      selectedFile, selectedFileDetail, setSelectedFileDetail,
      explorerContext, setExplorerContext,
      customParsers, setCustomParsers,
      fetchFiles, fetchFileDetail
    }}>
      {children}
    </FileContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components -- standard Context pattern: provider component + consumer hook in one module
export function useFileContext() {
  const ctx = useContext(FileContext);
  if (!ctx) throw new Error('useFileContext must be used within FileProvider');
  return ctx;
}
