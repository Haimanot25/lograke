const rateLimit = require('express-rate-limit');

const generalLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later.' }
});

const uploadLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Upload limit reached. Please wait before uploading again.' }
});

const aiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'AI request limit reached. Please wait before sending more requests.' }
});

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many login attempts, please try again later.' }
});

// Per-provider rate limit tracking (in-memory, per-node-process)
const providerUsage = new Map();

function getProviderUsage(provider) {
  const now = Date.now();
  const windowMs = 60000;
  let entries = providerUsage.get(provider);
  if (!entries) {
    entries = [];
    providerUsage.set(provider, entries);
  }
  const cutoff = now - windowMs;
  while (entries.length > 0 && entries[0] < cutoff) entries.shift();
  return entries;
}

function checkProviderRateLimit(provider, maxPerMinute = 15) {
  const entries = getProviderUsage(provider);
  if (entries.length >= maxPerMinute) return false;
  entries.push(Date.now());
  return true;
}

// Cleanup stale entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  const cutoff = now - 60000;
  for (const [provider, entries] of providerUsage) {
    while (entries.length > 0 && entries[0] < cutoff) entries.shift();
    if (entries.length === 0) providerUsage.delete(provider);
  }
}, 300000);

module.exports = { generalLimiter, uploadLimiter, aiLimiter, loginLimiter, checkProviderRateLimit };
