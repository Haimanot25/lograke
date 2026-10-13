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
- **Rate limiting** on API endpoints (general: 100/15min, uploads: 10/min, AI: 20/min)
- **JWT authentication** (optional, controlled via `AUTH_ENABLED` env var)
- **Input validation** middleware on all routes
- **SQL injection prevention** via parameterized queries and better-sqlite3
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

When `AUTH_ENABLED=true`, the following endpoints require a valid JWT token:

- `POST /api/logs/settings` (settings modification)
- Any endpoint marked as protected

### Default Credentials
- Username: `admin`
- Password: `lograke`

**Change these immediately in production.**

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
