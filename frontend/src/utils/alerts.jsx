import { createRoot } from 'react-dom/client';

let modalRoot = null;
function getModalRoot() {
  if (!modalRoot) {
    modalRoot = document.createElement('div');
    modalRoot.id = 'modal-root';
    document.body.appendChild(modalRoot);
  }
  return modalRoot;
}

export function showAlert(message, title = 'Alert', type = 'info') {
  return new Promise((resolve) => {
    const container = document.createElement('div');
    const root = getModalRoot();
    root.appendChild(container);
    const reactRoot = createRoot(container);
    container._reactRoot = reactRoot;

    const borderColor = type === 'error' ? 'var(--color-error)' : type === 'warn' ? 'var(--color-warning)' : 'var(--color-accent)';

    function close() {
      reactRoot.unmount();
      container.remove();
      resolve();
    }

    reactRoot.render(
      <div
        role="alertdialog"
        aria-modal="true"
        style={{
          position: 'fixed', inset: 0, zIndex: 10000,
          background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(8px)',
          display: 'flex', alignItems: 'center', justifyContent: 'center'
        }}
        onClick={close}
      >
        <div
          style={{
            maxWidth: 420, width: '90%', padding: 28,
            background: 'var(--bg-secondary)', border: `1px solid ${borderColor}`,
            borderRadius: 12, boxShadow: 'var(--shadow-lg)'
          }}
          onClick={e => e.stopPropagation()}
        >
          <h3 style={{ fontSize: 18, fontWeight: 700, marginBottom: 12, color: 'var(--text-primary)' }}>{title}</h3>
          <p style={{ fontSize: 14, color: 'var(--text-secondary)', marginBottom: 24, lineHeight: 1.5 }}>{message}</p>
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <button
              onClick={close}
              className="btn btn-primary"
            >
              OK
            </button>
          </div>
        </div>
      </div>
    );
  });
}

export function showConfirm(message, title = 'Confirm') {
  return new Promise((resolve) => {
    const container = document.createElement('div');
    const root = getModalRoot();
    root.appendChild(container);
    const reactRoot = createRoot(container);

    function close(result) {
      reactRoot.unmount();
      container.remove();
      resolve(result);
    }

    reactRoot.render(
      <div
        role="dialog"
        aria-modal="true"
        style={{
          position: 'fixed', inset: 0, zIndex: 10000,
          background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(8px)',
          display: 'flex', alignItems: 'center', justifyContent: 'center'
        }}
        onClick={() => close(false)}
      >
        <div
          style={{
            maxWidth: 420, width: '90%', padding: 28,
            background: 'var(--bg-secondary)', border: '1px solid var(--color-accent)',
            borderRadius: 12, boxShadow: 'var(--shadow-lg)'
          }}
          onClick={e => e.stopPropagation()}
        >
          <h3 style={{ fontSize: 18, fontWeight: 700, marginBottom: 12, color: 'var(--text-primary)' }}>{title}</h3>
          <p style={{ fontSize: 14, color: 'var(--text-secondary)', marginBottom: 24, lineHeight: 1.5 }}>{message}</p>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
            <button
              onClick={() => close(false)}
              className="btn btn-secondary"
            >
              Cancel
            </button>
            <button
              onClick={() => close(true)}
              className="btn btn-primary"
            >
              Confirm
            </button>
          </div>
        </div>
      </div>
    );
  });
}
