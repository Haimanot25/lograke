const dns = require('dns').promises;

const MAX_REDIRECTS = 3;

function normalizeHost(hostname) {
  let host = String(hostname || '').toLowerCase();
  if (host.startsWith('[') && host.endsWith(']')) host = host.slice(1, -1);
  return host;
}

// IPv4 policy: block loopback (127/8), 0/8 and link-local/cloud-metadata
// (169.254/16). RFC1918 ranges stay reachable so self-hosted collectors can
// be polled (ALLOW_PRIVATE_URLS=true lifts every restriction).
function isIpv4Allowed(a, b, c, d) {
  if (a === 127 || a === 0) return false;
  if (a === 169 && b === 254) return false;
  return true;
}

function ipv4Octets(host) {
  const m = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return null;
  const n = m.slice(1).map(Number);
  if (n.some(x => x > 255)) return null;
  return n;
}

// Expand an IPv6 literal to its 16 bytes. Returns null when unparsable —
// the caller treats unparsable address literals as blocked (fail closed).
function ipv6ToBytes(raw) {
  const [addr] = String(raw).split('%'); // drop zone id
  const parts = addr.split('::');
  if (parts.length > 2) return null;
  const expand = (groups) => {
    const out = [];
    for (const g of groups) {
      if (g.includes('.')) {
        // trailing dotted-quad form, e.g. ::ffff:127.0.0.1
        const n = ipv4Octets(g);
        if (!n) return null;
        out.push(((n[0] << 8) | n[1]).toString(16), ((n[2] << 8) | n[3]).toString(16));
      } else {
        if (!/^[0-9a-f]{1,4}$/i.test(g)) return null;
        out.push(g.toLowerCase());
      }
    }
    return out;
  };
  const left = parts[0] ? expand(parts[0].split(':').filter(Boolean)) : expand([]);
  if (!left) return null;
  let groups;
  if (parts.length === 1) {
    if (left.length !== 8) return null;
    groups = left;
  } else {
    const right = parts[1] ? expand(parts[1].split(':').filter(Boolean)) : expand([]);
    if (!right) return null;
    const missing = 8 - left.length - right.length;
    if (missing < 0) return null;
    groups = [...left, ...Array(missing).fill('0'), ...right];
  }
  const bytes = [];
  for (const g of groups) {
    const v = parseInt(g, 16);
    bytes.push((v >> 8) & 0xff, v & 0xff);
  }
  return Buffer.from(bytes);
}

function isIpAllowed(host) {
  const octets = ipv4Octets(host);
  if (octets) return isIpv4Allowed(octets[0], octets[1], octets[2], octets[3]);
  if (host.includes(':')) {
    const bytes = ipv6ToBytes(host);
    if (!bytes || bytes.length !== 16) return false;
    // :: and ::1
    if (bytes.every(b => b === 0)) return false;
    if (bytes.slice(0, 15).every(b => b === 0) && bytes[15] === 1) return false;
    // fc00::/7 unique-local, fe80::/10 link-local
    if ((bytes[0] & 0xfe) === 0xfc) return false;
    if (bytes[0] === 0xfe && (bytes[1] & 0xc0) === 0x80) return false;
    // IPv4-mapped (::ffff:a.b.c.d) and IPv4-compatible (::a.b.c.d):
    // apply the IPv4 rules to the embedded address so ::ffff:127.0.0.1 and
    // ::ffff:7f00:1 are blocked just like 127.0.0.1 (finding #5).
    if (bytes.slice(0, 10).every(b => b === 0) && bytes[10] === 0xff && bytes[11] === 0xff) {
      return isIpv4Allowed(bytes[12], bytes[13], bytes[14], bytes[15]);
    }
    if (bytes.slice(0, 12).every(b => b === 0)) {
      return isIpv4Allowed(bytes[12], bytes[13], bytes[14], bytes[15]);
    }
    return true;
  }
  return true;
}

function isUrlAllowed(raw) {
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
  if (process.env.ALLOW_PRIVATE_URLS === 'true') return true;
  const host = normalizeHost(parsed.hostname);
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) return false;
  if (host === 'metadata.google.internal') return false;
  return isIpAllowed(host);
}

/**
 * Full SSRF validation for a URL: syntax/hostname rules via isUrlAllowed,
 * plus DNS pre-resolution — every resolved A/AAAA record must pass the same
 * IP policy (mitigates DNS rebinding; residual TOCTOU remains between this
 * check and the connection, see SECURITY.md).
 */
