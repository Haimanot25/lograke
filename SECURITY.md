# Security Policy

## Disclosure Guidelines

When reporting a vulnerability, please include:

- A description of the vulnerability
- Steps to reproduce the issue
- Potential impact
- Suggested fix (if any)

We will acknowledge receipt within 48 hours and provide a more detailed response within 7 days.

## Security Measures

Lograke includes the following security features:

### Backend Security
- **Helmet.js** for HTTP security headers (CSP, HSTS, X-Frame-Options, etc.)
  - `script-src 'self'` only — no `unsafe-inline`/`unsafe-eval`; the theme
    bootstrap ships as an external file (`public/theme-init.js`). `style-src`
    keeps `'unsafe-inline'` because the UI uses React inline style attributes
    throughout.
- **Rate limiting** on API endpoints (general: 100/min, uploads: 10/min, AI: 20/min, login: 20/15min)
- **JWT authentication** (on by default, controlled via `AUTH_ENABLED` env var;
  production refuses to boot without `JWT_SECRET`, and `/api/health` reports
  `authInsecure: true` while running on a generated ephemeral secret)
- **Role-based access control** (admin/user roles: settings writes, custom
  parsers, and notification settings are admin-gated)
- **Per-file ownership scoping**: files record the uploading user; non-admins
  can only read/list their own files (ownerless files — source ingestion and
  legacy rows — remain shared, see Deployment Considerations)
- **Input validation** middleware on mutating routes
- **SQL injection prevention** via parameterized queries and better-sqlite3
- **ReDoS protection** for user-supplied patterns via `safe-regex2` — applies
  to custom parsers, schema inference, and the `regex:` query DSL (unsafe
  patterns are rejected with HTTP 400)
- **SSRF guards on HTTP-poll sources**: hostname/IP policy (loopback, `0/8`,
  link-local, cloud metadata, IPv4-mapped/compatible IPv6 all blocked), DNS
  pre-resolution of every A/AAAA record, and manual redirect handling with
  per-hop re-validation (max 3). RFC1918 targets remain reachable by design
  for self-hosted collectors; `ALLOW_PRIVATE_URLS=true` disables the guard.
- **SFTP target allowlist**: `SFTP_ALLOWED_HOSTS` restricts which hosts the
  server will connect to for SFTP sources (create/update and before every
  list/ingest connection)
- **Webhook key hygiene**: API keys are generated server-side, compared in
  constant time, revealed exactly once (creation response), redacted in all
  reads, and never written to request logs (`?apiKey=` is redacted)
- **Archive extraction caps**: decompressed size and entry count are bounded
  (`ARCHIVE_MAX_EXTRACTED_MB`, `ARCHIVE_MAX_ENTRIES`); archives with
  symlink/hardlink or path-traversal entries are dropped
- **CSV export hardening**: cells starting with `=`, `+`, `-`, `@`, tab or CR
  are neutralized against spreadsheet formula injection
- **Storage retention**: raw file copies in `uploads/` and `data/ingested/`
  can be pruned by age (`STORAGE_MAX_AGE_DAYS`, default off)
- **Error message sanitization** - internal errors never leak to clients
- **Configurable CORS** via environment variables
- **Request body size limits** (10MB default; JSON body limit via `MAX_JSON_BODY`)

### Frontend Security
- **No secrets in client code** - API keys are server-side only
- **XSS prevention** via React's default escaping
- **CSRF protection** via SameSite cookies and origin validation

## Environment Variables

Never commit `.env` files. The repository includes `.env.example` files as templates. Ensure your `.env` files are in `.gitignore`.

### Required Security Configuration
```
JWT_SECRET=<generate a strong random string>
AUTH_ENABLED=true  # Set to true in production
CORS_ORIGIN=https://yourdomain.com  # Don't use * in production
```

