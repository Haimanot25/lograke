const express = require('express');
const router = express.Router();
const db = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');
const config = require('../config');

// CSRF protection: validate Origin/Referer for mutating requests
function csrfProtection(req, res, next) {
  if (req.method === 'GET' || req.method === 'HEAD') return next();
  const origin = req.headers.origin;
  const referer = req.headers.referer;
  const corsOrigin = config.cors?.origin;
  const allowedOrigins = [
    corsOrigin && corsOrigin !== '*' ? corsOrigin : null,
    'http://localhost:5173',
    'http://localhost:4173',
    'http://localhost:5000',
    'http://127.0.0.1:5173',
  ].filter(Boolean);
  if (origin && allowedOrigins.some(o => origin.startsWith(o))) return next();
  if (referer && allowedOrigins.some(o => referer.startsWith(o))) return next();
  // Allow same-origin requests (no Origin header = same origin in many browsers)
  if (!origin && !referer) return next();
  return res.status(403).json({ error: 'CSRF validation failed — request origin not allowed' });
}

router.use(csrfProtection);

const ALLOWED_SETTINGS_KEYS = new Set([
  'active_ai_provider',
  'groq_api_key',
  'gemini_api_key',
  'grok_api_key',
  'ollama_base_url'
]);

const VALID_PROVIDERS = ['groq', 'gemini', 'grok', 'ollama'];

function maskKey(key) {
  if (!key || key.length < 8) return '••••••••';
  return `${key.slice(0, 4)}••••••••${key.slice(-4)}`;
}

router.get('/', requireAuth, (req, res) => {
  try {
    const rows = db.prepare('SELECT * FROM settings').all();
    const settings = {};
    rows.forEach(row => {
      if (row.key.includes('api_key') && row.value) {
        settings[row.key] = maskKey(row.value);
      } else {
        settings[row.key] = row.value;
      }
    });

    if (!settings.active_ai_provider) settings.active_ai_provider = 'groq';
    if (!settings.gemini_api_key) settings.gemini_api_key = '';
    if (!settings.grok_api_key) settings.grok_api_key = '';
    if (!settings.groq_api_key) settings.groq_api_key = '';
    if (!settings.ollama_base_url) settings.ollama_base_url = '';

    res.json({ success: true, settings });
  } catch (err) {
    res.status(500).json({ error: 'Failed to load settings' });
  }
});

// Admin-only: settings include provider API keys and global configuration
router.post('/', requireAuth, requireRole('admin'), (req, res) => {
  const newSettings = req.body;
  if (!newSettings || typeof newSettings !== 'object') {
    return res.status(400).json({ error: 'Invalid settings object' });
  }

  const errors = [];
  for (const key of Object.keys(newSettings)) {
    if (!ALLOWED_SETTINGS_KEYS.has(key)) {
      errors.push(`Unknown setting: ${key}`);
    }
  }
  if (errors.length > 0) {
    return res.status(400).json({ error: 'Invalid settings', details: errors });
  }

  if (newSettings.active_ai_provider && !VALID_PROVIDERS.includes(newSettings.active_ai_provider)) {
    return res.status(400).json({ error: `Invalid provider. Must be one of: ${VALID_PROVIDERS.join(', ')}` });
  }

  try {
    const stmt = db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (@key, @value)');
    const updateTx = db.transaction((settingsObj) => {
      for (const [key, value] of Object.entries(settingsObj)) {
        if (key.includes('api_key') && value && value.includes('••••')) {
          continue;
        }
        if ((key.includes('api_key') || key === 'ollama_base_url') && !String(value).trim()) {
          continue;
        }
        stmt.run({ key, value: String(value) });
      }
    });

    updateTx(newSettings);
    res.json({ success: true, message: 'Settings saved successfully' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to save settings' });
  }
});

module.exports = router;
