# Changelog

## [1.0.0] - 2026-10-18

### Added
- Initial public release of Lograke — Universal Adaptive Log Intelligence Platform
- Multi-format log ingestion (plain text, JSON, CSV, archives)
- SQL-based query endpoint with full-text search across message, raw, metadata, and IDs
- DSL query endpoint with regex and key:value syntax, pre-filtered by SQL level index
- Entity correlation engine with timeline trace modal (KPI summary cards, color-coded entries, AI analysis)
- AI Copilot with streaming responses via Groq, Gemini, Grok, and Ollama providers
- Real-time log tail via Server-Sent Events
- Custom parser builder with AI-assisted field suggestion and regex preview
- External log source integrations (webhook, syslog, HTTP poll; SFTP via on-demand browser)
- Alert engine with rule-based monitoring and notification dispatch
- Dashboard with KPIs, temporal heatmap, error burst detection, and log-level pie chart
- Comparative drift analysis between log files
- Pattern detection, anomaly detection, and deduplication
- HTML/CSV/JSON report generation and export

### Security
- Auth enabled by default; the first registered user becomes admin
- JWT-based authentication with bcrypt password hashing; JWT_SECRET required in production
- Webhook ingestion authenticated per-source via API key
- Secrets (SFTP passwords, poll bearer tokens) no longer returned by the sources API
- SSRF guard for HTTP-poll sources; ReDoS protection for user-supplied regex patterns
- Upload filename sanitization and body-size caps; archive extraction limits
- Rate limiting on general (100/min), upload (10/min), AI (20/min), and login (20/15min) endpoints
- Helmet security headers with configurable CSP; CORS origin allowlist support
- Generic error messages on internal failures; audit logging for auth events
- Known limitations documented in SECURITY.md

### Testing
- Route-level integration suites for logs, ingestion, webhooks, sources, and API surface
- Security-control tests (auth, RBAC, SSRF guard, rate limiting, validation)
- Coverage thresholds enforced in CI for backend and frontend

### Changed
- `backend/src/routes/logs.js` split into focused route modules (ingest, query, analysis, alerts, AI, export, webhook, files)
- Dead code removed across backend and frontend; `express-validator` dependency dropped (hand-rolled validation remains)
- All frontend requests send `credentials: 'include'`; shared `useChartData` hook for chart endpoints
- Frontend lint at 0 errors/0 warnings; ~1,700 lines of dead CSS removed
- AI provider model lists refreshed (decommissioned models) with runtime discovery and env overrides

### Fixed
- Query engine: colon-vs-comparison token parsing, `*` wildcard escaping, camelCase `statusCode`/`durationMs` lookup
- SSE clients evicted at the 100-connection cap now have their responses closed
- Deleting a file clears its analysis cache and saved queries; source deletion awaits transport shutdown
- CORS origin list values are trimmed; parser group extraction handles escaped parentheses

### Infrastructure
- Express 5 backend with SQLite (better-sqlite3) storage
- React 19 frontend with Vite 8 build tooling
- Docker Compose fails fast when `JWT_SECRET` is missing
- Concurrent frontend/backend development server; cross-platform scripts
- CI: build, lint, test with coverage gates

### Notes
- See API.md for complete API reference (all endpoints documented)
- See SECURITY.md for security posture, deployment considerations, and disclosure policy
- See CONTRIBUTING.md for development setup and contribution guidelines
