/**
 * MultiLineGrouper — Groups continuation lines (stack traces, exceptions)
 * with their parent log line before parsing.
 *
 * Continuation detection patterns:
 *  - Java/.NET stack traces: lines starting with whitespace + "at "
 *  - Caused by: / Exception: chains
 *  - File "..." line references
 *  - "... N more" overflow markers
 *  - Lines that lack any timestamp pattern (heuristic fallback)
 */

const CONTINUATION_PATTERNS = [
  /^\s+at\s+/,                       // Java/.NET: "  at com.foo.Bar.method(File.java:42)"
  /^\s+Caused\s+by:/i,               // Java: "  Caused by: java.lang.NullPointerException"
  /^\s+Exception\s+in/i,             // Java: "  Exception in thread ..."
  /^\s+…\s+\d+\s+more$/,            // Java: "  ... 12 more"
  /^\s+File\s+["']/i,                // Python/JS traceback: '  File "foo.py", line 42'
  /^\s+at\s+/i,                      // Generic .NET: "   at System.Object.Invoke()"
  /^\s+---+\s+end\s+of/i,           // Java: "  --- End of stack trace ---"
  /^\s*\.{3}\s*\d+\s+more\s*$/,    // Python: "... 3 more"
  /^\s+raise\s+\w+/i,               // Python: "    raise ValueError('bad')"
  /^\s+Traceback\s+\(most recent/i,  // Python: "  Traceback (most recent call last):"
  // Postgres extended error detail (DETAIL, HINT, CONTEXT, QUERY)
  /^\s*(DETAIL|HINT|CONTEXT|QUERY)\s*:/i,
];

// Lines with timestamps are never continuations
const TIMESTAMP_PATTERNS = [
  /^\d{4}[-/]\d{2}[-/]\d{2}/,            // 2025-01-15 or 2025/01/15
  /^\d{2}[-/]\d{2}[-/]\d{4}/,            // 01-15-2025
  /^\[\d{4}[-/]\d{2}[-/]\d{2}/,          // [2025-01-15
  /^\d{2}:\d{2}:\d{2}/,                  // 14:30:00
  /^\d{10,13}[\s,]/,                      // Unix epoch: 1704067200 or 1704067200000
  /^\d{4}\d{2}\d{2}\s+\d{2}:\d{2}/,     // 20250115 14:30
  /^\w{3}\s+\d{1,2}\s+\d{2}:\d{2}/,     // Jan 15 14:30
  /^\d{1,2}\/\w{3}\/\d{4}/,             // 15/Jan/2025
];

// Strip RFC 5424 / RFC 3164 PRI headers (<134>1 or <131>)
function stripPriPrefix(line) {
  return line ? line.replace(/^<\d+>(?:\d\s+)?/, '') : '';
}

function isContinuationLine(line) {
  if (line.trim().length === 0) return false;
  const cleaned = stripPriPrefix(line);

  for (const pattern of CONTINUATION_PATTERNS) {
    if (pattern.test(cleaned)) return true;
  }

  return false;
}

function hasTimestamp(line) {
  const cleaned = stripPriPrefix(line);
  for (const pattern of TIMESTAMP_PATTERNS) {
    if (pattern.test(cleaned)) return true;
  }
  return false;
}

/**
 * Extract the first timestamp found in a line, or null.
 */
function extractTimestamp(line) {
  const cleaned = stripPriPrefix(line);
  const m = cleaned.match(/^(\d{4}[-/]\d{2}[-/]\d{2}[T ]\d{2}:\d{2}:\d{2})/);
  return m ? m[1] : null;
}

/**
 * Group raw lines into "logical" lines.
 * Returns an array of objects: { raw: string, startLine: number }
 */
function groupLines(rawLines) {
  const grouped = [];
  let current = null;
  let currentTimestamp = null;

  for (let i = 0; i < rawLines.length; i++) {
    const line = rawLines[i];

    if (isContinuationLine(line) && current) {
      current.raw += '\n' + line;
    } else if (hasTimestamp(line) || !current) {
      // If this line has a timestamp AND is a continuation, check if timestamps match
      const lineTs = extractTimestamp(line);
      if (isContinuationLine(line) && current && currentTimestamp && lineTs && lineTs === currentTimestamp) {
        // Same-timestamp continuation (e.g. Postgres DETAIL/HINT)
        current.raw += '\n' + line;
      } else {
        if (current) grouped.push(current);
        current = { raw: line, startLine: i };
        currentTimestamp = extractTimestamp(line);
      }
    } else {
      // Line has no timestamp and no continuation pattern — no parent either
      grouped.push({ raw: line, startLine: i });
    }
  }

  if (current) grouped.push(current);
  return grouped;
}

module.exports = { groupLines, isContinuationLine, hasTimestamp };
