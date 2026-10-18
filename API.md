# Lograke API Documentation

The Lograke backend provides a REST API for log ingestion, analysis, and management.

## Base URL

- Development: `http://localhost:5000/api`
- Production: the same port as the backend server (the backend also serves the built frontend).

## Authentication

When `AUTH_ENABLED=true` (the default), protected endpoints require a JWT token:

```
Authorization: Bearer <token>
```

Tokens are obtained via `POST /api/auth/login` or `POST /api/auth/register`. The API
also accepts the token from the `lograke_token` httpOnly cookie set on login, which is
how the bundled frontend authenticates.

The first user to register becomes `admin`; later registrations get the `user` role.
Endpoints marked **admin** require the `admin` role.

Webhook ingestion (`POST /api/logs/ingest/webhook/:sourceId`) is authenticated with the
source's API key instead: send it in the `X-API-Key` header.

## Response Format

Successful responses are JSON with endpoint-specific shapes, for example:

```json
{ "files": [ ... ] }
```

```json
{ "success": true, "metadata": { ... } }
```

Errors always use:

```json
{ "error": "Error message describing the issue" }
```

## Rate Limiting

| Scope   | Limit   | Window |
|---------|---------|--------|
| General | 100 req | 1 min  |
| Upload  | 10 req  | 1 min  |
| AI      | 20 req  | 1 min  |
| Login   | 20 req  | 15 min |

Rate limit headers (`RateLimit-*`) are included in responses.

## Endpoints

### Health

| Method | Endpoint   | Auth | Description                              |
|--------|------------|------|------------------------------------------|
| GET    | `/health`  | –    | Server health, AI status, uptime         |

### Auth (`/auth`)

| Method | Endpoint    | Auth  | Description |
|--------|-------------|-------|-------------|
| POST   | `/register` | –     | Register a new user (first user becomes admin) |
| POST   | `/login`    | –     | Login; sets the session cookie and returns the user |
| POST   | `/logout`   | optional | Clear the session cookie            |
| GET    | `/me`       | ✔     | Get the current user's profile        |

### Log files (`/logs`)

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST   | `/upload` | ✔ | Upload log files (multipart `file`, up to 20; `.zip`/`.tar`/`.gz` archives supported) |
| POST   | `/ingest/raw` | ✔ | Ingest raw log text pasted as JSON |
| GET    | `/files` | ✔ | List processed log files |
| GET    | `/:fileId` | ✔ | Get full file details |
| GET    | `/:fileId/metadata` | ✔ | File metadata + time buckets (lightweight) |
| DELETE | `/:fileId` | ✔ | Delete a log file and its analysis |
| GET    | `/:fileId/dashboard` | ✔ | Aggregated dashboard payload |
| GET    | `/:fileId/analysis` | ✔ | Full analysis (patterns, anomalies, entities) |
| GET    | `/:fileId/query` | ✔ | Query logs: text search, level/facet filters, pagination |
| POST   | `/:fileId/query-dsl` | ✔ | Advanced DSL query (`regex:`, `level:`, `field:value`, …) |
| GET    | `/:fileId/timeline` | ✔ | Time-bucketed log volume |
| GET    | `/:fileId/chronology` | ✔ | Chronological buckets (`bucketMinutes` query param) |
| GET    | `/:fileId/temporal-patterns` | ✔ | Time-of-day / interval patterns |
| GET    | `/:fileId/metrics-series` | ✔ | Metric series over time |
| GET    | `/:fileId/patterns` | ✔ | Detected recurring patterns |
| GET    | `/:fileId/anomalies` | ✔ | Detected statistical anomalies |
| GET    | `/:fileId/entities` | ✔ | Traceable entity summary |
| GET    | `/:fileId/trace?entity=…` | ✔ | Trace one entity across logs |
| GET    | `/:fileId/aggregations?field=…` | ✔ | Aggregated values by field |
| GET    | `/:fileId/heatmap` | ✔ | Day-of-week × hour-of-day heatmap |
| GET    | `/:fileId/tags` | ✔ | User tags for a file |
| POST   | `/:fileId/tags` | ✔ | Add a tag |
| GET    | `/:fileId/export?format=csv\|json\|md` | ✔ | Export logs |
| GET    | `/compare/:baseId/:targetId` | ✔ | Log drift comparison between two files |
| GET    | `/visualisation/graph?fileId=…` | ✔ | Entity graph data |
| GET    | `/metrics` | ✔ | Cross-file metrics |
| GET    | `/metrics/:type` | ✔ | Specific metric series |
| GET    | `/queries/saved` | ✔ | List saved queries |
| POST   | `/queries/saved` | ✔ | Save a query |
| GET    | `/stream` | ✔ | Server-Sent Events stream of parsed log lines |
| POST   | `/cache/clear` | ✔ | Clear the analysis cache |

