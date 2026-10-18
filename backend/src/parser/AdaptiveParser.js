const readline = require('readline');
const fs = require('fs');
const { formatParsers } = require('./formatParsers');

/**
 * Enterprise-grade Adaptive Parser
 * Uses streaming to handle multi-GB files and heuristic probing for format detection.
 */
class AdaptiveParser {
    constructor() {
        // Pre-compile regex for performance
        this.probes = {
            // More flexible probes to find structured data anywhere in a line
            json: /\{.*\}/,
            xml: /<[?a-zA-Z].*?>/,
            kv: /([a-zA-Z0-9._-]+)=("[^"]*"|[^\s]+)/,
            syslog: /^[A-Z][a-z]{2}\s+\d+\s+\d{2}:\d{2}:\d{2}/,
            iso8601: /(\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(\.\d+)?Z?)/,
            bracketTs: /\[(\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}.*?)\]/
        };

        // Specialized structures for Enterprise log types
        this.specializedParsers = {
            web: /^(\S+) (\S+) (\S+) \[([\w:/]+\s[+\-]\d{4})\] "(\S+)\s?(\S+)?\s?(\S+)?" (\d{3}|-) (\d+|-)/,
            network: /^(\S+) (\S+) (\S+) (\S+) (\S+) (\d+) (\d+) (\d+) (\d+) (\d+) (\d+) (\d+) (\S+) (\S+)/,
            os: /^([A-Z][a-z]{2}\s+\d{1,2}\s+\d{2}:\d{2}:\d{2})\s+(\S+)\s+([^\[:]+)(?:\[(\d+)\])?:\s+(.*)$/, // Syslog style
            db: /^(\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d+)?)\s+(\[.*?\])?\s*(.*?):\s+(.*)$/, // Generic DB style
            cdr: /^(record\d+:|---|\{)\s*(.*)$/,
            android: /^\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}\.\d{3}\s+\d+\s+\d+\s+[VDIWEF]\s+/,
            linux: /^[A-Z][a-z]{2}\s+\d{1,2}\s+\d{2}:\d{2}:\d{2}\s+\S+\s+[^:]+:\s+/,
            windows: /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:,\d{3})?\s+(?:Info|Warning|Error|Verbose|Critical|Audit|Failure|Warning)/i,
            hadoop: /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2},\d{3}\s+\w+\s+\[.*?\]/,
            apache: /^\S+ \S+ \S+ \[[^\]]+\] "[A-Z]+/,
            openssh: /^[A-Z][a-z]{2}\s+\d{1,2}\s+\d{2}:\d{2}:\d{2}\s+.*sshd\[/i,
            zookeeper: /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2},\d{3}\s+\[.*?\]/,
            mac: /^[0-9a-fx]+\s+\S+\s+.*lib/i,
            opens: /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2},\d{3}\s+\S+/,
            spark: /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2},\d{3}\s+\S+/,
            // loghub-specific formats
            hdfs: /^\d{4}\d{2}\d{2}\d{2}\d{2}\d{2}[.,]\d+\s+\d+\s/,
            bgl: /^\d{4}\d{2}\d{2}\s+\d{2}:\d{2}:\d{2}\.\d+\s+(?:FATAL|SEVERE|ERROR|WARN|INFO|DEBUG|TRACE|CONFIG)/,
            thunderbird: /^\d{2}-\d{2}-\d{4}\s+\d{2}:\d{2}:\d{2}\.\d+/,
            healthapp: /^\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}\.\d+\|/,
            hpc: /\b\d{10,13}\b.*\[[^\]]+\]/,
            proxifier: /^\[\d{4}\.\d{2}\.\d{2}\s+\d{2}\.\d{2}\.\d{2}\.\d{3}\]\s+/
        };
    }

    extractBalancedJsonObject(line) {
        const start = line.indexOf('{');
        if (start === -1) return null;

        let depth = 0;
        let inString = false;
        let escaped = false;

        for (let i = start; i < line.length; i++) {
            const char = line[i];
            if (escaped) {
                escaped = false;
                continue;
            }
            if (char === '\\') {
                escaped = true;
                continue;
            }
            if (char === '"') {
                inString = !inString;
                continue;
            }
            if (inString) continue;
            if (char === '{') depth++;
            else if (char === '}') {
                depth--;
                if (depth === 0) {
                    const candidate = line.slice(start, i + 1);
                    try {
                        return JSON.parse(candidate);
                    } catch (e) {
                        return null;
                    }
                }
            }
        }
        return null;
    }

    extractEntityCandidatesFromText(text) {
        const values = [];
        if (!text) return values;
        const patterns = [
            /(?:transaction(?:Id|ID)?|request(?:Id|ID)?|trace(?:Id|ID)?|session(?:Id|ID)?|correlation(?:Id|ID)?|call(?:Id|ID)?)\s*[:=]\s*([A-Za-z0-9._:-]+)/gi,
            /(?:user(?:Id|ID)?|uid|subscriber|deviceId|device_id|msisdn|imsi)\s*[:=]\s*([A-Za-z0-9._:-]+)/gi,
            /(?:uuid|guid)\s*[:=]\s*([A-Za-z0-9._:-]+)/gi,
            /(?:email)\s*[:=]\s*([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})/gi,
            /\b(?:ip|srcIp|dstIp)\s*[:=]\s*(\d{1,3}(?:\.\d{1,3}){3})/gi,
            /\bid\b\s*[:=]\s*([A-Za-z0-9._:-]+)/gi,
            /\b(?:identifier|subscriber|device)\b[^A-Za-z0-9]*(?:[:=]\s*|is\s+)([A-Za-z0-9._:-]+)/gi
        ];

        patterns.forEach(pattern => {
            let match;
            while ((match = pattern.exec(text)) !== null) {
                values.push(match[1]);
            }
        });

        return values;
    }

    /**
     * Processes a file using a read stream to ensure low memory footprint.
     */
    async parseStream(filePath, onLine) {
        const fileStream = fs.createReadStream(filePath);
        const rl = readline.createInterface({
            input: fileStream,
            crlfDelay: Infinity
        });

        let lineNumber = 0;
        for await (const line of rl) {
            lineNumber++;
            if (!line.trim()) continue;

            const parsed = this.parseLogLine(line, lineNumber);
            onLine({ ...parsed, line: lineNumber });
        }
    }

    // Renamed to match the import used in logs.js
    parseLogLine(line, index = 0, logType = 'default') {
        let data = { 
            index, 
            raw: line, 
            timestamp: Date.now(), 
            level: 'INFO', 
            message: line, 
            metadata: {}, 
            ids: {}, 
            format: 'text' 
        };

        // 0. Check for specialized parser match if a type is provided
        if (logType !== 'default' && this.specializedParsers[logType]) {
            const specializedResult = this.trySpecializedParse(line, logType, index);
            if (specializedResult) return specializedResult;
        }

        // Auto-detect a specialized log type for default parsing
        if (logType === 'default') {
            const inferredType = this.autoDetectType(line);
            if (inferredType) {
                const specializedResult = this.trySpecializedParse(line, inferredType, index);
                if (specializedResult) return specializedResult;
            }
        }

        // 1. Extract Timestamp first (Independent of format)
        const tsMatch = line.match(this.probes.iso8601) || line.match(this.probes.bracketTs);
        if (tsMatch) {
            const tsStr = tsMatch[1] || tsMatch[0];
            const parsedTs = new Date(tsStr).getTime();
            if (!isNaN(parsedTs)) data.timestamp = parsedTs;
        }

        // 1b. Heuristic Level Detection for raw text (Pre-emptive)
        if (/\b(ERROR|FAIL|CRITICAL|FATAL|EXCEPTION)\b/i.test(line)) data.level = 'ERROR';
        else if (/\b(WARN|WARNING|DEGRADED)\b/i.test(line)) data.level = 'WARN';
        else if (/\b(DEBUG|TRACE)\b/i.test(line)) data.level = 'DEBUG';

        // 2. Intelligent JSON Fragment Detection
        const jsonObj = this.extractBalancedJsonObject(line);
        if (jsonObj) {
            try {
                const normalized = this.normalize(jsonObj, 'json', line, index, data);
                if (data.timestamp !== Date.now()) normalized.timestamp = data.timestamp; // Preserve heuristically extracted timestamp
                return normalized;
            } catch (e) { /* timestamp parsing failed, skip */ }
        }

        // 3. Intelligent XML Fragment Detection
        const xmlMatch = line.match(/(<[?a-zA-Z].*?>.*<\/.*?>)/);
        if (xmlMatch) {
            const xmlData = this.extractXmlFields(xmlMatch[1]);
            xmlData.raw = line;
            xmlData.index = index;
            if (data.timestamp !== Date.now()) xmlData.timestamp = data.timestamp; // Preserve heuristically extracted timestamp
            return xmlData;
        }

        // 4. Intelligent Key-Value Pair Detection
        if (this.probes.kv.test(line)) {
            const kvData = {};
            const matches = line.matchAll(/([a-zA-Z0-9._-]+)=("[^"]*"|[^\s]+)/g);
            for (const match of matches) {
                kvData[match[1]] = match[2].replace(/(^"|"$)/g, '');
            }
            if (Object.keys(kvData).length > 1) { // Ensure more than one KV pair to avoid false positives
                const normalized = this.normalize(kvData, 'kv', line, index);
                // Preserve timestamp if already extracted from the beginning of the line
                if (data.timestamp !== Date.now()) normalized.timestamp = data.timestamp; // Preserve heuristically extracted timestamp
                return normalized;
            }
        }

        return data;
    }

    trySpecializedParse(line, type, index) {
        const regex = this.specializedParsers[type];
        const match = line.match(regex);
        if (!match) return null;

        switch (type) {
            case 'web':
                return {
                    index,
                    timestamp: new Date(match[4].replace(':', ' ')).getTime(),
                    level: parseInt(match[8]) >= 400 ? 'ERROR' : 'INFO',
                    message: `${match[5]} ${match[6] || ''}`,
                    format: 'web-server',
                    metadata: { clientIp: match[1], method: match[5], path: match[6], proto: match[7], status: match[8], bytes: match[9] },
                    ids: { ip: match[1] },
                    raw: line
                };
            case 'network':
                return {
                    index,
                    timestamp: parseInt(match[11]) * 1000, // Unix start time
                    level: match[13] === 'REJECT' ? 'WARN' : 'INFO',
                    message: `${match[13]} ${match[4]} -> ${match[5]}`,
                    format: 'network-flow',
                    metadata: { src: match[4], dst: match[5], srcPort: match[6], dstPort: match[7], protocol: match[8], action: match[13] },
                    ids: { srcIp: match[4], dstIp: match[5] },
                    raw: line
                };
            case 'os':
                return {
                    index,
                    timestamp: new Date(match[1] + ' ' + new Date().getFullYear()).getTime(),
                    level: /\b(fail|error|warn|crit)\b/i.test(match[5]) ? 'ERROR' : 'INFO',
                    message: match[5],
                    format: 'syslog',
                    metadata: { hostname: match[2], process: match[3], pid: match[4] },
                    ids: { host: match[2], pid: match[4] },
                    raw: line
                };
            case 'db':
                return {
                    index,
                    timestamp: new Date(match[1]).getTime(),
                    level: String(match[3]).toUpperCase().includes('ERR') ? 'ERROR' : 'INFO',
                    message: match[4],
                    format: 'database',
                    metadata: { context: match[2], tag: match[3] },
                    raw: line,
                    ids: {}
                };
            case 'security':
                // Security logs often use KV or JSON, so we rely on heuristic enhancement
                const base = this.parseLogLine(line, index, 'default');
                return {
                    ...base,
                    format: 'security-audit',
                    level: /\b(denied|blocked|attack|unauthorized|failed)\b/i.test(line) ? 'ERROR' : base.level
                };
            case 'cdr':
                const fields = {};
                // Extract quoted and unquoted KV pairs specifically for EDR formats
                const kvMatches = line.matchAll(/(\w+)\s*[:=]\s*"?([^"\n,;]+)"?/g);
                for (const m of kvMatches) {
                    fields[m[1]] = m[2].trim();
                }
                
                const cdrBase = this.parseLogLine(line, index, 'default');
                const level = /\b(fail|err|reject|drop|4\d\d|5\d\d)\b/i.test(line) ? 'ERROR' : 'INFO';

                return {
                    ...cdrBase,
                    level,
                    format: 'telecom-edr',
                    metadata: { ...cdrBase.metadata, ...fields },
                    // IDs will be automatically extracted by normalize if keys match
                    message: fields.event || fields.operation || cdrBase.message,
                    raw: line
                };
            case 'android':
                return this.parseAndroid(line, index);
            case 'linux':
                return this.parseSyslog(line, index, 'linux');
            case 'windows':
                return this.parseWindowsEvent(line, index);
            case 'hadoop':
                return this.parseHadoop(line, index);
            case 'apache':
                return this.parseApache(line, index);
            case 'openssh':
                return this.parseOpenSSH(line, index);
            case 'zookeeper':
                return this.parseZookeeper(line, index);
            case 'mac':
                return this.parseMac(line, index);
            case 'opens':
            case 'spark':
                return this.parseGenericTimestampedLine(line, index, type);
            case 'hdfs':
                return this.parseHDFS(line, index);
            case 'bgl':
                return this.parseBGL(line, index);
            case 'thunderbird':
                return this.parseThunderbird(line, index);
            case 'healthapp':
                return this.parseHealthApp(line, index);
            case 'hpc':
                return this.parseHPC(line, index);
            case 'proxifier':
                return this.parseProxifier(line, index);
            default:
                return null;
        }
    }

    parseHDFS(line, index) {
        const shared = formatParsers.hdfs.parseLine(line, index);
        if (!shared) return this.parseGenericTimestampedLine(line, index, 'hdfs');
        const { fields, line: rawLine } = shared;

        const ts = new Date(`${fields.year}-${fields.month}-${fields.day}T${fields.hour}:${fields.min}:${fields.sec}.${fields.ms}`);
        const rest = fields.rest;
        let level = 'INFO';
        const numLevelMatch = rest.match(/^(\d+)\s/);
        if (numLevelMatch) {
            const num = parseInt(numLevelMatch[1], 10);
            if (num >= 110000 && num < 120000) level = 'ERROR';
            else if (num === 200000 || num === 130000) level = 'WARN';
            else level = 'INFO';
        } else {
            level = this.inferLevelFromText(rest);
        }

        const ids = {};
        const blockMatch = rawLine.match(/\b(blk_-?\d{10,20})\b/);
        if (blockMatch) ids.blockId = blockMatch[1];

        return {
            index,
            timestamp: isNaN(ts.getTime()) ? Date.now() : ts.getTime(),
            level,
            message: rest,
            metadata: { source: 'HDFS' },
            ids,
            format: 'hdfs',
            raw: rawLine
        };
    }

    parseBGL(line, index) {
        const shared = formatParsers.bgl.parseLine(line, index);
        if (!shared) return this.parseGenericTimestampedLine(line, index, 'bgl');
        const { fields, line: rawLine } = shared;

        const ts = new Date(`${fields.year}-${fields.month}-${fields.day}T${fields.time}`);
        const levelMap = { FATAL: 'ERROR', SEVERE: 'ERROR', ERROR: 'ERROR', WARN: 'WARN', WARNING: 'WARN', INFO: 'INFO', DEBUG: 'DEBUG', TRACE: 'DEBUG', CONFIG: 'INFO' };
        const level = levelMap[fields.levelWord.toUpperCase()] || 'INFO';

        return {
            index,
            timestamp: isNaN(ts.getTime()) ? Date.now() : ts.getTime(),
            level,
            message: fields.message,
            metadata: { source: 'BGL' },
            ids: {},
            format: 'bgl',
            raw: rawLine
        };
    }

    parseThunderbird(line, index) {
        const shared = formatParsers.thunderbird.parseLine(line, index);
        if (!shared) return this.parseGenericTimestampedLine(line, index, 'thunderbird');
        const { fields, line: rawLine } = shared;

        const pipeParts = fields.pipeParts;
        let ts = Date.now();
        const d = new Date(`${fields.year}-${fields.month}-${fields.day}T${fields.time}.${fields.ms}`);
        if (!isNaN(d.getTime())) ts = d.getTime();

        let level = 'INFO';
        let message = rawLine;
        if (pipeParts.length >= 3) {
            const levelPart = pipeParts.find(p => /^(INFO|WARN|ERROR|DEBUG|VERBOSE|FATAL)$/i.test(p.trim()));
            if (levelPart) level = this.mapWindowsLevel(levelPart.trim());
            message = pipeParts.slice(1).filter(p => !/^(INFO|WARN|ERROR|DEBUG|VERBOSE|FATAL)$/i.test(p.trim())).join('|').trim();
        } else {
            level = this.inferLevelFromText(rawLine);
        }

        return {
            index,
            timestamp: ts,
            level: level || 'INFO',
            message: message || rawLine,
            metadata: { source: 'Thunderbird' },
            ids: {},
            format: 'thunderbird',
            raw: rawLine
        };
    }

    parseHealthApp(line, index) {
        const shared = formatParsers.healthapp.parseLine(line, index);
        if (!shared) return this.parseGenericTimestampedLine(line, index, 'healthapp');
        const { fields, line: rawLine } = shared;

        const parts = fields.parts;
        let ts = Date.now();
        if (fields.tsStr) { const d = new Date(fields.tsStr); if (!isNaN(d.getTime())) ts = d.getTime(); }

        let level = 'INFO';
        const levelPart = parts.find(p => /^(INFO|WARN|ERROR|DEBUG|VERBOSE|TRACE|FATAL)$/i.test(p));
        if (levelPart) level = this.mapWindowsLevel(levelPart);

        const message = parts.slice(levelPart ? parts.indexOf(levelPart) + 1 : 2).join(' | ').trim()
            || parts.slice(1).join(' | ').trim() || rawLine;

        return {
            index,
            timestamp: ts,
            level,
            message,
            metadata: { source: 'HealthApp', pipeFields: parts },
            ids: {},
            format: 'healthapp',
            raw: rawLine
        };
    }

    parseHPC(line, index) {
        const shared = formatParsers.hpc.parseLine(line, index);
        if (!shared) return this.parseGenericTimestampedLine(line, index, 'hpc');
        const { fields, line: rawLine } = shared;

        const ids = {};
        const metadata = { source: 'HPC' };
        const level = this.inferLevelFromText(rawLine);

        if (fields.procMatch) { metadata.process = fields.procMatch[1]; metadata.pid = fields.procMatch[2]; }

        let ts = Date.now();
        if (fields.epochMatch) {
            const num = parseInt(fields.epochMatch[1], 10);
            const d = new Date(num > 1e12 ? num : num * 1000);
            if (!isNaN(d.getTime()) && d.getFullYear() > 2000 && d.getFullYear() < 2100) ts = d.getTime();
        }

        return {
            index, timestamp: ts, level, message: rawLine,
            metadata, ids, format: 'hpc', raw: rawLine
        };
    }

    parseProxifier(line, index) {
        const shared = formatParsers.proxifier.parseLine(line, index);
        if (!shared) return this.parseGenericTimestampedLine(line, index, 'proxifier');
        const { fields, line: rawLine } = shared;

        const ts = new Date(`${fields.year}-${fields.month}-${fields.day}T${fields.hour}:${fields.min}:${fields.sec}.${fields.ms}`);
        const message = fields.message;
        const level = this.inferLevelFromText(message);
        const ids = {};
        const metadata = { source: 'Proxifier' };
        const ipMatch = message.match(/(\d{1,3}(?:\.\d{1,3}){3}):(\d+)/);
        if (ipMatch) { ids.ip = ipMatch[1]; metadata.port = parseInt(ipMatch[2], 10); }

        return {
            index,
            timestamp: isNaN(ts.getTime()) ? Date.now() : ts.getTime(),
            level, message, metadata, ids,
            format: 'proxifier', raw: rawLine
        };
    }

    extractXmlFields(line) {
        const data = { format: 'xml', raw: line, level: 'INFO', ids: {} }; // Initialize ids here
        const timestamp = line.match(/timestamp="([^"]+)"/) || line.match(/<timestamp>([^<]+)<\/timestamp>/);
        const level = line.match(/level="([^"]+)"/) || line.match(/<level>([^<]+)<\/level>/);
        const msg = line.match(/>([^<]+)<\//); // Grabs content between tags

        if (timestamp) data.timestamp = new Date(timestamp[1]).getTime();
        if (level) data.level = level[1].toUpperCase();
        data.message = msg ? msg[1] : line;

        return data;
    }
    autoDetectType(line) {
        // Skip overly generic formats that must be selected explicitly via a
        // configured parser — auto-detecting them would misclassify any
        // pipe/space-delimited line as web, network, db, cdr or security traffic.
        const skipAuto = ['web', 'network', 'db', 'cdr', 'security'];
        for (const [type, regex] of Object.entries(this.specializedParsers)) {
            if (skipAuto.includes(type)) continue;
            if (regex.test(line)) return type;
        }
        return null;
    }

    parseAndroid(line, index) {
        const match = line.match(/^(\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3})\s+(\d+)\s+(\d+)\s+([VDIWEF])\s+([^:]+):\s+(.*)$/);
        if (!match) return null;
        const ts = new Date(`${new Date().getFullYear()}-${match[1]}`);
        return {
            index,
            timestamp: isNaN(ts.getTime()) ? Date.now() : ts.getTime(),
            level: this.mapAndroidLevel(match[4]),
            message: match[6],
            metadata: { pid: match[2], tid: match[3], tag: match[5] },
            ids: { pid: match[2], tid: match[3] },
            format: 'android',
            raw: line
        };
    }

    parseSyslog(line, index, type = 'linux') {
        const match = line.match(/^([A-Z][a-z]{2})\s+(\d{1,2})\s+(\d{2}:\d{2}:\d{2})\s+(\S+)\s+([^\[:]+)(?:\[(\d+)\])?:\s+(.*)$/);
        if (!match) return null;
        const ts = new Date(`${match[1]} ${match[2]} ${new Date().getFullYear()} ${match[3]}`);
        const message = match[7];
        const level = this.inferLevelFromText(message);
        return {
            index,
            timestamp: isNaN(ts.getTime()) ? Date.now() : ts.getTime(),
            level,
            message,
            metadata: { hostname: match[4], process: match[5].trim(), pid: match[6] || null },
            ids: { host: match[4], process: match[5].trim(), pid: match[6] || null },
            format: type === 'openssh' ? 'openssh' : 'syslog',
            raw: line
        };
    }

    parseOpenSSH(line, index) {
        const parsed = this.parseSyslog(line, index, 'openssh');
        if (!parsed) return null;
        parsed.format = 'openssh';
        parsed.metadata.process = parsed.metadata.process || 'sshd';
        parsed.ids.process = parsed.metadata.process;
        return parsed;
    }

    parseWindowsEvent(line, index) {
        const match = line.match(/^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2},\d{3})\s+([A-Za-z]+)\s+(\S+)\s+(.*)$/);
        if (!match) return null;
        const ts = new Date(match[1].replace(',', '.'));
        return {
            index,
            timestamp: isNaN(ts.getTime()) ? Date.now() : ts.getTime(),
            level: this.mapWindowsLevel(match[2]),
            message: match[4],
            metadata: { source: match[3] },
            ids: { source: match[3] },
            format: 'windows',
            raw: line
        };
    }

    parseHadoop(line, index) {
        const match = line.match(/^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2},\d{3})\s+(\w+)\s+\[([^\]]+)\]\s+([^:]+):\s+(.*)$/);
        if (!match) return null;
        const ts = new Date(match[1].replace(',', '.'));
        return {
            index,
            timestamp: isNaN(ts.getTime()) ? Date.now() : ts.getTime(),
            level: this.mapWindowsLevel(match[2]),
            message: match[5],
            metadata: { component: match[3], class: match[4] },
            ids: { component: match[3] },
            format: 'hadoop',
            raw: line
        };
    }

    parseApache(line, index) {
        const match = line.match(/^(\S+) (\S+) (\S+) \[([^\]]+)\] "([A-Z]+) ([^\s]+) ([^"]+)" (\d{3}) (\d+|-)(.*)$/);
        if (!match) return null;
        const ts = new Date(match[4]);
        return {
            index,
            timestamp: isNaN(ts.getTime()) ? Date.now() : ts.getTime(),
            level: Number(match[8]) >= 400 ? 'ERROR' : 'INFO',
            message: `${match[5]} ${match[6]} ${match[7]}`,
            metadata: { clientIp: match[1], user: match[3], method: match[5], path: match[6], protocol: match[7], status: match[8], bytes: match[9] },
            ids: { clientIp: match[1] },
            format: 'apache',
            raw: line
        };
    }

    parseZookeeper(line, index) {
        const match = line.match(/^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2},\d{3})\s+\[([^\]]+)\]\s+(.*)$/);
        if (!match) return null;
        const ts = new Date(match[1].replace(',', '.'));
        const message = match[3];
        return {
            index,
            timestamp: isNaN(ts.getTime()) ? Date.now() : ts.getTime(),
            level: this.inferLevelFromText(message),
            message,
            metadata: { thread: match[2] },
            ids: { thread: match[2] },
            format: 'zookeeper',
            raw: line
        };
    }

    parseMac(line, index) {
        const match = line.match(/^([0-9a-fx]+)\s+(\S+)\s+(.*)$/);
        if (!match) return null;
        return {
            index,
            timestamp: Date.now(),
            level: this.inferLevelFromText(line),
            message: match[3],
            metadata: { address: match[1], module: match[2] },
            ids: { address: match[1] },
            format: 'mac',
            raw: line
        };
    }

    parseGenericTimestampedLine(line, index, type) {
        const match = line.match(/^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2},\d{3})\s+(.*)$/);
        const ts = match ? new Date(match[1].replace(',', '.')) : new Date();
        return {
            index,
            timestamp: match && !isNaN(ts.getTime()) ? ts.getTime() : Date.now(),
            level: this.inferLevelFromText(line),
            message: match ? match[2] : line,
            metadata: { sourceType: type },
            ids: {},
            format: type,
            raw: line
        };
    }

    mapAndroidLevel(code) {
        switch (code) {
            case 'V': return 'DEBUG';
            case 'D': return 'DEBUG';
            case 'I': return 'INFO';
            case 'W': return 'WARN';
            case 'E': return 'ERROR';
            case 'F': return 'ERROR';
            default: return 'INFO';
        }
    }

    mapWindowsLevel(level) {
        const normalized = String(level).trim().toLowerCase();
        if (['error', 'failure', 'critical', 'audit'].includes(normalized)) return 'ERROR';
        if (['warning', 'warn'].includes(normalized)) return 'WARN';
        return 'INFO';
    }

    inferLevelFromText(text) {
        if (/\b(error|failed?|fatal|critical|denied|unauthorized|timeout|exception|segfault|segmentation.fault|oom|out.of.memory|killed|crashed?|abort(ed|ing)?)\b/i.test(text)) return 'ERROR';
        if (/\b(NullPointerException|IndexOutOfBoundsException|ClassCastException|OutOfMemoryError|StackOverflowError|IllegalStateException|RuntimeException|IOException|SQLException|ConnectionRefusedException)\b/i.test(text)) return 'ERROR';
        if (/\b(System\.\w+Exception|Microsoft\.\w+Exception|System\.Invalid\w+)\b/i.test(text)) return 'ERROR';
        if (/\bHTTP\s+\d{3}\b/i.test(text)) {
            const match = text.match(/HTTP\s+(\d{3})/i);
            if (match) {
                const code = parseInt(match[1]);
                if (code >= 500) return 'ERROR';
                if (code >= 400) return 'WARN';
            }
        }
        if (/\b[45]\d{2}\s+(error|forbidden|not found|internal|bad|gateway|timeout|unavailable)\b/i.test(text)) return 'ERROR';
        if (/\b(warning|warn|deprecated|slow|throttled|retry|retried|missing|suspicious)\b/i.test(text)) return 'WARN';
        if (/\b(debug|trace|verbose)\b/i.test(text)) return 'DEBUG';
        return 'INFO';
    }
    normalize(obj, format, originalLine = null, index = 0, heuristicData = {}) { // Add heuristicData parameter
        // Extract common fields regardless of source key names
        const tsKey = ['timestamp', 'time', '@timestamp', 'ts', 'logTime', 'eventTime'].find(k => obj[k] !== undefined);
        // Ensure we check for undefined values before accessing properties
        const msgKey = ['message', 'msg', 'content', 'text', 'body', 'description', 'event'].find(k => obj[k] !== undefined);
        const lvlKey = ['level', 'severity', 'lvl', 'status', 'type'].find(k => obj[k] !== undefined);

        // EDR specific identifier mapping
        const idKeys = {
            msisdn: ['msisdn', 'e164', 'gpsi', 'phone', 'calling_number', 'called_number'],
            correlation_id: ['correlation_id', 'session_id', 'transaction_id', 'request_id', 'call_id'],
            imsi: ['imsi', 'subscriber_id']
        };

        let timestamp = Date.now();
        if (tsKey) {
            const parsed = new Date(obj[tsKey]).getTime();
            if (!isNaN(parsed)) timestamp = parsed;
        } else if (obj.log && obj.log.time) { // Check for nested time (as seen in example log)
            const parsed = new Date(obj.log.time).getTime();
            if (!isNaN(parsed)) timestamp = parsed;
        }

        let level = 'INFO';
        if (obj.log && obj.log.level) {
            level = String(obj.log.level).toUpperCase();
        } else if (lvlKey) {
            level = String(obj[lvlKey]).toUpperCase();
        } else if (heuristicData && heuristicData.level) { // Use level from heuristicData if available
            // Keep the heuristic level detected earlier if JSON doesn't specify one
            level = heuristicData.level || 'INFO';
        }
        
        // Ensure level is strictly one of the expected types for aggregation
        if (!['INFO', 'WARN', 'ERROR', 'FATAL', 'DEBUG'].includes(level)) level = 'INFO';
        if (level === 'FATAL') level = 'ERROR';

        let message = msgKey ? obj[msgKey] : (obj.log && obj.log.message ? obj.log.message : JSON.stringify(obj));

        // Extract telecom IDs
        const ids = { ...(obj.ids || {}) };
        const candidateKeys = Object.keys(obj);
        const entityKeywords = /(?:^|_)(?:id|ids|uuid|ip|email|user|session|trace|transaction|request|correlation|span|call|msisdn|imsi)(?:$|_)/i;

        for (const [idType, aliases] of Object.entries(idKeys)) {
            const foundKey = aliases.find(k => obj[k] !== undefined);
            if (foundKey) ids[idType] = obj[foundKey];
        }

        const collectFromValue = (value, keyName) => {
            if (value === undefined || value === null || value === '') return;
            const normalizedKey = String(keyName || '').trim().toLowerCase();
            const stringValue = String(value).trim();
            const isEntityLike = entityKeywords.test(normalizedKey) || ['user', 'email', 'ip', 'uuid', 'guid'].includes(normalizedKey);
            if (!stringValue || (!isEntityLike && !/^[A-Za-z0-9._:-]+$/.test(stringValue))) return;

            const bucket = normalizedKey.includes('transaction') || normalizedKey.includes('txid') || normalizedKey.includes('request') || normalizedKey.includes('trace') || normalizedKey.includes('session') || normalizedKey.includes('correlation') || normalizedKey.includes('call')
              ? 'transactionId'
              : normalizedKey.includes('user')
                ? 'userId'
                : normalizedKey.includes('uuid') || normalizedKey.includes('guid')
                  ? 'uuid'
                  : normalizedKey.includes('email')
                    ? 'email'
                    : normalizedKey.includes('ip')
                      ? 'ip'
                      : null;

            if (bucket) {
                ids[bucket] = stringValue;
            } else if (normalizedKey && !ids[keyName]) {
                ids[keyName] = stringValue;
            }
        };

        candidateKeys.forEach(key => {
            const rawValue = obj[key];
            if (rawValue === undefined || rawValue === null || rawValue === '') return;
            const keyName = String(key).trim();
            if (typeof rawValue === 'object' && !Array.isArray(rawValue)) {
                Object.entries(rawValue).forEach(([nestedKey, nestedValue]) => collectFromValue(nestedValue, nestedKey));
            } else {
                collectFromValue(rawValue, keyName);
            }
        });

        // Fallback: extract structured key=value pairs from the raw line and message text
        if (originalLine) {
            const rawPairs = [...String(originalLine).matchAll(/([A-Za-z][A-Za-z0-9._-]*)(?:\s*[:=]\s*)([A-Za-z0-9._:-]+)/g)];
            rawPairs.forEach(([_, key, value]) => collectFromValue(value, key));
        }

        this.extractEntityCandidatesFromText(`${message} ${originalLine || ''}`).forEach(value => {
            if (!ids.transactionId) ids.transactionId = value;
            else if (!ids.userId && /user/i.test(value)) ids.userId = value;
            else if (!ids.ip && /\d{1,3}(?:\.\d{1,3}){3}/.test(value)) ids.ip = value;
            else if (!ids.email && /@/.test(value)) ids.email = value;
        });

        // Extract composite-key identifiers from message content
        // Handles Java toString() formats: E164<digits>=..., IMSI<digits>=..., DEVICE_ID<id>=...
        if (message && typeof message === 'string') {
            // Composite-key: "E164<digits>=" — value embedded in key name
            const compositeE164 = message.match(/\bE164(\d{5,15})\s*=/);
            if (compositeE164 && !ids.msisdn) ids.msisdn = compositeE164[1];

            // Composite-key: "IMSI<digits>=" — value embedded in key name
            const compositeImsi = message.match(/\bIMSI(\d{10,15})\s*=/);
            if (compositeImsi && !ids.imsi) ids.imsi = compositeImsi[1];

            // Composite-key: "DEVICE_ID<id>=" — value after DEVICE_ID prefix
            const compositeDevice = message.match(/\bDEVICE_ID([A-Za-z0-9_.:-]+)\s*=/);
            if (compositeDevice && !ids.deviceId) ids.deviceId = compositeDevice[1];

            // Also check "DEVICE_<id>=" variant
            if (!ids.deviceId) {
                const compositeDeviceShort = message.match(/\bDEVICE_([A-Za-z0-9_.:-]+)\s*=/);
                if (compositeDeviceShort) ids.deviceId = compositeDeviceShort[1];
            }

            // Standard key=value: "E164=<phone>", "IMSI=<imsi>", "DEVICE_ID=<id>"
            const stdE164 = message.match(/\bE164\s*=\s*['"]?(\d{5,15})['"]?/);
            if (stdE164 && !ids.msisdn) ids.msisdn = stdE164[1];

            const stdImsi = message.match(/\bIMSI\s*=\s*['"]?(\d{10,15})['"]?/);
            if (stdImsi && !ids.imsi) ids.imsi = stdImsi[1];

            const stdDevice = message.match(/\bDEVICE_ID\s*=\s*['"]?([A-Za-z0-9._:-]+)['"]?/);
            if (stdDevice && !ids.deviceId) ids.deviceId = stdDevice[1];
        }

        return {
            index,
            format,
            timestamp,
            level,
            message,
            metadata: obj,
            raw: originalLine || JSON.stringify(obj),
            ids // Enriched with telecom identifiers
        };
    }
}

function extractLevel(levelStr) {
    if (!levelStr) return 'info';
    const normalized = String(levelStr).toUpperCase().trim();
    if (['ERROR', 'ERR', 'CRITICAL', 'CRIT', 'FATAL'].includes(normalized)) return 'error';
    if (['WARN', 'WARNING', 'DEGRADED'].includes(normalized)) return 'warn';
    if (['DEBUG', 'DBG'].includes(normalized)) return 'debug';
    if (['TRACE', 'TRC'].includes(normalized)) return 'trace';
    return 'info';
}

// Export the instance and the specific function for compatibility
const parserInstance = new AdaptiveParser();
module.exports = {
    AdaptiveParser,
    parseLogLine: (line, index, logType) => parserInstance.parseLogLine(line, index, logType),
    extractLevel
};