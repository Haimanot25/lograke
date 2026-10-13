import { memo, useEffect, useRef, useCallback } from 'react';
import ReactDOM from 'react-dom';

function ContextMenu({ items, position, onClose, triggerRef }) {
  const menuRef = useRef(null);

  const handleClickOutside = useCallback((e) => {
    if (menuRef.current && !menuRef.current.contains(e.target)) {
      if (triggerRef && triggerRef.current && triggerRef.current.contains(e.target)) return;
      onClose();
    }
  }, [onClose, triggerRef]);

  const handleEsc = useCallback((e) => {
    if (e.key === 'Escape') onClose();
  }, [onClose]);

  const handleScroll = useCallback(() => {
    onClose();
  }, [onClose]);

  const adustPosition = useCallback(() => {
    if (!menuRef.current) return;
    const rect = menuRef.current.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let { x, y } = position;
    if (x + rect.width > vw - 8) x = vw - rect.width - 8;
    if (y + rect.height > vh - 8) y = vh - rect.height - 8;
    if (x < 8) x = 8;
    if (y < 8) y = 8;
    menuRef.current.style.left = `${x}px`;
    menuRef.current.style.top = `${y}px`;
  }, [position]);

  useEffect(() => {
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEsc);
    document.addEventListener('scroll', handleScroll, true);
    adustPosition();
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEsc);
      document.removeEventListener('scroll', handleScroll, true);
    };
  }, [handleClickOutside, handleEsc, handleScroll, adustPosition]);

  return ReactDOM.createPortal(
    <div className="context-menu-overlay">
      <div className="context-menu" ref={menuRef} role="menu" tabIndex={-1}>
        {items.map((item, idx) => {
          if (item.divider) {
            return <div key={`div-${idx}`} className="context-menu-divider" />;
          }
          return (
            <button
              key={item.label || idx}
              className={`context-menu-item ${item.disabled ? 'disabled' : ''} ${item.danger ? 'danger' : ''}`}
              role="menuitem"
              disabled={item.disabled}
              onClick={() => {
                if (!item.disabled && item.onClick) {
                  item.onClick();
                  onClose();
                }
              }}
            >
              {item.icon && <span className="context-menu-icon">{item.icon}</span>}
              <span className="context-menu-label">{item.label}</span>
              {item.shortcut && <span className="context-menu-shortcut">{item.shortcut}</span>}
            </button>
          );
        })}
      </div>
    </div>,
    document.body
  );
}

export default memo(ContextMenu);
