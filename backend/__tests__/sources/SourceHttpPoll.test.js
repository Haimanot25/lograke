/**
 * Unit tests for the HTTP-poll SSRF guard (isUrlAllowed / isIpAllowed).
 *
 * Finding #5 hardening: IPv4-mapped IPv6 (::ffff:) now falls under the IPv4
 * rules, DNS results are pre-validated, and redirects are re-checked per hop
 * (DNS/redirect behavior is covered in SourceHttpPoll.ssrf.test.js).
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

  // Finding #5: IPv4-mapped IPv6 must obey the IPv4 policy — this was the
  // documented bypass that let 127.0.0.1 back in as ::ffff:127.0.0.1.
  it('rejects IPv4-mapped IPv6 loopback and metadata addresses', () => {
    expect(isUrlAllowed('http://[::ffff:127.0.0.1]/')).toBe(false);
    expect(isUrlAllowed('http://[::ffff:169.254.169.254]/latest/meta-data/')).toBe(false);
    expect(isUrlAllowed('http://[::ffff:0.0.0.0]/')).toBe(false);
    // hex-encoded embedded form: 127.0.0.1 = 7f00:1
    expect(isUrlAllowed('http://[::ffff:7f00:1]/')).toBe(false);
  });

  it('applies IPv4 policy to IPv4-compatible IPv6 too', () => {
    expect(isUrlAllowed('http://[::127.0.0.1]/')).toBe(false);
    // ::ffff:10.1.2.3 → mapped private, same policy as 10.1.2.3 (allowed)
    expect(isUrlAllowed('http://[::ffff:10.1.2.3]/')).toBe(true);
  });

  it('keeps blocking unique-local and link-local IPv6 ranges', () => {
    expect(isUrlAllowed('http://[fd00::1]/')).toBe(false);
    expect(isUrlAllowed('http://[fc00::1]/')).toBe(false);
    expect(isUrlAllowed('http://[fe80::1]/')).toBe(false);
    // public v6 stays reachable
    expect(isUrlAllowed('http://[2606:4700:4700::1111]/')).toBe(true);
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
