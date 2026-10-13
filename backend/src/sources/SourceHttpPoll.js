function isUrlAllowed(raw) {
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
  if (process.env.ALLOW_PRIVATE_URLS === 'true') return true;
  let host = parsed.hostname.toLowerCase();
  if (host.startsWith('[') && host.endsWith(']')) host = host.slice(1, -1);
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) return false;
  if (host === 'metadata.google.internal') return false;
  const ipv4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4) {
    const a = Number(ipv4[1]);
    const b = Number(ipv4[2]);
    if (a === 127 || a === 0) return false;
    if (a === 169 && b === 254) return false;
    return true;
  }
  if (host.includes(':')) {
    if (host === '::1' || host === '::') return false;
    if (/^(fe80:|fc|fd)/i.test(host)) return false;
    return true;
  }
  return true;
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
      const res = await fetch(this.url, { headers, signal: AbortSignal.timeout(30000) });
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
