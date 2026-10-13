const dgram = require('dgram');
const { createServer } = require('net');

const RFC3164_RE = /^<(\d+)>?([A-Z][a-z]{2}\s+\d+\s+\d{2}:\d{2}:\d{2})\s+(\S+)\s+(\S+)\s*(.*)$/;
const RFC5424_RE = /^<(\d+)>?\d+\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s*(.*)$/;

const FACILITY_NAMES = {
  0: 'kern', 1: 'user', 2: 'mail', 3: 'daemon', 4: 'auth',
  5: 'syslog', 6: 'lpr', 7: 'news', 8: 'uucp', 9: 'cron',
  10: 'authpriv', 11: 'ftp', 16: 'local0', 17: 'local1',
  18: 'local2', 19: 'local3', 20: 'local4', 21: 'local5',
  22: 'local6', 23: 'local7'
};

const SEVERITY_MAP = {
  0: 'FATAL', 1: 'ERROR', 2: 'ERROR', 3: 'ERROR',
  4: 'WARN', 5: 'INFO', 6: 'INFO', 7: 'DEBUG'
};

function parsePriority(code) {
  const pri = parseInt(code, 10);
  return { facility: pri >> 3, severity: pri & 7 };
}

function parseSyslogLine(raw) {
  let match = raw.match(RFC5424_RE);
  if (match) {
    const pri = parsePriority(match[1]);
    return {
      timestamp: match[2],
      hostname: match[3],
      appName: match[4],
      procId: match[5],
      msgId: match[6],
      message: match[9] || '',
      facility: FACILITY_NAMES[pri.facility] || `facility_${pri.facility}`,
      severity: SEVERITY_MAP[pri.severity] || 'INFO'
    };
  }
  match = raw.match(RFC3164_RE);
  if (match) {
    const pri = parsePriority(match[1]);
    return {
      timestamp: match[2],
      hostname: match[3],
      appName: match[4],
      message: match[5] || '',
      facility: FACILITY_NAMES[pri.facility] || `facility_${pri.facility}`,
      severity: SEVERITY_MAP[pri.severity] || 'INFO',
      procId: ''
    };
  }
  return {
    timestamp: new Date().toISOString(),
    hostname: '',
    appName: '',
    message: raw,
    facility: 'unknown',
    severity: 'INFO',
    procId: ''
  };
}

class SourceSyslog {
  constructor(sourceConfig, ingestCallback) {
    this.id = sourceConfig.id;
    this.config = sourceConfig.config || {};
    this.port = parseInt(this.config.port, 10) || 1514;
    this.protocol = (this.config.protocol || 'udp').toLowerCase();
    this.ingestCallback = ingestCallback;
    this.udpServer = null;
    this.tcpServer = null;
    this.running = false;
    this.stats = { received: 0, ingested: 0, errors: 0 };
    this.buffer = [];
    this.flushTimer = null;
  }

  async start() {
    if (this.running) return;
    this.running = true;

    if (this.protocol === 'udp' || this.protocol === 'both') {
      this.udpServer = dgram.createSocket('udp4');
      this.udpServer.on('message', (msg, rinfo) => {
        this.stats.received++;
        try {
          const line = msg.toString('utf8').trim();
          if (!line) return;
          this.buffer.push({ line, source: `syslog:${rinfo.address}` });
          this.stats.ingested++;
        } catch (err) {
          this.stats.errors++;
        }
      });
      this.udpServer.on('error', (err) => {
        this.stats.errors++;
      });
      await new Promise((resolve, reject) => {
        this.udpServer.bind(this.port, '0.0.0.0', () => resolve());
        this.udpServer.on('error', reject);
      });
    }

    if (this.protocol === 'tcp' || this.protocol === 'both') {
      this.tcpServer = createServer((socket) => {
        socket.on('data', (data) => {
          this.stats.received++;
          const lines = data.toString('utf8').split(/\r?\n/).filter(l => l.trim());
          for (const line of lines) {
            this.buffer.push({ line, source: `syslog:${socket.remoteAddress || 'tcp'}` });
            this.stats.ingested++;
          }
        });
        socket.on('error', () => { this.stats.errors++; });
      });
      await new Promise((resolve, reject) => {
        this.tcpServer.listen(this.port, '0.0.0.0', () => resolve());
        this.tcpServer.on('error', reject);
      });
    }

    this.flushTimer = setInterval(() => { this.flush().catch(e => { this.stats.errors++; }); }, 5000);
  }

  async flush() {
    if (this.buffer.length === 0) return;
    const batch = this.buffer.splice(0);
    const lines = batch.map(item => {
      const parsed = parseSyslogLine(item.line);
      const ts = parsed.timestamp || new Date().toISOString();
      return {
        raw: item.line,
        timestamp: ts,
        level: parsed.severity,
        message: parsed.message,
        service: parsed.appName || parsed.facility,
        host: parsed.hostname,
        category: 'syslog',
        environment: 'production',
        ids: {},
        metadata: {
          facility: parsed.facility,
          procId: parsed.procId,
          source: item.source
        }
      };
    });
    try {
      const sourceName = `syslog_${this.id}_${new Date().toISOString().slice(0, 10)}`;
      await this.ingestCallback(sourceName, lines, { source: `syslog:${this.id}`, sourcePath: 'syslog://' });
    } catch (err) {
      this.stats.errors++;
    }
  }

  async stop() {
    this.running = false;
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
    await this.flush();
    if (this.udpServer) {
      this.udpServer.close();
      this.udpServer = null;
    }
    if (this.tcpServer) {
      this.tcpServer.close();
      this.tcpServer = null;
    }
  }

  getStats() {
    return { ...this.stats };
  }

  toJSON() {
    return {
      id: this.id,
      type: 'syslog',
      port: this.port,
      protocol: this.protocol,
      running: this.running,
      stats: this.getStats()
    };
  }
}

module.exports = SourceSyslog;
