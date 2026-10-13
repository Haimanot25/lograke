import { useEffect, useRef, useState } from 'react';

export function useFocusTrap(active) {
  const elRef = useRef(null);
  const previousFocusRef = useRef(null);

  useEffect(() => {
    if (!active) return;
    previousFocusRef.current = document.activeElement;
    const el = elRef.current;
    if (!el) return;

    const focusable = 'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';
    const first = () => el.querySelectorAll(focusable)[0];
    const last = () => {
      const all = el.querySelectorAll(focusable);
      return all[all.length - 1];
    };

    const handleKey = (e) => {
      if (e.key !== 'Tab') return;
      const firstEl = first();
      const lastEl = last();
      if (!firstEl) return;
      if (e.shiftKey) {
        if (document.activeElement === firstEl) { e.preventDefault(); lastEl?.focus(); }
      } else {
        if (document.activeElement === lastEl) { e.preventDefault(); firstEl?.focus(); }
      }
    };

    el.addEventListener('keydown', handleKey);
    first()?.focus();

    return () => {
      el.removeEventListener('keydown', handleKey);
      previousFocusRef.current?.focus();
    };
  }, [active]);

  return elRef;
}

export function useAriaId(prefix) {
  const [id] = useState(() => `${prefix}-${Math.random().toString(36).slice(2, 8)}`);
  return id;
}