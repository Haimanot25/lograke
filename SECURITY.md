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
- **Rate limiting** on API endpoints (general: 100/min, uploads: 10/min, AI: 20/min, login: 20/15min)
- **JWT authentication** (on by default, controlled via `AUTH_ENABLED` env var)
- **Role-based access control** (admin/user roles for privileged endpoints)
- **Input validation** middleware on mutating routes
- **SQL injection prevention** via parameterized queries and better-sqlite3
- **ReDoS protection** for user-supplied patterns via `safe-regex2`
- **Error message sanitization** - internal errors never leak to clients
- **Configurable CORS** via environment variables
- **Request body size limits** (10MB default)

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

## Authentication

When `AUTH_ENABLED=true` (the default), all API endpoints except login/registration
and webhook ingestion require a valid JWT token.

### Accounts

There are **no default or seeded accounts**. The first user to register on a fresh
instance is granted the `admin` role; every subsequent user gets the `user` role.
Choose a strong password at registration — there is no password reset flow, so an
admin can only restore access by editing the `users` table directly.

Privileged operations (custom parsers, notification settings, log sources) require
the `admin` role.

## Deployment Considerations

Lograke is designed to run on a trusted, single-organization network. Be aware of
the following when exposing it more widely:

- **Single-tenant data model**: parsed log files are not isolated per user. Anyone
  with an account can view any uploaded file. Do not let untrusted parties register
  on a shared instance.
- **Settings endpoint**: `POST /api/settings` stores AI provider keys for the whole
  instance. Restrict who can reach it (network-level or `AUTH_ENABLED` + trusted
  users).
- **Ingestion surfaces**: syslog (UDP/TCP), webhook, and HTTP-poll sources accept
  logs from the network. Bind them to trusted interfaces only and use firewall rules.
- **SFTP sources**: any authenticated user can configure a source pointing at an
  arbitrary host/port (the server will connect outbound on their behalf — an
  SSRF-class capability). Ingestion is on-demand only (browse + pull individual
  files via the Sources page); scheduled automatic polling is not implemented.
- **Archive uploads**: upload size limits apply to archives, not to their
  decompressed contents. Prefer ingesting plain text/log files from sources you
  control.
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