### Alerts (`/logs/:fileId/alerts`)

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST   | `/:fileId/alerts` | ✔ | Create an alert rule |
| GET    | `/:fileId/alerts` | ✔ | Get alert rules and triggered alerts |
| GET    | `/:fileId/alerts/evaluate` | ✔ | Evaluate alerts against current data |
| DELETE | `/:fileId/alerts/:ruleId` | ✔ | Delete an alert rule |

Alert notifications are streamed over `GET /api/notifications/stream`.

### AI Copilot (`/logs`)

All AI endpoints require a configured provider (Groq/Gemini/Grok/Ollama) and are rate
limited to 20 req/min. Log excerpts are sent to the configured provider — see
[SECURITY.md](SECURITY.md).

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET    | `/:fileId/explain/:logIndex` | ✔ | AI explanation of a log line |
| POST   | `/:fileId/query-ai` | ✔ | Natural-language query against logs |
| POST   | `/:fileId/query-ai/stream` | ✔ | Streaming natural-language query (SSE) |
| GET    | `/:fileId/ai-summary` | ✔ | AI-generated file summary |
| GET    | `/ai/health` | ✔ | AI provider status |
| POST   | `/few-shot-configure` | ✔ | Configure few-shot field extraction |
| POST   | `/parsers/suggest` | ✔ | AI-suggested parser fields (see Parsers) |

### Notifications (`/notifications`)

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET    | `/stream` | ✔ | SSE stream for alert notifications |
| GET    | `/settings` | ✔ | List notification channel settings |
| POST   | `/settings` | **admin** | Create a notification channel |
| PUT    | `/settings/:id` | **admin** | Update a notification channel |
| DELETE | `/settings/:id` | **admin** | Delete a notification channel |

### Parsers (`/parsers`)

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET    | `/` | ✔ | List custom parsers |
| GET    | `/:id` | ✔ | Get one parser |
| POST   | `/` | **admin** | Create a custom parser |
| PUT    | `/:id` | **admin** | Update a custom parser |
| DELETE | `/:id` | **admin** | Delete a custom parser |
| POST   | `/suggest` | ✔ | AI-suggested field extraction |
| POST   | `/preview` | ✔ | Preview parser match results |
| POST   | `/verify` | ✔ | Verify parser syntax |
| POST   | `/:id/test` | ✔ | Test a parser against sample log lines |
| GET    | `/:id/test` | ✔ | Get stored test results |
| GET    | `/:id/export` | ✔ | Export a parser definition |
| POST   | `/import` | **admin** | Import parser definitions |

### Settings (`/settings`)

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET    | `/` | ✔ | Get all settings (API keys are masked) |
| POST   | `/` | ✔ | Update settings (`active_ai_provider`, `*_api_key`, `ollama_base_url`) |

### Log sources (`/log-sources`)

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET    | `/` | ✔ | List configured sources (with stats and ingest URLs) |
| POST   | `/` | ✔ | Create a source (`syslog`, `sftp`, `webhook`, `http_poll`) |
| GET    | `/:id` | ✔ | Get one source |
| PUT    | `/:id` | ✔ | Update a source configuration |
| DELETE | `/:id` | ✔ | Delete a source |
| POST   | `/:id/start` | ✔ | Start a source |
| POST   | `/:id/stop` | ✔ | Stop a source |
| POST   | `/:id/restart` | ✔ | Restart a source |
| POST   | `/:id/sftp-list` | ✔ | List remote files for an SFTP source |
| POST   | `/:id/sftp-ingest` | ✔ | Ingest a file from an SFTP source |

### Webhook ingestion

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST   | `/logs/ingest/webhook/:sourceId` | `X-API-Key` | Ingest log lines from an external system |

Send either one JSON object, an array of entries, or raw text body.

## Error handling

- `400` validation failed · `401` missing/invalid token · `403` not allowed / CSRF origin rejected
- `404` not found · `413` payload too large · `429` rate limited
- `500` `{ "error": "Internal server error" }` — internal details are never disclosed
