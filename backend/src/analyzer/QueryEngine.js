/**
 * QueryEngine - Supports lightweight log DSL search and filtering.
 */
const COMPARE_OPERATORS = ['>=', '<=', '!=', '>', '<', '='];

function parseToken(token) {
  // Colon field:value syntax wins over comparison operators so values may
  // contain <, > or = (e.g. regex:<NUM>, url=http://x). Comparison operators
  // are only parsed for tokens without a colon (e.g. statusCode>=500).
  const parts = token.split(':');
  if (parts.length >= 2) {
    return { field: parts[0].trim(), operator: '=', value: parts.slice(1).join(':').trim() };
  }
  const numericComparison = COMPARE_OPERATORS.find(op => token.includes(op));
  if (numericComparison) {
    const [left, right] = token.split(numericComparison);
    return { field: left.trim(), operator: numericComparison, value: right.trim() };
  }
  return { field: null, operator: null, value: token.trim() };
}

function normalizeValue(value) {
  if (value === undefined || value === null) return '';
  return String(value).toLowerCase();
}

function matchesWildcard(target, pattern) {
  // Escape regex metacharacters (including *), then turn the escaped \*
  // back into a .* wildcard match.
  const escaped = pattern.replace(/[-/\\^$+?.()|[\]{}*]/g, '\\$&').replace(/\\\*/g, '.*');
  return new RegExp(`^${escaped}$`, 'i').test(target);
}

function fieldValue(log, field) {
  const key = String(field);
  const lower = key.toLowerCase();
  switch (lower) {
    case 'level': return log.level;
    case 'service': return log.service || log.metadata?.service;
    case 'host': return log.host || log.metadata?.host;
    case 'environment': return log.environment || log.metadata?.env || log.metadata?.environment;
    case 'category': return log.category || log.metadata?.category;
    case 'message': return log.message;
    case 'raw': return log.raw;
    case 'statuscode': return log.metrics?.statusCode;
    case 'durationms': return log.metrics?.durationMs;
    default: {
      if (log.metadata && log.metadata[key] !== undefined) return log.metadata[key];
      if (log.ids && log.ids[key] !== undefined) return log.ids[key];
      // Case-insensitive fallback so Service: matches a "service" metadata key
      if (log.metadata) {
        const mk = Object.keys(log.metadata).find(k => k.toLowerCase() === lower);
        if (mk !== undefined) return log.metadata[mk];
      }
      if (log.ids) {
        const ik = Object.keys(log.ids).find(k => k.toLowerCase() === lower);
        if (ik !== undefined) return log.ids[ik];
      }
      return null;
    }
  }
}

function buildPredicate(token) {
  const { field, operator, value } = parseToken(token);
  if (!field) {
    const term = normalizeValue(value.replace(/^"|"$/g, ''));
    return (log) => {
      return [log.raw, log.message, JSON.stringify(log.metadata), JSON.stringify(log.ids)]
        .some(str => normalizeValue(str).includes(term));
    };
  }

  // Handle patterns like "<NUM>" or "<PATH>" by converting them to regex
  if (value.includes('<NUM>') || value.includes('<PATH>') || value.includes('<UUID>') || value.includes('<IP>')) {
    const regexPattern = value.replace(/<NUM>/g, '\\d+').replace(/<PATH>/g, '[^\\s]+').replace(/<UUID>/g, '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}').replace(/<IP>/g, '\\d{1,3}\\.\\d{1,3}\\.\\d{1,3}\\.\\d{1,3}');
    const matcher = new RegExp(regexPattern, 'i');
    return (log) => {
      return matcher.test(log.message) || matcher.test(log.raw);
    };
  }

  const normalizedValue = value.replace(/^"|"$/g, '');
  const targetField = field.toLowerCase();

  if (targetField === 'regex' && normalizedValue) {
    let matcher;
    try {
      matcher = new RegExp(normalizedValue, 'i');
    } catch (e) {
      return () => false;
    }
    const safeMatcher = matcher;
    let callCount = 0;
    return (log) => {
      if (callCount++ > 10000) return false;
      try {
        return safeMatcher.test(log.raw) || safeMatcher.test(log.message);
      } catch (e) {
        return false;
      }
    };
  }

  return (log) => {
    const actual = fieldValue(log, targetField);
    if (actual === null || actual === undefined) return false;
    const actualNorm = normalizeValue(actual);
    const expectedNorm = normalizeValue(normalizedValue);

    if (operator === '=') {
      if (expectedNorm.includes('*')) {
        return matchesWildcard(actualNorm, expectedNorm);
      }
      return actualNorm === expectedNorm || actualNorm.includes(expectedNorm);
    }
    if (operator === '!=') {
      return actualNorm !== expectedNorm;
    }
    const actualNum = Number(actual);
    const expectedNum = Number(normalizedValue);
    if (Number.isNaN(actualNum) || Number.isNaN(expectedNum)) {
      return false;
    }
    if (operator === '>') return actualNum > expectedNum;
    if (operator === '<') return actualNum < expectedNum;
    if (operator === '>=') return actualNum >= expectedNum;
    if (operator === '<=') return actualNum <= expectedNum;
    return actualNorm.includes(expectedNorm);
  };
}

function tokenize(query) {
  if (!query || typeof query !== 'string') return [];
  const tokens = [];
  const regex = /"([^"]+)"|([^\s]+)/g;
  let match;
  while ((match = regex.exec(query)) !== null) {
    tokens.push(match[1] || match[2]);
  }
  return tokens;
}

function filterLogs(logs, query) {
  const terms = tokenize(query);
  if (!terms.length) return logs;
  const predicates = terms.map(buildPredicate);
  return logs.filter(log => predicates.every(fn => fn(log)));
}

module.exports = {
  filterLogs
};
