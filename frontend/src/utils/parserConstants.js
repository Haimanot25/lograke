export const FIELD_COLORS = ['#6366f1', '#22c55e', '#f59e0b', '#ef4444', '#a855f7', '#3b82f6', '#ec4899', '#14b8a6'];
export const FIELD_TYPES = ['string', 'date', 'number', 'ip', 'email', 'uuid', 'level', 'path', 'url', 'json', 'mac'];

export const DEFAULT_SAMPLE = `2026-06-07 10:15:30 ERROR Database connection failed user_id=4923
2026-06-07 10:15:31 WARN Query timeout after 5000ms user_id=4923
2026-06-07 10:15:32 INFO Retry attempt 1 user_id=4923
2026-06-07 10:15:33 ERROR Connection refused user_id=7842
2026-06-07 10:15:34 INFO Reconnected successfully user_id=4923`;

export function getFieldColor(index) {
  return FIELD_COLORS[index % FIELD_COLORS.length];
}

export function extractGroupPattern(regexStr, groupName) {
  if (!regexStr) return null;
  const escaped = groupName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const idx = regexStr.indexOf('(?<' + escaped + '>');
  if (idx === -1) return null;
  let depth = 0;
  let end = idx + 3 + escaped.length + 1;
  for (let i = end; i < regexStr.length; i++) {
    if (regexStr[i] === '\\') { i++; continue; } // skip escaped chars, e.g. \(
    if (regexStr[i] === '(') depth++;
    else if (regexStr[i] === ')') {
      if (depth === 0) { end = i; break; }
      depth--;
    }
  }
  return regexStr.slice(idx, end + 1);
}
