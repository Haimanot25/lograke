# Lograke - Universal Adaptive Log Intelligence Platform

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js Version](https://img.shields.io/badge/node-%3E%3D20.x-brightgreen)](https://nodejs.org/)
[![React Version](https://img.shields.io/badge/react-19.x-blue)](https://react.dev/)
[![CI](https://github.com/lograke/lograke/actions/workflows/ci.yml/badge.svg)](https://github.com/lograke/lograke/actions/workflows/ci.yml)

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

### Prerequisites
- Node.js >= 20.x
- npm or yarn

### Installation

1. **Clone the repository**
   ```bash
   git clone https://github.com/lograke/lograke
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
# Backend unit tests (74 tests, 6 suites)
npm run test:backend

# Frontend unit tests (19 tests, 6 suites)
npm run test:frontend

# All unit tests
npm test

# E2E smoke tests (requires backend running)
npm run test:e2e
```

## Configuration

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `PORT` | Backend server port | `5000` |
| `NODE_ENV` | Environment mode | `development` |
| `CORS_ORIGIN` | Allowed origins (`*` or comma-separated) | `*` |
| `AUTH_ENABLED` | Enable JWT authentication | `true` (set `false` to disable) |
| `JWT_SECRET` | Secret for JWT signing | Required in production; auto-generated in development |
| `JWT_EXPIRES_IN` | JWT token expiry | `7d` |
| `ACTIVE_AI_PROVIDER` | AI provider: `groq`, `gemini`, `grok`, `ollama` | `groq` |
| `GROQ_API_KEY` | Groq API key (free) | - |
| `GEMINI_API_KEY` | Google Gemini API key | - |
| `GROK_API_KEY` | xAI Grok API key | - |
| `OLLAMA_BASE_URL` | Ollama server URL | `http://localhost:11434` |
| `MAX_JSON_BODY` | Max request body size | `10mb` |
| `LOG_LEVEL` | Logging level | `info` |
| `VITE_API_BASE` | Frontend API base URL | `http://localhost:5000/api` |

See `backend/.env.example` and `frontend/.env.example` for full templates.

## Security

- **Helmet.js**: HTTP security headers (CSP, HSTS, X-Frame-Options)
- **Rate Limiting**: General (100/15min), uploads (10/min), AI (20/min)
- **JWT Authentication**: Enabled by default (first registered user becomes admin); set `AUTH_ENABLED=false` to disable
- **Input Validation**: Middleware-based request validation
- **SQL Injection Prevention**: Parameterized queries via better-sqlite3
- **Error Sanitization**: Internal errors never leak to clients
- **Configurable CORS**: Restrict origins via `CORS_ORIGIN`

See [SECURITY.md](SECURITY.md) for details.

## Project Structure

```
Log2/
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
│   ├── data/                # Data storage
│   ├── uploads/             # Temporary uploads
│   ├── package.json
│   └── .env.example
├── frontend/
│   ├── src/
│   │   ├── components/      # React components
│   │   ├── pages/           # Page components
│   │   ├── utils/           # Utilities (API, alerts)
│   │   ├── config.js        # API_BASE configuration
│   │   ├── App.jsx          # Main app
│   │   └── main.jsx         # Entry point (with ErrorBoundary)
│   ├── package.json
│   └── vite.config.js
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
# Build and run with Docker Compose
docker compose up -d

# Or build and run manually
docker build -t lograke .
docker run -d -p 5000:5000 -v lograke_data:/app/data lograke
```

Set environment variables via `.env` or the `environment` section in `docker-compose.yml`. See `.env.example` for all available options.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Support

If you encounter any issues or have questions, please open an issue on GitHub.
