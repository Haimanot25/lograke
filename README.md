# Lograke - Universal Adaptive Log Intelligence Platform

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js Version](https://img.shields.io/badge/node-%3E%3D20.x-brightgreen)](https://nodejs.org/)
[![React Version](https://img.shields.io/badge/react-19.x-blue)](https://react.dev/)
[![CI](https://github.com/Haimanot25/lograke/actions/workflows/ci.yml/badge.svg)](https://github.com/Haimanot25/lograke/actions/workflows/ci.yml)

Lograke is an enterprise-grade, open-source log analysis platform that automatically parses, analyzes, and visualizes log files from any system without requiring custom parsers.

## Features

- **Adaptive Parsing**: Automatically detects and parses any log format
- **Multiple Input Methods**: Upload files, paste logs, or ingest from archives
- **Advanced Analysis**:
  - Pattern detection
  - Anomaly detection
  - Entity trace correlation
  - Temporal analysis
  - Log drift comparison
- **Interactive Dashboard**: Real-time metrics, KPIs, heatmaps, and sparklines
- **AI-Powered Insights**: Multi-provider support (Groq free, Gemini, Grok, Ollama local)
- **Live Tail**: Stream logs in real-time via SSE
- **Export Options**: JSON, CSV, and Markdown exports
- **Alerting**: Custom alert rules and notifications
- **Observability**: Entity graph visualization and trace correlation
- **Security**: JWT authentication, rate limiting, input validation, Helmet headers
- **Accessibility**: WCAG-compliant keyboard navigation, ARIA labels, screen reader support

## Tech Stack

### Backend
- Node.js + Express
- better-sqlite3 (database with WAL mode)
- helmet (HTTP security headers)
- bcrypt + jsonwebtoken (authentication)
- winston (structured logging)
- multer (file uploads)

### Frontend
- React 19 + Vite
- Vanilla CSS (glassmorphism dark/light theme)
- React Router (client-side routing)
- recharts (charts & visualizations)
- framer-motion (animations)
- lucide-react (icons)

## Quick Start

### Run from npm

```bash
npx lograke
```

Opens the full app (API + web UI) at http://localhost:5000 — the first registered user becomes admin.

### Prerequisites
- Node.js >= 20.x
- npm or yarn

### Installation

1. **Clone the repository**
   ```bash
   git clone https://github.com/Haimanot25/lograke.git
   cd lograke
   ```

2. **Install all dependencies**
   ```bash
   npm run install:all
   ```

3. **Configure environment variables**
   ```bash
   cp .env.example backend/.env
   # Edit backend/.env to add your API keys if needed
   ```

### Running the Application

**Development mode (recommended):**
```bash
npm run dev
# Backend runs on http://localhost:5000
# Frontend runs on http://localhost:5173
```

**Or run individually:**
```bash
# Backend
cd backend
npm start

# Frontend (in new terminal)
cd frontend
npm run dev
```

### Building for Production

```bash
npm run build    # Builds frontend
npm run start    # Starts backend (serves built frontend)
```

### Testing

```bash
# Backend unit tests (16 suites, 182 tests)
npm run test:backend

# Frontend unit tests (9 suites, 38 tests)
npm run test:frontend

# All unit tests
npm test

# E2E smoke tests (Playwright auto-starts the backend)
npm run install:e2e   # one-time: installs Playwright + Chromium
npm run build         # the smoke test serves the built frontend
npm run test:e2e
```

## Configuration

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `PORT` | Backend server port | `5000` |
| `NODE_ENV` | Environment mode | `development` |
| `CORS_ORIGIN` | Allowed origins (`*` or comma-separated) | `*` |
| `CORS_CREDENTIALS` | Allow credentialed CORS requests (keep `false` with `CORS_ORIGIN=*`) | `false` |
| `AUTH_ENABLED` | Enable JWT authentication | `true` (set `false` to disable) |
| `JWT_SECRET` | Secret for JWT signing | Required in production; auto-generated in development |
| `JWT_EXPIRES_IN` | JWT token expiry | `7d` |
| `DB_PATH` | SQLite database location | `./data/lograke.db` |
| `PUBLIC_URL` | External base URL for generated webhook URLs | request origin |
| `TRUST_PROXY` | Trusted proxy hops when behind nginx/traefik | unset |
| `ACTIVE_AI_PROVIDER` | AI provider: `groq`, `gemini`, `grok`, `ollama` | `groq` |
| `GROQ_API_KEY` | Groq API key (free) | - |
| `GEMINI_API_KEY` | Google Gemini API key | - |
| `GROK_API_KEY` | xAI Grok API key | - |
| `OLLAMA_BASE_URL` | Ollama server URL | `http://localhost:11434` |
| `MAX_JSON_BODY` | Max request body size | `10mb` |
| `MAX_FILE_SIZE` | Max upload size in bytes | `10485760` (10MB) |
| `ARCHIVE_MAX_EXTRACTED_MB` | Max decompressed size per archive upload (bomb guard) | `512` |
| `ARCHIVE_MAX_ENTRIES` | Max files extracted per archive | `5000` |
| `ALLOW_PRIVATE_URLS` | Allow http-poll sources to target loopback/private URLs (disables the SSRF guard) | `false` |
| `SYSLOG_BIND` | Syslog listener bind address | `0.0.0.0` |
| `SFTP_ALLOWED_HOSTS` | Comma-separated SFTP host allowlist (unset = allow all) | unset |
| `STORAGE_MAX_AGE_DAYS` | Prune raw uploads/ingested copies older than N days (0 = keep forever) | `0` |
| `LOG_LEVEL` | Logging level | `info` |
| `VITE_API_BASE` | Frontend API base URL (frontend only) | `/api` (same-origin proxy) |

See `.env.example` (root, fully commented), `backend/.env.example`, and `frontend/.env.example` for templates.

## Security

- **Helmet.js**: HTTP security headers (`script-src 'self'` — no inline/eval scripts)
- **Rate Limiting**: general (100/min), uploads (10/min), AI (20/min), login (20/15min)
- **JWT Authentication**: Enabled by default (first registered user becomes admin); set `AUTH_ENABLED=false` to disable
- **RBAC + file ownership**: settings/parsers/notifications are admin-only; uploaded files are scoped to their owner
- **SSRF guards**: HTTP-poll validates hostnames, resolved DNS records, and every redirect hop; SFTP honors an optional host allowlist
- **Input Validation**: Middleware-based request validation; user regexes guarded by `safe-regex2`
- **SQL Injection Prevention**: Parameterized queries via better-sqlite3
- **Error Sanitization**: Internal errors never leak to clients
- **Configurable CORS**: Restrict origins via `CORS_ORIGIN`

See [SECURITY.md](SECURITY.md) for details.

## Project Structure

```
lograke/
├── backend/
│   ├── src/
│   │   ├── ai/              # AI integration (multi-provider)
│   │   ├── analyzer/        # Analysis engines
│   │   ├── config.js        # Centralized configuration
│   │   ├── ingestion/       # Log ingestion
│   │   ├── middleware/       # Auth, validation, rate-limit, logging, errors
│   │   ├── parser/          # Log parsing (streaming + format parsers)
│   │   ├── utils/           # Shared utilities (time helpers, etc.)
│   │   ├── routes/          # API routes
│   │   ├── services/        # Business logic
│   │   ├── db.js            # Database setup (SQLite + indexes)
│   │   └── index.js         # Server entry
│   ├── __tests__/           # Jest test suites
│   ├── uploads/             # Temporary uploads (gitignored)
│   ├── package.json
│   └── .env.example
├── frontend/
│   ├── src/
│   │   ├── components/      # React components
│   │   ├── pages/           # Page components
│   │   ├── hooks/           # Custom hooks
│   │   ├── context/         # React contexts (auth, files, UI)
│   │   ├── utils/           # Utilities (API, alerts)
│   │   ├── config.js        # API_BASE configuration
│   │   ├── App.jsx          # Main app
│   │   └── main.jsx         # Entry point (with ErrorBoundary)
│   ├── package.json
│   └── vite.config.js
├── data/                    # SQLite database (gitignored, created at runtime)
├── .github/workflows/       # CI/CD (lint → test → build)
├── .dockerignore
├── Dockerfile               # Multi-stage build (non-root user)
├── docker-compose.yml
├── e2e/                     # Playwright E2E smoke tests
│   ├── playwright.config.mjs
│   └── smoke.spec.mjs
├── .env.example             # Root env template
├── SECURITY.md              # Security policy
├── CONTRIBUTING.md          # Contribution guidelines
├── LICENSE                  # MIT License
└── README.md
```

## Usage

1. **Upload Logs**: Drag and drop log files or paste raw logs
2. **Explore**: Browse parsed logs with filters, regex, and SQL-like search
3. **Analyze**: View patterns, anomalies, and entity correlations
4. **Visualize**: Check the dashboard, heatmaps, and trace timelines
5. **AI Copilot**: Ask natural language questions about your logs
6. **Export**: Download results in JSON, CSV, or Markdown

## Docker

```bash
# Generate a secret once, then build and run with Docker Compose
export JWT_SECRET=$(openssl rand -hex 32)   # Windows PowerShell: $env:JWT_SECRET = -join ((1..32) | ForEach-Object { '{0:x}' -f (Get-Random -Max 16) })
docker compose up -d

# Or build and run manually
docker build -t lograke .
docker run -d -p 5000:5000 -e JWT_SECRET=<your-secret> -v lograke_data:/app/data lograke
```

`JWT_SECRET` is **required** — the container exits at startup without it (the compose
file fails fast with a clear message). Set other environment variables via `.env` or
the `environment` section in `docker-compose.yml`. See `.env.example` for all options.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Support

If you encounter any issues or have questions, please open an issue on GitHub.
