/**
 * formatParsers.js - Shared log format parser functions
 * Extracted from EnhancedParser.js and AdaptiveParser.js
 * Provides: hdfs, bgl, thunderbird, healthapp, hpc, proxifier
 * Each format exports detect(line) and parseLine(line, index)
 */

/* ── HDFS ────────────────────────────────────────────────────── */
function parseHDFSFields(line) {
  const match = line.match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})[.,](\d{3,6})\s+(.*)$/);
  if (!match) return null;
  return {
    year: match[1], month: match[2], day: match[3],
    hour: match[4], min: match[5], sec: match[6],
    ms: match[7].padEnd(3, '0'),
    rest: match[8]
  };
}

function detectHDFS(line) {
  return /^\d{4}\d{2}\d{2}\d{2}\d{2}\d{2}[.,]\d+/.test(line);
}

function parseHDFSLine(line, index) {
  const fields = parseHDFSFields(line);
  if (!fields) return null;
  return { fields, line, index };
}

/* ── BGL ─────────────────────────────────────────────────────── */
function parseBGLFields(line) {
  const match = line.match(/^(\d{4})(\d{2})(\d{2})\s+(\d{2}:\d{2}:\d{2}\.\d+)\s+(\w+)\s+(.*)$/);
  if (!match) return null;
  return {
    year: match[1], month: match[2], day: match[3],
    time: match[4], levelWord: match[5], message: match[6]
  };
}

function detectBGL(line) {
  return /^\d{4}\d{2}\d{2}\s+\d{2}:\d{2}:\d{2}\.\d+\s+(?:FATAL|SEVERE|ERROR|WARN|INFO|DEBUG|TRACE|CONFIG)\s/.test(line);
}

function parseBGLLine(line, index) {
  const fields = parseBGLFields(line);
  if (!fields) return null;
  return { fields, line, index };
}

/* ── Thunderbird ─────────────────────────────────────────────── */
function parseThunderbirdFields(line) {
  const tsMatch = line.match(/(\d{2})-(\d{2})-(\d{4})\s+(\d{2}:\d{2}:\d{2})\.(\d+)/);
  if (!tsMatch) return null;
  return {
    day: tsMatch[1], month: tsMatch[2], year: tsMatch[3],
    time: tsMatch[4], ms: tsMatch[5],
    pipeParts: line.split('|')
  };
}

function detectThunderbird(line) {
  return /^\d{2}-\d{2}-\d{4}\s+\d{2}:\d{2}:\d{2}\.\d+/.test(line);
}

function parseThunderbirdLine(line, index) {
  const fields = parseThunderbirdFields(line);
  if (!fields) return null;
  return { fields, line, index };
}

/* ── HealthApp ───────────────────────────────────────────────── */
function parseHealthAppFields(line) {
  const parts = line.split('|').map(s => s.trim());
  if (parts.length < 3) return null;
  const tsMatch = line.match(/(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}\.\d+)/);
  return {
    parts,
    tsStr: tsMatch ? tsMatch[1] : null
  };
}

function detectHealthApp(line) {
  return /^\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}\.\d+\|/.test(line);
}

function parseHealthAppLine(line, index) {
  const fields = parseHealthAppFields(line);
  if (!fields) return null;
  return { fields, line, index };
}

/* ── HPC ─────────────────────────────────────────────────────── */
function parseHPCFields(line) {
  const procMatch = line.match(/\[([^\]]+):(\d+)\]/);
  return {
    epochMatch: line.match(/\b(\d{10,13})\b/),
    procMatch
  };
}

function detectHPC(line) {
  return /\b\d{10,13}\b.*\[[^\]]+\]/.test(line);
}

function parseHPCLine(line, index) {
  const fields = parseHPCFields(line);
  if (!fields) return null;
  return { fields, line, index };
}

/* ── Proxifier ───────────────────────────────────────────────── */
function parseProxifierFields(line) {
  const match = line.match(/^\[(\d{4})\.(\d{2})\.(\d{2})\s+(\d{2})\.(\d{2})\.(\d{2})\.(\d{3})\]\s+(.*)$/);
  if (!match) return null;
  return {
    year: match[1], month: match[2], day: match[3],
    hour: match[4], min: match[5], sec: match[6], ms: match[7],
    message: match[8]
  };
}

function detectProxifier(line) {
  return /^\[\d{4}\.\d{2}\.\d{2}\s+\d{2}\.\d{2}\.\d{2}\.\d{3}\]\s+/.test(line);
}

function parseProxifierLine(line, index) {
  const fields = parseProxifierFields(line);
  if (!fields) return null;
  return { fields, line, index };
}

/* ── Detect format ───────────────────────────────────────────── */
const formatParsers = {
  hdfs: { detect: detectHDFS, parseLine: parseHDFSLine },
  bgl: { detect: detectBGL, parseLine: parseBGLLine },
  thunderbird: { detect: detectThunderbird, parseLine: parseThunderbirdLine },
  healthapp: { detect: detectHealthApp, parseLine: parseHealthAppLine },
  hpc: { detect: detectHPC, parseLine: parseHPCLine },
  proxifier: { detect: detectProxifier, parseLine: parseProxifierLine }
};

function detectFormat(line) {
  for (const [key, parser] of Object.entries(formatParsers)) {
    if (parser.detect(line)) return key;
  }
  return null;
}

module.exports = { formatParsers, detectFormat };