async function assertUrlResolvesSafe(raw) {
  if (!isUrlAllowed(raw)) throw new Error('URL blocked by SSRF guard');
  if (process.env.ALLOW_PRIVATE_URLS === 'true') return;
  const parsed = new URL(raw);
  const host = normalizeHost(parsed.hostname);
  if (ipv4Octets(host) || host.includes(':')) return; // literal, already validated
  let addrs;
  try {
    addrs = await dns.lookup(host, { all: true, verbatim: true });
  } catch {
    throw new Error(`DNS resolution failed for ${host}`);
  }
  if (!Array.isArray(addrs) || addrs.length === 0) throw new Error(`No DNS records for ${host}`);
  for (const { address } of addrs) {
    if (!isIpAllowed(normalizeHost(address))) {
      throw new Error(`Blocked resolved address ${address} for ${host}`);
    }
  }
}

/**
 * fetch() with SSRF guards: pre-resolves and validates the target, never
 * follows redirects automatically — each hop is re-validated (max 3).
 */
async function fetchWithSsrfGuard(url, options = {}) {
  const { maxRedirects = MAX_REDIRECTS, ...fetchOptions } = options;
  let current = url;
  for (let attempt = 0; attempt <= maxRedirects; attempt++) {
    await assertUrlResolvesSafe(current);
    const res = await fetch(current, { ...fetchOptions, redirect: 'manual' });
    if (![301, 302, 303, 307, 308].includes(res.status)) return res;
    const location = res.headers.get('location');
    if (!location) return res;
    await res.text().catch(() => {}); // drain before reusing the socket
    let next;
    try {
      next = new URL(location, current).toString();
    } catch {
      throw new Error('Invalid redirect target (SSRF guard)');
    }
    if (!isUrlAllowed(next)) throw new Error('Redirect target blocked by SSRF guard');
    current = next;
  }
  throw new Error('Too many redirects (SSRF guard)');
}

class SourceHttpPoll {
  constructor(sourceConfig, ingestCallback) {
    this.id = sourceConfig.id;
    this.config = sourceConfig.config || {};
    this.url = this.config.url || '';
    this.intervalMs = (parseInt(this.config.intervalSeconds, 10) || 60) * 1000;
    this.authType = this.config.authType || 'none';
    this.authValue = this.config.authValue || '';
    this.customHeaders = this.config.customHeaders || {};
    this.ingestCallback = ingestCallback;
    this.timer = null;
    this.running = false;
    this.urlAllowed = isUrlAllowed(this.url);
    this.stats = { polls: 0, received: 0, ingested: 0, errors: 0, lastPollTime: null };
  }

  async start() {
    if (this.running) return;
    this.running = true;
    this.timer = setInterval(() => this.poll(), this.intervalMs);
    await this.poll();
  }

  async poll() {
    if (!this.url) { this.stats.errors++; return; }
    if (!isUrlAllowed(this.url)) { this.stats.errors++; return; }
    this.stats.polls++;
    this.stats.lastPollTime = new Date().toISOString();
    try {
      const headers = { ...this.customHeaders };
      if (this.authType === 'basic' && this.authValue) {
        headers['Authorization'] = 'Basic ' + Buffer.from(this.authValue).toString('base64');
      } else if (this.authType === 'bearer' && this.authValue) {
        headers['Authorization'] = 'Bearer ' + this.authValue;
      }
      const res = await fetchWithSsrfGuard(this.url, { headers, signal: AbortSignal.timeout(30000) });
      if (!res.ok) { this.stats.errors++; return; }
      const text = await res.text();
      this.stats.received += text.length;
      const lines = text.split(/\r?\n/).filter(l => l.trim());
      if (lines.length === 0) return;
      const sourceName = `http_poll_${this.id}_${new Date().toISOString().slice(0, 10)}`;
      await this.ingestCallback(sourceName, lines, { source: `http_poll:${this.id}`, sourcePath: this.url });
      this.stats.ingested += lines.length;
    } catch (err) {
      this.stats.errors++;
    }
  }

  async stop() {
    this.running = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  getStats() {
    return { ...this.stats };
  }

  toJSON() {
    return {
      id: this.id,
      type: 'http_poll',
      url: this.url,
      intervalSeconds: Math.round(this.intervalMs / 1000),
      running: this.running,
      stats: this.getStats()
    };
  }
}

module.exports = SourceHttpPoll;
// Exported for the SSRF-guard unit tests
module.exports.isUrlAllowed = isUrlAllowed;
module.exports.isIpAllowed = isIpAllowed;
module.exports.assertUrlResolvesSafe = assertUrlResolvesSafe;
module.exports.fetchWithSsrfGuard = fetchWithSsrfGuard;
