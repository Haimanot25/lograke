# Lograke Frontend

React 19 + Vite UI for the Lograke log intelligence platform.

## Quick start

```bash
npm install
npm run dev        # http://localhost:5173 (proxies /api to http://localhost:5000)
```

The backend must be running (see the [root README](../README.md)):

```bash
cd ../backend && npm start
```

## Scripts

| Command           | Description                          |
|-------------------|--------------------------------------|
| `npm run dev`     | Dev server with HMR                  |
| `npm run build`   | Production build to `dist/`          |
| `npm run preview` | Preview the production build         |
| `npm run lint`    | ESLint                               |
| `npm test`        | Vitest unit tests                    |

## Configuration

The frontend reads `VITE_API_BASE` from `.env` in this directory. **Leave it unset** —
by default requests go to `/api` on the same origin (proxied to port 5000 in dev, and
served directly by the backend in production), which keeps the auth cookie working.

See `.env.example` for details.

## Architecture

```
src/
├── App.jsx            # Router + lazy-loaded routes
├── AppShell.jsx       # Authenticated layout (sidebar, header, toasts)
├── components/        # Reusable UI (charts, sidebar, modals, timeline)
├── context/           # Auth, file selection, toasts, modals, UI state
├── hooks/             # URL state, alert SSE, explorer logic, a11y
├── pages/             # Route-level screens (Dashboard, Explorer, …)
├── utils/             # API client, alerts, parser helpers
├── design-system.css  # Shared design tokens and component styles
└── index.css          # Global styles
```

- **API client**: `src/utils/api.js` (`fetchJSON` handles auth, errors, and JSON parsing)
- **Auth**: JWT stored in an httpOnly cookie by the backend; `AuthContext` manages state
- **State**: server state is fetched per page; UI state lives in contexts and URL params
- **Tests**: colocated under `src/**/__tests__/` (Vitest + Testing Library)
