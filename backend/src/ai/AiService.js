const db = require('../db');
const { logger } = require('../middleware/logger');
const crypto = require('crypto');
const { buildLogContextForAI, redactPII } = require('./LogChunker');

const PROVIDERS = {
  groq: {
    label: 'Groq (Free)',
    keySetting: 'groq_api_key',
    envKey: 'GROQ_API_KEY',
    apiUrl: 'https://api.groq.com/openai/v1/chat/completions',
    models: [
      'meta-llama/llama-4-maverick-17b-128e-instruct',
      'meta-llama/llama-4-scout-17b-16e-instruct'
    ],
    requiresKey: true,
    contextLimit: 131072,
  },
  gemini: {
    label: 'Google Gemini',
    keySetting: 'gemini_api_key',
    envKey: 'GEMINI_API_KEY',
    models: [
      'gemini-3.5-flash',
      'gemini-3.1-flash-lite'
    ],
    requiresKey: true,
    contextLimit: 128000,
  },
  grok: {
    label: 'xAI Grok',
    keySetting: 'grok_api_key',
    envKey: 'GROK_API_KEY',
    apiUrl: 'https://api.x.ai/v1/chat/completions',
    models: [
      'grok-4.20-0309-non-reasoning',
      'grok-4.3',
      'grok-4.7'
    ],
    requiresKey: true,
    contextLimit: 32000,
  },
  ollama: {
    label: 'Ollama (Local)',
    keySetting: 'ollama_base_url',
    envKey: 'OLLAMA_BASE_URL',
    defaultBaseUrl: 'http://localhost:11434/v1/chat/completions',
    models: ['llama3.2', 'mistral', 'gemma2'],
    requiresKey: false,
    contextLimit: 8192,
  },
};

for (const [providerKey, providerConfig] of Object.entries(PROVIDERS)) {
  const envOverride = process.env[`${providerKey.toUpperCase()}_MODELS`];
  if (envOverride) {
    const overridden = envOverride.split(',').map(s => s.trim()).filter(Boolean);
    if (overridden.length) providerConfig.models = overridden;
  }
}

const AI_CACHE = new Map();
const AI_CACHE_TTL = 5 * 60 * 1000;
const AI_CACHE_MAX = 100;

function cacheGet(key) {
  const entry = AI_CACHE.get(key);
  if (!entry) return undefined;
  if (Date.now() - entry.timestamp > AI_CACHE_TTL) {
    AI_CACHE.delete(key);
    return undefined;
  }
  return entry.value;
}

function cacheSet(key, value) {
  if (AI_CACHE.size >= AI_CACHE_MAX) {
    const oldestKey = AI_CACHE.keys().next().value;
    AI_CACHE.delete(oldestKey);
  }
  AI_CACHE.set(key, { value, timestamp: Date.now() });
}

// Persistent SQLite cache layer
function sqliteCacheGet(key) {
  try {
    const row = db.prepare('SELECT value FROM ai_cache WHERE cache_key = ? AND expires_at > ?').get(key, Date.now());
    return row ? row.value : undefined;
  } catch { return undefined; }
}

function sqliteCacheSet(key, value, ttlMs = AI_CACHE_TTL) {
  try {
    db.prepare('INSERT OR REPLACE INTO ai_cache (cache_key, value, expires_at) VALUES (?, ?, ?)').run(key, value, Date.now() + ttlMs);
  } catch { /* best-effort */ }
}

// Circuit breaker per provider
const CIRCUIT_BREAKER = new Map();
const CB_THRESHOLD = 3;
const CB_RESET_MS = 120000;

function isCircuitOpen(provider) {
  const state = CIRCUIT_BREAKER.get(provider);
  if (!state) return false;
  if (state.failures >= CB_THRESHOLD) {
    if (Date.now() - state.openedAt > CB_RESET_MS) {
      CIRCUIT_BREAKER.delete(provider);
      return false;
    }
    return true;
  }
  return false;
}

function recordCircuitFailure(provider) {
  let state = CIRCUIT_BREAKER.get(provider);
  if (!state) {
    state = { failures: 0, openedAt: 0 };
    CIRCUIT_BREAKER.set(provider, state);
  }
  state.failures++;
  if (state.failures >= CB_THRESHOLD) {
    state.openedAt = Date.now();
    logger.warn(`[AiService] Circuit breaker opened for provider "${provider}" after ${state.failures} failures`);
  }
}

function recordCircuitSuccess(provider) {
  CIRCUIT_BREAKER.delete(provider);
}

