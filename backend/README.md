# lograke

**Universal Adaptive Log Intelligence Platform** — ingest, parse, search, and visualize logs from any system without custom parsers, with AI-powered insights.

This package ships the Lograke server **and** the built web UI, so a single command gives you the full app.

## Quick start

```bash
npx lograke
```

Then open http://localhost:5000 and register — the first user becomes admin.

Or install globally:

```bash
npm install -g lograke
lograke
```

## Configuration

| Variable | Description | Default |
| --- | --- | --- |
| `PORT` | HTTP port | `5000` |
| `JWT_SECRET` | Secret for JWT signing | Required in production (a per-boot dev secret triggers `authInsecure: true` in `/api/health`) |
| `AUTH_ENABLED` | Enable authentication | `true` |
| `ALLOW_PRIVATE_URLS` | Allow HTTP-poll sources to reach private network ranges | `false` |
| `SFTP_ALLOWED_HOSTS` | Comma-separated SFTP host allowlist | empty (all hosts allowed) |
| `STORAGE_MAX_AGE_DAYS` | Age-based retention for raw file copies | unset (disabled) |
| `ARCHIVE_MAX_EXTRACTED_MB` | Max decompressed size per archive | `512` |
| `ARCHIVE_MAX_ENTRIES` | Max entries per archive | `5000` |
| `SYSLOG_BIND` | Syslog listener bind address | `0.0.0.0` |

Data is stored next to the working directory under `data/` and `uploads/`.

## Documentation

- [Full README & contributor guide](https://github.com/Haimanot25/lograke#readme)
- [API reference](https://github.com/Haimanot25/lograke/blob/main/API.md)
- [Security posture & disclosure policy](https://github.com/Haimanot25/lograke/blob/main/SECURITY.md)
- [Changelog](https://github.com/Haimanot25/lograke/blob/main/CHANGELOG.md)

## License

MIT
