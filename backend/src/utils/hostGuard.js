/**
 * SFTP target allowlist (security finding #10, SSRF-class consideration).
 *
 * SFTP servers are usually internal, so private addresses are NOT blocked by
 * default. Operators can restrict which hosts may be contacted by setting
 * SFTP_ALLOWED_HOSTS to a comma-separated list of exact hostnames/IPs.
 * Empty/unset = allow all (backward compatible) — documented in SECURITY.md.
 */

function sftpAllowedHosts() {
  return String(process.env.SFTP_ALLOWED_HOSTS || '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

function isSftpHostAllowed(host) {
  const allowed = sftpAllowedHosts();
  if (allowed.length === 0) return true; // allowlist disabled
  if (!host) return false;
  return allowed.includes(String(host).trim().toLowerCase());
}

module.exports = { isSftpHostAllowed, sftpAllowedHosts };