function estimateTokens(text) {
  return Math.ceil((text || '').length / 4);
}

const COST_PER_1K_INPUT = { groq: 0.00059, gemini: 0.000075, grok: 0.002, ollama: 0 };
const COST_PER_1K_OUTPUT = { groq: 0.00079, gemini: 0.0003, grok: 0.01, ollama: 0 };

function estimateCost(provider, tokensIn, tokensOut) {
  const inRate = COST_PER_1K_INPUT[provider] || 0;
  const outRate = COST_PER_1K_OUTPUT[provider] || 0;
  return (tokensIn / 1000) * inRate + (tokensOut / 1000) * outRate;
}

function logAiCost({ provider, model, tokensIn, tokensOut, endpoint, durationMs, success, errorMessage }) {
  try {
    const cost = estimateCost(provider, tokensIn || 0, tokensOut || 0);
    db.prepare(`INSERT INTO ai_cost_log (provider, model, tokens_in, tokens_out, cost_estimate, endpoint, duration_ms, success, error_message, timestamp)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`)
      .run(provider, model || 'unknown', tokensIn || 0, tokensOut || 0, cost, endpoint || '', durationMs || 0, success ? 1 : 0, errorMessage || null);
  } catch { /* best-effort */ }
}

function getSetting(key) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row?.value || '';
}

function getProviderKey(provider) {
  const config = PROVIDERS[provider];
  if (!config) return '';
  return getSetting(config.keySetting) || process.env[config.envKey] || '';
}

function getAiConfig() {
  const provider = getSetting('active_ai_provider') || process.env.ACTIVE_AI_PROVIDER || 'groq';
  return {
    provider,
    groqKey: getProviderKey('groq'),
    geminiKey: getProviderKey('gemini'),
    grokKey: getProviderKey('grok'),
    ollamaBaseUrl: getProviderKey('ollama') || PROVIDERS.ollama.defaultBaseUrl,
  };
}

function getActiveProvider() {
  return getAiConfig().provider;
}

function getProviderLabel(provider) {
  return PROVIDERS[provider]?.label || provider;
}

function isEnabled() {
  const { provider, groqKey, geminiKey, grokKey } = getAiConfig();
  if (provider === 'groq') return Boolean(groqKey);
  if (provider === 'gemini') return Boolean(geminiKey);
  if (provider === 'grok') return Boolean(grokKey);
  if (provider === 'ollama') return true;
  return false;
}

function isAuthError(err, status) {
  if (status === 401 || status === 403) return true;
  const msg = String(err?.message || err || '').toLowerCase();
  return msg.includes('api key') || msg.includes('unauthorized') || msg.includes('invalid key') || msg.includes('forbidden') || msg.includes('auth');
}

function fetchWithTimeout(url, options, timeoutMs = 30000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...options, signal: controller.signal }).finally(() => clearTimeout(timeout));
}

async function fetchWithRetry(url, options, timeoutMs = 60000, retries = 1) {
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      if (attempt > 0) {
        const delay = Math.min(1000 * Math.pow(2, attempt - 1), 8000);
        logger.info(`[AiService] Retry attempt ${attempt + 1}/${retries + 1} after ${delay}ms`);
        await new Promise(r => setTimeout(r, delay));
      }
      return await fetchWithTimeout(url, options, timeoutMs);
    } catch (err) {
      if (err.name === 'AbortError') throw err;
      lastError = err;
    }
  }
  throw lastError;
}

// Runtime model discovery: drop decommissioned IDs by asking the provider
// which models it currently serves. Cached in memory for 1 hour; failures are
// cached for 5 minutes. Discovery must never break an otherwise-working call.
const MODEL_DISCOVERY_CACHE = new Map(); // provider -> { ids: Set|null, timestamp }
const MODEL_DISCOVERY_TTL = 60 * 60 * 1000;
const MODEL_DISCOVERY_FAIL_TTL = 5 * 60 * 1000;
const DEAD_MODELS = new Set(); // `${provider}:${model}` marked dead at runtime

function getCachedDiscoveredModels(provider) {
  const entry = MODEL_DISCOVERY_CACHE.get(provider);
  if (!entry) return undefined;
  const ttl = entry.ids ? MODEL_DISCOVERY_TTL : MODEL_DISCOVERY_FAIL_TTL;
  if (Date.now() - entry.timestamp > ttl) {
    MODEL_DISCOVERY_CACHE.delete(provider);
    return undefined;
  }
  return entry.ids;
}

