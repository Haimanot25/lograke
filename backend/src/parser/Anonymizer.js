/**
 * Anonymizer - Redacts and masks PII / sensitive data in log lines.
 */

// Regex patterns for various sensitive formats
const PATTERNS = {
  email: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g,
  creditCard: /\b(?:\d[ -]*?){13,16}\b/g,
  // Matches query params or key-values like password=xyz, token=abc, secret=123, api_key=key
  credentials: /(?:password|passwd|secret|token|api_key|apikey|private_key)\s*[:=]\s*["']?([^\s"']+)["']?/gi,
  // IPv4 Address (matches full IP and masks last two octets by default)
  ipv4: /\b(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})\b/g,
  // Simple UUID/GUID matching
  uuid: /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi
};

/**
 * Anonymizes log content based on active rules.
 * @param {string} text - Raw log text
 * @param {Object} options - Toggles for what should be anonymized
 * @returns {string} - Anonymized log text
 */
function anonymize(text, options = {}) {
  if (!text) return text;
  
  const config = {
    email: true,
    creditCard: true,
    credentials: true,
    ip: true, // If true, masks IPs (e.g. 192.168.1.50 -> 192.168.X.X)
    uuid: false, // Off by default as UUIDs are useful for correlation
    ...options
  };

  let processed = text;

  if (config.email) {
    processed = processed.replace(PATTERNS.email, '[EMAIL_REDACTED]');
  }

  if (config.creditCard) {
    processed = processed.replace(PATTERNS.creditCard, '[CARD_REDACTED]');
  }

  if (config.credentials) {
    // We want to replace the value part, keeping the key
    processed = processed.replace(PATTERNS.credentials, (match, val) => {
      // Find where value is, replace it
      const keyPart = match.substring(0, match.indexOf(val));
      return `${keyPart}[REDACTED]`;
    });
  }

  if (config.ip) {
    processed = processed.replace(PATTERNS.ipv4, (match, o1, o2, o3, o4) => {
      // Keep first two octets, mask the rest (e.g. 192.168.X.X)
      return `${o1}.${o2}.X.X`;
    });
  }

  if (config.uuid) {
    processed = processed.replace(PATTERNS.uuid, '[UUID_REDACTED]');
  }

  return processed;
}

module.exports = {
  anonymize
};
