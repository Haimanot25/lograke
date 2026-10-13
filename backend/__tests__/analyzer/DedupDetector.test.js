const { detectDuplicates, normalizeMessage } = require('../../src/analyzer/DedupDetector');

describe('DedupDetector', () => {
  describe('normalizeMessage', () => {
    it('should strip UUIDs', () => {
      const result = normalizeMessage('Request abc12345-def6-7890-abcd-ef1234567890 completed');
      expect(result).toContain('<VAR>');
      expect(result).not.toContain('abc12345');
    });

    it('should strip IPv4 addresses', () => {
      const result = normalizeMessage('Connection from 192.168.1.100 accepted');
      expect(result).toContain('<VAR>');
      expect(result).not.toContain('192.168.1.100');
    });

    it('should strip timestamps', () => {
      const result = normalizeMessage('Event at 2025-01-15T14:30:00 processed');
      expect(result).toContain('<VAR>');
      expect(result).not.toContain('2025-01-15');
    });

    it('should not strip common words', () => {
      const result = normalizeMessage('ERROR connection refused to database');
      expect(result).toContain('ERROR');
      expect(result).toContain('connection');
      expect(result).toContain('database');
    });
  });

  describe('detectDuplicates', () => {
    it('should detect exact duplicates', () => {
      const logs = [
        { message: 'Connection timeout to database' },
        { message: 'Connection timeout to database' },
        { message: 'Connection timeout to database' },
        { message: 'Server started successfully' },
      ];

      const summary = detectDuplicates(logs);
      expect(summary.total).toBe(4);
      expect(summary.duplicates).toBe(2);
      expect(logs[0].duplicateCount).toBe(3);
      expect(logs[1].isDuplicate).toBe(true);
      expect(logs[2].isDuplicate).toBe(true);
      expect(logs[3].isDuplicate).toBeUndefined();
    });

    it('should not flag unique messages', () => {
      const logs = [
        { message: 'Server started' },
        { message: 'Request received' },
        { message: 'Response sent' },
      ];

      const summary = detectDuplicates(logs);
      expect(summary.duplicates).toBe(0);
      expect(summary.unique).toBe(3);
    });

    it('should handle empty input', () => {
      const summary = detectDuplicates([]);
      expect(summary.total).toBe(0);
      expect(summary.duplicates).toBe(0);
    });

    it('should compute fingerprints', () => {
      const logs = [
        { message: 'Request 12345 completed' },
        { message: 'Request 67890 completed' },
      ];

      detectDuplicates(logs);
      expect(logs[0].fingerprint).toBeDefined();
      expect(logs[1].fingerprint).toBeDefined();
      // Near-duplicates (same structure, different numbers) should have same fingerprint
      expect(logs[0].fingerprint).toBe(logs[1].fingerprint);
    });

    it('should count near-unique groups', () => {
      const logs = [
        { message: 'Error 1001 occurred' },
        { message: 'Error 1002 occurred' },
        { message: 'Error 1003 occurred' },
        { message: 'Connection timeout' },
      ];

      const summary = detectDuplicates(logs);
      expect(summary.nearUniqueGroups).toBe(2); // "Error <VAR> occurred" and "Connection timeout"
    });
  });
});
