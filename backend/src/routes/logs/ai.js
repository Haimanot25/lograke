const { explainLog, queryLogs, isEnabled, generateCompletionStream, pipeStreamToResponse, sanitizeErrorMessage } = require('../../ai/AiService');
const { buildLogContextForAI } = require('../../ai/LogChunker');
const { aiLimiter, checkProviderRateLimit } = require('../../middleware/rateLimiter');
const { store } = require('./shared');

// In-flight dedup set for explain requests
const explainInFlight = new Set();

// Build explain prompt (mirrors AiService.explainLog logic for streaming)
function buildExplainPrompt(logText, level, fileRecord) {
  const contextLines = [];
  if (fileRecord?.parsedLogs) {
    const idx = fileRecord.parsedLogs.findIndex(l => l.raw === logText);
    if (idx >= 0) {
      let start = idx;
      let end = idx + 1;
      const tsGap = 60000;
      const baseTs = new Date(fileRecord.parsedLogs[idx].timestamp).getTime();
      while (start > 0) {
        const prev = fileRecord.parsedLogs[start - 1];
        if (!prev.raw.trim()) break;
        const prevTs = new Date(prev.timestamp).getTime();
        if (!isNaN(baseTs) && !isNaN(prevTs) && (baseTs - prevTs) > tsGap) break;
        if ((idx - start + 1) >= 10) break;
        start--;
      }
      while (end < fileRecord.parsedLogs.length) {
        const next = fileRecord.parsedLogs[end];
        if (!next.raw.trim()) break;
        const nextTs = new Date(next.timestamp).getTime();
        if (!isNaN(baseTs) && !isNaN(nextTs) && (nextTs - baseTs) > tsGap) break;
        if ((end - idx + 1) >= 10) break;
        end++;
      }
      for (let i = start; i < end; i++) {
        const l = fileRecord.parsedLogs[i];
        if (i === idx) contextLines.push(`→ [${l.level}] ${l.message}`);
        else contextLines.push(`  [${l.level}] ${l.message}`);
      }
    }
  }
  return `Explain this log entry with root cause analysis and remediation steps. Be concise.

Level: ${level}
${contextLines.length ? `Context (${contextLines.length - 1} surrounding lines):\n${contextLines.join('\n')}\n` : ''}
Log Content: ${logText}

Format your response as markdown with sections: Root Cause, Impact, Remediation.`;
}

