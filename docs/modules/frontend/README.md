# Frontend

## Purpose

A repo-scoped chat workspace for the [Chat Session Service](../chat-session/README.md)
product boundary: pick a repo, send a message, watch the resulting run
execute through a live event stream, and inspect the terminal result, diff,
and artifacts. It is a plain client of the public HTTP API documented in
[Chat Session Service](../chat-session/README.md) and
[Event Service](../event-service/README.md); it owns no state the backend
doesn't already expose.

The app lives in [`frontend/`](../../../frontend/) as a standalone Vite +
React + TypeScript SPA, separate from the backend's `tsconfig`/build.

## Read first

- [`docs/agent-sandboxing-project.md`](../../agent-sandboxing-project.md) — product direction
- [Chat Session Service](../chat-session/README.md) — public HTTP contract, run lifecycle, and harness
- [Event Service](../event-service/README.md) — SSE delivery, replay cursor, and event taxonomy

## Status and scope

MVP only, matching the current session API surface:

- **Repo select** (`/`) — shows the GitHub login-required/coming-soon state and
  recent sessions. It no longer starts the local fixture repository; `github` is a
  stored, not-yet-executable choice (backend returns the
  `501 repo_source_not_supported` error).
- **Chat workspace** (`/sessions/:sessionId`) — the primary route:
  - `MessageThread` renders the session's chat history
    (`GET /chat-sessions/:sessionId/messages`); the user bubble for a new
    message appears immediately, before the server confirms it.
  - `Composer` posts a new message (`POST
/chat-sessions/:sessionId/messages`); while a run is active, sending is
    blocked client-side to match the backend's one-active-run-per-session
    lock (`409 session_run_in_progress`).
  - `RunInspector` shows the latest/selected run's status
    (`GET /chat-sessions/:sessionId/runs/:runId`), a cancel action while
    non-terminal (`DELETE .../runs/:runId`), the terminal result
    (`GET .../runs/:runId/result`) with exit reason/summary/failure, and the
    unified diff via `DiffView`.
  - `EventTimeline` renders the live run event stream.

There is no auth or multi-user support; those remain out of scope for the
backend too.

## Structure

- `frontend/src/api/types.ts` — hand-ported response/request types mirroring
  `src/types/chat.types.ts`/`src/types/task.types.ts` and `EVENT_TYPES` from
  `src/types/event.types.ts`. Field names must stay identical to the backend
  contract; update both sides together when the backend contract changes.
- `frontend/src/api/client.ts` — thin fetch wrapper for the chat-session REST
  endpoints (sessions, messages, runs, results, artifacts).
- `frontend/src/api/useEventStream.ts` — generic hook that opens an
  `EventSource` against a session or run's events URL. Reconnect/replay uses
  the browser's native `Last-Event-ID` behavior, matching the cursor contract
  in the Event Service; no manual cursor bookkeeping is implemented
  client-side.
- `frontend/src/pages/` — route components (`RepoSelectPage`,
  `ChatWorkspacePage`).
- `frontend/src/components/` — `AppShell` (top bar), `Composer` (message
  input), `MessageThread` (chat history), `RunInspector` (run status/result),
  `StatusBadge` (lifecycle status pill), `EventTimeline` (activity rows),
  `DiffView` (unified diff renderer).
- `frontend/src/index.css` — Geist/Vercel-inspired neutral design tokens
  (typography, color, spacing, radius) and shared layout/component classes
  used across pages. No UI framework or component library is used.

## Compatibility

The legacy `NewTaskPage`/`TaskDetailPage` routes and the `/tasks` API client
were removed once the chat workspace reached equivalent coverage (Phase 7/8
of the [master plan](../../planning/repo-scoped-chat-session-agent-harness-plan.md)).
There is no task list/history page or task-shaped route left in the frontend.

## Dev-time cross-origin

The backend has no CORS middleware. `frontend/vite.config.ts` proxies
`/chat-sessions` and `/health` to `http://localhost:3000` in dev, so the SPA
calls same-origin paths and no backend change is needed locally. A production
deploy where the frontend and backend are on different origins will need
CORS (or a reverse proxy) added to the backend — not yet implemented.

## Development and verification

From `frontend/`:

```bash
npm install
npm run dev        # requires the backend running locally
npm run typecheck
npm run build
npm run lint
```

See [`frontend/README.md`](../../../frontend/README.md) for local setup
details.
