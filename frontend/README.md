# Frontend

Minimal dashboard for the Task Service: create a sandboxed coding task, watch
it run via the live SSE event stream, and view terminal task metadata/results. See
[`docs/modules/frontend/README.md`](../docs/modules/frontend/README.md) for
the module overview and [`docs/modules/task-service/README.md`](../docs/modules/task-service/README.md)
for the API contract this app consumes.

## Development

Requires the backend running locally (Postgres, Docker, and
`npm run dev` from the repo root — see the task-service README for setup).

```bash
npm install
npm run dev
```

The Vite dev server proxies `/tasks` and `/health` to
`http://localhost:3000` (see `vite.config.ts`), so no backend CORS
configuration is needed in dev.

## Scripts

- `npm run dev` — dev server with HMR
- `npm run build` — typecheck (`tsc -b`) and production build
- `npm run typecheck` — typecheck only
- `npm run lint` — Oxlint
- `npm run preview` — preview the production build locally

## Configuration

`VITE_API_BASE_URL` (optional, see `.env.example`) — set only when the
frontend is deployed separately from the backend origin. The backend
currently has no CORS middleware; deploying the frontend cross-origin
requires adding CORS (or a reverse proxy) to the backend as a follow-up.