function modelsUrlFromChatCompletionsUrl(apiUrl) {
  return String(apiUrl || '').replace(/\/chat\/completions\/?$/, '/models');
}

async function fetchModelIdsOpenAICompatible(apiUrl, apiKey) {
  const modelsUrl = modelsUrlFromChatCompletionsUrl(apiUrl);
  if (!modelsUrl || modelsUrl === apiUrl) throw new Error('could not derive models URL');
  const headers = {};
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
  const res = await fetchWithTimeout(modelsUrl, { headers }, 10000);
  if (!res.ok) throw new Error(`models list request failed (status ${res.status})`);
  const data = await res.json();
  const ids = (Array.isArray(data?.data) ? data.data : []).map(m => m?.id).filter(Boolean);
  if (!ids.length) throw new Error('empty model list');
  return ids;
}

async function fetchModelIdsGemini(apiKey) {
  const res = await fetchWithTimeout(
    `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(apiKey)}`,
    {}, 10000
  );
  if (!res.ok) throw new Error(`models list request failed (status ${res.status})`);
  const data = await res.json();
  const ids = (Array.isArray(data?.models) ? data.models : [])
    .map(m => String(m?.name || '').replace(/^models\//, ''))
    .filter(Boolean);
  if (!ids.length) throw new Error('empty model list');
  return ids;
}

async function resolveModels(provider, configuredModels, discoverIds) {
  const config = PROVIDERS[provider];
  const configured = (config && Array.isArray(config.models)) ? config.models : configuredModels;
  const alive = configured.filter(m => !DEAD_MODELS.has(`${provider}:${m}`));
  const base = alive.length ? alive : configured;

  let discovered = getCachedDiscoveredModels(provider);
  if (discovered === undefined) {
    try {
      discovered = new Set(await discoverIds());
      MODEL_DISCOVERY_CACHE.set(provider, { ids: discovered, timestamp: Date.now() });
    } catch (err) {
      MODEL_DISCOVERY_CACHE.set(provider, { ids: null, timestamp: Date.now() });
      logger.warn(`[AiService] Model discovery failed for "${provider}", using configured model list. Error: ${err.message}`);
      discovered = null;
    }
  }
  if (!discovered) return base;
  const available = base.filter(m => discovered.has(m));
  return available.length ? available : base;
}

function isDecommissionedModelError(err) {
  const status = err?.status;
  const msg = String(err?.message || err || '').toLowerCase();
  if (status === 404 || status === 'NOT_FOUND' || status === 'not_found') return true;
  if (msg.includes('model_decommissioned')) return true;
  if (msg.includes('does not exist')) return true;
  if (msg.includes('not found')) return true;
  if ((status === 400 || status === 'INVALID_ARGUMENT' || status === 'invalid_argument') &&
      /(model|slug)\b.*\b(invalid|deprecat|decommission|retired|no longer|unavailable|disabled|removed)|\b(invalid|deprecat|decommission|retired)\b.*\b(model|slug)/.test(msg)) return true;
  return false;
}

async function callOpenAICompatible({ apiUrl, apiKey, models, messages, providerLabel, stream = false }) {
  let lastError = null;
  const provider = Object.entries(PROVIDERS).find(([, v]) => v.label === providerLabel)?.[0] || providerLabel.toLowerCase();

  const effectiveModels = await resolveModels(provider, models, () => fetchModelIdsOpenAICompatible(apiUrl, apiKey));

  for (const model of effectiveModels) {
    const startMs = Date.now();
    const tokensIn = estimateTokens(JSON.stringify(messages));
    try {
      const headers = { 'Content-Type': 'application/json' };
      if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

      const body = { model, messages };
      if (stream) body.stream = true;

      const response = await fetchWithRetry(apiUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      }, 60000, 1);

      if (!response.ok) {
        const errBody = await response.text();
        if (response.status === 401 || response.status === 403) {
          recordCircuitFailure(provider);
          throw new Error(`${providerLabel} authentication failed (status ${response.status}). Please verify your API key.`);
        }
        const modelError = new Error(`${providerLabel} model "${model}" failed (status ${response.status}): ${errBody}`);
        modelError.status = response.status;
        throw modelError;
      }

      if (stream) {
        const durationMs = Date.now() - startMs;
        logAiCost({ provider, model, tokensIn, tokensOut: 0, endpoint: apiUrl, durationMs, success: true });
        recordCircuitSuccess(provider);
        return response.body;
      }

      const data = await response.json();
      const content = data.choices?.[0]?.message?.content;
      if (!content) throw new Error(`${providerLabel} returned an empty response.`);

      const tokensOut = estimateTokens(content);
      const durationMs = Date.now() - startMs;
      logAiCost({ provider, model, tokensIn, tokensOut, endpoint: apiUrl, durationMs, success: true });
      recordCircuitSuccess(provider);
      return content;
    } catch (err) {
      if (isAuthError(err)) { recordCircuitFailure(provider); throw err; }
      if (isDecommissionedModelError(err)) {
        DEAD_MODELS.add(`${provider}:${model}`);
        const durationMs = Date.now() - startMs;
        logAiCost({ provider, model, tokensIn, tokensOut: 0, endpoint: apiUrl, durationMs, success: false, errorMessage: sanitizeErrorMessage(err) });
        logger.warn(`[AiService] ${providerLabel} model "${model}" is decommissioned or not found, marked dead and trying next fallback. Error: ${err.message}`);
      } else {
        logger.warn(`[AiService] ${providerLabel} model "${model}" failed, trying next fallback. Error: ${err.message}`);
      }
      lastError = err;
    }
  }

  recordCircuitFailure(provider);
  throw lastError || new Error(`${providerLabel}: no available models responded.`);
}

async function callGemini(apiKey, prompt, stream = false) {
  const { GoogleGenerativeAI } = require('@google/generative-ai');
  const client = new GoogleGenerativeAI(apiKey);
  let lastError = null;
  const provider = 'gemini';

  const effectiveModels = await resolveModels(provider, PROVIDERS.gemini.models, () => fetchModelIdsGemini(apiKey));

  for (const modelName of effectiveModels) {
    const startMs = Date.now();
    const tokensIn = estimateTokens(typeof prompt === 'string' ? prompt : JSON.stringify(prompt));
    try {
      const model = client.getGenerativeModel({ model: modelName });
      if (stream) {
        const result = await model.generateContentStream(prompt);
        const durationMs = Date.now() - startMs;
        logAiCost({ provider, model: modelName, tokensIn, tokensOut: 0, endpoint: 'gemini-sdk', durationMs, success: true });
        recordCircuitSuccess(provider);
        return result.stream;
      }
      const result = await model.generateContent(prompt);
      const response = await result.response;
      const text = response.text();
      const tokensOut = estimateTokens(text);
      const durationMs = Date.now() - startMs;
      logAiCost({ provider, model: modelName, tokensIn, tokensOut, endpoint: 'gemini-sdk', durationMs, success: true });
      recordCircuitSuccess(provider);
      return text;
    } catch (err) {
      if (isAuthError(err)) { recordCircuitFailure(provider); throw err; }
      if (isDecommissionedModelError(err)) {
        DEAD_MODELS.add(`${provider}:${modelName}`);
        const durationMs = Date.now() - startMs;
        logAiCost({ provider, model: modelName, tokensIn, tokensOut: 0, endpoint: 'gemini-sdk', durationMs, success: false, errorMessage: sanitizeErrorMessage(err) });
        logger.warn(`[AiService] Gemini model "${modelName}" is decommissioned or not found, marked dead and trying next fallback. Error: ${err.message}`);
      } else {
        logger.warn(`[AiService] Gemini model "${modelName}" failed, trying next fallback. Error: ${err.message}`);
      }
      lastError = err;
    }
  }

  recordCircuitFailure(provider);
  throw lastError || new Error('Gemini: no available models responded.');
}

async function generateCompletion(prompt, stream = false) {
  const { provider, groqKey, geminiKey, grokKey, ollamaBaseUrl } = getAiConfig();

  if (isCircuitOpen(provider)) {
    throw new Error(`${getProviderLabel(provider)} circuit breaker is open — too many recent failures. Please try again later or switch providers in Admin Settings.`);
  }

  const messages = [
    { role: 'system', content: 'You are a Senior Site Reliability Engineer and log analysis expert. Respond concisely and accurately based on the provided log data.' }, 
    { role: 'user', content: prompt }
  ];

  if (provider === 'groq') {
    if (!groqKey) throw new Error('Groq API key is not configured.');
    return callOpenAICompatible({
      apiUrl: PROVIDERS.groq.apiUrl,
      apiKey: groqKey,
      models: PROVIDERS.groq.models,
      messages,
      providerLabel: 'Groq',
      stream,
    });
  }

  if (provider === 'grok') {
    if (!grokKey) throw new Error('Grok API key is not configured.');
    return callOpenAICompatible({
      apiUrl: PROVIDERS.grok.apiUrl,
      apiKey: grokKey,
      models: PROVIDERS.grok.models,
      messages,
      providerLabel: 'Grok',
      stream,
    });
  }

  if (provider === 'ollama') {
    const baseUrl = ollamaBaseUrl.replace(/\/$/, '');
    const apiUrl = baseUrl.includes('/chat/completions')
      ? baseUrl
      : `${baseUrl}/v1/chat/completions`;
    return callOpenAICompatible({
      apiUrl,
      apiKey: '',
      models: PROVIDERS.ollama.models,
      messages,
      providerLabel: 'Ollama',
      stream,
    });
  }

  if (!geminiKey) throw new Error('Gemini API key is not configured.');
  return callGemini(geminiKey, prompt, stream);
}

async function* generateCompletionStream(prompt) {
  const body = await generateCompletion(prompt, true);
  const { provider } = getAiConfig();

  if (provider === 'gemini') {
    for await (const chunk of body) {
      const text = chunk.text();
      if (text) yield text;
    }
    return;
  }

  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';
    for (const line of lines) {
      if (line.startsWith('data: ')) {
        const jsonStr = line.slice(6).trim();
        if (jsonStr === '[DONE]') return;
        if (!jsonStr) continue;
        try {
          const parsed = JSON.parse(jsonStr);
          const content = parsed.choices?.[0]?.delta?.content || '';
          if (content) yield content;
        } catch (err) { logger.warn('AI streaming chunk skipped:', err.message); }
      }
    }
  }
}

