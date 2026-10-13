const { AdaptiveParser } = require('../../src/parser/AdaptiveParser');

describe('AdaptiveParser - Severity Inference', () => {
  let parser;
  beforeEach(() => {
    parser = new AdaptiveParser();
  });

  describe('inferLevelFromText', () => {
    it('should detect ERROR from exception class names', () => {
      expect(parser.inferLevelFromText('NullPointerException at handler')).toBe('ERROR');
    });

    it('should detect ERROR from .NET exception names', () => {
      expect(parser.inferLevelFromText('System.InvalidOperationException thrown')).toBe('ERROR');
    });

    it('should detect ERROR from HTTP 5xx status codes', () => {
      expect(parser.inferLevelFromText('HTTP 500 Internal Server Error')).toBe('ERROR');
    });

    it('should detect WARN from HTTP 4xx status codes', () => {
      expect(parser.inferLevelFromText('HTTP 404 Not Found')).toBe('WARN');
    });

    it('should detect ERROR from crashed/crash keywords', () => {
      expect(parser.inferLevelFromText('Process crashed unexpectedly')).toBe('ERROR');
    });

    it('should detect ERROR from timeout keyword', () => {
      expect(parser.inferLevelFromText('Connection timeout after 30s')).toBe('ERROR');
    });

    it('should detect WARN from deprecated keyword', () => {
      expect(parser.inferLevelFromText('API endpoint deprecated')).toBe('WARN');
    });

    it('should detect WARN from retry keyword', () => {
      expect(parser.inferLevelFromText('Retried connection after failure')).toBe('WARN');
    });

    it('should detect DEBUG from trace keyword', () => {
      expect(parser.inferLevelFromText('Trace message for debugging')).toBe('DEBUG');
    });

    it('should default to INFO for normal messages', () => {
      expect(parser.inferLevelFromText('Server started on port 8080')).toBe('INFO');
    });

    it('should detect ERROR from segfault', () => {
      expect(parser.inferLevelFromText('Segmentation fault at address 0x0')).toBe('ERROR');
    });

    it('should detect ERROR from OOM', () => {
      expect(parser.inferLevelFromText('Out of memory error')).toBe('ERROR');
    });
  });
});
