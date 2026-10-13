import { FIELD_COLORS } from './parserConstants';

export function HighlightedLine({ line, matchedGroups, fieldColors, index }) {
  if (!matchedGroups || Object.keys(matchedGroups).length === 0) {
    return <div className="pl-preview-line pl-preview-line-miss">#{index + 1}: {line.length > 120 ? line.slice(0, 120) + '...' : line}</div>;
  }
  const parts = [];
  let remaining = line;
  const entries = Object.entries(matchedGroups).filter(([, v]) => v);
  let ok = true;
  entries.forEach(([name, value], fi) => {
    if (!ok) return;
    if (!value) return;
    const idx = remaining.indexOf(value);
    if (idx === -1) { ok = false; return; }
    if (idx > 0) parts.push({ text: remaining.slice(0, idx), color: null });
    parts.push({ text: value, color: fieldColors[name] || FIELD_COLORS[fi % FIELD_COLORS.length] });
    remaining = remaining.slice(idx + value.length);
  });
  if (!ok) {
    return <div className="pl-preview-line pl-preview-line-miss">#{index + 1}: {line.length > 120 ? line.slice(0, 120) + '...' : line}</div>;
  }
  if (remaining) parts.push({ text: remaining, color: null });
  return (
    <div className="pl-preview-line pl-preview-line-match">
      <span className="pl-line-num">{index + 1}</span>
      {parts.map((p, i) =>
        p.color ? (
          <mark key={i} style={{ background: p.color + '33', color: '#e5e7eb', borderRadius: '2px', padding: '0 1px' }}>{p.text}</mark>
        ) : (
          <span key={i}>{p.text}</span>
        )
      )}
    </div>
  );
}
