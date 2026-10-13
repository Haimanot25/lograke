import { createContext, useContext, useState, useEffect } from 'react';

const UIContext = createContext(null);

function usePersistedState(key, defaultValue) {
  const [state, setState] = useState(() => {
    try {
      const saved = localStorage.getItem(key);
      return saved !== null ? JSON.parse(saved) : defaultValue;
    } catch { return defaultValue; }
  });
  useEffect(() => {
    try { localStorage.setItem(key, JSON.stringify(state)); } catch { /* ignore storage quota errors */ }
  }, [key, state]);
  return [state, setState];
}

export function UIProvider({ children }) {
  const [sidebarCollapsed, setSidebarCollapsed] = usePersistedState('lograke-sidebar-collapsed', false);
  const [navGroups, setNavGroups] = usePersistedState('lograke-nav-groups', { main: true, analysis: true, admin: true });
  const [theme, setTheme] = usePersistedState('lograke-theme', 'black');
  const [selectedLogType, setSelectedLogType] = useState('default');
  const [multiLineEDR, setMultiLineEDR] = useState(false);
  const [loading, setLoading] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [pasteText, setPasteText] = useState('');
  const [pasteName, setPasteName] = useState('pasted-log.txt');
  const [backendStatus, setBackendStatus] = useState({ healthy: false, aiEnabled: false, activeAiProvider: 'groq' });

  const handleDrag = (e) => { e.preventDefault(); e.stopPropagation(); setDragActive(e.type === 'dragenter' || e.type === 'dragover'); };
  const handleDrop = (e) => { e.preventDefault(); e.stopPropagation(); setDragActive(false); };

  return (
    <UIContext.Provider value={{
      sidebarCollapsed, setSidebarCollapsed,
      theme, setTheme,
      selectedLogType, setSelectedLogType,
      multiLineEDR, setMultiLineEDR,
      loading, setLoading,
      dragActive, setDragActive,
      pasteText, setPasteText,
      pasteName, setPasteName,
      navGroups, setNavGroups,
      backendStatus, setBackendStatus,
      handleDrag, handleDrop
    }}>
      {children}
    </UIContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components -- standard Context pattern: provider component + consumer hook in one module
export function useUI() {
  const ctx = useContext(UIContext);
  if (!ctx) throw new Error('useUI must be used within UIProvider');
  return ctx;
}
