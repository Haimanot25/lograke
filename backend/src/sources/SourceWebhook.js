const crypto = require('crypto');

class SourceWebhook {
  constructor(sourceConfig, ingestCallback) {
    this.id = sourceConfig.id;
    this.config = sourceConfig.config || {};
    this.apiKey = this.config.apiKey || crypto.randomBytes(24).toString('hex');
    this.ingestCallback = ingestCallback;
    this.stats = { received: 0, ingested: 0, errors: 0 };
  }

  getWebhookUrl(baseUrl) {
    return `${baseUrl.replace(/\/+$/, '')}/api/logs/ingest/webhook/${this.id}`;
  }

  getApiKey() {
    return this.apiKey;
  }

  validateApiKey(key) {
    return key === this.apiKey;
  }

  async handlePayload(body, ip) {
    this.stats.received++;
    try {
      const rawText = Array.isArray(body) ? body.join('\n') : (typeof body === 'string' ? body : JSON.stringify(body));
      if (!rawText || !rawText.trim()) {
        return { accepted: 0, error: 'Empty payload' };
      }
      const lines = rawText.split(/\r?\n/).filter(l => l.trim());
      const sourceName = `webhook_${this.id}_${new Date().toISOString().slice(0, 10)}`;
      await this.ingestCallback(sourceName, lines, { source: `webhook:${this.id}`, sourcePath: `webhook://${ip || 'unknown'}` });
      this.stats.ingested += lines.length;
      return { accepted: lines.length };
    } catch (err) {
      this.stats.errors++;
      return { accepted: 0, error: err.message };
    }
  }

  getStats() {
    return { ...this.stats };
  }

  toJSON(baseUrl) {
    return {
      id: this.id,
      type: 'webhook',
      webhookUrl: this.getWebhookUrl(baseUrl),
      apiKey: this.apiKey,
      stats: this.getStats()
    };
  }
}

module.exports = SourceWebhook;
