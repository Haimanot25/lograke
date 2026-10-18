/**
 * SourceSftp — lifecycle placeholder for SFTP sources.
 *
 * start()/stop() only track status; this class does NOT poll remote servers.
 * SFTP ingestion is on-demand via the /sftp-list and /sftp-ingest endpoints
 * in routes/logSources.js (surfaced as the SFTP browser in the Sources page).
 */
class SourceSftp {
  constructor(sourceConfig, ingestCallback) {
    this.id = sourceConfig.id;
    this.config = sourceConfig.config || {};
    this.host = this.config.host || '';
    this.port = parseInt(this.config.port, 10) || 22;
    this.username = this.config.username || '';
    this.password = this.config.password || '';
    this.remotePath = this.config.remotePath || '/';
    this.filePattern = this.config.filePattern || '*.log';
    this.intervalMs = (parseInt(this.config.intervalSeconds, 10) || 60) * 1000;
    this.deleteAfterDownload = this.config.deleteAfterDownload === true;
    this.ingestCallback = ingestCallback;
    this.running = false;
    this.stats = { polls: 0, filesDownloaded: 0, linesIngested: 0, errors: 0, lastPollTime: null, lastError: null };
  }

  async start() {
    this.running = true;
  }

  async stop() {
    this.running = false;
  }

  getStats() { return { ...this.stats }; }

  toJSON() {
    return {
      id: this.id, type: 'sftp',
      host: this.host, port: this.port,
      username: this.username,
      remotePath: this.remotePath,
      filePattern: this.filePattern,
      intervalSeconds: Math.round(this.intervalMs / 1000),
      running: this.running,
      stats: this.getStats()
    };
  }
}

module.exports = SourceSftp;
