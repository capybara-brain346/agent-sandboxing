# Frontend

## Purpose

A minimal dashboard for the Task Service product boundary: create a
repo-scoped coding task, watch it run through the live task event stream,
and view terminal task metadata/results. It is a plain client of the public HTTP
API documented in [Task Service](../task-service/README.md) and
[Event Service](../event-service/README.md); it owns no state the backend
doesn't already expose.

The app lives in [`frontend/`](../../../frontend/) as a standalone Vite +
React + TypeScript SPA, separate from the backend's `tsconfig`/build.

## Read first

- [`docs/agent-sandboxing-project.md`](../../agent-sandboxing-project.md) — product direction
- [Task Service](../task-service/README.md) — public HTTP contract and task state machine
- [Event Service](../event-service/README.md) — SSE delivery, replay cursor, and event taxonomy

## Status and scope

MVP only, matching the current task API surface:

- **New Task** (`/`) — form for `repoRef`, `instructions`, optional `image`;
  `POST /tasks`, then navigates to the task detail page.
- **Task Detail** (`/tasks/:taskId`) — polls `GET /tasks/:taskId` for status,
  opens `GET /tasks/:taskId/events` as an `EventSource` for a live event
  timeline, and offers `DELETE /tasks/:taskId` (cancel) while the task is
  active.
- **Result** — rendered inline on the task detail page once the task reaches
  a terminal status; fetches `GET /tasks/:taskId/result` and renders the
  exit reason, agent summary, and failure details. The response's `diff`
  field remains part of the API contract but is not displayed by the dashboard.

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
- `frontend/src/pages/` — route components; `frontend/src/components/` —
  `EventTimeline`.

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
