/**
 * EnhancedParser - log format detection.
 *
 * Sniffs the first non-empty line (plus the filename extension) to classify
 * uploaded content: json-lines, xml, csv, tsv, hdfs, healthapp, proxifier,
 * bgl, thunderbird or plain text.
 *
 * Line-level parsing of those formats lives in ./formatParsers.js and the
 * adaptive fallback parser in ./AdaptiveParser.js — only detection remains here.
 */
const path = require('path');

/* ── Format detection ───────────────────────────────────────── */
function detectFormat(content, filename) {
  const ext = path.extname(filename).toLowerCase();
  const firstNonEmpty = content.split('\n').find(l => l.trim());
  if (!firstNonEmpty) return 'text';

  if (ext === '.json' || firstNonEmpty.trim().startsWith('{') || firstNonEmpty.trim().startsWith('[')) {
    try { JSON.parse(firstNonEmpty); return 'json-lines'; } catch { /* not JSON */ }
  }
  if (ext === '.xml' || firstNonEmpty.trim().startsWith('<')) return 'xml';
  if (ext === '.csv') return 'csv';
  if (ext === '.tsv') return 'tsv';
  if (content.includes('<event') || content.includes('<log')) return 'xml';

  // Detect loghub-specific formats by content sniffing
  if (/^\d{4}\d{2}\d{2}\d{2}\d{2}\d{2}[.,]\d+/.test(firstNonEmpty)) return 'hdfs';
  if (/^\d{2}:\d{2}:\d{2}\.\d{3}\s/.test(firstNonEmpty)) return 'healthapp';
  if (/^\[\d{4}\.\d{2}\.\d{2}/.test(firstNonEmpty)) return 'proxifier';
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2},\d{3}\s+(INFO|WARN|ERROR|DEBUG)/.test(firstNonEmpty)) return 'bgl';
  if (/^\d+-\d+-\d+\s+/.test(firstNonEmpty)) return 'thunderbird';

  return 'text';
}

module.exports = {
  detectFormat
};