### Optional Security Hardening
```
SYSLOG_BIND=127.0.0.1             # default 0.0.0.0 (docker-compose peers); restrict to a LAN/loopback IP
SFTP_ALLOWED_HOSTS=host1,host2    # comma-separated allowlist; unset = allow all hosts
STORAGE_MAX_AGE_DAYS=30           # prune raw uploads/ingested copies older than N days; 0/unset = keep forever
ARCHIVE_MAX_EXTRACTED_MB=512      # decompression-bomb budget per archive
ARCHIVE_MAX_ENTRIES=5000          # max files extracted per archive
ALLOW_PRIVATE_URLS=true           # disables the HTTP-poll SSRF guard (only for trusted networks)
```

## Authentication

When `AUTH_ENABLED=true` (the default), all API endpoints except login/registration
and webhook ingestion require a valid JWT token.

### Accounts

There are **no default or seeded accounts**. The first user to register on a fresh
instance is granted the `admin` role; every subsequent user gets the `user` role.
Choose a strong password at registration — there is no password reset flow, so an
admin can only restore access by editing the `users` table directly.

Privileged operations (custom parsers, notification settings, settings writes)
require the `admin` role; reading a log file requires ownership or admin.

## Deployment Considerations

Lograke is designed to run on a trusted, single-organization network. Be aware of
the following when exposing it more widely:

- **File ownership**: files uploaded through the UI/API record their owner and
  are only readable by that user or an admin. Files created by sources
  (webhook, syslog, HTTP-poll, SFTP) and rows that predate ownership have no
  owner and are visible to every authenticated user — a deliberate,
  backward-compatible choice. Do not let untrusted parties register on a
  shared instance if source-ingested logs must stay private to admins.
- **Settings endpoint**: `POST /api/settings` stores AI provider keys for the
  whole instance and is admin-only (non-admins receive 403).
- **Ingestion surfaces**: syslog (UDP/TCP), webhook, and HTTP-poll sources accept
  logs from the network. Bind them to trusted interfaces only (`SYSLOG_BIND`)
  and use firewall rules. The syslog listener defaults to `0.0.0.0` so
  docker-compose peers can reach it.
- **HTTP-poll SSRF residual risk**: redirects and DNS results are re-validated,
  but a resolver that returns an allowed address and then rebinds before the
  connection (TOCTOU) is not fully preventable without pinning the resolved IP
  into the connection. Keep `ALLOW_PRIVATE_URLS` unset unless required.
- **Webhook keys**: the key is shown once, in the `POST /api/log-sources`
  response. It can also be supplied via `?apiKey=` query string for senders
  that cannot set headers — prefer the `X-API-Key` header, since query strings
  appear in intermediary logs (Lograke redacts its own request logs).
  Rotate a source (send a new key in a PUT) if a key is lost or exposed.
- **SFTP sources**: any authenticated user can configure a source pointing at
  an arbitrary host/port (the server will connect outbound on their behalf — an
  SSRF-class capability). Set `SFTP_ALLOWED_HOSTS` to an explicit list to
  contain this. Ingestion is on-demand only (browse + pull individual
  files via the Sources page); scheduled automatic polling is not implemented.
- **Archive uploads**: upload size limits apply to archives, and their
  decompressed contents are now capped (`ARCHIVE_MAX_EXTRACTED_MB` default
  512MB, `ARCHIVE_MAX_ENTRIES` default 5000) — oversized extractions are
  rejected with 413.
- **Storage growth**: parsed logs live in SQLite; raw file copies accumulate
  in `uploads/` and `data/ingested/` unless `STORAGE_MAX_AGE_DAYS` is set.
- **AI providers**: when AI features are used, log excerpts are sent to the
  configured provider (Groq/Gemini/Grok) — or stay local with Ollama. Review the
  provider's data policy before enabling.

Report anything not listed here as a vulnerability via the process below.

## Dependencies

We regularly audit dependencies for known vulnerabilities. Run `npm audit` periodically to check for issues.

## Reporting a Vulnerability

If you discover a security vulnerability, please email **security@lograke.ai**.
Do not open a public GitHub issue. We will acknowledge receipt within 48 hours
and work on a fix before public disclosure.

## Supported Versions

| Version | Supported          |
|---------|-------------------|
| 1.x     | Yes               |
| < 1.0   | No                |
