import { createContext, useContext, useState, useCallback } from 'react';

let toastId = 0;

const ToastCtx = createContext(null);

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);

  const addToast = useCallback((message, severity = 'info', title = 'Alert') => {
    const id = ++toastId;
    setToasts(prev => [...prev, { id, message, severity, title }]);
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 8000);
  }, []);

  const removeToast = useCallback((id) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  return (
    <ToastCtx.Provider value={{ addToast, removeToast }}>
      {children}
      <div style={{
        position: 'fixed', top: '16px', right: '16px', zIndex: 9999,
        display: 'flex', flexDirection: 'column', gap: '8px', maxWidth: '380px'
      }}>
        {toasts.map(toast => {
          const severityColors = {
            error: { bg: '#3b1219', border: '#dc2626', icon: '\u26a0' },
            warn: { bg: '#3b2e10', border: '#f59e0b', icon: '\u26a0' },
            info: { bg: '#102e3b', border: '#3b82f6', icon: '\u2139' }
          };
          const colors = severityColors[toast.severity] || severityColors.info;
          return (
            <div key={toast.id} style={{
              background: colors.bg, border: `1px solid ${colors.border}`,
              borderRadius: '8px', padding: '12px 16px', color: '#e5e7eb',
              boxShadow: '0 4px 12px rgba(0,0,0,0.4)', animation: 'slideIn 0.3s ease'
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '4px' }}>
                <div style={{ fontWeight: 600, fontSize: '13px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <span>{colors.icon}</span> {toast.title}
                </div>
                <button onClick={() => removeToast(toast.id)} style={{
                  background: 'none', border: 'none', color: '#9ca3af', cursor: 'pointer', fontSize: '16px', padding: 0, lineHeight: 1
                }}>&times;</button>
              </div>
              <div style={{ fontSize: '12px', color: '#9ca3af' }}>{toast.message}</div>
            </div>
          );
        })}
      </div>
    </ToastCtx.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components -- standard Context pattern: provider component + consumer hook in one module
export function useToastCtx() {
  const ctx = useContext(ToastCtx);
  if (!ctx) throw new Error('useToastCtx must be used within ToastProvider');
  return ctx;
}
