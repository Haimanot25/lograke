// Applies the persisted theme before first paint (no flash of wrong theme).
// This lives in an external file — not inline in index.html — so the Content
// Security Policy can ship without 'unsafe-inline' for scripts.
var t = localStorage.getItem('lograke-theme');
if (t && t !== 'dark') document.documentElement.setAttribute('data-theme', t);
