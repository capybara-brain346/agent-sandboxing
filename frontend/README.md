# Frontend

Repo-scoped chat workspace for the Chat Session Service: pick a repo, send a
message, watch message processing via the live session SSE event stream, and
view the terminal result/diff. See
[`docs/modules/frontend/README.md`](../docs/modules/frontend/README.md) for
the module overview and [`docs/modules/chat-session/README.md`](../docs/modules/chat-session/README.md)
for the API contract this app consumes.

## Development

Requires the backend running locally (Postgres, Docker, and
`npm run dev` from the repo root — see the chat-session README for setup).

```bash
npm install
npm run dev
```

The Vite dev server proxies `/auth`, `/github`, `/chat-sessions`, and `/health`
to `http://localhost:3000` (see `vite.config.ts`), so no backend CORS
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

For local GitHub auth, backend `APP_BASE_URL` must point at the Vite app
(`http://localhost:5173`), while the GitHub OAuth callback and GitHub App Setup
URL both point at the backend (`http://localhost:3000/auth/github/callback` and
`http://localhost:3000/github/install/callback`).
