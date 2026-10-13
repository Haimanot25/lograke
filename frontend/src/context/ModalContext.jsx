import { createContext, useContext, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

const ModalContext = createContext(null);

export function ModalProvider({ children }) {
  const [modals, setModals] = useState([]);

  const showAlert = useCallback((message, title = 'Alert', type = 'info') => {
    return new Promise(resolve => {
      const id = Date.now() + Math.random();
      setModals(prev => [...prev, { id, type: 'alert', message, title, alertType: type, resolve }]);
    });
  }, []);

  const showConfirm = useCallback((message, title = 'Confirm') => {
    return new Promise(resolve => {
      const id = Date.now() + Math.random();
      setModals(prev => [...prev, { id, type: 'confirm', message, title, resolve }]);
    });
  }, []);

  const closeModal = useCallback((id, result) => {
    setModals(prev => {
      const modal = prev.find(m => m.id === id);
      if (modal) modal.resolve(result);
      return prev.filter(m => m.id !== id);
    });
  }, []);

  const value = { showAlert, showConfirm, closeModal };

  return (
    <ModalContext.Provider value={value}>
      {children}
      <ModalStack modals={modals} onClose={closeModal} />
    </ModalContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components -- standard Context pattern: provider component + consumer hook in one module
export function useModal() {
  const ctx = useContext(ModalContext);
  if (!ctx) throw new Error('useModal must be used within ModalProvider');
  return ctx;
}

function ModalStack({ modals, onClose }) {
  if (!modals.length) return null;
  return createPortal(
    <div style={{ position: 'fixed', inset: 0, zIndex: 10000, pointerEvents: 'none' }}>
      {modals.map(modal => (
        <Modal key={modal.id} modal={modal} onClose={onClose} />
      ))}
    </div>,
    document.body
  );
}

function Modal({ modal, onClose }) {
  const { id, type, message, title, alertType } = modal;
  const close = (result) => onClose(id, result);

  const borderColor = type === 'alert'
    ? alertType === 'error' ? 'var(--color-error)'
    : alertType === 'warn' ? 'var(--color-warning)'
    : 'var(--color-accent)'
    : 'var(--color-accent)';

  const overlayStyle = {
    position: 'fixed', inset: 0, zIndex: 10000,
    background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(8px)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    pointerEvents: 'auto', animation: 'fadeIn 0.2s ease',
  };

  const contentStyle = {
    maxWidth: 420, width: '90%', padding: 28,
    background: 'var(--bg-secondary)', border: `1px solid ${borderColor}`,
    borderRadius: 12, boxShadow: 'var(--shadow-lg)',
    pointerEvents: 'auto', animation: 'slideUp 0.25s ease',
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Escape') close(false);
  };

  if (type === 'alert') {
    return (
      <div role="alertdialog" aria-modal="true" style={overlayStyle} onClick={() => close()} onKeyDown={handleKeyDown}>
        <div style={contentStyle} onClick={e => e.stopPropagation()} onKeyDown={handleKeyDown} tabIndex={0} role="dialog" aria-labelledby="alert-title" aria-describedby="alert-message">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
            <h3 id="alert-title" style={{ fontSize: 18, fontWeight: 700, margin: 0, color: 'var(--text-primary)' }}>{title}</h3>
            <button onClick={() => close()} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: 4, lineHeight: 1 }} aria-label="Close">
              <X size={20} />
            </button>
          </div>
          <p id="alert-message" style={{ fontSize: 14, color: 'var(--text-secondary)', marginBottom: 24, lineHeight: 1.5 }}>{message}</p>
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <button onClick={() => close()} className="btn btn-primary">OK</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div role="dialog" aria-modal="true" style={overlayStyle} onClick={() => close(false)} onKeyDown={handleKeyDown}>
      <div style={contentStyle} onClick={e => e.stopPropagation()} onKeyDown={handleKeyDown} tabIndex={0} role="dialog" aria-labelledby="confirm-title" aria-describedby="confirm-message">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
          <h3 id="confirm-title" style={{ fontSize: 18, fontWeight: 700, margin: 0, color: 'var(--text-primary)' }}>{title}</h3>
          <button onClick={() => close(false)} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: 4, lineHeight: 1 }} aria-label="Close">
            <X size={20} />
          </button>
        </div>
        <p id="confirm-message" style={{ fontSize: 14, color: 'var(--text-secondary)', marginBottom: 24, lineHeight: 1.5 }}>{message}</p>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
          <button onClick={() => close(false)} className="btn btn-secondary">Cancel</button>
          <button onClick={() => close(true)} className="btn btn-primary">Confirm</button>
        </div>
      </div>
    </div>
  );
}

export default ModalContext;