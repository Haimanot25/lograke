# Lograke API Documentation

The Lograke backend provides a RESTful API for log ingestion, analysis, and management.

## Base URL

Development: `http://localhost:5000/api`
Production: The same port as the backend server.

## Authentication

When `AUTH_ENABLED=true`, protected endpoints require a JWT token in the `Authorization` header:

```
Authorization: Bearer <token>
```

Tokens are obtained via `POST /api/auth/login` or `POST /api/auth/register`.

## Response Format

All endpoints return JSON:

```json
{
  "success": true,
  "data": { ... },
  "error": null
}
```

On error:

```json
{
  "success": false,
  "error": "Error message describing the issue"
}
```

## Rate Limiting

| Scope    | Limit     | Window |
|----------|-----------|--------|
| General  | 100 req   | 1 min  |
| Upload   | 10 req    | 1 min  |
| AI       | 20 req    | 1 min  |

Rate limit headers (`X-RateLimit-*`) are included in responses.

## Endpoints

### Logs

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/logs/upload` | Upload log files (multipart/form-data) |
| POST | `/logs/ingest/raw` | Ingest raw log text |
| GET | `/logs/files` | List processed log files |
| GET | `/logs/:fileId` | Get full file details |
| GET | `/logs/:fileId/metadata` | Get file metadata |
| DELETE | `/logs/:fileId` | Delete a log file and its analysis |
| GET | `/logs/:fileId/query` | Query logs with text/filter search |
| POST | `/logs/:fileId/query-dsl` | Advanced DSL query |
| GET | `/logs/:fileId/timeline` | Time-bucketed log volume data |
| GET | `/logs/:fileId/patterns` | Detected recurring patterns |
| GET | `/logs/:fileId/anomalies` | Detected statistical anomalies |
| GET | `/logs/:fileId/entities` | Traceable entity summary |
| GET | `/logs/:fileId/trace?entity=...` | Trace a specific entity across logs |
| GET | `/logs/:fileId/aggregations?field=...` | Aggregated values by field |
| GET | `/logs/:fileId/heatmap` | Day-of-week × hour-of-day heatmap |
| GET | `/logs/:fileId/export?format=...` | Export logs (csv / json / md) |
| POST | `/logs/:fileId/sftp-ingest` | Ingest via SFTP |
| GET | `/logs/stream` | Server-Sent Events log stream |
| POST | `/logs/cache/clear` | Clear analysis cache |

### Alerts & Monitoring

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/logs/:fileId/alerts` | Create an alert rule |
| GET | `/logs/:fileId/alerts` | Get alert rules and triggered alerts |
| GET | `/logs/:fileId/alerts/evaluate` | Evaluate alerts against current data |
| GET | `/notifications/stream` | SSE stream for alert notifications |
| GET | `/notifications/settings` | Get notification channel settings |
| POST | `/notifications/settings` | Update notification channel settings |

### AI Copilot

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/logs/:fileId/explain/:logIndex` | AI explanation of a log line |
| POST | `/logs/:fileId/explain/stream` | Streaming AI explanation |
| POST | `/logs/:fileId/query-ai` | Natural language query against logs |

### Parsers

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/parsers` | List custom parsers |
| POST | `/parsers` | Create a custom parser |
| PUT | `/parsers/:id` | Update a custom parser |
| DELETE | `/parsers/:id` | Delete a custom parser |
| POST | `/parsers/suggest` | AI-suggested field extraction |
| POST | `/parsers/preview` | Preview parser match results |

### Settings

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/settings` | Get all settings |
| PATCH | `/settings` | Update settings (e.g., AI provider, API keys) |

### Health

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/health` | Server health, AI status, uptime |

### Auth

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/auth/register` | Register a new user |
| POST | `/auth/login` | Login, returns JWT token |
| GET | `/auth/me` | Get current user info |

### Log Sources

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/log-sources` | List configured external sources |
| POST | `/log-sources` | Create a source (syslog, SFTP, webhook, HTTP poll) |
| PUT | `/log-sources/:id` | Update a source configuration |
| DELETE | `/log-sources/:id` | Delete a source |
| POST | `/log-sources/:id/start` | Start a source |
| POST | `/log-sources/:id/stop` | Stop a source |
| GET | `/log-sources/:id/stats` | Get source statistics |
| POST | `/ingest/webhook/:sourceId` | Webhook ingestion endpoint |
