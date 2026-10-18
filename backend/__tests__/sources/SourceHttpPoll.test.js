/**
 * Unit tests for the HTTP-poll SSRF guard (isUrlAllowed).
 *
 * These pin the CURRENT behavior of the guard. Known limitations (DNS
 * resolution not validated, redirects followed, IPv4-mapped IPv6) are tracked
 * in SECURITY.md — tighten here together with the guard itself.
 */
const SourceHttpPoll = require('../../src/sources/SourceHttpPoll');
const { isUrlAllowed } = SourceHttpPoll;

describe('isUrlAllowed', () => {
  afterEach(() => {
    delete process.env.ALLOW_PRIVATE_URLS;
  });

  it('is exported from the module', () => {
    expect(typeof isUrlAllowed).toBe('function');
  });

  it('allows public http(s) URLs', () => {
    expect(isUrlAllowed('https://example.com/api/logs')).toBe(true);
    expect(isUrlAllowed('http://logs.example.org:8080/stream')).toBe(true);
  });

  it('rejects non-http protocols', () => {
    expect(isUrlAllowed('ftp://example.com/file')).toBe(false);
    expect(isUrlAllowed('file:///etc/passwd')).toBe(false);
    expect(isUrlAllowed('gopher://example.com')).toBe(false);
  });

  it('rejects unparsable URLs', () => {
    expect(isUrlAllowed('not a url')).toBe(false);
    expect(isUrlAllowed('')).toBe(false);
  });

  it('rejects localhost and .local hostnames', () => {
    expect(isUrlAllowed('http://localhost:5000/health')).toBe(false);
    expect(isUrlAllowed('http://sub.localhost/x')).toBe(false);
    expect(isUrlAllowed('http://nas.local/x')).toBe(false);
  });

  it('rejects loopback and link-local IPs (incl. cloud metadata)', () => {
    expect(isUrlAllowed('http://127.0.0.1:9200')).toBe(false);
    expect(isUrlAllowed('http://0.0.0.0')).toBe(false);
    expect(isUrlAllowed('http://169.254.169.254/latest/meta-data')).toBe(false);
    expect(isUrlAllowed('http://metadata.google.internal/computeMetadata/')).toBe(false);
  });

  it('rejects IPv6 loopback', () => {
    expect(isUrlAllowed('http://[::1]:8080')).toBe(false);
    expect(isUrlAllowed('http://[::]/')).toBe(false);
  });

  // Current design: RFC1918 private ranges are reachable so self-hosted
  // collectors (ELK, Grafana, internal APIs) can be polled.
  it('allows private RFC1918 ranges for self-hosted sources', () => {
    expect(isUrlAllowed('http://10.1.2.3:9200')).toBe(true);
    expect(isUrlAllowed('http://172.16.0.5/_search')).toBe(true);
    expect(isUrlAllowed('http://192.168.1.10/metrics')).toBe(true);
  });

  it('allows loopback only when ALLOW_PRIVATE_URLS=true', () => {
    process.env.ALLOW_PRIVATE_URLS = 'true';
    expect(isUrlAllowed('http://localhost:5000/health')).toBe(true);
  });
});
