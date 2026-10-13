const { groupLines, isContinuationLine, hasTimestamp } = require('../../src/parser/MultiLineGrouper');

describe('MultiLineGrouper', () => {
  describe('isContinuationLine', () => {
    it('should detect Java stack trace lines', () => {
      expect(isContinuationLine('  at com.foo.Bar.method(File.java:42)')).toBe(true);
      expect(isContinuationLine('	at System.Object.Invoke()')).toBe(true);
    });

    it('should detect Caused by lines', () => {
      expect(isContinuationLine('  Caused by: java.lang.NullPointerException')).toBe(true);
      expect(isContinuationLine('  Caused by: System.InvalidOperationException')).toBe(true);
    });

    it('should detect Python traceback lines', () => {
      expect(isContinuationLine('  File "foo.py", line 42, in <module>')).toBe(true);
      expect(isContinuationLine('    raise ValueError("bad")')).toBe(true);
      expect(isContinuationLine('  Traceback (most recent call last):')).toBe(true);
    });

    it('should detect overflow markers', () => {
      expect(isContinuationLine('  ... 12 more')).toBe(true);
      expect(isContinuationLine('  … 3 more')).toBe(true);
    });

    it('should not detect timestamped lines as continuations', () => {
      expect(isContinuationLine('2025-01-15 INFO Starting application')).toBe(false);
    });

    it('should not detect empty lines as continuations', () => {
      expect(isContinuationLine('')).toBe(false);
      expect(isContinuationLine('   ')).toBe(false);
    });

    it('should not detect normal log lines as continuations', () => {
      expect(isContinuationLine('INFO: Server started on port 8080')).toBe(false);
      expect(isContinuationLine('GET /api/users 200 12ms')).toBe(false);
    });
  });

  describe('hasTimestamp', () => {
    it('should detect ISO timestamps', () => {
      expect(hasTimestamp('2025-01-15T14:30:00Z INFO Starting')).toBe(true);
      expect(hasTimestamp('2025-01-15 INFO Starting')).toBe(true);
    });

    it('should detect bracket timestamps', () => {
      expect(hasTimestamp('[2025-01-15 14:30:00] INFO Starting')).toBe(true);
    });

    it('should detect time-only patterns', () => {
      expect(hasTimestamp('14:30:00 INFO Starting')).toBe(true);
    });

    it('should detect epoch timestamps', () => {
      expect(hasTimestamp('1704067200 INFO Starting')).toBe(true);
      expect(hasTimestamp('1704067200000 INFO Starting')).toBe(true);
    });

    it('should not detect plain text', () => {
      expect(hasTimestamp('Server started on port 8080')).toBe(false);
    });
  });

  describe('groupLines', () => {
    it('should group stack trace lines with their parent', () => {
      const lines = [
        '2025-01-15 ERROR NullPointerException in handler',
        '  at com.foo.Bar.method(File.java:42)',
        '  at com.foo.Baz.run(Baz.java:10)',
        '2025-01-15 INFO Request completed',
      ];

      const grouped = groupLines(lines);
      expect(grouped).toHaveLength(2);
      expect(grouped[0].raw).toContain('NullPointerException');
      expect(grouped[0].raw).toContain('at com.foo.Bar.method');
      expect(grouped[0].raw).toContain('at com.foo.Baz.run');
      expect(grouped[1].raw).toBe('2025-01-15 INFO Request completed');
    });

    it('should group Caused by chains', () => {
      const lines = [
        '2025-01-15 ERROR Transaction failed',
        '  Caused by: ConnectionTimeoutException',
        '  at org.db.ConnectionPool.acquire(ConnectionPool.java:100)',
      ];

      const grouped = groupLines(lines);
      expect(grouped).toHaveLength(1);
      expect(grouped[0].raw).toContain('Transaction failed');
      expect(grouped[0].raw).toContain('Caused by: ConnectionTimeoutException');
    });

    it('should handle standalone continuation lines without parent', () => {
      const lines = [
        '  at orphaned.method()',
      ];

      const grouped = groupLines(lines);
      expect(grouped).toHaveLength(1);
    });

    it('should preserve line numbers', () => {
      const lines = [
        '2025-01-15 ERROR Line 1',
        '  at stack.trace()',
        '2025-01-15 ERROR Line 3',
      ];

      const grouped = groupLines(lines);
      expect(grouped[0].startLine).toBe(0);
      expect(grouped[1].startLine).toBe(2);
    });

    it('should handle empty input', () => {
      expect(groupLines([])).toHaveLength(0);
    });
  });
});
