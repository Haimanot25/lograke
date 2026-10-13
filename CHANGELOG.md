# Changelog

## [Unreleased]

### Pre-release hardening
- Security: auth enabled by default (first registered user becomes admin); webhook ingestion remains API-key authenticated; secrets (SFTP passwords, poll bearer tokens) no longer returned by the sources API; SSRF guard for HTTP-poll sources; ReDoS protection for custom regex parsers; upload filename sanitization and body-size caps; generic error messages on internal failures
- AI: refreshed decommissioned provider model lists (Groq/Gemini/Grok) with runtime model discovery and env-configurable overrides
- Reliability: process-level unhandled error logging, test isolation, cross-platform scripts (Windows), CI workflow fixes, e2e config fixes
- Docs: README/.env.example corrections

## [1.0.0] - 2026-07-22

### Added
- Initial public release of Lograke — Universal Adaptive Log Intelligence Platform
- Multi-format log ingestion (plain text, JSON, CSV, archives)
- SQL-based query endpoint with full-text search across message, raw, metadata, and IDs
- DSL query endpoint with regex and key:value syntax, pre-filtered by SQL level index
- Entity correlation engine with timeline trace modal (KPI summary cards, color-coded entries, AI analysis)
- AI Copilot with streaming responses via Groq, Gemini, Grok, and Ollama providers
- Real-time log tail via Server-Sent Events
- Custom parser builder with AI-assisted field suggestion and regex preview
- External log source integrations (SFTP, webhook, syslog, HTTP poll)
- Alert engine with rule-based monitoring and notification dispatch
- Dashboard with KPIs, temporal heatmap, error burst detection, and log-level pie chart
- Comparative drift analysis between log files
- Pattern detection, anomaly detection, and deduplication
- HTML/CSV/JSON report generation and export

### Security
- JWT-based authentication with bcrypt password hashing
- Rate limiting on general (100/min), upload (10/min), and AI (20/min) endpoints
- Helmet security headers with configurable CSP
- CORS configuration with origin allowlist support
- Audit logging for user registration and login events
- XSS escaping in HTML report generation
- Ephemeral dev JWT secret — production requires explicit JWT_SECRET env var

### Infrastructure
- Express 5 backend with SQLite (better-sqlite3) storage
- React 19 frontend with Vite 8 build tooling
- Concurrent frontend/backend development server
- Comprehensive test suite for utility modules and alert system

### Notes
- See API.md for complete API reference
- See CONTRIBUTING.md for development setup and contribution guidelines