function register(router) {
  // 11. Explain single log via AI or heuristic fallback
  router.get('/:fileId/explain/:logIndex', aiLimiter, async (req, res) => {
    const { fileId, logIndex } = req.params;
    const stream = req.query.stream === 'true';
    const record = store.get(fileId);

    if (!record) {
      return res.status(404).json({ error: 'File not found' });
    }

    const logIdx = parseInt(logIndex);
    const log = record.parsedLogs.find(l => l.index === logIdx);
    if (!log) {
      return res.status(404).json({ error: 'Log entry not found' });
    }

    // Deduplicate in-flight requests for same (fileId, logIndex)
    const dedupKey = `${fileId}:${logIdx}`;
    if (explainInFlight.has(dedupKey)) {
      return res.status(429).json({ error: 'Explanation already in progress for this log entry.' });
    }
    explainInFlight.add(dedupKey);
    const cleanup = () => explainInFlight.delete(dedupKey);

    try {
      if (stream) {
        // Streaming mode
        const prompt = buildExplainPrompt(log.raw, log.level, record);
        pipeStreamToResponse(prompt, res);
        cleanup();
        return;
      }

      const explanation = await explainLog(log.raw, log.level, record);
      res.json({
        aiEnabled: isEnabled(),
        explanation
      });
    } catch (err) {
      res.status(500).json({ error: sanitizeErrorMessage(err) });
    } finally {
      cleanup();
    }
  });

  // 10. Query all logs using AI
  router.post('/:fileId/query-ai', aiLimiter, async (req, res) => {
    const { fileId } = req.params;
    let { prompt } = req.body;
    const record = store.get(fileId);

    if (!record) {
      return res.status(404).json({ error: 'File not found' });
    }
    if (!prompt) {
      return res.status(400).json({ error: 'Prompt is required' });
    }

    const AiService = require('../../ai/AiService');
    const provider = AiService.getActiveProvider ? AiService.getActiveProvider() : 'unknown';
    if (!checkProviderRateLimit(provider, 15)) {
      return res.status(429).json({ error: `Provider "${provider}" rate limit reached. Please wait or switch providers.` });
    }

    const MAX_PROMPT_CHARS = 3000;
    if (prompt.length > MAX_PROMPT_CHARS) {
      prompt = prompt.slice(0, MAX_PROMPT_CHARS) + '\n...[truncated for context limit]';
    }

    try {
      const aiResponse = await queryLogs(record.parsedLogs, prompt);
      res.json({
        aiEnabled: isEnabled(),
        response: aiResponse
      });
    } catch (err) {
      res.status(500).json({ error: sanitizeErrorMessage(err) });
    }
  });

  // 10a. Stream AI response (SSE for copilot)
  router.post('/:fileId/query-ai/stream', aiLimiter, async (req, res) => {
    const { fileId } = req.params;
    let { prompt, logContext } = req.body;
    const record = store.get(fileId);

    if (!record) {
      return res.status(404).json({ error: 'File not found' });
    }
    if (!prompt) {
      return res.status(400).json({ error: 'Prompt is required' });
    }

    const AiService = require('../../ai/AiService');
    const provider = AiService.getActiveProvider ? AiService.getActiveProvider() : 'unknown';
    if (!checkProviderRateLimit(provider, 15)) {
      return res.status(429).json({ error: `Provider "${provider}" rate limit reached. Please wait or switch providers.` });
    }

    const ctx = buildLogContextForAI(record.parsedLogs || []);
    const { stats, timeline, errorTraces, sampleNormalLogs, omittedErrorCount } = ctx;
    const errorPct = stats.totalLogs ? ((stats.countsByLevel.ERROR + stats.countsByLevel.FATAL) / stats.totalLogs * 100).toFixed(1) : '0.0';

    const timelineStr = timeline.length > 0
      ? timeline.map(w => `  ${w.window}: ${w.errors} errors, ${w.total} total`).join('\n')
      : '  (no time data)';
    const errorsStr = errorTraces.length > 0
      ? errorTraces.map(e => `[${e.effectiveLevel || e.level}] ${e.timestampIso || e.timestamp} ${e.message || e.raw}`).join('\n')
      : '  (none)';
    const omittedStr = omittedErrorCount > 0 ? `\n[+ ${omittedErrorCount} similar errors omitted]` : '';
    const samplesStr = sampleNormalLogs.length > 0
      ? sampleNormalLogs.map(s => `[${s.effectiveLevel || s.level}] ${s.timestampIso || s.timestamp} ${s.message || s.raw}`).join('\n')
      : '  (none)';

    const fullPrompt = `Answer the user query based on the structured log context below.

Query: "${prompt}"

### LOG SUMMARY METRICS
- Total Logs: ${stats.totalLogs}
- Level Breakdown: INFO=${stats.countsByLevel.INFO}, WARN=${stats.countsByLevel.WARN}, ERROR=${stats.countsByLevel.ERROR}, FATAL=${stats.countsByLevel.FATAL}
- Error Rate: ${errorPct}%

### PER-MINUTE TIMELINE (errors / total per window)
${timelineStr}

### INCIDENT SANDBOX (Trigger → Critical → Recovery) (${errorTraces.length} shown${omittedErrorCount > 0 ? `, ${omittedErrorCount} omitted` : ''})
${errorsStr}${omittedStr}

### SAMPLE NORMAL LOGS (baseline context, ${sampleNormalLogs.length} entries)
${samplesStr}

### INSTRUCTIONS
1. Provide a chronological timeline of events described in the logs.
2. Identify root causes for any errors, exceptions, or anomalies.
3. Correlate related events across services or trace IDs.
4. Do NOT stop analysis early. Evaluate the full timeline from start to finish.
   CRITICAL: Cover both the INCIDENT phase AND the RECOVERY phase
   (e.g., pod restarts, state transitions back to CLOSED, cleared locks, restored connections).`;

    pipeStreamToResponse(fullPrompt, res);
  });

  // Health check endpoint for AI providers
  router.get('/ai/health', aiLimiter, async (req, res) => {
    const AiService = require('../../ai/AiService');
    const config = require('../../config');
    const provider = AiService.getActiveProvider ? AiService.getActiveProvider() : 'none';
    const enabled = AiService.isEnabled ? AiService.isEnabled() : false;

    const result = {
      enabled,
      activeProvider: provider,
      providerLabel: AiService.getProviderLabel ? AiService.getProviderLabel(provider) : provider,
      hasKey: enabled,
      providers: {
        groq: { configured: Boolean(config.ai?.groqApiKey || process.env.GROQ_API_KEY) },
        gemini: { configured: Boolean(config.ai?.geminiApiKey || process.env.GEMINI_API_KEY) },
        grok: { configured: Boolean(config.ai?.grokApiKey || process.env.GROK_API_KEY) },
        ollama: { configured: true },
      },
    };

    res.json(result);
  });

  // 12. Global AI Insights
  router.get('/:fileId/ai-summary', aiLimiter, async (req, res) => {
    const { fileId } = req.params;
    const record = store.get(fileId);
    if (!record) return res.status(404).json({ error: 'File not found' });
    
    const { AiService } = require('../../ai/AiService');
    if (!AiService.isEnabled()) {
      return res.status(400).json({ error: 'AI integration is disabled.' });
    }

    try {
      const summary = await AiService.generateExecutiveSummary(record);
      res.json({ summary });
    } catch (err) {
      res.status(500).json({ error: sanitizeErrorMessage(err) });
    }
  });
}

module.exports = { register };
