# Frontend

## Purpose

A Vercel Deployments-inspired operational dashboard for the Task Service
product boundary: start a repo-scoped agent run in a sandbox, watch it
execute through a live event stream, and inspect the terminal result and
diff. It is a plain client of the public HTTP API documented in
[Task Service](../task-service/README.md) and
[Event Service](../event-service/README.md); it owns no state the backend
doesn't already expose. User-facing copy calls a task a "run" (e.g. "New
run", "Run detail", "Cancel run"); backend API paths and field names are
unchanged (`/tasks`, `taskId`, etc.).

The app lives in [`frontend/`](../../../frontend/) as a standalone Vite +
React + TypeScript SPA, separate from the backend's `tsconfig`/build.

## Read first

- [`docs/agent-sandboxing-project.md`](../../agent-sandboxing-project.md) — product direction
- [Task Service](../task-service/README.md) — public HTTP contract and task state machine
- [Event Service](../event-service/README.md) — SSE delivery, replay cursor, and event taxonomy

## Status and scope

MVP only, matching the current task API surface:

- **New run** (`/`) — form for `repoRef`, `instructions`, optional `image`;
  `POST /tasks`, then navigates to the run detail page.
- **Run detail** (`/tasks/:taskId`) — header with run id, status badge, and
  cancel action (only shown while non-terminal); polls `GET /tasks/:taskId`
  for status/metadata; opens `GET /tasks/:taskId/events` as an `EventSource`
  for a live activity timeline, showing a non-blocking banner on stream
  disconnect; offers `DELETE /tasks/:taskId` (cancel) while the run is
  active, with its own error state near the cancel button.
- **Result** — rendered inline on the run detail page once the run reaches a
  terminal status (`completed`, `failed`, `cancelled`); fetches
  `GET /tasks/:taskId/result` and renders the exit reason, agent summary,
  failure details (if any), and the raw unified `diff` as a monospace,
  horizontally scrollable, syntax-colored panel. An empty diff renders as
  "No changes." rather than an error. Result-load failures render inside the
  result panel, separate from run polling/cancel errors.

There is no task list/history page — the backend has no list endpoint. There
is no auth, GitHub connection flow, or multi-repo support; those remain out
of scope for the backend too.

## Structure

- `frontend/src/api/types.ts` — hand-ported response/request types mirroring
  `src/types/task.types.ts` and `EVENT_TYPES` from `src/types/event.types.ts`.
  Field names must stay identical to the backend contract; update both sides
  together when the backend contract changes.
- `frontend/src/api/client.ts` — thin fetch wrapper for the four REST
  endpoints.
- `frontend/src/api/useTaskEvents.ts` — hook that opens an `EventSource`
  against a task's `eventsUrl`. Reconnect/replay uses the browser's native
  `Last-Event-ID` behavior, matching the cursor contract in the Event
  Service; no manual cursor bookkeeping is implemented client-side.
- `frontend/src/pages/` — route components (`NewTaskPage`, `TaskDetailPage`).
- `frontend/src/components/` — `AppShell` (top bar), `StatusBadge` (lifecycle
  status pill), `EventTimeline` (activity rows), `DiffView` (unified diff
  renderer).
- `frontend/src/index.css` — Geist/Vercel-inspired neutral design tokens
  (typography, color, spacing, radius) and shared layout/component classes
  (`.panel`, `.badge`, `.overview`, `.diff`, etc.) used across pages. No UI
  framework or component library is used.

## Dev-time cross-origin

The backend has no CORS middleware. `frontend/vite.config.ts` proxies
`/tasks` and `/health` to `http://localhost:3000` in dev, so the SPA calls
same-origin paths and no backend change is needed locally. A production
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