function pipeStreamToResponse(prompt, res) {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');

  (async () => {
    try {
      const stream = generateCompletionStream(prompt);
      for await (const chunk of stream) {
        res.write(`data: ${JSON.stringify({ token: chunk })}\n\n`);
      }
      res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
      res.end();
    } catch (err) {
      const msg = sanitizeErrorMessage(err);
      res.write(`data: ${JSON.stringify({ error: msg })}\n\n`);
      res.end();
    }
  })();
}

function sanitizeErrorMessage(err) {
  const msg = String(err?.message || err || 'Unknown error');
  if (msg.includes('circuit breaker is open')) return msg;
  const safe = msg
    .replace(/(https?:\/\/)[^\s]+/g, '$1[REDACTED]')
    .replace(/(api[_-]?key['":\s=]+)[^\s"']+/gi, '$1[REDACTED]')
    .replace(/(Bearer\s+)[^\s]+/gi, '$1[REDACTED]')
    .replace(/(\/[a-zA-Z0-9_-]{20,})/g, '/[REDACTED]');
  if (safe.length > 200) return safe.slice(0, 200) + '...';
  return safe;
}

function validateAiResponse(text, expectedSections = []) {
  if (!text || text.length < 20) return false;
  if (expectedSections.length === 0) return true;
  const lower = text.toLowerCase();
  return expectedSections.some(s => lower.includes(s.toLowerCase()));
}

async function explainLog(logText, level, fileRecord) {
  const scrubbedLogText = redactPII(logText);
  const cacheKey = `explain:${fileRecord?.id}:${scrubbedLogText.slice(0, 80)}:${level}`;
  const cached = cacheGet(cacheKey) || sqliteCacheGet(cacheKey);
  if (cached) return cached;

  if (!isEnabled()) {
    const result = generateFallbackExplanation(scrubbedLogText, level);
    cacheSet(cacheKey, result);
    sqliteCacheSet(cacheKey, result);
    return result;
  }

  const contextLines = [];
  let windowErrorRate = '';
  if (fileRecord?.parsedLogs) {
    const idx = fileRecord.parsedLogs.findIndex(l => l.raw === logText || l.raw === scrubbedLogText);
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
        const msg = redactPII(l.message || l.raw);
        if (i === idx) contextLines.push(`→ [${l.level}] ${msg}`);
        else contextLines.push(`  [${l.level}] ${msg}`);
      }
      
      const chunked = buildLogContextForAI(fileRecord.parsedLogs);
      const errorsInWindow = chunked.stats.countsByLevel.ERROR + chunked.stats.countsByLevel.FATAL;
      if (errorsInWindow > 0) {
        windowErrorRate = `\nOverall error count in this file: ${errorsInWindow} (${(errorsInWindow / chunked.stats.totalLogs * 100).toFixed(1)}% of total).`;
      }
    }
  }

  const prompt = `Explain this log entry with root cause analysis and remediation steps. Be concise.

Level: ${level}
${contextLines.length ? `Context (${contextLines.length - 1} surrounding lines):\n${contextLines.join('\n')}\n` : ''}
Log Content: ${scrubbedLogText}${windowErrorRate}

Format your response as markdown with sections: Root Cause, Impact, Remediation.`;

  try {
    const result = await generateCompletion(prompt);
    if (!validateAiResponse(result, ['Root Cause', 'Impact', 'Remediation'])) {
      logger.warn('[AiService] AI response did not contain expected sections, but returning anyway');
    }
    cacheSet(cacheKey, result);
    sqliteCacheSet(cacheKey, result);
    return result;
  } catch (err) {
    logger.error(`${getActiveProvider()} error, falling back:`, sanitizeErrorMessage(err));
    const result = generateFallbackExplanation(scrubbedLogText, level);
    cacheSet(cacheKey, result);
    sqliteCacheSet(cacheKey, result);
    return result;
  }
}

