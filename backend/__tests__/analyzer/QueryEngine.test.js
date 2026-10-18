/**
 * Unit tests for the log query DSL (QueryEngine.filterLogs).
 */
const { filterLogs } = require('../../src/analyzer/QueryEngine');

const logs = [
  {
    level: 'ERROR',
    message: 'Payment gateway timeout',
    raw: '2026-10-18 10:00:04 ERROR Payment gateway timeout',
    metadata: { service: 'payments' },
    ids: { requestId: 'req-1' },
    metrics: { statusCode: 504 },
  },
  {
    level: 'INFO',
    message: 'User logged in',
    raw: '2026-10-18 10:00:05 INFO User logged in',
    metadata: { service: 'auth' },
    ids: { requestId: 'req-2' },
    metrics: { statusCode: 200 },
  },
  {
    level: 'WARN',
    message: 'Cache miss ratio high',
    raw: '2026-10-18 10:00:06 WARN Cache miss ratio high',
    metadata: { service: 'payments' },
    ids: {},
    metrics: { statusCode: 503 },
  },
];

describe('filterLogs', () => {
  it('returns everything for an empty query', () => {
    expect(filterLogs(logs, '')).toHaveLength(3);
    expect(filterLogs(logs, null)).toHaveLength(3);
  });

  it('matches free text across raw, message, metadata and ids', () => {
    expect(filterLogs(logs, 'timeout')).toHaveLength(1);
    expect(filterLogs(logs, 'payments')).toHaveLength(2);
    expect(filterLogs(logs, 'req-2')).toHaveLength(1);
  });

  it('is case-insensitive', () => {
    expect(filterLogs(logs, 'TIMEOUT')).toHaveLength(1);
    expect(filterLogs(logs, 'level:error')).toHaveLength(1);
  });

  it('supports key:value field filters', () => {
    expect(filterLogs(logs, 'level:WARN')).toHaveLength(1);
    expect(filterLogs(logs, 'service:payments')).toHaveLength(2);
    expect(filterLogs(logs, 'level:ERROR service:payments')).toHaveLength(1);
  });

  it('supports negation with !=', () => {
    expect(filterLogs(logs, 'level!=ERROR')).toHaveLength(2);
  });

  it('supports numeric comparisons', () => {
    expect(filterLogs(logs, 'statusCode>=500')).toHaveLength(2);
    expect(filterLogs(logs, 'statusCode<300')).toHaveLength(1);
  });

  it('supports wildcard values', () => {
    expect(filterLogs(logs, 'message:cache*')).toHaveLength(1);
    expect(filterLogs(logs, 'service:pay*')).toHaveLength(2);
  });

  it('supports quoted phrases', () => {
    expect(filterLogs(logs, '"user logged"')).toHaveLength(1);
  });

  it('supports regex: predicates', () => {
    expect(filterLogs(logs, 'regex:payment.*timeout')).toHaveLength(1);
    expect(filterLogs(logs, 'regex:^cache')).toHaveLength(1);
    expect(filterLogs(logs, 'regex:[invalid')).toHaveLength(0); // invalid regex matches nothing
  });

  it('expands <NUM> pattern tokens', () => {
    expect(filterLogs(logs, 'regex:<NUM>')).toHaveLength(3);
  });

  it('returns nothing when no log matches', () => {
    expect(filterLogs(logs, 'unicorn-munchies')).toHaveLength(0);
  });
});
