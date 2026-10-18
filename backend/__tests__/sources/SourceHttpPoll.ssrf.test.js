/**
 * Finding #5 hardening: DNS pre-resolution and redirect re-validation for
 * the HTTP-poll SSRF guard (assertUrlResolvesSafe / fetchWithSsrfGuard).
 */
jest.mock('dns', () => ({ promises: { lookup: jest.fn() } }));
const dns = require('dns').promises;
const SourceHttpPoll = require('../../src/sources/SourceHttpPoll');
const { assertUrlResolvesSafe, fetchWithSsrfGuard } = SourceHttpPoll;

const PUBLIC = [{ address: '93.184.216.34' }];

function redirectResponse(status, location) {
  return {
    status,
    headers: { get: (h) => (h === 'location' ? location : null) },
    text: async () => ''
  };
}

function okResponse(body = 'log line') {
  return {
    status: 200,
    ok: true,
    headers: { get: () => null },
    text: async () => body
  };
}

describe('assertUrlResolvesSafe (DNS pre-resolution)', () => {
  afterEach(() => {
    delete process.env.ALLOW_PRIVATE_URLS;
    dns.lookup.mockReset();
  });

  it('accepts hostnames that resolve only to allowed addresses', async () => {
    dns.lookup.mockResolvedValue(PUBLIC);
    await expect(assertUrlResolvesSafe('https://example.com/api')).resolves.toBeUndefined();
    expect(dns.lookup).toHaveBeenCalledWith('example.com', { all: true, verbatim: true });
  });

  it('rejects hostnames that resolve to loopback (DNS rebinding)', async () => {
    dns.lookup.mockResolvedValue([{ address: '127.0.0.1' }]);
    await expect(assertUrlResolvesSafe('https://rebind.example.com/x'))
      .rejects.toThrow(/Blocked resolved address 127\.0\.0\.1/);
  });

  it('rejects when any single record in the answer is blocked', async () => {
    dns.lookup.mockResolvedValue([...PUBLIC, { address: '169.254.169.254' }]);
    await expect(assertUrlResolvesSafe('https://mixed.example.com/x'))
      .rejects.toThrow(/169\.254\.169\.254/);
  });

  it('rejects when DNS resolution fails outright', async () => {
    dns.lookup.mockRejectedValue(new Error('ENOTFOUND'));
    await expect(assertUrlResolvesSafe('https://nxdomain.example.com/'))
      .rejects.toThrow(/DNS resolution failed/);
  });

  it('skips DNS entirely for IP literals (already validated by syntax check)', async () => {
    await assertUrlResolvesSafe('http://10.1.2.3:9200/');
    expect(dns.lookup).not.toHaveBeenCalled();
    await expect(assertUrlResolvesSafe('http://127.0.0.1/')).rejects.toThrow(/SSRF guard/);
  });

  it('bypasses everything when ALLOW_PRIVATE_URLS=true', async () => {
    process.env.ALLOW_PRIVATE_URLS = 'true';
    await expect(assertUrlResolvesSafe('http://localhost:5000/health')).resolves.toBeUndefined();
    expect(dns.lookup).not.toHaveBeenCalled();
  });
});

describe('fetchWithSsrfGuard (redirect handling)', () => {
  const fetchMock = jest.fn();

  beforeAll(() => {
    global.fetch = fetchMock;
  });

  beforeEach(() => {
    fetchMock.mockReset();
    dns.lookup.mockResolvedValue(PUBLIC);
  });

  afterEach(() => {
    delete process.env.ALLOW_PRIVATE_URLS;
  });

  it('never follows a redirect to a blocked target', async () => {
    fetchMock.mockResolvedValueOnce(redirectResponse(302, 'http://127.0.0.1/steal'));
    await expect(fetchWithSsrfGuard('https://example.com/hop'))
      .rejects.toThrow(/Redirect target blocked/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('re-validates every hop of an allowed redirect chain', async () => {
    fetchMock
      .mockResolvedValueOnce(redirectResponse(307, 'https://cdn.example.org/next'))
      .mockResolvedValueOnce(okResponse('ingest me'));
    const res = await fetchWithSsrfGuard('https://example.com/start');
    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1][0]).toBe('https://cdn.example.org/next');
    // each hop is fetched manually — never with auto-follow
    expect(fetchMock.mock.calls[0][1].redirect).toBe('manual');
    expect(fetchMock.mock.calls[1][1].redirect).toBe('manual');
  });

  it('gives up after too many redirects', async () => {
    fetchMock.mockImplementation(async (url) => redirectResponse(302, `${url}/hop`));
    await expect(fetchWithSsrfGuard('https://example.com/loop', { maxRedirects: 2 }))
      .rejects.toThrow(/Too many redirects/);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('returns non-redirect responses untouched', async () => {
    fetchMock.mockResolvedValueOnce(okResponse());
    const res = await fetchWithSsrfGuard('https://example.com/logs');
    expect(await res.text()).toBe('log line');
  });
});