async function queryLogs(parsedLogs, userQuery) {
  if (!isEnabled()) {
    return 'AI is not enabled. Configure an API key in Admin Settings to search with natural language.';
  }

  const cacheKey = `query:${crypto.createHash('md5').update(userQuery).digest('hex')}:${parsedLogs.length}`;
  const cached = sqliteCacheGet(cacheKey);
  if (cached) return cached;

  const ctx = buildLogContextForAI(parsedLogs);
  const { stats, timeline, errorTraces, sampleNormalLogs, omittedErrorCount } = ctx;
  const errorPct = stats.totalLogs ? ((stats.countsByLevel.ERROR + stats.countsByLevel.FATAL) / stats.totalLogs * 100).toFixed(1) : '0.0';

  const timelineStr = timeline.length > 0
    ? timeline.map(w => `  ${w.window}: ${w.errors} errors, ${w.total} total`).join('\n')
    : '  (no time data)';
  const errorsStr = errorTraces.length > 0
    ? errorTraces.map(e => `[${e.effectiveLevel || e.level}] ${e.timestampIso || e.timestamp} ${e.message || e.raw}`).join('\n')
    : '  (none)';
  const omittedStr = omittedErrorCount > 0 ? `\n[+ ${omittedErrorCount} similar errors omitted due to token limit]` : '';
  const samplesStr = sampleNormalLogs.length > 0
    ? sampleNormalLogs.map(s => `[${s.effectiveLevel || s.level}] ${s.timestampIso || s.timestamp} ${s.message || s.raw}`).join('\n')
    : '  (none)';

  const prompt = `Answer the user query based on the structured log context below.

Query: "${userQuery}"

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

  try {
    const result = await generateCompletion(prompt);
    sqliteCacheSet(cacheKey, result, 120000);
    return result;
  } catch (err) {
    logger.error(`${getActiveProvider()} error:`, sanitizeErrorMessage(err));
    return `Failed to execute natural language query via ${getProviderLabel(getActiveProvider())}: ${sanitizeErrorMessage(err)}`;
  }
}

async function generateExecutiveSummary(fileRecord) {
  if (!isEnabled()) {
    return heuristicExecutiveSummary(fileRecord);
  }

  const cacheKey = `summary:${fileRecord.id}:${crypto.createHash('md5').update(JSON.stringify(fileRecord.levelCounts || {})).digest('hex')}`;
  const cached = sqliteCacheGet(cacheKey);
  if (cached) return cached;

  const levelCounts = fileRecord.levelCounts || {};
  const total = fileRecord.linesCount || 1;
  const errorPct = (((levelCounts.ERROR || 0) + (levelCounts.FATAL || 0)) / total * 100).toFixed(1);

  const ctx = buildLogContextForAI(fileRecord.parsedLogs || []);
  const timelineStr = ctx.timeline.length > 0
    ? ctx.timeline.map(w => `  ${w.window}: ${w.errors} errors / ${w.total} total`).join('\n')
    : '';

  const stats = {
    fileName: fileRecord.name,
    totalLogs: fileRecord.linesCount,
    healthScore: fileRecord.healthScore,
    errorRate: `${errorPct}%`,
    levelCounts,
    topServices: Object.entries(fileRecord.facetCounts?.service || {})
      .sort((a, b) => b[1] - a[1]).slice(0, 3).map(e => e[0]),
    topHosts: Object.entries(fileRecord.facetCounts?.host || {})
      .sort((a, b) => b[1] - a[1]).slice(0, 3).map(e => e[0]),
    anomaliesCount: (fileRecord.anomalies || []).length,
    alertsCount: (fileRecord.alerts || []).length,
    errorsByCategory: ctx.stats.errorsByCategory,
    timeSpanMs: ctx.timeSpanMs,
  };

  const prompt = `Generate a concise executive summary of this log file based on its metrics. Use markdown with sections: System Health Overview, Critical Findings, Key Recommendations.

Metrics:
${JSON.stringify(stats, null, 2)}
${timelineStr ? `\nPer-Minute Error Timeline:\n${timelineStr}` : ''}

Do NOT stop analysis early. Evaluate the full time span of ${ctx.timeSpanMs ? Math.round(ctx.timeSpanMs / 1000) + 's' : 'the logs'}.
CRITICAL: Cover both the INCIDENT phase AND THE RECOVERY phase (e.g., pod restarts, state transitions back to CLOSED, cleared locks).`;

  try {
    const result = await generateCompletion(prompt);
    sqliteCacheSet(cacheKey, result, 300000);
    return result;
  } catch (err) {
    logger.error(`${getActiveProvider()} error:`, sanitizeErrorMessage(err));
    return heuristicExecutiveSummary(fileRecord);
  }
}

function heuristicExecutiveSummary(fileRecord) {
  const lc = fileRecord.levelCounts || {};
  const total = fileRecord.linesCount || 0;
  const errors = (lc.ERROR || 0) + (lc.FATAL || 0);
  const warnings = lc.WARN || 0;
  const errorPct = total ? (errors / total * 100).toFixed(1) : '0.0';
  const health = fileRecord.healthScore ?? 'N/A';
  const topServices = Object.entries(fileRecord.facetCounts?.service || {})
    .sort((a, b) => b[1] - a[1]).slice(0, 3).map(e => e[0]).join(', ') || 'none detected';

  let status = 'Healthy';
  let findings = 'No critical issues detected.';
  let recommendations = 'Continue monitoring.';

  if (errors > 0) {
    status = 'Needs Attention';
    findings = `${errors} error(s) found (${errorPct}% of total).`;
    recommendations = 'Investigate error patterns and review top failing services.';
  }
  if (errorPct > 10) {
    status = 'Critical';
    findings = `High error rate of ${errorPct}%. Immediate investigation recommended.`;
    recommendations = 'Prioritize root cause analysis of the most frequent error patterns.';
  }

  return `## Executive Summary (AI Offline)

### System Health Overview
- **Status**: ${status}
- **Health Score**: ${health}/100
- **Total Log Entries**: ${total}
- **Error Rate**: ${errorPct}%
- **Top Services**: ${topServices}

### Critical Findings
- ${findings}
- ${warnings > 0 ? `${warnings} warning(s) detected, review recommended.` : 'No warnings detected.'}

### Key Recommendations
- ${recommendations}
- Configure AI in Admin Settings to get AI-powered insights (Groq is free).`;
}

function generateFallbackExplanation(logText, level) {
  const txt = logText.toLowerCase();
  let rootCause = 'Unknown';
  let actions = [];

  const patterns = {
    'Network/Connection': [
      { match: /conn(ection)?\s*(refused|reset|closed|timed?out?)/i, cause: 'Connection refused or reset by remote host.', actions: ['Verify the target service is running and accepting connections.', 'Check firewall rules and network ACLs.', 'Ensure the correct hostname and port are configured.'] },
      { match: /socket\s*(error|close|timeout)/i, cause: 'Socket-level communication failure.', actions: ['Check network stability between services.', 'Verify socket timeout settings.', 'Inspect load balancer health checks.'] },
      { match: /dns.*(fail|error|not found|resolve)/i, cause: 'DNS resolution failure.', actions: ['Verify DNS server configuration.', 'Check that the hostname exists in DNS records.', 'Ensure network connectivity to DNS servers.'] },
      { match: /tcp.*(timeout|refused|reset)/i, cause: 'TCP connection failure.', actions: ['Verify the target port is open and listening.', 'Check for network congestion or packet loss.', 'Review TCP keepalive settings.'] },
    ],
    'Timeout/Performance': [
      { match: /timeout|deadline exceeded|timed?out?/i, cause: 'Operation exceeded the allowed time limit.', actions: ['Increase timeout configuration for the failing operation.', 'Check if the downstream service is slow or overloaded.', 'Optimize slow database queries or external API calls.'] },
      { match: /out of memory|oom|heap.*(full|exceeded|error)/i, cause: 'Application ran out of available memory.', actions: ['Increase heap/container memory limits.', 'Investigate memory leak in the application code.', 'Analyze heap dump for object retention issues.'] },
      { match: /(disk|space).*(full|exhausted|no space)/i, cause: 'Disk storage exhausted.', actions: ['Free up disk space by rotating old logs or cleaning temp files.', 'Increase disk size or configure auto-scaling.', 'Set up disk usage alerts.'] },
    ],
    'Authentication/Authorization': [
      { match: /(auth|authenticat).*(fail|error|invalid|denied)/i, cause: 'Authentication failure — credentials rejected.', actions: ['Verify the username/password or API token.', 'Check if the credentials have expired.', 'Ensure the correct authentication method is configured.'] },
      { match: /(403|forbidden|permission denied)/i, cause: 'Authorization denied — insufficient permissions.', actions: ['Verify the user/service account has the required IAM roles.', 'Check resource-level permission policies.', 'Review recent access policy changes.'] },
      { match: /(401|unauthorized)/i, cause: 'Request lacked valid authentication credentials.', actions: ['Ensure authentication headers/tokens are included.', 'Verify the token has not expired.', 'Check the authentication endpoint is reachable.'] },
    ],
    'Application Errors': [
      { match: /nullpointer|null reference/i, cause: 'Null pointer exception — code attempted to access an uninitialized object.', actions: ['Check for missing null checks in the code path.', 'Verify that required dependencies are properly initialized.', 'Review stack trace for the exact line number.'] },
      { match: /(stack|trace|exception|throw)/i, cause: 'Unhandled exception or runtime error.', actions: ['Analyze the stack trace to find the root cause.', 'Check if this is a recurring pattern or one-time failure.', 'Review recent code deployments that may have introduced the issue.'] },
      { match: /rate limit|too many requests|throttl/i, cause: 'Request rate limit exceeded.', actions: ['Implement client-side retry with exponential backoff.', 'Increase the rate limit quota if applicable.', 'Review the request pattern for burst traffic.'] },
      { match: /(ssl|tls).*(error|fail|certif)/i, cause: 'SSL/TLS handshake or certificate error.', actions: ['Verify the SSL certificate is valid and not expired.', 'Check if the certificate chain is complete.', 'Ensure the client trusts the server certificate authority.'] },
    ],
    'Database': [
      { match: /(db|database).*(connect|timeout|refused)/i, cause: 'Database connection failure.', actions: ['Verify the database server is running and reachable.', 'Check database connection pool settings.', 'Review database user permissions.'] },
      { match: /pool.*(exhausted|full|timeout)/i, cause: 'Database connection pool exhausted.', actions: ['Increase the maximum connection pool size.', 'Check for connection leaks in application code.', 'Review database server max_connections setting.'] },
      { match: /deadlock|lock.*(timeout|contention)/i, cause: 'Database lock contention or deadlock.', actions: ['Review transaction isolation levels.', 'Optimize queries to reduce lock duration.', 'Consider retry logic for deadlock victims.'] },
    ],
  };

  for (const [, checks] of Object.entries(patterns)) {
    for (const p of checks) {
      if (p.match.test(txt)) {
        rootCause = p.cause;
        actions = [...p.actions];
        break;
      }
    }
    if (actions.length) break;
  }

  if (!actions.length) {
    if (level === 'error' || level === 'fatal') {
      rootCause = 'Critical exception or runtime failure.';
      actions = ['Check the surrounding stack trace to isolate the file and line number.', 'Ensure required environment parameters and config keys are defined.', 'Review recent deployments for potential regressions.'];
    } else if (level === 'warn') {
      rootCause = 'Non-critical alert or deprecated usage.';
      actions = ['Monitor frequency. If it occurs in bursts, it might indicate resource constraint.', 'Check deprecation warnings in dependencies or deprecated API paths.'];
    } else {
      rootCause = 'Standard system lifecycle event.';
      actions = ['No action required. Used for tracking operational workflow health.'];
    }
  }

  return `### Heuristic Summary (AI Offline)

- **Level**: ${level.toUpperCase()}
- **Possible Cause**: ${rootCause}
- **Suggested Remediation**:
${actions.map(a => `  - ${a}`).join('\n')}
  - *Enable AI by configuring API keys in Admin Settings (Groq is free, no card required).*`;
}

const AiService = {
  isEnabled,
  getActiveProvider,
  getProviderLabel,
  explainLog,
  queryLogs,
  generateExecutiveSummary,
  generateCompletionStream,
  pipeStreamToResponse,
};

module.exports = {
  ...AiService,
  AiService,
  sanitizeErrorMessage,
};