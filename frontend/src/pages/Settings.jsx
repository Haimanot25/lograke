import { useState, useEffect } from 'react';

import { API_BASE } from '../config';

const PROVIDER_OPTIONS = [
  { value: 'groq', label: 'Groq (Free — recommended)' },
  { value: 'gemini', label: 'Google Gemini' },
  { value: 'grok', label: 'xAI Grok' },
  { value: 'ollama', label: 'Ollama (Local, free)' },
];

export default function Settings({ onSettingsChange }) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState(null);
  const [settings, setSettings] = useState({
    groq_api_key: '',
    gemini_api_key: '',
    grok_api_key: '',
    ollama_base_url: '',
    active_ai_provider: 'groq',
  });
  const [savedMasks, setSavedMasks] = useState({
    groq_api_key: '',
    gemini_api_key: '',
    grok_api_key: '',
    ollama_base_url: '',
  });

  const loadSettings = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/settings`, { credentials: 'include' });
      if (res.ok) {
        const data = await res.json();
        const s = data.settings || {};
        setSettings({
          groq_api_key: '',
          gemini_api_key: '',
          grok_api_key: '',
          ollama_base_url: '',
          active_ai_provider: s.active_ai_provider || 'groq',
        });
        setSavedMasks({
          groq_api_key: s.groq_api_key || '',
          gemini_api_key: s.gemini_api_key || '',
          grok_api_key: s.grok_api_key || '',
          ollama_base_url: s.ollama_base_url || '',
        });
      }
    } catch (err) {
      setMessage({ type: 'error', text: `Failed to load settings: ${err.message}` });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional fetch-on-mount; loading flag mirrors request lifecycle
    loadSettings();
  }, []);

  const handleSave = async (e) => {
    e.preventDefault();
    setSaving(true);
    setMessage(null);

    const payload = { active_ai_provider: settings.active_ai_provider };
    if (settings.groq_api_key.trim()) payload.groq_api_key = settings.groq_api_key.trim();
    if (settings.gemini_api_key.trim()) payload.gemini_api_key = settings.gemini_api_key.trim();
    if (settings.grok_api_key.trim()) payload.grok_api_key = settings.grok_api_key.trim();
    if (settings.ollama_base_url.trim()) payload.ollama_base_url = settings.ollama_base_url.trim();

    try {
      const res = await fetch(`${API_BASE}/settings`, {
        credentials: 'include',
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (res.ok) {
        setMessage({ type: 'success', text: 'Settings saved successfully.' });
        setSettings(prev => ({
          ...prev,
          groq_api_key: '',
          gemini_api_key: '',
          grok_api_key: '',
          ollama_base_url: '',
        }));
        await loadSettings();
        onSettingsChange?.();
      } else {
        const errData = await res.json();
        setMessage({ type: 'error', text: errData.error || 'Failed to save settings.' });
      }
    } catch (err) {
      setMessage({ type: 'error', text: `Save error: ${err.message}` });
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="loading-state">
        Loading settings…
      </div>
    );
  }

  return (
    <div className="settings-layout">
      <div className="section-header">
        <div>
          <h1>Admin Settings</h1>
          <p>Configure AI provider API keys and select the active engine.</p>
        </div>
      </div>

      {message && (
        <div className={`settings-message ${message.type}`} aria-live="polite">
          {message.text}
        </div>
      )}

      <div className="recommended-banner">
        <strong>Recommended: Groq (Free)</strong>
        <p>
          Sign up at{' '}
          <a href="https://console.groq.com" target="_blank" rel="noopener noreferrer">
            console.groq.com
          </a>{' '}
          — no credit card required. Free tier includes Llama 3.3 70B with ~30 requests/min.
        </p>
      </div>

      <form onSubmit={handleSave} className="card-elevated settings-form">
        <div>
          <h3>Active AI Provider</h3>
          <p style={{ marginBottom: '12px' }}>
            Choose which provider powers log explanations, natural language queries, and executive summaries.
          </p>
          <select
            className="input-select"
            aria-label="Active AI Provider"
            value={settings.active_ai_provider}
            onChange={(e) => setSettings(prev => ({ ...prev, active_ai_provider: e.target.value }))}
            style={{ width: '100%', maxWidth: '360px' }}
          >
            {PROVIDER_OPTIONS.map(opt => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </div>

        <div className="settings-provider">
          <h3>Groq API Key (Free)</h3>
          <p>
            Get a free key from{' '}
            <a href="https://console.groq.com/keys" target="_blank" rel="noopener noreferrer">
              Groq Console
            </a>
            . Uses Llama 3.3 70B by default.
          </p>
          {savedMasks.groq_api_key && (
            <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '8px' }}>
              Current: <code>{savedMasks.groq_api_key}</code>
            </div>
          )}
          <input
            type="password"
            className="input-select"
            placeholder={savedMasks.groq_api_key ? 'Enter new key to replace…' : 'Enter Groq API key (gsk_…)…'}
            value={settings.groq_api_key}
            onChange={(e) => setSettings(prev => ({ ...prev, groq_api_key: e.target.value }))}
            style={{ width: '100%' }}
            autoComplete="off"
            aria-label="Groq API key"
          />
        </div>

        <div className="settings-provider">
          <h3>Gemini API Key</h3>
          <p>
            Get a key from{' '}
            <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener noreferrer">
              Google AI Studio
            </a>
            . Uses gemini-2.5-flash (free tier available).
          </p>
          {savedMasks.gemini_api_key && (
            <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '8px' }}>
              Current: <code>{savedMasks.gemini_api_key}</code>
            </div>
          )}
          <input
            type="password"
            className="input-select"
            placeholder={savedMasks.gemini_api_key ? 'Enter new key to replace…' : 'Enter Gemini API key…'}
            value={settings.gemini_api_key}
            onChange={(e) => setSettings(prev => ({ ...prev, gemini_api_key: e.target.value }))}
            style={{ width: '100%' }}
            autoComplete="off"
            aria-label="Gemini API key"
          />
        </div>

        <div className="settings-provider">
          <h3>Grok API Key</h3>
          <p>
            Get a key from{' '}
            <a href="https://console.x.ai" target="_blank" rel="noopener noreferrer">
              xAI Console
            </a>
            . Uses grok-4.3 (paid).
          </p>
          {savedMasks.grok_api_key && (
            <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '8px' }}>
              Current: <code>{savedMasks.grok_api_key}</code>
            </div>
          )}
          <input
            type="password"
            className="input-select"
            placeholder={savedMasks.grok_api_key ? 'Enter new key to replace…' : 'Enter Grok API key…'}
            value={settings.grok_api_key}
            onChange={(e) => setSettings(prev => ({ ...prev, grok_api_key: e.target.value }))}
            style={{ width: '100%' }}
            autoComplete="off"
            aria-label="Grok API key"
          />
        </div>

        <div className="settings-provider">
          <h3>Ollama Base URL (Local)</h3>
          <p>
            Run models locally with{' '}
            <a href="https://ollama.com" target="_blank" rel="noopener noreferrer">
              Ollama
            </a>
            . Default: <code>http://localhost:11434</code>. No API key needed.
          </p>
          {savedMasks.ollama_base_url && (
            <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '8px' }}>
              Current: <code>{savedMasks.ollama_base_url}</code>
            </div>
          )}
          <input
            type="text"
            className="input-select"
            placeholder="http://localhost:11434"
            value={settings.ollama_base_url}
            onChange={(e) => setSettings(prev => ({ ...prev, ollama_base_url: e.target.value }))}
            style={{ width: '100%' }}
            autoComplete="off"
            aria-label="Ollama base URL"
          />
        </div>

        <div className="settings-actions">
          <button type="submit" className="btn btn-primary" disabled={saving}>
            {saving ? 'Saving…' : 'Save Settings'}
          </button>
          <button type="button" className="btn btn-ghost" onClick={loadSettings} disabled={saving}>
            Reset
          </button>
        </div>
      </form>

      <div className="settings-info-card">
        <h4>Model Fallback</h4>
        <p>
          If a provider&apos;s primary model is unavailable, the system automatically tries fallback models
          (e.g. gemini-2.5-flash → gemini-2.5-flash-lite → gemini-2.0-flash).
        </p>
      </div>
    </div>
  );
}
