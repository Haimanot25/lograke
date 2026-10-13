import { useEffect, useCallback } from 'react';
import { Outlet, useNavigate } from 'react-router-dom';
import { API_BASE } from './config';
import Sidebar from './components/Sidebar';
import { useAlertSSE } from './hooks/useAlertSSE';
import { useToastCtx } from './context/ToastContext';
import { useFileContext } from './context/FileContext';
import { useUI } from './context/UIContext';

export default function AppShell() {
  const navigate = useNavigate();
  const { addToast } = useToastCtx();
  const { files, fetchFiles } = useFileContext();
  const { theme, backendStatus, setBackendStatus } = useUI();

  useAlertSSE((alert) => {
    addToast(alert.message, alert.severity, `Alert: ${alert.type}`);
  });

  const checkHealth = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/health`);
      if (res.ok) {
        const data = await res.json();
        setBackendStatus({ healthy: true, aiEnabled: data.aiEnabled, activeAiProvider: data.activeAiProvider || 'groq' });
      } else {
        setBackendStatus({ healthy: false, aiEnabled: false, activeAiProvider: 'groq' });
      }
    } catch {
      setBackendStatus({ healthy: false, aiEnabled: false, activeAiProvider: 'groq' });
    }
  }, [setBackendStatus]);

  useEffect(() => { checkHealth(); fetchFiles(); }, [checkHealth, fetchFiles]);

  useEffect(() => {
    if (backendStatus.healthy) return;
    const interval = setInterval(checkHealth, 30000);
    return () => clearInterval(interval);
  }, [backendStatus.healthy, checkHealth]);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('lograke-theme', theme);
  }, [theme]);

  // Redirect to dashboard if files exist, otherwise upload
  useEffect(() => {
    if (files.length > 0 && location.pathname === '/') {
      navigate('/dashboard', { replace: true });
    } else if (files.length === 0 && location.pathname === '/') {
      navigate('/upload', { replace: true });
    }
  }, [files.length, navigate]);

  return (
    <div className="app-container">
      <a href="#main-content" className="skip-link" style={{
        position: 'absolute', left: '-9999px', zIndex: 9999, padding: '8px 16px',
        background: 'var(--color-accent)', color: '#fff', borderRadius: '0 0 4px 0',
        textDecoration: 'none', fontSize: '14px', fontWeight: 600
      }} onFocus={e => e.target.style.left = '0'} onBlur={e => e.target.style.left = '-9999px'}>
        Skip to main content
      </a>
      <Sidebar />
      <main className="main-content" id="main-content">
        <Outlet />
      </main>
    </div>
  );
}
